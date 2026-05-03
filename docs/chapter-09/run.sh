#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly OL_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
readonly COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yaml"
readonly ENV_FILE="${OL_ROOT}/codebase-indexing/.env"

readonly -a PROFILES=(
  qwen36-a3b-swarm-only
  qwen36-a3b-swarm
  qwen36-a3b-hive-only
  qwen36-a3b-hive
  qwen36-a3b-assistant-only
  qwen36-a3b-assistant
  codebase-indexing
)

# Shared containers across mutex profiles
readonly -a SHARED=(inference-model embedding-inference embedding-manager db-vector)

die()   { printf '%s\n' "$*" >&2; exit 1; }
usage() { printf 'Usage: %s <profile|--stop|logs:inference>\n\nProfiles:\n' "$(basename "$0")"; printf '  %s\n' "${PROFILES[@]}"; }

valid() { local p; for p in "${PROFILES[@]}"; do [[ "$p" == "$1" ]] && return 0; done; return 1; }

purge() { local c; for c in "${SHARED[@]}"; do docker rm -f "$c" &>/dev/null || true; done; }

launch() {
  purge
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" --profile "$1" up -d --remove-orphans
}

logs_inference() {
  local cid
  cid="$(docker ps -q --filter 'ancestor=yevai/local-inference-qwen36' --filter 'ancestor=yevai/local-inference-qwen36:sm120-cu132-v4' 2>/dev/null | head -1)"
  [[ -z "$cid" ]] && cid="$(docker ps -q --filter 'name=inference-model' | head -1)"
  [[ -z "$cid" ]] && die "No running inference container found."
  exec docker logs -f "$cid"
}

case "${1:-}" in
  --stop)          purge; echo "Stopped." ;;
  logs:inference)  logs_inference ;;
  --help|-h|"")    usage ;;
  *)               valid "$1" || { usage >&2; die "Unknown profile: $1"; }; launch "$1" ;;
esac
