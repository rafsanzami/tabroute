#!/usr/bin/env bash
# Build a release zip containing only the files the extension needs.
# Usage: ./scripts/package.sh   ->  dist/tabroute-v<version>.zip
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')
OUT="dist/tabroute-v${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"
zip -q -r "$OUT" \
  manifest.json background.js popup.html popup.css popup.js LICENSE \
  icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png \
  icons/on16.png icons/on32.png icons/on48.png icons/on128.png \
  icons/off16.png icons/off32.png icons/off48.png icons/off128.png

echo "Built $OUT"
unzip -l "$OUT" | tail -1
