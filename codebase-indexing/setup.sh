#!/bin/bash
set -e

function check_installations() {
  echo "Checking installs..."
  # Check for required tools
  if ! which docker >/dev/null 2>&1; then
    echo "Error: docker is not installed or not in PATH. Install it with:"
    echo -e "curl -fsSL https://get.docker.com | sh\n"
    echo "And add your user to the docker group:"
    echo -e "sudo usermod -aG docker \$USER\n"
    exit 1
  else
    echo "  > docker found"
  fi

  if ! which nvidia-smi >/dev/null 2>&1; then
    echo "Error: nvidia-smi is not installed or not in PATH"
    echo "Note: NVIDIA GPU and drivers are required for this setup"
    exit 1
  else
    echo "  > nvidia-smi found"
  fi

  if ! which hf >/dev/null 2>&1; then
    echo "Error: Hugging Face CLI (hf) is not installed or not in PATH. Install it with:"
    
    # Check for available package managers and suggest installation command
    if which brew >/dev/null 2>&1; then
      echo "  brew install huggingface-cli"
    elif which pipx >/dev/null 2>&1; then
      echo "  pipx install huggingface_hub[cli]"
    elif which pip3 >/dev/null 2>&1; then
      echo "  pip3 install huggingface_hub[cli]"
    elif which pip >/dev/null 2>&1; then
      echo "  pip install huggingface_hub[cli]"
    else
      echo "  No package manager found. Recommended: install Homebrew with:"
      echo "  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
      echo "  Then run: brew install huggingface-cli"
    fi
    exit 1
  else
    echo "  > hf found"
  fi

  echo -e "\nAll required installations are present."
}

function check_nvidia_smi() {
  COMPUTE_CAP=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader | head -n 1)
  if [[ ! "$COMPUTE_CAP" =~ ^12\. ]]; then
    echo "Error: Blackwell GPU (compute capability 12.x) required"
    echo "Found: $COMPUTE_CAP"
    exit 1
  else
    echo "COMPUTE_CAP $COMPUTE_CAP found"
  fi

  CUDA_VERSION=$(nvidia-smi | grep "CUDA Version" | awk '{print $9}')
  if [[ "${CUDA_VERSION%%.*}" -lt 13 ]]; then
    echo "Error: CUDA 13.1+ required, found: $CUDA_VERSION"
    exit 1
  else
    echo "CUDA_VERSION $CUDA_VERSION found"
  fi
}

HF_INFO=$(hf env)
HF_HUB_CACHE=$(echo "$HF_INFO" | grep "HF_HUB_CACHE:" | awk -F: '{print $2}' | xargs)

REQUIRED_MODELS=(
  "model/jinaai/jina-code-embeddings-0.5b"
  "model/jinaai/jina-reranker-v3"
)

function verify_model() {
  local model_name="$1"
  local model_name_clean="${model_name#model/}"
  local model_path="$HF_HUB_CACHE/models--${model_name_clean//\//--}"

  if [ ! -d "$model_path" ]; then
    echo "Error: Model not found at $model_path"
    exit 1
  fi

  SNAPSHOT_DIR=$(find "$model_path/snapshots" -maxdepth 1 -mindepth 1 -type d | head -n 1)

  if [ -z "$SNAPSHOT_DIR" ]; then
    echo "Error: No snapshot found in $model_path/snapshots"
    exit 1
  fi

  local env_key="${model_name_clean#*/}"
  env_key="${env_key//-/_}"
  # echo "$env_key=\"$SNAPSHOT_DIR\"" >> .env

  echo "$SNAPSHOT_DIR"
}

check_installations
check_nvidia_smi

EMBEDDING_MODEL_PATH=$(verify_model "model/jinaai/jina-code-embeddings-0.5b")
echo "Snapshot: ${EMBEDDING_MODEL_PATH}"
