import asyncio
import base64 as b64
import hashlib
import json
import logging
import os
import random
import struct
import sys
import time
from collections import OrderedDict
from contextlib import asynccontextmanager

import httpx
import torch
import uvicorn
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from torchao.quantization import quantize_, Int4WeightOnlyConfig, Int8WeightOnlyConfig
from transformers import AutoModel, AutoModelForCausalLM, AutoTokenizer

logger = logging.getLogger("SmartProxy")
logger.setLevel(logging.INFO)
logger.propagate = False
_handler = logging.StreamHandler(sys.stdout)
_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] SmartProxy: %(message)s"))
logger.addHandler(_handler)

env = os.environ.get


def require_env(name: str) -> str:
    if not (value := env(name)):
        logger.error(f"Required ENV var '{name}' not set")
        sys.exit(1)
    return value


TEI_BASE_URL = require_env("TEI_BASE_URL")
VECTOR_DB_BASE_URL = require_env("VECTOR_DB_BASE_URL")
PORT = int(env("PORT", 8000))
MODEL_PATH = env("MODEL_PATH", "jinaai/jina-reranker-v3")

RERANKER_STYLE = env("RERANKER_STYLE", "auto").strip().lower()
if RERANKER_STYLE == "auto":
    RERANKER_STYLE = "qwen3" if "qwen3-reranker" in MODEL_PATH.lower() else "jina"

# qwen3 is pointwise (one forward per pair); jina v3 is listwise (64 candidates native).
RERANK_BATCH_SIZE = int(env("RERANK_BATCH_SIZE", 8 if RERANKER_STYLE == "qwen3" else 64))
RERANK_CANDIDATES = int(env("RERANK_CANDIDATES", 100))
RERANK_TIMEOUT_S = float(env("RERANK_TIMEOUT_S", 60))
RERANK_MIN_SCORE = float(env("RERANK_MIN_SCORE", 0.10))
RERANK_MAX_LENGTH = int(env("RERANK_MAX_LENGTH", 8192))
RERANK_INSTRUCTION = env("RERANK_INSTRUCTION", "Given a code search query, retrieve relevant code snippets that answer the query")
REQUIRE_RERANKER = env("REQUIRE_RERANKER", "0") == "1"
TEI_RETRIES = int(env("TEI_RETRIES", 4))
TEI_BACKOFF_BASE_S = float(env("TEI_BACKOFF_BASE_S", 0.5))
EMBED_CONCURRENCY = int(env("EMBED_CONCURRENCY", 4))
# TEI batching is independent of reranker batch size; keep <= TEI --max-client-batch-size.
EMBED_BATCH_SIZE = int(env("EMBED_BATCH_SIZE", 32))
QUERY_MAX_LEN = int(env("QUERY_MAX_LEN", 2000))
QUERY_CACHE_SIZE = int(env("QUERY_CACHE_SIZE", 1000))
QUERY_CACHE_TTL = int(env("QUERY_CACHE_TTL", 120))

# Qwen3-Embedding: instructed queries, bare documents. Jina: fixed prefixes on both
# sides. Misaligned prefixes wreck NN accuracy.
EMBED_STYLE = env("EMBED_STYLE", "auto").strip().lower()
if EMBED_STYLE == "auto":
    EMBED_STYLE = "qwen3" if "qwen3-embedding" in env("EMBEDDING_MODEL_PATH", "").lower() else "jina"

EMBED_INSTRUCTION = env("EMBED_INSTRUCTION", "Given a code search query, retrieve relevant code snippets that answer the query")

if EMBED_STYLE == "qwen3":
    QUERY_PREFIX = env("QUERY_PREFIX", f"Instruct: {EMBED_INSTRUCTION}\nQuery:")
    PASSAGE_PREFIX = env("PASSAGE_PREFIX", "")
else:
    QUERY_PREFIX = env("QUERY_PREFIX", "Find the code snippet most similar to the query of:\n")
    PASSAGE_PREFIX = env("PASSAGE_PREFIX", "Candidate code snippet:\n")

EMBED_MODEL_ID = "qwen3-embedding" if EMBED_STYLE == "qwen3" else "jina-code-embeddings"
RERANK_MODEL_ID = "qwen3-reranker" if RERANKER_STYLE == "qwen3" else "jina-reranker-v3"


