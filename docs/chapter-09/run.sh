#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly OL_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
readonly COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yaml"
readonly ENV_FILE="${OL_ROOT}/codebase-indexing/.env"
readonly INFERENCE_URL="http://localhost:1337/v1/models"

# Short profile names the user types after "start:"
readonly -a PROFILES=(
  swarm-only
  swarm
  hive-only
  hive
  assistant-only
  assistant
  codebase-indexing
)

# Shared containers across mutex profiles
readonly -a SHARED=(inference-model embedding-inference embedding-manager db-vector)

die()   { printf '%s\n' "$*" >&2; exit 1; }

usage() {
  printf 'Usage: %s <command>\n\n' "$(basename "$0")"
  printf 'Run profiles:\n'
  for p in "${PROFILES[@]}"; do printf '  start:%s\n' "$p"; done
  printf '\nCommands:\n'
  printf '  logs               Follow inference container logs\n'
  printf '  purge              Stop and remove all shared containers\n'
  printf '  status             JSON status of the inference container\n'
  printf '  perf               Launch nvitop GPU monitor\n'
}

valid() { local p; for p in "${PROFILES[@]}"; do [[ "$p" == "$1" ]] && return 0; done; return 1; }

resolve_profile() {
  case "$1" in
    codebase-indexing) echo "codebase-indexing" ;;
    *)                 echo "qwen36-a3b-$1" ;;
  esac
}

purge() { local c; for c in "${SHARED[@]}"; do docker rm -f "$c" &>/dev/null || true; done; }

launch() {
  local compose_profile
  compose_profile="$(resolve_profile "$1")"
  purge
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" --profile "$compose_profile" up -d --remove-orphans
}

wait_for_inference() {
  printf 'Be patient! It is normal for model load and graph computation to take 1-3 minutes.\nView startup log in a separate terminal via "./run.sh logs"\nWaiting for inference server at %s ' "$INFERENCE_URL"
  local elapsed=0
  while ! curl -sf "$INFERENCE_URL" >/dev/null 2>&1; do
    printf '.'
    sleep 5
    elapsed=$((elapsed + 5))
    if (( elapsed >= 600 )); then
      printf '\n'
      die "Timed out after ${elapsed}s waiting for inference server."
    fi
  done
  printf ' ready! (%ds)\n' "$elapsed"
}

logs_inference() {
  local cid
  cid="$(docker ps -q --filter 'ancestor=yevai/local-inference-qwen36' --filter 'ancestor=yevai/local-inference-qwen36:sm120-cu132-v4' 2>/dev/null | head -1)"
  [[ -z "$cid" ]] && cid="$(docker ps -q --filter 'name=inference-model' | head -1)"
  [[ -z "$cid" ]] && die "No running inference container found."
  exec docker logs -f "$cid"
}

inference_perf() {
  if command -v nvitop &>/dev/null; then
    exec nvitop
  else
    die "nvitop not found. Install it from: https://github.com/XuehaiPan/nvitop"
  fi
}

inference_status() {
  if docker ps --format '{{.Names}}' | grep -q '^inference-model$'; then
    echo '{"status":"running"}'
  else
    echo '{"status":"stopped"}'
  fi
}

easter_egg_you_lonely_mf() {
  if ! docker ps --format '{{.Names}}' | grep -q '^inference-model$'; then
    die "I love you but you need a friend. ./run.sh start:assistant"
  fi
  local data_dir="$SCRIPT_DIR/webui_data"
  if [ -d "$data_dir" ]; then
    echo "WebUI data folder already exists at: $data_dir"
  else
    echo "Creating WebUI data folder at: $data_dir"
    mkdir -p "$data_dir"
  fi
  docker run --name vllm-ui \
    --rm \
    --network=host \
    -e PORT=1338 \
    -v "$SCRIPT_DIR/webui_data":/app/backend/data \
    -e OPENAI_API_BASE_URL=http://localhost:1337/v1 \
    -e OPENAI_API_KEY=empty \
    -e WEBUI_AUTH=False \
    -e ENABLE_OLLAMA_API="False" \
    -e RAG_EMBEDDING_MODEL="" \
    -e RAG_RERANKING_MODEL="" \
    ghcr.io/open-webui/open-webui:main
}

case "${1:-}" in
  logs)                logs_inference ;;
  purge)               purge; echo "Purged." ;;
  status)              inference_status ;;
  perf)                inference_perf ;;
  chat)                easter_egg_you_lonely_mf ;;
  --help|-h|"")        usage ;;
  start:*)
    profile="${1#start:}"
    valid "$profile" || { usage >&2; die "Unknown profile: $profile"; }
    launch "$profile"
    [[ "$profile" != "codebase-indexing" ]] && wait_for_inference
    ;;
  *)                   usage >&2; die "Unknown command: $1" ;;
esac
