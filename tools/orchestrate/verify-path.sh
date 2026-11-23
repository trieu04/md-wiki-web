#!/usr/bin/env bash
# verify-path.sh <ID> -> path of the task's verify script; for merged tasks (D-30) concatenates the parts' scripts
set -euo pipefail
ID=$1
[ -f docs/tasks/$ID.verify.sh ] && grep -q . docs/tasks/$ID.verify.sh 2>/dev/null && ! grep -q "^$ID	" docs/tasks/merges.tsv && { echo docs/tasks/$ID.verify.sh; exit 0; }
parts=$(awk -F'\t' -v id="$ID" '$1==id {print $2}' docs/tasks/merges.tsv | tr ',' ' ')
[ -z "$parts" ] && { [ -f docs/tasks/$ID.verify.sh ] && echo docs/tasks/$ID.verify.sh; exit 0; }
mkdir -p .orchestrate; OUT=.orchestrate/$ID.verify.sh; echo 'set -e' > "$OUT"
for p in $parts; do [ -f docs/tasks/$p.verify.sh ] && { echo "# --- part $p"; echo "("; cat docs/tasks/$p.verify.sh; echo ")"; } >> "$OUT"; done
grep -q . "$OUT" && echo "$OUT" || true