class QueryCache:
    def __init__(self, size: int, ttl: int):
        self.data: OrderedDict[str, tuple[str, float]] = OrderedDict()
        self.size, self.ttl = size, ttl
        self.hits = self.misses = 0
        self.lock = asyncio.Lock()

    @staticmethod
    def key(vector: list) -> str:
        return hashlib.md5(",".join(f"{v:.4f}" for v in vector[:32]).encode()).hexdigest()

    def prune(self) -> None:
        now = time.time()
        for k in [k for k, (_, ts) in self.data.items() if now - ts > self.ttl]:
            del self.data[k]

    async def store(self, vector: list, text: str) -> None:
        async with self.lock:
            self.prune()
            self.data[k := self.key(vector)] = (text, time.time())
            self.data.move_to_end(k)
            if len(self.data) > self.size:
                self.data.popitem(last=False)

    async def get(self, vector: list) -> str | None:
        async with self.lock:
            self.prune()
            if entry := self.data.get(k := self.key(vector)):
                self.hits += 1
                self.data.move_to_end(k)
                return entry[0]
            self.misses += 1
            return None

    async def stats(self) -> dict:
        async with self.lock:
            total = self.hits + self.misses
            return {
                "size": len(self.data),
                "max_size": self.size,
                "ttl_seconds": self.ttl,
                "hits": self.hits,
                "misses": self.misses,
                "hit_rate": self.hits / total if total else 0.0,
            }


query_cache = QueryCache(QUERY_CACHE_SIZE, QUERY_CACHE_TTL)
http_client: httpx.AsyncClient | None = None
model = None
model_load_error: str | None = None
rerank_gpu_lock = asyncio.Semaphore(1)
tei_semaphore = asyncio.Semaphore(EMBED_CONCURRENCY)
started_at = time.time()


class Qwen3RerankerAdapter:
    """Qwen3-Reranker yes/no-logit scoring behind jina's .rerank() contract.
    Scores are P(yes) in [0, 1], so RERANK_MIN_SCORE keeps its meaning."""

    PREFIX = (
        '<|im_start|>system\nJudge whether the Document meets the requirements '
        'based on the Query and the Instruct provided. Note that the answer can '
        'only be "yes" or "no".<|im_end|>\n<|im_start|>user\n'
    )
    SUFFIX = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"

    def __init__(self, model_path: str):
        self.tokenizer = AutoTokenizer.from_pretrained(model_path, padding_side="left")
        self.model = AutoModelForCausalLM.from_pretrained(
            model_path,
            attn_implementation="flash_attention_2",
            dtype=torch.bfloat16,
            device_map="cuda",
        )
        self.token_yes, self.token_no = map(self.tokenizer.convert_tokens_to_ids, ("yes", "no"))
        self.prefix_ids = self.tokenizer.encode(self.PREFIX, add_special_tokens=False)
        self.suffix_ids = self.tokenizer.encode(self.SUFFIX, add_special_tokens=False)

    def eval(self):
        self.model.eval()
        return self

    @torch.no_grad()
    def rerank(self, query: str, documents: list) -> list[dict]:
        enc = self.tokenizer(
            [f"<Instruct>: {RERANK_INSTRUCTION}\n<Query>: {query}\n<Document>: {doc}" for doc in documents],
            padding=False,
            truncation="longest_first",
            add_special_tokens=False,
            return_attention_mask=False,
            max_length=RERANK_MAX_LENGTH - len(self.prefix_ids) - len(self.suffix_ids),
        )
        enc["input_ids"] = [self.prefix_ids + ids + self.suffix_ids for ids in enc["input_ids"]]
        inputs = self.tokenizer.pad(enc, padding=True, return_tensors="pt").to(self.model.device)
        try:
            # Final position only: full logits (batch x seq x ~152k vocab) would be tens of GB.
            logits = self.model(**inputs, logits_to_keep=1).logits[:, -1, :]
        except TypeError:
            logits = self.model(**inputs).logits[:, -1, :]
        scores = torch.stack([logits[:, self.token_no], logits[:, self.token_yes]], dim=1).float().softmax(dim=1)[:, 1]
        return [{"index": i, "relevance_score": float(s)} for i, s in enumerate(scores.tolist())]


