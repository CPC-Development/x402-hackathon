#!/bin/sh
set -eu

# Start hardhat node in background
npx hardhat node --hostname 0.0.0.0 --port 8545 &
NODE_PID=$!

# Give the node a moment to start
sleep 3

# Deploy contracts to local node
yarn hardhat run scripts/deploy.ts --network localhost

# Keep the node running
wait $NODE_PID
