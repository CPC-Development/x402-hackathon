#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DEMO_DIR="$ROOT_DIR/apps/demo-client"
INFRA_DIR="$ROOT_DIR/infra"

# Ensure a writable temp dir for tsx IPC sockets in restricted environments.
TMPDIR="/tmp"
export TMPDIR

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

SERVICE_URL=${SERVICE_URL:-}
RPC_URL=${RPC_URL:-}
SEQUENCER_URL=${SEQUENCER_URL:-}

CACHE_ONLY=${CACHE_ONLY:-}
REQUIREMENTS_ONLY=${REQUIREMENTS_ONLY:-}
if [ "${1:-}" = "--cache-only" ]; then
  CACHE_ONLY=1
  shift
fi
if [ "${1:-}" = "--requirements-only" ]; then
  REQUIREMENTS_ONLY=1
  shift
fi

SERVICE_PORT=${SERVICE_PORT:-$(read_env_value SERVICE_PORT)}
HARDHAT_PORT=${HARDHAT_PORT:-$(read_env_value HARDHAT_PORT)}
SEQUENCER_PORT=${SEQUENCER_PORT:-$(read_env_value SEQUENCER_PORT)}

if [ -z "$SERVICE_URL" ]; then
  if [ -n "$SERVICE_PORT" ]; then
    SERVICE_URL="http://localhost:${SERVICE_PORT}"
  else
    SERVICE_URL="http://localhost:4000"
  fi
fi

if [ -z "$RPC_URL" ]; then
  if [ -n "$HARDHAT_PORT" ]; then
    RPC_URL="http://localhost:${HARDHAT_PORT}"
  else
    RPC_URL="http://localhost:8545"
  fi
fi

if [ -z "$SEQUENCER_URL" ]; then
  if [ -n "$SEQUENCER_PORT" ]; then
    SEQUENCER_URL="http://localhost:${SEQUENCER_PORT}"
  else
    SEQUENCER_URL="http://localhost:4001"
  fi
fi

export SERVICE_URL
export RPC_URL
export SEQUENCER_URL
if [ -n "$CACHE_ONLY" ]; then
  export CACHE_ONLY=1
fi
if [ -n "$REQUIREMENTS_ONLY" ]; then
  export REQUIREMENTS_ONLY=1
fi

printf "SERVICE_URL=%s\n" "$SERVICE_URL"
printf "RPC_URL=%s\n" "$RPC_URL"
printf "SEQUENCER_URL=%s\n" "$SEQUENCER_URL"

cd "$DEMO_DIR"
if [ ! -d node_modules ]; then
  yarn install
fi

yarn start "$@"
