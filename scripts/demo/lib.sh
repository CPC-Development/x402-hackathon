#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
INFRA_DIR="$ROOT_DIR/infra"
DEMO_CLIENT_DIR="$ROOT_DIR/apps/demo-client"

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

get_service_url() {
  service_url=${SERVICE_URL:-}
  service_port=${SERVICE_PORT:-$(read_env_value SERVICE_PORT)}
  if [ -z "$service_url" ]; then
    if [ -n "$service_port" ]; then
      service_url="http://localhost:${service_port}"
    else
      service_url="http://localhost:4000"
    fi
  fi
  printf "%s" "$service_url"
}

get_owner_address() {
  if [ -n "${OWNER_ADDRESS:-}" ]; then
    printf "%s" "$OWNER_ADDRESS"
    return 0
  fi

  demo_private_key=${DEMO_PRIVATE_KEY:-$(read_env_value DEMO_PRIVATE_KEY)}
  if [ -z "$demo_private_key" ]; then
    echo "Missing OWNER_ADDRESS and DEMO_PRIVATE_KEY. Set OWNER_ADDRESS in your env." >&2
    exit 1
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "node is required to derive OWNER_ADDRESS. Set OWNER_ADDRESS in your env." >&2
    exit 1
  fi

  if [ ! -d "$DEMO_CLIENT_DIR/node_modules" ]; then
    echo "Installing demo client deps to derive OWNER_ADDRESS..." >&2
    (cd "$DEMO_CLIENT_DIR" && yarn install)
  fi

  NODE_PATH="$DEMO_CLIENT_DIR/node_modules" node -e "const { Wallet } = require('ethers'); const pk = process.argv[1]; console.log(new Wallet(pk).address);" "$demo_private_key"
}

pretty_json() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -m json.tool
  else
    cat
  fi
}