@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client, model, model_load_error
    # int4 excluded from the default cascade: CUTLASS int4 kernels fail at inference on Blackwell.
    for mode in [m.strip() for m in env("RERANKER_QUANT", "none,int8").split(",") if m.strip()]:
        logger.info(f"Loading Reranker ({MODEL_PATH}) style={RERANKER_STYLE} quant={mode}...")
        try:
            if RERANKER_STYLE == "qwen3":
                candidate = Qwen3RerankerAdapter(MODEL_PATH)
                target = candidate.model
            else:
                candidate = target = AutoModel.from_pretrained(
                    MODEL_PATH,
                    trust_remote_code=True,
                    attn_implementation="flash_attention_2",
                    dtype=torch.bfloat16,
                    device_map="cuda",
                )
            if mode == "int4":
                quantize_(target, Int4WeightOnlyConfig(group_size=128))
            elif mode == "int8":
                quantize_(target, Int8WeightOnlyConfig())
            candidate.eval()
            result = candidate.rerank("self test query", ["def hello():\n    pass"])
            assert result and "relevance_score" in result[0]
            model, model_load_error = candidate, None
            logger.info(f"Reranker Loaded (quant={mode}) - self-test passed")
            break
        except Exception as e:
            model, model_load_error, candidate = None, f"quant={mode}: {e}", None
            logger.error(f"Reranker unusable with quant={mode}: {e}")
            torch.cuda.empty_cache()

    if model is None:
        logger.error(f"Failed to load reranker: {model_load_error}")
        if REQUIRE_RERANKER:
            logger.error("REQUIRE_RERANKER=1, refusing to start without reranker")
            sys.exit(1)
        logger.error("SERVING WITHOUT RERANKING - search results will use raw vector scores")

    http_client = httpx.AsyncClient(
        timeout=120.0,
        limits=httpx.Limits(max_keepalive_connections=20, max_connections=100),
    )
    yield
    await http_client.aclose()


app = FastAPI(lifespan=lifespan)


@app.middleware("http")
async def normalize_path(request: Request, call_next):
    path = original = request.scope.get("path", "")
    while "//" in path:
        path = path.replace("//", "/")
    if path != original:
        logger.info(f"Normalized path '{original}' -> '{path}'")
        request.scope["path"] = path
        request.scope["raw_path"] = path.encode()
    return await call_next(request)


async def tei_embed_batch(inputs: list[str]) -> list:
    async with tei_semaphore:
        for attempt in range(TEI_RETRIES + 1):
            try:
                resp = await http_client.post(f"{TEI_BASE_URL}/embed", json={"inputs": inputs, "truncate": True})
                if resp.status_code in (429, 503):
                    raise httpx.HTTPStatusError(f"TEI transient {resp.status_code}", request=resp.request, response=resp)
                resp.raise_for_status()
                return resp.json()
            except (httpx.TimeoutException, httpx.ConnectError, httpx.HTTPStatusError) as e:
                transient = not isinstance(e, httpx.HTTPStatusError) or e.response.status_code in (429, 503)
                if not transient or attempt == TEI_RETRIES:
                    raise
                delay = TEI_BACKOFF_BASE_S * 2**attempt + random.uniform(0, 0.25)
                logger.warning(f"TEI transient failure (attempt {attempt + 1}/{TEI_RETRIES + 1}): {e}. Retrying in {delay:.2f}s")
                await asyncio.sleep(delay)
    raise RuntimeError("TEI embed failed after retries")


def classify_query(raw, texts: list[str]) -> bool:
    if len(texts) != 1 or len(texts[0]) >= QUERY_MAX_LEN:
        return False
    return isinstance(raw, str) or "\n" not in texts[0]


def extract_vector(value) -> list | None:
    if isinstance(value, dict):
        value = value.get("vector") or value.get("nearest")
    if isinstance(value, list) and value and isinstance(value[0], (int, float)):
        return value
    return None


async def probe(url: str) -> bool:
    try:
        return (await http_client.get(url, timeout=5.0)).status_code == 200
    except Exception:
        return False


