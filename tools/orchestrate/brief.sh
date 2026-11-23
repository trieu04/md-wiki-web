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
  else awk -v id="$ID" '
      $0 ~ "^#### "id" " {p=1; print; next}
      p && /^#{2,4} / {exit}
      p {print}' docs/implementation-plan.md
  fi
  if [ -f docs/tasks/$ID.verify.sh ]; then echo; echo "## Verify (the gate runs exactly this)"; echo '```bash'; cat docs/tasks/$ID.verify.sh; echo '```'; fi
  if [ -n "$EXTRA" ]; then echo; echo "## Context from previous attempts — fix these"; cat "$EXTRA"; fi
} > "$OUT"
echo "$OUT"
