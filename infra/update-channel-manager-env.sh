#!/bin/sh
set -eu

ENV_FILE=${ENV_FILE:-.env}
IGNITION_DEPLOYMENT_ID=${IGNITION_DEPLOYMENT_ID:-x402}
IGNITION_ADDRESSES_PATH=${IGNITION_ADDRESSES_PATH:-../contracts/hardhat/ignition/deployments/${IGNITION_DEPLOYMENT_ID}/deployed_addresses.json}

if [ ! -f "${IGNITION_ADDRESSES_PATH}" ]; then
  echo "Ignition addresses file not found: ${IGNITION_ADDRESSES_PATH}" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to read ignition deployment addresses" >&2
  exit 1
fi

CHANNEL_MANAGER_ADDRESS=$(node -e "const fs = require('fs'); const path = process.argv[1]; const data = JSON.parse(fs.readFileSync(path, 'utf8')); const entry = Object.entries(data).find(([key]) => key.endsWith('#X402CheddrPaymentChannel')); if (entry) { console.log(entry[1]); }" "${IGNITION_ADDRESSES_PATH}")
USDC_ADDRESS=$(node -e "const fs = require('fs'); const path = process.argv[1]; const data = JSON.parse(fs.readFileSync(path, 'utf8')); const entry = Object.entries(data).find(([key]) => key.endsWith('#TestUSDC')); if (entry) { console.log(entry[1]); }" "${IGNITION_ADDRESSES_PATH}")

if [ -z "${CHANNEL_MANAGER_ADDRESS}" ]; then
  echo "X402CheddrPaymentChannel address not found in ignition file" >&2
  exit 1
fi
if [ -z "${USDC_ADDRESS}" ]; then
  echo "TestUSDC address not found in ignition file" >&2
  exit 1
fi

if [ -f "${ENV_FILE}" ]; then
  awk -v channel="${CHANNEL_MANAGER_ADDRESS}" -v usdc="${USDC_ADDRESS}" '
    BEGIN { found_channel=0; found_usdc=0 }
    /^CHANNEL_MANAGER_ADDRESS=/ { print "CHANNEL_MANAGER_ADDRESS=" channel; found_channel=1; next }
    /^USDC_ADDRESS=/ { print "USDC_ADDRESS=" usdc; found_usdc=1; next }
    { print }
    END {
      if (!found_channel) print "CHANNEL_MANAGER_ADDRESS=" channel
      if (!found_usdc) print "USDC_ADDRESS=" usdc
    }
  ' "${ENV_FILE}" > "${ENV_FILE}.tmp"
  mv "${ENV_FILE}.tmp" "${ENV_FILE}"
else
  {
    echo "CHANNEL_MANAGER_ADDRESS=${CHANNEL_MANAGER_ADDRESS}"
    echo "USDC_ADDRESS=${USDC_ADDRESS}"
  } > "${ENV_FILE}"
fi

echo "Updated ${ENV_FILE} with CHANNEL_MANAGER_ADDRESS=${CHANNEL_MANAGER_ADDRESS}"
echo "Updated ${ENV_FILE} with USDC_ADDRESS=${USDC_ADDRESS}"
