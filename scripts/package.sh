#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
OUT="dist/tb-thread-summarizer-${VERSION}.xpi"
mkdir -p dist
rm -f "$OUT"
zip -r "$OUT" manifest.json background.js lib popup options icons -x '*.DS_Store'
echo "Packaged $OUT"
