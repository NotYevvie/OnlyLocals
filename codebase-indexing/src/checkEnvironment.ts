import { runCommand } from "./runner.ts";

declare const process: any;

type CheckResult = {
  success: boolean;
  name: string;
  messages: string[];
};

async function checkDocker(): Promise<CheckResult> {
  const result = await runCommand("which docker");
  if (result.exitCode !== 0) {
    return {
      success: false,
      name: "Docker",
      messages: [
        "Error: docker is not installed or not in PATH. Install it with:",
        "curl -fsSL https://get.docker.com | sh\n",
        "And add your user to the docker group:",
        "sudo usermod -aG docker $USER\n"
      ]
    };
  }
  return {
    success: true,
    name: "Docker",
    messages: ["  docker found"]
  };
}

async function checkNvidiaSmi(): Promise<CheckResult> {
  const result = await runCommand("which nvidia-smi");
  if (result.exitCode !== 0) {
    return {
      success: false,
      name: "NVIDIA Drivers",
      messages: [
        "Error: nvidia-smi is not installed or not in PATH",
        "Note: NVIDIA GPU and drivers are required for this setup"
      ]
    };
  }
  return {
    success: true,
    name: "NVIDIA Drivers",
    messages: ["  nvidia-smi found"]
  };
}

async function checkHuggingFaceCli(): Promise<CheckResult> {
  const result = await runCommand("which hf");
  if (result.exitCode !== 0) {
    const messages = ["Error: Hugging Face CLI (hf) is not installed or not in PATH. Install it with:"];
    
    const [brew, pipx, pip3, pip] = await Promise.all([
      runCommand("which brew"),
      runCommand("which pipx"),
      runCommand("which pip3"),
      runCommand("which pip")
    ]);
    
    if (brew.exitCode === 0) {
      messages.push("  brew install huggingface-cli");
    } else if (pipx.exitCode === 0) {
      messages.push("  pipx install huggingface_hub[cli]");
    } else if (pip3.exitCode === 0) {
      messages.push("  pip3 install huggingface_hub[cli]");
    } else if (pip.exitCode === 0) {
      messages.push("  pip install huggingface_hub[cli]");
    } else {
      messages.push("  No package manager found. Recommended: install Homebrew with:");
      messages.push('  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
      messages.push("  Then run: brew install huggingface-cli");
    }
    
    return {
      success: false,
      name: "Hugging Face CLI",
      messages
    };
  }
  return {
    success: true,
    name: "Hugging Face CLI",
    messages: ["  hf found"]
  };
}

async function checkGpu(): Promise<CheckResult> {
  const result = await runCommand("nvidia-smi --query-gpu=compute_cap --format=csv,noheader");
  if (result.exitCode !== 0) {
    return {
      success: false,
      name: "GPU Compute",
      messages: ["Error: Failed to query GPU compute"]
    };
  }
  
  const computeCap = result.stdout.trim().split('\n')[0].trim();
  const major = computeCap.split('.')[0];
  
  if (major !== '12') {
    return {
      success: false,
      name: "GPU Compute",
      messages: [
        `Error: Blackwell GPU (compute 12.x) required`,
        `Found: ${computeCap}`
      ]
    };
  }
  
  return {
    success: true,
    name: "GPU Compute",
    messages: [`  Compute ${computeCap} found`]
  };
}

async function checkCuda(): Promise<CheckResult> {
  const result = await runCommand("nvidia-smi | grep 'CUDA' | awk '{print $9}'");
  if (result.exitCode !== 0) {
    return {
      success: false,
      name: "CUDA",
      messages: ["Error: Failed to query CUDA"]
    };
  }
  
  const cudaVersion = result.stdout.trim();
  const major = parseInt(cudaVersion.split('.')[0]);
  
  if (major < 13) {
    return {
      success: false,
      name: "CUDA",
      messages: [`Error: CUDA 13.1+ required, found: ${cudaVersion}`]
    };
  }
  
  return {
    success: true,
    name: "CUDA",
    messages: [`  CUDA ${cudaVersion} found`]
  };
}

async function getHfCache(): Promise<string | null> {
  const result = await runCommand("hf env");
  if (result.exitCode !== 0) {
    return null;
  }
  
  const lines = result.stdout.split('\n');
  const cacheLine = lines.find(line => line.includes('HF_HUB_CACHE:'));
  if (!cacheLine) {
    return null;
  }
  
  const cache = cacheLine.split(':')[1].trim();
  return cache;
}

async function verifyModel(modelName: string, hfCache: string): Promise<CheckResult & { snapshot?: string }> {
  const modelNameClean = modelName.replace('model/', '');
  const modelPath = `${hfCache}/models--${modelNameClean.replace(/\//g, '--')}`;
  
  const dirCheck = await runCommand(`[ -d "${modelPath}" ] && echo "exists"`);
  if (dirCheck.exitCode !== 0 || !dirCheck.stdout.includes('exists')) {
    return {
      success: false,
      name: modelNameClean,
      messages: [`Error: Model not found at ${modelPath}`]
    };
  }
  
  const snapshotResult = await runCommand(`find "${modelPath}/snapshots" -maxdepth 1 -mindepth 1 -type d | head -n 1`);
  if (snapshotResult.exitCode !== 0 || !snapshotResult.stdout.trim()) {
    return {
      success: false,
      name: modelNameClean,
      messages: [`Error: No snapshot found in ${modelPath}/snapshots`]
    };
  }
  
  const snapshotDir = snapshotResult.stdout.trim();
  return {
    success: true,
    name: modelNameClean,
    messages: [`  ${modelNameClean}`],
    snapshot: snapshotDir
  };
}

export async function checkEnvironment() {
  console.log("Checking installations...\n");
  
  const installChecks = await Promise.all([
    checkDocker(),
    checkNvidiaSmi(),
    checkHuggingFaceCli()
  ]);
  
  for (const check of installChecks) {
    for (const message of check.messages) {
      if (check.success) {
        console.log(message);
      } else {
        console.error(message);
      }
    }
  }
  
  const installsOk = installChecks.every(r => r.success);
  if (!installsOk) {
    console.error("\nSetup failed: Missing required tools");
    process.exit(1);
  }
  
  console.log("\nRequired tools are installed.\n");
  
  console.log("Checking GPU and CUDA...\n");
  const gpuChecks = await Promise.all([
    checkGpu(),
    checkCuda()
  ]);
  
  for (const check of gpuChecks) {
    for (const message of check.messages) {
      if (check.success) {
        console.log(message);
      } else {
        console.error(message);
      }
    }
  }
  
  const gpuOk = gpuChecks.every(r => r.success);
  if (!gpuOk) {
    console.error("\nSetup failed: GPU/CUDA requirements not met");
    process.exit(1);
  }
  
  console.log("\nGPU and CUDA requirements met.\n");
  
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
  
  const modelResults = await Promise.all(
    requiredModels.map(model => verifyModel(model, hfCache!))
  );
  
  for (const result of modelResults) {
    for (const message of result.messages) {
      if (result.success) {
        console.log(message);
      } else {
        console.error(message);
      }
    }
  }
  
  const modelsOk = modelResults.every(r => r.success);
  if (!modelsOk) {
    console.error("\nSetup failed: Some models are missing or incomplete");
    console.error("\nDownload missing models with:");
    for (let i = 0; i < modelResults.length; i++) {
      if (!modelResults[i].success) {
        console.error(`  hf download ${requiredModels[i].replace('model/', '')}`);
      }
    }
    process.exit(1);
  }
  
  console.log("\nRequired models present.");
  console.log("\nModel snapshots:");
  for (let i = 0; i < modelResults.length; i++) {
    const result = modelResults[i];
    if (result.snapshot) {
      console.log(`  ${result.name}: ${result.snapshot}`);
    }
  }
}