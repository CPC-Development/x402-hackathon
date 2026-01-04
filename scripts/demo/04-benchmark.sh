#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/lib.sh"

printf "\n=== Step 4/4: Benchmark ===\n"

"$ROOT_DIR/scripts/run-benchmark.sh"
