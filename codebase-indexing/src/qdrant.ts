import { runCommand } from "./runner.ts";

declare const process: any;

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const PROXY_URL = process.env.PROXY_URL || 'http://localhost:1335';

// These are here because they are lightweight, zero dependency, and work on Node/Bun/Deno
const getJsonFromQdrantApi = async (url: string) => {
  return JSON.parse(await (await fetch(`${QDRANT_URL}/${url}`)).text());
}

const getUserInput = async (prompt: string) => {
  const result = await runCommand(`
    printf '\n%s' "${prompt}" > /dev/tty
    read input < /dev/tty
    echo "$input"
  `);
  return result.stdout.trim();
}

const getEmbedding = async (text: string): Promise<number[]> => {
  const response = await fetch(`${PROXY_URL}/v1/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embeddings failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();

  return data.data[0].embedding;
}

const searchVectors = async (
  collectionName: string,
  vector: number[],
  filePath?: string,
  limit: number = 10
) => {
  const response = await fetch(
    `${PROXY_URL}/collections/${collectionName}/points/search`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...{
          vector,
          limit,
          with_payload: true,
        }, ...{ filter: filePath ? { must: [{ key: "file_path", match: { value: filePath } }] } : undefined }
      }),
    }
  );
  if (!response.ok) {
    throw new Error(`Search failed: ${response.status}`);
  }
  return await response.json();
};



(async () => {
  if (typeof fetch === 'undefined') {
    console.error('Fetch native API is unavailable. Node.js Users: Please upgrade to v18+');
    process.exit(1);
  }

  let details: any[] = [];

  try {
    const { collections } = (await getJsonFromQdrantApi('collections')).result;
    details = await Promise.all(collections.map(async (col: any) => {
      const { points_count } = (await getJsonFromQdrantApi(`collections/${col.name}`)).result;
      return {
        name: col.name,
        points_count
      };
    }));
  } catch {
    console.error(`Failed to connect to Qdrant at ${QDRANT_URL}. Please ensure Qdrant is running.`);
    process.exit(1);
  }

  console.log('Available collections:');
  console.log(details.map((detail: any, idx: number) => `  Index: [${idx}] Name: [${detail.name}] - Vectors: [${detail.points_count}]`).join('\n'));
  const collectionIndex = await getUserInput('Select collection index (type in 1, 2, 3 etc and hit Enter. default 0): ') || '0';
  const activeCollectionName = details[parseInt(collectionIndex, 10)]?.name;
  const numResultsInput = await getUserInput('Enter number of results to return (default 5): ');
  const searchFile = await getUserInput('Optional file path filter (Ex.: "src/index" or "codebase-indexing/docker-compose.yaml"): ') || '';
  

  while (true) {
    const userQuestion = await getUserInput('Enter search query (or "quit" or "exit"): ');
    if (userQuestion.toLowerCase() === 'quit' || userQuestion.toLowerCase() === 'exit') {
      console.log('\nExiting!\n');
      break;
    }
    if (!userQuestion.trim()) {
      continue;
    }
    const vectorArray = await getEmbedding(userQuestion);
    const { result } = await searchVectors(
      activeCollectionName,
      vectorArray,
      searchFile,
      parseInt(numResultsInput, 10) || 5
    );

    console.dir(result, { depth: null });
    console.log(`\n${"=".repeat(80)}`);
    console.log(`Search Results for: "${userQuestion}"`);
    console.log(`${"=".repeat(80)}`);

    result.forEach((hit: any, idx: number) => {
      const p = hit.payload;
      console.log(`\n[${idx + 1}] Score: ${hit.score.toFixed(4)}`);
      console.log(`${p.filePath}:${p.startLine}-${p.endLine}`);
      console.log(`${"-".repeat(80)}`);
      console.log(p.codeChunk);
      console.log("");
    });
  }
})();