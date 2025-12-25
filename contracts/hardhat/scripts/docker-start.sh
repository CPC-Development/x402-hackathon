#!/bin/sh
set -eu

# Start hardhat node in background
npx hardhat node --hostname 0.0.0.0 --port 8545 &
NODE_PID=$!

# Wait for the node to be ready
echo "Waiting for hardhat node..."
until curl --silent --fail http://localhost:8545 >/dev/null 2>&1; do
  sleep 1
done

# Deploy contracts deterministically using Ignition + CREATE2
IGNITION_MODULE=${IGNITION_MODULE:-ignition/modules/X402.ts}
IGNITION_DEPLOYMENT_ID=${IGNITION_DEPLOYMENT_ID:-x402}
IGNITION_STRATEGY=${IGNITION_STRATEGY:-create2}

IGNITION_CMD="yarn hardhat ignition deploy ${IGNITION_MODULE} --network localhost --deployment-id ${IGNITION_DEPLOYMENT_ID}"
if [ -n "${IGNITION_STRATEGY}" ]; then
  IGNITION_CMD="${IGNITION_CMD} --strategy ${IGNITION_STRATEGY}"
fi

sh -c "${IGNITION_CMD}"

# Keep the container running
tail -f /dev/null
