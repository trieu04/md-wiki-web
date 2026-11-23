#!/usr/bin/env bash
# brief.sh <ID> <attempt> [extra-context-file]  -> prints brief path
set -euo pipefail
ID=$1; ATT=$2; EXTRA=${3:-}
ROOT=$(git rev-parse --show-toplevel); cd "$ROOT"
mkdir -p .orchestrate/briefs
OUT=.orchestrate/briefs/$ID-$ATT.md
{
  cat tools/orchestrate/preamble.md
  echo "# Task $ID (attempt $ATT)"
  if [ -f docs/tasks/$ID.md ]; then cat docs/tasks/$ID.md
  else python3 -I tools/orchestrate/brief-spec.py "$ID"
  fi
  V=$(tools/orchestrate/verify-path.sh "$ID")
  if [ -n "$V" ]; then echo; echo "## Verify (the gate runs exactly this)"; echo '```bash'; cat "$V"; echo '```'; fi
  if [ -n "$EXTRA" ]; then echo; echo "## Context from previous attempts — fix these"; cat "$EXTRA"; fi
} > "$OUT"
echo "$OUT"
