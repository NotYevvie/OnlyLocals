#!/bin/bash
set -e

# TODO check for docker
# TODO check nvidia-smi
# TODO check for hf CLI

HF_INFO=$(hf env)
HF_HUB_CACHE=$(echo "$HF_INFO" | grep "HF_HUB_CACHE:" | awk -F: '{print $2}' | xargs)

REQUIRED_MODELS=(
  "model/jinaai/jina-code-embeddings-0.5b"
  "model/jinaai/jina-reranker-v3"
)

function get_snapshot_dir() {
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
  echo "$env_key=\"$SNAPSHOT_DIR\"" >> .env

  echo "$SNAPSHOT_DIR"
}

EMBEDDING_MODEL_PATH=$(get_snapshot_dir "model/jinaai/jina-code-embeddings-0.5b")
echo "Snapshot: ${EMBEDDING_MODEL_PATH}"