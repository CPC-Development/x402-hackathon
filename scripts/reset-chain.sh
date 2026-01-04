#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
INFRA_DIR="$ROOT_DIR/infra"
DATA_DIR="$ROOT_DIR/data/postgres"
CACHE_DIR="$ROOT_DIR/apps/demo-client/.cache"

STOP_TIMEOUT=${STOP_TIMEOUT:-2}

printf "[reset-chain] Stopping hardhat + sequencer + postgres (timeout %ss)...\n" "$STOP_TIMEOUT"
cd "$INFRA_DIR"
# Stop services cleanly before deleting the data dir.
docker compose stop -t "$STOP_TIMEOUT" hardhat sequencer postgres

printf "[reset-chain] Removing %s ...\n" "$DATA_DIR"
rm -rf "$DATA_DIR"

printf "[reset-chain] Removing %s ...\n" "$CACHE_DIR"
rm -rf "$CACHE_DIR"

printf "[reset-chain] Starting hardhat + sequencer (postgres will auto-start)...\n"
docker compose --profile hardhat --profile sequencer up -d --no-build hardhat sequencer

printf "[reset-chain] Done.\n"
