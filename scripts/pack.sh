#!/usr/bin/env bash
# Bash equivalent of scripts/pack.ps1: bundle the plugin files into dist/dist.zip.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p dist
rm -f dist/dist.zip
# -j stores the files at the archive root (no directory paths), matching pack.ps1.
zip -j dist/dist.zip manifest.json main.js styles.css
