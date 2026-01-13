import { runCommand } from "./runner.ts";

declare const process: any;

let hfCacheDir: string | null = null;
const modelPaths: Map<string, string> = new Map();

export async function getHfCacheDir(): Promise<string> {
  if (hfCacheDir) {
    return hfCacheDir;
  }
  
  const result = await runCommand("hf env");
  if (result.exitCode !== 0) {
    throw new Error("Failed to get HF environment info");
  }
  
  const lines = result.stdout.split('\n');
  const cacheLine = lines.find(line => line.includes('HF_HUB_CACHE:'));
  if (!cacheLine) {
    throw new Error("Could not find HF_HUB_CACHE in hf env output");
  }
  
  hfCacheDir = cacheLine.split(':')[1].trim();
  return hfCacheDir;
}

export async function getModelPath(modelName: string): Promise<string> {
  const cacheKey = modelName;
  
  if (modelPaths.has(cacheKey)) {
    return modelPaths.get(cacheKey)!;
  }
  
  const hfCache = await getHfCacheDir();
  const modelNameClean = modelName.replace('model/', '');
  const modelPath = `${hfCache}/models--${modelNameClean.replace(/\//g, '--')}`;
  
  const dirCheck = await runCommand(`[ -d "${modelPath}" ] && echo "exists"`);
  if (dirCheck.exitCode !== 0 || !dirCheck.stdout.includes('exists')) {
    throw new Error(`Model not found at ${modelPath}`);
  }
  
  modelPaths.set(cacheKey, modelPath);
  return modelPath;
}

export async function getModelSnapshot(modelName: string): Promise<string> {
  const cacheKey = `${modelName}:snapshot`;
  
  if (modelPaths.has(cacheKey)) {
    return modelPaths.get(cacheKey)!;
  }
  
  const modelPath = await getModelPath(modelName);
  
  const snapshotResult = await runCommand(`find "${modelPath}/snapshots" -maxdepth 1 -mindepth 1 -type d | head -n 1`);
  if (snapshotResult.exitCode !== 0 || !snapshotResult.stdout.trim()) {
    throw new Error(`No snapshot found in ${modelPath}/snapshots`);
  }
  
  const snapshotDir = snapshotResult.stdout.trim();
  modelPaths.set(cacheKey, snapshotDir);
  return snapshotDir;
}