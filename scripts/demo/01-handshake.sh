#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/lib.sh"

QUERY=${QUERY:-monaco}

printf "\n=== Step 1/4: 402 handshake (cached via client) ===\n"
export QUERY

printf "Caching payment requirements via client (no payment)...\n"
REQ_CACHE="$ROOT_DIR/apps/demo-client/.cache/geocode-requirements.json"
rm -f "$REQ_CACHE"
"$ROOT_DIR/scripts/run-demo-client.sh" --requirements-only

printf "\nCached requirements summary:\n"
if [ ! -f "$REQ_CACHE" ]; then
  echo "Missing cached requirements at $REQ_CACHE" >&2
  exit 1
fi

if command -v python3 >/dev/null 2>&1; then
  REQ_CACHE_PATH="$REQ_CACHE" python3 - <<'PY'
import json
import os
with open(os.environ["REQ_CACHE_PATH"], "r", encoding="utf-8") as fh:
    data = json.load(fh)
extra = data.get("extra") or {}
print(f"scheme: {data.get('scheme')}")
print(f"network: {data.get('network')}")
print(f"maxAmountRequired: {data.get('maxAmountRequired')}")
print(f"payTo: {data.get('payTo')}")
print(f"asset: {data.get('asset')}")
print(f"channelId: {extra.get('channelId')}")
print(f"nextSequenceNumber: {extra.get('nextSequenceNumber')}")
print(f"channelExpiry: {extra.get('channelExpiry')}")

print("\nrequirements:")
print(json.dumps(data, indent=2))
PY
else
  cat "$REQ_CACHE"
fi
