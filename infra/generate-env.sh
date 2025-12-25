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
EOT

echo "Wrote .env with offset ${OFFSET}".
