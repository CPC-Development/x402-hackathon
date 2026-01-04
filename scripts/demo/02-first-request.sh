#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/lib.sh"

printf "\n=== Step 2/4: Fund channel + first paid request ===\n"

export QUERY=${QUERY:-monaco}
export PURPOSE=${PURPOSE:-demo-first}

"$ROOT_DIR/scripts/run-demo-client.sh"
