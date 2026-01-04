#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)

cd "${SCRIPT_DIR}"

PORT_OFFSET=${PORT_OFFSET:-0}

# 1) generate env (random mnemonic + sequencer key)
echo "[bootstrap] Generating env (.env + demo client config)"
PORT_OFFSET=${PORT_OFFSET} ./generate-env.sh

# 2) start hardhat (deploys via Ignition + CREATE2)
echo "[bootstrap] Starting hardhat container"
docker compose --profile hardhat up -d --build hardhat

# 3) wait for ignition outputs
echo "[bootstrap] Waiting for ignition outputs"
IGNITION_DIR="${PROJECT_ROOT}/contracts/hardhat/ignition/deployments/x402"
ATTEMPTS=60
while [ $ATTEMPTS -gt 0 ]; do
  if [ -f "${IGNITION_DIR}/deployed_addresses.json" ]; then
    break
  fi
  sleep 1
  ATTEMPTS=$((ATTEMPTS - 1))
done

if [ ! -f "${IGNITION_DIR}/deployed_addresses.json" ]; then
  echo "Ignition output not found after waiting; check hardhat logs" >&2
  exit 1
fi

# 4) write deterministic contract addresses into .env
echo "[bootstrap] Writing contract addresses into .env"
./update-channel-manager-env.sh

echo "[bootstrap] Hardhat bootstrap complete."
