#!/usr/bin/env bash
# Copies the page under review into the empty eval workspace, with its TL;DR as it was
# before #368: the common-mistake bullet ("twice the limit through at the seam") answers
# the first prediction (the most a client gets in one second: 20).
set -euo pipefail
repo="$(cd "$(dirname "$0")/../../../../.." && pwd)"
mkdir -p docs
out=docs/token-bucket-rate-limiting.html
sed 's/It lets a burst past the limit at the seam/It lets twice the limit through at the seam/' \
  "$repo/docs/token-bucket-rate-limiting.html" > "$out"
grep -q 'It lets twice the limit through at the seam' "$out" || { echo "fixture: the TL;DR bullet was not found" >&2; exit 1; }
