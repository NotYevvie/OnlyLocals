# Local Embeddings and Reranking

High-performance local codebase indexing and retrieval for [Roo Code](https://github.com/RooCodeInc/Roo-Code). This this is (inference) model-agnostic and API-compatible with any LM-based code assistance tool that relies on [Qdrant](https://qdrant.tech/) since that's the API we are overriding. 

This setup enforces a "pseudo-CoT" (Chain of Thought) workflow by applying strict reranking filters. If an initial search lacks high relevance, the system returns narrow or empty results. This compels your AI coding assistant of choice to refine its query, ensuring only high-quality context enters the context window. The result is superior steering and a significantly more productive developer experience.

# Requirements

- Unix-like environment
- HuggingFace CLI
- NVIDIA Blackwell GPU with 6GB+ available VRAM
  - The consumer versions are RTX 50 series
  - The workstation version is [RTX PRO 6000](https://www.nvidia.com/en-us/products/workstations/professional-desktop-gpus/rtx-pro-6000/)
- AMD Ryzen 9000 series CPU (LTO / other compiler optimizations)
- 590+ drivers with CUDA 13.1 (check `nvidia-smi`)
- Docker and a logged in [huggingface-cli](https://formulae.brew.sh/formula/huggingface-cli)

# Getting Started

```bash
# Download the 1.0GB embedding model
hf download jinaai/jina-code-embeddings-0.5b

# Download the 1.2GB reranker model
hf download jinaai/jina-reranker-v3

# Run checks and one-time setup
chmod +x setup.sh
./setup.sh

# Download the embedding container
docker pull yevai/codebase-index-embed:sm120-cu131-v1

# Download the retrieval container
docker pull yevai/codebase-index-rerank:sm120-cu131-v1

# Start it up!
docker compose --profile codebase-indexing up
```

Connecting it to Roo Code and other IDEs that rely on qdrant:

- Enable Codebase Indexing
- Use the below settings
- Click "Start Indexing"

Any string value works for API Key:

![Roo Code Settings](./img/roo-index.png)

# Try It Out

## Negative Test Use Case

Once indexed, try it out with (in "Ask" mode if using Roo Code): `Search your embeddings about this codebase to find what it knows about CoIRS and if it has any interesting innovations about reranking / RAG`

If ran in this repo, little to no results outside of this mention get returned - this means our reranker is filtering properly.

## Positive Test Use Case

Next up, try `Search your embeddings about this codebase and give me the highlights.`

This should result in narrow returns. A few queries later you should see a high-quality overview of what this repo is.

# Embedding Container

This is a version of HuggingFace's [text-embeddings-inference](https://github.com/huggingface/text-embeddings-inference) with [CUDA 13.1 support and performance enhancements](https://github.com/huggingface/candle-extensions/compare/main...NotYevvie:candle-ext-cu-13010:main).


- I've upgraded the following libraries to support SM120 (blackwell) and CUDA 13.1:

  - `huggingface/candle` [Source Repository](https://github.com/huggingface/candle) | [Upgraded Link](https://github.com/NotYevvie/candle-cu-13010)
  - `huggingface/candle-extensions` [Source Repository](https://github.com/huggingface/candle-extensions) | [Upgraded Link](https://github.com/NotYevvie/candle-ext-cu-13010)
  - `huggingface/candle-index-select-cu` [Source Repository](https://github.com/michaelfeil/candle-index-select-cu) | [Upgraded Link](https://github.com/NotYevvie/candle-select-cu-13010)
- Performance-optimized Flash Attention and LTO as well as CPU optimizations.
- A sprinkle of extra low-level magic with a focus on single-GPU performance.

# Reranker Container

This is a Qdrant retrieval proxy based on the NVIDIA NGC PyTorch 25.12-py3 container with:

- Highly customized version of FBGEMM tuned for SM120 performance.
- Flash Attention 2 and TorchAO int4 quantization for Blackwell.

The rough gist of how this works is: Pull top 100, rerank with extreme prejudice, track latest query for context.

# Troubleshooting

I put some effort into making the setup script comprehensive and user-friendly but I fully expect this to not work out-of-the-box on all applicable machine types. 

- Found a bug? Please [open a GitHub issue](https://github.com/NotYevvie/OnlyLocals/issues/new/choose).
- Stuck on setup? [Message me on LinkedIn](https://www.linkedin.com/in/yevgen-reztsov-5646346b/)!

# What's Next

If this gets any traction, I'll create containers optimized for:

- ABM (Apple baremetal, the M-series chips)
- Older NVIDIA GPUs (be warned - bad perf)

Beyond that, I'd like to slowly distill more of my secret sauce into the public docker image of the reranker without [my latest startup's](https://www.yev.ai/) lawyers and technical due diligence team having an aneyurism. This includes stuff like temporal context linkage and some rudimentary linear algebra dark magic for the vectors themselves.

Unless this blows up, I'll release another part of the setup that includes the actual model I run locally for primary LM code assist inference when I have time!