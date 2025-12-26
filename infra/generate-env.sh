#!/bin/sh
set -eu

read_env_value() {
  key=$1
  if [ ! -f .env ]; then
    return 0
  fi
  value=$(awk -F= -v k="$key" '$0 ~ "^"k"=" { sub("^"k"=",""); print; exit }' .env)
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf "%s" "$value"
}

# Preserve explicit env overrides and fall back to existing .env values.
ENV_PORT_OFFSET=${PORT_OFFSET:-}
ENV_HARDHAT_MNEMONIC=${HARDHAT_MNEMONIC:-}
ENV_SEQUENCER_PRIVATE_KEY=${SEQUENCER_PRIVATE_KEY:-}
ENV_CHANNEL_MANAGER_ADDRESS=${CHANNEL_MANAGER_ADDRESS:-}
ENV_USDC_ADDRESS=${USDC_ADDRESS:-}
ENV_IGNITION_CREATE2_SALT=${IGNITION_CREATE2_SALT:-}
ENV_PAY_TO_ADDRESS=${PAY_TO_ADDRESS:-}
ENV_PRICE=${PRICE:-}
ENV_MAX_TIMEOUT_SECONDS=${MAX_TIMEOUT_SECONDS:-}
ENV_TIMESTAMP_SKEW_SECONDS=${TIMESTAMP_SKEW_SECONDS:-}
ENV_CHANNEL_BOOTSTRAP_AMOUNT=${CHANNEL_BOOTSTRAP_AMOUNT:-}
ENV_CHANNEL_BOOTSTRAP_EXPIRY_SECONDS=${CHANNEL_BOOTSTRAP_EXPIRY_SECONDS:-}
ENV_DEMO_PRIVATE_KEY=${DEMO_PRIVATE_KEY:-}

if [ -z "${ENV_PORT_OFFSET}" ]; then
  PORT_OFFSET=$(read_env_value PORT_OFFSET)
else
  PORT_OFFSET=${ENV_PORT_OFFSET}
fi
if [ -z "${ENV_HARDHAT_MNEMONIC}" ]; then
  HARDHAT_MNEMONIC=$(read_env_value HARDHAT_MNEMONIC)
else
  HARDHAT_MNEMONIC=${ENV_HARDHAT_MNEMONIC}
fi
if [ -z "${ENV_SEQUENCER_PRIVATE_KEY}" ]; then
  SEQUENCER_PRIVATE_KEY=$(read_env_value SEQUENCER_PRIVATE_KEY)
else
  SEQUENCER_PRIVATE_KEY=${ENV_SEQUENCER_PRIVATE_KEY}
fi
if [ -z "${ENV_CHANNEL_MANAGER_ADDRESS}" ]; then
  CHANNEL_MANAGER_ADDRESS=$(read_env_value CHANNEL_MANAGER_ADDRESS)
else
  CHANNEL_MANAGER_ADDRESS=${ENV_CHANNEL_MANAGER_ADDRESS}
fi
if [ -z "${ENV_USDC_ADDRESS}" ]; then
  USDC_ADDRESS=$(read_env_value USDC_ADDRESS)
else
  USDC_ADDRESS=${ENV_USDC_ADDRESS}
fi
if [ -z "${ENV_IGNITION_CREATE2_SALT}" ]; then
  IGNITION_CREATE2_SALT=$(read_env_value IGNITION_CREATE2_SALT)
else
  IGNITION_CREATE2_SALT=${ENV_IGNITION_CREATE2_SALT}
fi
if [ -z "${ENV_PAY_TO_ADDRESS}" ]; then
  PAY_TO_ADDRESS=$(read_env_value PAY_TO_ADDRESS)
else
  PAY_TO_ADDRESS=${ENV_PAY_TO_ADDRESS}
fi
if [ -z "${ENV_PRICE}" ]; then
  PRICE=$(read_env_value PRICE)
else
  PRICE=${ENV_PRICE}
fi
if [ -z "${ENV_MAX_TIMEOUT_SECONDS}" ]; then
  MAX_TIMEOUT_SECONDS=$(read_env_value MAX_TIMEOUT_SECONDS)
else
  MAX_TIMEOUT_SECONDS=${ENV_MAX_TIMEOUT_SECONDS}
fi
if [ -z "${ENV_TIMESTAMP_SKEW_SECONDS}" ]; then
  TIMESTAMP_SKEW_SECONDS=$(read_env_value TIMESTAMP_SKEW_SECONDS)
else
  TIMESTAMP_SKEW_SECONDS=${ENV_TIMESTAMP_SKEW_SECONDS}
fi
if [ -z "${ENV_CHANNEL_BOOTSTRAP_AMOUNT}" ]; then
  CHANNEL_BOOTSTRAP_AMOUNT=$(read_env_value CHANNEL_BOOTSTRAP_AMOUNT)
else
  CHANNEL_BOOTSTRAP_AMOUNT=${ENV_CHANNEL_BOOTSTRAP_AMOUNT}
fi
if [ -z "${ENV_CHANNEL_BOOTSTRAP_EXPIRY_SECONDS}" ]; then
  CHANNEL_BOOTSTRAP_EXPIRY_SECONDS=$(read_env_value CHANNEL_BOOTSTRAP_EXPIRY_SECONDS)
else
  CHANNEL_BOOTSTRAP_EXPIRY_SECONDS=${ENV_CHANNEL_BOOTSTRAP_EXPIRY_SECONDS}
