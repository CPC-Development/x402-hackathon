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

# Deploy contracts to local node
yarn hardhat run scripts/deploy.ts --network localhost

# Keep the container running
tail -f /dev/null
