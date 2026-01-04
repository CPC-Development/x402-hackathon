#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/lib.sh"

printf "\n=== Step 3/4: Subsequent paid request (same channel) ===\n"

export PURPOSE=${PURPOSE:-demo-repeat}
export REVERSE_BATCH=1
export REVERSE_COUNT=${REVERSE_COUNT:-100}
export REVERSE_START_LAT=${REVERSE_START_LAT:-43.7282151}
export REVERSE_START_LON=${REVERSE_START_LON:-7.4135342}
export REVERSE_END_LAT=${REVERSE_END_LAT:-43.7457591}
export REVERSE_END_LON=${REVERSE_END_LON:-7.4344044}

"$ROOT_DIR/scripts/run-demo-client.sh" --cache-only
