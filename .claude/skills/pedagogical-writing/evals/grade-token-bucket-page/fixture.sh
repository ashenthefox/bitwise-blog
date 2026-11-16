#!/usr/bin/env bash
# Writes the token-bucket page into the empty eval workspace (the repo is not there), as it was
# at the commit its calibration reference pins (evals/calibration/token-bucket-rate-limiting.json).
# The graders name what that version says, so a later edit to the live page must not move them.
set -euo pipefail
skill="$(cd "$(dirname "$0")/../.." && pwd)"
node "$skill/scripts/calibrate.mjs" --materialize token-bucket-rate-limiting docs
test -f docs/token-bucket-rate-limiting.html
