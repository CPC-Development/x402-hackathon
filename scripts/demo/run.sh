#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

run_all() {
  "$SCRIPT_DIR/01-handshake.sh"
  "$SCRIPT_DIR/02-first-request.sh"
  "$SCRIPT_DIR/03-subsequent-request.sh"
  "$SCRIPT_DIR/04-benchmark.sh"
}

case "${1:-all}" in
  1|handshake)
    "$SCRIPT_DIR/01-handshake.sh"
    ;;
  2|first)
    "$SCRIPT_DIR/02-first-request.sh"
    ;;
  3|subsequent)
    "$SCRIPT_DIR/03-subsequent-request.sh"
    ;;
  4|benchmark)
    "$SCRIPT_DIR/04-benchmark.sh"
    ;;
  all|"" )
    run_all
    ;;
  *)
    echo "Usage: $0 [1|2|3|4|handshake|first|subsequent|benchmark|all]" >&2
    exit 1
    ;;
esac
