#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
INFRA_DIR="$ROOT_DIR/infra"

PORT_OFFSET=${PORT_OFFSET:-0}
SKIP_BOOTSTRAP=${SKIP_BOOTSTRAP:-}
SKIP_WAIT=${SKIP_WAIT:-}
WAIT_TIMEOUT_SECONDS=${WAIT_TIMEOUT_SECONDS:-1200}

read_env_value() {
  key=$1
  if [ ! -f "$INFRA_DIR/.env" ]; then
    return 0
  fi
  value=$(awk -F= -v k="$key" '$0 ~ "^"k"=" { sub("^"k"=",""); print; exit }' "$INFRA_DIR/.env")
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf "%s" "$value"
}

if [ -z "$SKIP_BOOTSTRAP" ]; then
  echo "[1/4] Bootstrapping hardhat + env (infra/bootstrap-hardhat.sh)"
  (cd "$INFRA_DIR" && PORT_OFFSET=${PORT_OFFSET} ./bootstrap-hardhat.sh)
else
  if [ ! -f "$INFRA_DIR/.env" ]; then
    echo "infra/.env missing; unset SKIP_BOOTSTRAP or run infra/bootstrap-hardhat.sh" >&2
    exit 1
  fi
fi

cd "$INFRA_DIR"

echo "[2/4] Starting docker stack (hardhat, sequencer, facilitator, service, nominatim)"
docker compose \
  --profile hardhat \
  --profile sequencer \
  --profile facilitator \
  --profile service \
  --profile nominatim \
  up -d --build

if [ -z "$SKIP_WAIT" ]; then
  SERVICE_PORT=${SERVICE_PORT:-$(read_env_value SERVICE_PORT)}
  if [ -n "$SERVICE_PORT" ]; then
    SERVICE_URL="http://localhost:${SERVICE_PORT}"
  else
    SERVICE_URL="http://localhost:4000"
  fi

  echo "[3/4] Waiting for service health at ${SERVICE_URL}/health"
  echo "Waiting for service health at ${SERVICE_URL}/health ..."
  start=$(date +%s)
  while :; do
    if curl -sf "${SERVICE_URL}/health" >/dev/null 2>&1; then
      break
    fi
    now=$(date +%s)
    elapsed=$((now - start))
    if [ "$elapsed" -ge "$WAIT_TIMEOUT_SECONDS" ]; then
      echo "Timed out waiting for service. Set SKIP_WAIT=1 to skip health checks." >&2
      exit 1
    fi
    sleep 5
  done
fi

echo "[4/4] Running demo client"
exec "$ROOT_DIR/scripts/run-demo-client.sh"
