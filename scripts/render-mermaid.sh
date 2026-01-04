#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
README_PATH="$ROOT_DIR/README.md"
OUT_DIR="$ROOT_DIR/docs/diagrams"

if [ ! -f "$README_PATH" ]; then
  echo "README.md not found at $README_PATH" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

cd "$ROOT_DIR"
README_PATH="$README_PATH" OUT_DIR="$OUT_DIR" python3 - <<'PY'
import re
import pathlib

readme = pathlib.Path(__import__("os").environ["README_PATH"])
text = readme.read_text()
blocks = re.findall(r"```mermaid\n(.*?)```", text, re.S)
outdir = pathlib.Path(__import__("os").environ["OUT_DIR"])
outdir.mkdir(parents=True, exist_ok=True)
for i, block in enumerate(blocks, 1):
    (outdir / f"diagram-{i}.mmd").write_text(block.strip() + "\n")
print(f"Extracted {len(blocks)} mermaid block(s) to {outdir}")
PY

if command -v docker >/dev/null 2>&1; then
  for f in "$OUT_DIR"/*.mmd; do
    [ -f "$f" ] || continue
    echo "Rendering $f -> ${f%.mmd}.png (docker)"
    rel="${f#$ROOT_DIR/}"
    out_rel="${rel%.mmd}.png"
    docker run --rm -v "$ROOT_DIR":/data minlag/mermaid-cli \
      -i "/data/$rel" -o "/data/$out_rel"
  done
  echo "Done. PNGs written to $OUT_DIR"
  exit 0
fi

if command -v npx >/dev/null 2>&1; then
  NPM_CACHE_DIR="$ROOT_DIR/.npm-cache"
  mkdir -p "$NPM_CACHE_DIR"
  for f in "$OUT_DIR"/*.mmd; do
    [ -f "$f" ] || continue
    echo "Rendering $f -> ${f%.mmd}.png"
    NPM_CONFIG_LOGLEVEL=error NPM_CONFIG_YES=1 NPM_CONFIG_CACHE="$NPM_CACHE_DIR" \
      npx -p @mermaid-js/mermaid-cli mmdc -i "$f" -o "${f%.mmd}.png"
  done
  echo "Done. PNGs written to $OUT_DIR"
  exit 0
fi

echo "Neither docker nor npx is available to render Mermaid diagrams." >&2
echo "Install Docker (preferred) or Node (for npx), then re-run this script." >&2
exit 1
