#!/usr/bin/env bash
# Writes the calibration's broken copy of the token-bucket page into the empty eval workspace,
# under the page's own name. The two edits that break it are in
# evals/calibration/token-bucket-rate-limiting-broken.json: #no-timer loses its need, and
# #implementation defers production failures to a section that was cut.
set -euo pipefail
skill="$(cd "$(dirname "$0")/../.." && pwd)"
node "$skill/scripts/calibrate.mjs" --materialize token-bucket-rate-limiting-broken docs
test -f docs/token-bucket-rate-limiting.html
