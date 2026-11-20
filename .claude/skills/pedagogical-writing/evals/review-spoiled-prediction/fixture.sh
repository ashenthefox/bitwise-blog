#!/usr/bin/env bash
# Copies the page under review, as it was before #368, into the empty eval workspace.
# At b813972 the TL;DR's common-mistake bullet ("twice the limit through at the seam")
# answers the first prediction (the most a client gets in one second: 20).
set -euo pipefail
repo="$(cd "$(dirname "$0")/../../../../.." && pwd)"
mkdir -p docs
git -C "$repo" show b813972:docs/token-bucket-rate-limiting.html > docs/token-bucket-rate-limiting.html