fi
if [ -z "${ENV_DEMO_PRIVATE_KEY}" ]; then
  DEMO_PRIVATE_KEY=$(read_env_value DEMO_PRIVATE_KEY)
else
  DEMO_PRIVATE_KEY=${ENV_DEMO_PRIVATE_KEY}
fi

OFFSET=${PORT_OFFSET:-0}
DEFAULT_DERIVATION_PATH="m/44'/60'/0'/0/1"

if [ -z "${HARDHAT_MNEMONIC:-}" ]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "node is required to generate a mnemonic" >&2
    exit 1
  fi
  HARDHAT_MNEMONIC=$(node -e "const { Wallet } = require('ethers'); const w = Wallet.createRandom(); console.log(w.mnemonic.phrase);")
fi

if [ -z "${SEQUENCER_PRIVATE_KEY:-}" ]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "node is required to derive the sequencer private key" >&2
    exit 1
  fi
  SEQUENCER_PRIVATE_KEY=$(node -e "const { HDNodeWallet } = require('ethers'); const mnemonic = process.argv[1]; const path = process.argv[2]; const w = HDNodeWallet.fromPhrase(mnemonic, undefined, path); console.log(w.privateKey);" "$HARDHAT_MNEMONIC" "$DEFAULT_DERIVATION_PATH")
fi

if [ -z "${IGNITION_CREATE2_SALT:-}" ]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "node is required to generate a create2 salt" >&2
    exit 1
  fi
  IGNITION_CREATE2_SALT=$(node -e "const crypto = require('crypto'); console.log('0x' + crypto.randomBytes(32).toString('hex'));")
fi

if [ -z "${DEMO_PRIVATE_KEY:-}" ]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "node is required to derive the demo client private key" >&2
    exit 1
  fi
  DEMO_PRIVATE_KEY=$(node -e "const { HDNodeWallet } = require('ethers'); const mnemonic = process.argv[1]; const path = \"m/44'/60'/0'/0/2\"; const w = HDNodeWallet.fromPhrase(mnemonic, undefined, path); console.log(w.privateKey);" "$HARDHAT_MNEMONIC")
fi

if [ -z "${PAY_TO_ADDRESS:-}" ]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "node is required to derive the pay-to address" >&2
    exit 1
  fi
  PAY_TO_ADDRESS=$(node -e "const { HDNodeWallet } = require('ethers'); const mnemonic = process.argv[1]; const path = \"m/44'/60'/0'/0/0\"; const w = HDNodeWallet.fromPhrase(mnemonic, undefined, path); console.log(w.address);" "$HARDHAT_MNEMONIC")
fi


HARDHAT_BASE=8545
FACILITATOR_BASE=8080
SEQUENCER_BASE=4001
SERVICE_BASE=4000
POSTGRES_BASE=5432

HARDHAT_PORT=$((HARDHAT_BASE + OFFSET))
FACILITATOR_PORT=$((FACILITATOR_BASE + OFFSET))
SEQUENCER_PORT=$((SEQUENCER_BASE + OFFSET))
SERVICE_PORT=$((SERVICE_BASE + OFFSET))
POSTGRES_PORT=$((POSTGRES_BASE + OFFSET))
SEQUENCER_PRIVATE_KEY_VALUE=${SEQUENCER_PRIVATE_KEY}
DEMO_PRIVATE_KEY_VALUE=${DEMO_PRIVATE_KEY}

cat > .env <<EOT
PORT_OFFSET=${OFFSET}
HARDHAT_PORT=${HARDHAT_PORT}
FACILITATOR_PORT=${FACILITATOR_PORT}
SEQUENCER_PORT=${SEQUENCER_PORT}
RPC_URL=http://hardhat:8545
SERVICE_PORT=${SERVICE_PORT}
POSTGRES_PORT=${POSTGRES_PORT}
HARDHAT_MNEMONIC="${HARDHAT_MNEMONIC}"
SEQUENCER_PRIVATE_KEY=${SEQUENCER_PRIVATE_KEY_VALUE}
IGNITION_CREATE2_SALT=${IGNITION_CREATE2_SALT}
CHANNEL_MANAGER_ADDRESS=${CHANNEL_MANAGER_ADDRESS:-}
USDC_ADDRESS=${USDC_ADDRESS:-}
PAY_TO_ADDRESS=${PAY_TO_ADDRESS:-}
PRICE=${PRICE:-}
MAX_TIMEOUT_SECONDS=${MAX_TIMEOUT_SECONDS:-}
TIMESTAMP_SKEW_SECONDS=${TIMESTAMP_SKEW_SECONDS:-}
CHANNEL_BOOTSTRAP_AMOUNT=${CHANNEL_BOOTSTRAP_AMOUNT:-}
CHANNEL_BOOTSTRAP_EXPIRY_SECONDS=${CHANNEL_BOOTSTRAP_EXPIRY_SECONDS:-}
DEMO_PRIVATE_KEY=${DEMO_PRIVATE_KEY_VALUE}
EOT

DEMO_CONFIG_PATH="../apps/demo-client/config.json"
cat > "${DEMO_CONFIG_PATH}" <<EOT
{
  "rpcUrl": "http://localhost:${HARDHAT_PORT}",
  "serviceUrl": "http://localhost:${SERVICE_PORT}",
  "privateKey": "${DEMO_PRIVATE_KEY_VALUE}"
}
EOT

echo "Wrote .env with offset ${OFFSET}."
echo "Wrote demo client config to ${DEMO_CONFIG_PATH}."
