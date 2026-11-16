#!/usr/bin/env bash
# Copies the page to grade into the empty eval workspace (the repo is not there).
set -euo pipefail
repo="$(cd "$(dirname "$0")/../../../../.." && pwd)"
mkdir -p docs
cp "$repo/docs/token-bucket-rate-limiting.html" docs/
