import { runCommand } from "./runner.ts";

declare const process: any;

// Check if Docker is installed
async function checkDocker(): Promise<boolean> {
  const result = await runCommand("which docker");
  if (result.exitCode !== 0) {
    console.error("Error: docker is not installed or not in PATH. Install it with:");
    console.error("curl -fsSL https://get.docker.com | sh\n");
    console.error("And add your user to the docker group:");
    console.error("sudo usermod -aG docker $USER\n");
    return false;
  }
  console.log("  docker found");
  return true;
}

// Check if nvidia-smi is installed
async function checkNvidiaSmi(): Promise<boolean> {
  const result = await runCommand("which nvidia-smi");
  if (result.exitCode !== 0) {
    console.error("Error: nvidia-smi is not installed or not in PATH");
    console.error("Note: NVIDIA GPU and drivers are required for this setup");
    return false;
  }
  console.log("  nvidia-smi found");
  return true;
}

// Check if Hugging Face CLI is installed
async function checkHuggingFaceCli(): Promise<boolean> {
  const result = await runCommand("which hf");
  if (result.exitCode !== 0) {
    console.error("Error: Hugging Face CLI (hf) is not installed or not in PATH. Install it with:");
    
    // Check for available package managers
    const brew = await runCommand("which brew");
    const pipx = await runCommand("which pipx");
    const pip3 = await runCommand("which pip3");
    const pip = await runCommand("which pip");
    
    if (brew.exitCode === 0) {
      console.error("  brew install huggingface-cli");
    } else if (pipx.exitCode === 0) {
      console.error("  pipx install huggingface_hub[cli]");
    } else if (pip3.exitCode === 0) {
      console.error("  pip3 install huggingface_hub[cli]");
    } else if (pip.exitCode === 0) {
      console.error("  pip install huggingface_hub[cli]");
    } else {
      console.error("  No package manager found. Recommended: install Homebrew with:");
      console.error('  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
      console.error("  Then run: brew install huggingface-cli");
    }
    return false;
  }
  console.log("  hf found");
  return true;
}

// Check GPU compute capability
async function checkGpu(): Promise<boolean> {
  const result = await runCommand("nvidia-smi --query-gpu=compute_cap --format=csv,noheader");
  if (result.exitCode !== 0) {
    console.error("Error: Failed to query GPU compute capability");
    return false;
  }
  
  const computeCap = result.stdout.trim().split('\n')[0].trim();
  const major = computeCap.split('.')[0];
  
  if (major !== '12') {
    console.error(`Error: Blackwell GPU (compute capability 12.x) required`);
    console.error(`Found: ${computeCap}`);
    return false;
  }
  
  console.log(`  Compute capability ${computeCap} found`);
  return true;
}

// Check CUDA version
async function checkCuda(): Promise<boolean> {
  const result = await runCommand("nvidia-smi | grep 'CUDA Version' | awk '{print $9}'");
  if (result.exitCode !== 0) {
    console.error("Error: Failed to query CUDA version");
    return false;
  }
  
  const cudaVersion = result.stdout.trim();
  const major = parseInt(cudaVersion.split('.')[0]);
  
  if (major < 13) {
    console.error(`Error: CUDA 13.1+ required, found: ${cudaVersion}`);
    return false;
  }
  
  console.log(`  CUDA version ${cudaVersion} found`);
  return true;
}

// Get Hugging Face cache directory
async function getHfCache(): Promise<string | null> {
  const result = await runCommand("hf env");
  if (result.exitCode !== 0) {
    console.error("Error: Failed to get HF environment info");
    return null;
  }
  
  const lines = result.stdout.split('\n');
  const cacheLine = lines.find(line => line.includes('HF_HUB_CACHE:'));
  if (!cacheLine) {
    console.error("Error: Could not find HF_HUB_CACHE in hf env output");
    return null;
  }
  
  const cache = cacheLine.split(':')[1].trim();
  return cache;
}

// Verify a model exists and get its snapshot directory
async function verifyModel(modelName: string, hfCache: string): Promise<string | null> {
  const modelNameClean = modelName.replace('model/', '');
  const modelPath = `${hfCache}/models--${modelNameClean.replace(/\//g, '--')}`;
  
  // Check if model directory exists
  const dirCheck = await runCommand(`[ -d "${modelPath}" ] && echo "exists"`);
  if (dirCheck.exitCode !== 0 || !dirCheck.stdout.includes('exists')) {
    console.error(`Error: Model not found at ${modelPath}`);
    return null;
  }
  
  // Find snapshot directory
  const snapshotResult = await runCommand(`find "${modelPath}/snapshots" -maxdepth 1 -mindepth 1 -type d | head -n 1`);
  if (snapshotResult.exitCode !== 0 || !snapshotResult.stdout.trim()) {
    console.error(`Error: No snapshot found in ${modelPath}/snapshots`);
    return null;
  }
  
  const snapshotDir = snapshotResult.stdout.trim();
  console.log(`  Model found: ${modelNameClean}`);
  return snapshotDir;
}

// Main setup function
async function main() {
  console.log("Checking installations...\n");
  
  // Check all required tools
  const dockerOk = await checkDocker();
  const nvidiaSmiOk = await checkNvidiaSmi();
  const hfOk = await checkHuggingFaceCli();
  
  if (!dockerOk || !nvidiaSmiOk || !hfOk) {
    console.error("\nSetup failed: Missing required tools");
    process.exit(1);
  }
  
  console.log("\nRequired tools are installed.\n");
  
  // Check GPU and CUDA
  console.log("Checking GPU and CUDA...\n");
  const gpuOk = await checkGpu();
  const cudaOk = await checkCuda();
  
  if (!gpuOk || !cudaOk) {
    console.error("\nSetup failed: GPU/CUDA requirements not met");
    process.exit(1);
  }
  
  console.log("\nGPU and CUDA requirements OK.\n");
  
  // Get HF cache and verify models
  console.log("Checking models...\n");
  const hfCache = await getHfCache();
  if (!hfCache) {
    console.error("\nSetup failed: Could not determine HF cache directory");
    process.exit(1);
  }
  
  const requiredModels = [
    "model/jinaai/jina-code-embeddings-0.5b",
    "model/jinaai/jina-reranker-v3"
  ];
  
  const modelSnapshots: Record<string, string> = {};
  
  for (const model of requiredModels) {
    const snapshot = await verifyModel(model, hfCache!);
    if (!snapshot) {
      console.error(`\nSetup failed: Model ${model} not found or incomplete`);
      console.error(`Download with: hf download ${model.replace('model/', '')}`);
      process.exit(1);
    }
    modelSnapshots[model] = snapshot!;
  }
  
  console.log("\nRequired models present.\n");
  console.log("Setup complete!");
  console.log("\nModel snapshots:");
  for (const [model, snapshot] of Object.entries(modelSnapshots)) {
    console.log(`  ${model}: ${snapshot}`);
  }
}

// Run main function
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