@app.get("/health")
async def health():
    tei, qdrant = await asyncio.gather(probe(f"{TEI_BASE_URL}/health"), probe(f"{VECTOR_DB_BASE_URL}/readyz"))
    ok = tei and qdrant
    body = {
        "status": "ok" if ok else "degraded",
        "uptime_seconds": round(time.time() - started_at, 1),
        "tei": tei,
        "qdrant": qdrant,
        "reranker_loaded": model is not None,
        "reranker_error": model_load_error,
        "query_cache": await query_cache.stats(),
    }
    return Response(json.dumps(body), 200 if ok else 503, {"Content-Type": "application/json"})


@app.get("/v1/models")
async def models():
    return {
        "object": "list",
        "data": [
            {"id": EMBED_MODEL_ID, "object": "model", "created": 1686935002, "owned_by": "smart-proxy"},
            {"id": RERANK_MODEL_ID, "object": "model", "created": 1686935002, "owned_by": "smart-proxy"},
        ],
    }


@app.get("/v1/cache/stats")
async def cache_stats():
    return await query_cache.stats()


@app.post("/v1/embeddings")
async def embeddings(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON")

    raw = body.get("input")
    if not raw:
        raise HTTPException(400, "Missing input")
    texts = [raw] if isinstance(raw, str) else raw
    if not texts:
        raise HTTPException(400, "Empty input array")

    kind = body.get("input_type") or request.headers.get("x-embedding-kind")
    is_query = kind == "query" if kind in ("query", "document", "passage") else classify_query(raw, texts)
    inputs = [(QUERY_PREFIX if is_query else PASSAGE_PREFIX) + t for t in texts]

    try:
        batches = await asyncio.gather(
            *(tei_embed_batch(inputs[i : i + EMBED_BATCH_SIZE]) for i in range(0, len(inputs), EMBED_BATCH_SIZE))
        )
        vectors = [v for batch in batches for v in batch]
    except httpx.HTTPStatusError as e:
        logger.error(f"TEI Embedder Failed: {e.response.status_code} - {e.response.text}")
        raise HTTPException(429 if e.response.status_code in (429, 503) else 500, f"Embedder Failed: {e.response.status_code}")
    except (httpx.TimeoutException, httpx.ConnectError, RuntimeError) as e:
        logger.error(f"TEI Embedder transient failure after retries: {e}")
        raise HTTPException(429, "Embedder busy or warming up - retry")
    except Exception as e:
        logger.error(f"TEI Embedder Failed: {e}")
        raise HTTPException(500, "Embedder Failed")

    if is_query and vectors and texts[0]:
        await query_cache.store(vectors[0], texts[0])

    tokens = max(1, sum(len(t) for t in texts) // 4)
    encode = (
        (lambda v: b64.b64encode(struct.pack(f"<{len(v)}f", *v)).decode())
        if body.get("encoding_format") == "base64"
        else (lambda v: v)
    )
    return {
        "object": "list",
        "data": [{"object": "embedding", "embedding": encode(v), "index": i} for i, v in enumerate(vectors)],
        "model": EMBED_MODEL_ID,
        "usage": {"prompt_tokens": tokens, "total_tokens": tokens},
    }


async def rerank_points(query: str, points: list) -> list | None:
    candidates, indices = [], []
    for i, hit in enumerate(points):
        payload = hit.get("payload", {})
        text = next((payload[k] for k in ("codeChunk", "text", "content", "snippet", "code") if payload.get(k)), None)
        path = next((payload[k] for k in ("filePath", "file_path", "path", "filename") if payload.get(k)), None)
        if text:
            candidates.append(f"File: {path}\n{text}" if path else text)
            indices.append(i)

    if not candidates:
        logger.warning("No candidate text in payloads - skipping rerank")
        return None

    logger.info(f"Reranking {len(candidates)} candidates")

    async def score_all():
        scores = []
        for start in range(0, len(candidates), RERANK_BATCH_SIZE):
            async with rerank_gpu_lock:
                batch = await run_in_threadpool(model.rerank, query, candidates[start : start + RERANK_BATCH_SIZE])
            scores.extend({**item, "index": item["index"] + start} for item in batch)
        return scores

    try:
        scored = await asyncio.wait_for(score_all(), timeout=RERANK_TIMEOUT_S)
    except asyncio.TimeoutError:
        logger.error(f"Reranking timed out after {RERANK_TIMEOUT_S}s - falling back to vector scores")
        return None
    except Exception as e:
        logger.error(f"Reranking Failed: {e}")
        return None

    reranked = []
    for item in scored:
        hit = points[indices[item["index"]]]
        hit["score"] = float(item["relevance_score"])
        reranked.append(hit)
    return sorted(reranked, key=lambda h: h["score"], reverse=True)


def finalize(points: list, threshold, limit: int, reranked: bool) -> list:
    if reranked:
        points = [h for h in points if h.get("score", 0) >= RERANK_MIN_SCORE]
        logger.info(f"After rerank threshold ({RERANK_MIN_SCORE}): {len(points)} results")
    elif threshold is not None:
        points = [h for h in points if h.get("score", 0) >= threshold]
        logger.info(f"After threshold filter ({threshold}): {len(points)} results")
    return points[:limit]


async def qdrant_passthrough(collection: str, api: str, body: dict) -> Response:
    try:
        resp = await http_client.post(f"{VECTOR_DB_BASE_URL}/collections/{collection}/points/{api}", json=body)
        return Response(
            resp.content,
            resp.status_code,
            {"Content-Type": resp.headers.get("Content-Type", "application/json"), "Connection": "close"},
        )
    except Exception as e:
        logger.error(f"Qdrant {api} passthrough failed: {e}")
        raise HTTPException(502, "Qdrant Failed")


async def smart_search(collection: str, request: Request, api: str):
    logger.info(f"{'Search' if api == 'search' else 'Query'}: {collection}")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON")

    vec = extract_vector(body.get("vector" if api == "search" else "query"))
    query = await query_cache.get(vec) if vec else None

    if not (query and model):
        logger.info(f"Reranker not loaded ({model_load_error}) - passthrough" if model is None
                    else "No query text found in cache - passthrough without rerank")
        return await qdrant_passthrough(collection, api, body)

    logger.info(f"Correlated query: {query[:50]}...")
    limit = body.get("limit", 20)
    threshold = body.pop("score_threshold", None)
    body["limit"] = RERANK_CANDIDATES
    body["with_payload"] = True

    try:
        resp = await http_client.post(f"{VECTOR_DB_BASE_URL}/collections/{collection}/points/{api}", json=body)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logger.error(f"Qdrant {api} Failed: {e}")
        raise HTTPException(502, "Qdrant Failed")

    result = data.get("result")
    points = result.get("points", []) if isinstance(result, dict) else result or []

    ranked = await rerank_points(query, points) if points else None
    final = finalize(ranked if ranked is not None else points, threshold, limit, ranked is not None)

    if isinstance(result, dict):
        result["points"] = final
    elif api == "search":
        data["result"] = final
    return data


@app.post("/collections/{collection}/points/search")
async def search_route(collection: str, request: Request):
    return await smart_search(collection, request, "search")


@app.post("/collections/{collection}/points/query")
async def query_route(collection: str, request: Request):
    return await smart_search(collection, request, "query")


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"])
async def catch_all(request: Request, path: str):
    excluded = {"host", "content-length", "transfer-encoding", "connection", "keep-alive", "accept-encoding"}
    headers = {k: v for k, v in request.headers.items() if k.lower() not in excluded}
    headers["Accept-Encoding"] = "identity"
    content = request.stream() if request.method in ("POST", "PUT", "PATCH") else None

    try:
        resp = await http_client.request(
            request.method,
            f"{VECTOR_DB_BASE_URL}/{path}",
            content=content,
            params=request.query_params,
            headers=headers,
        )
        if resp.status_code == 409 and request.method == "PUT" and path.startswith("collections/"):
            logger.info("Converting 409 Conflict to 200 OK (collection already exists)")
            return Response(b'{"result":true,"status":"ok"}', 200, {"Content-Type": "application/json", "Connection": "close"})

        drop = {"content-length", "transfer-encoding", "connection", "content-encoding"}
        out = {k: v for k, v in resp.headers.items() if k.lower() not in drop} | {"Connection": "close"}
        return Response(resp.content, resp.status_code, out)
    except httpx.ConnectError as e:
        logger.error(f"Proxy fail (vector DB unreachable at {VECTOR_DB_BASE_URL}): {e}")
        raise HTTPException(502, f"Vector DB unreachable: {e}")
    except Exception as e:
        logger.error(f"Proxy fail: {e}")
        raise HTTPException(502, f"Proxy Failed: {e}")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")
