#!/usr/bin/env bash
# Writes the token-bucket page into the empty eval workspace (the repo is not there), as it was
# at the commit its calibration reference pins (evals/calibration/token-bucket-rate-limiting.json).
# That version's TL;DR common-mistake bullet ("twice the limit through at the seam") answers the
# first prediction (the most a client gets in one second: 20), which is what the case tests (#368).
set -euo pipefail
skill="$(cd "$(dirname "$0")/../.." && pwd)"
node "$skill/scripts/calibrate.mjs" --materialize token-bucket-rate-limiting docs
grep -q 'It lets twice the limit through at the seam' docs/token-bucket-rate-limiting.html
