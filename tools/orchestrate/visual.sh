#!/usr/bin/env bash
# visual.sh <ID> <attempt> <reference-png> <actual-png> [<diff-png>] [notes]
# Sends a reference/actual pair (one width) to terra; repeat per width. Verdict JSON on last line.
set -uo pipefail
ID=$1; ATT=$2; REF=$3; ACT=$4; DIFF=${5:-}; NOTES=${6:-}
ROOT=$(git rev-parse --show-toplevel); cd "$ROOT"
mkdir -p .orchestrate/visual
NAME=$(basename "$ACT" .png)
OUT=.orchestrate/visual/$ID-$ATT-$NAME.txt
FILES=(@"$REF" @"$ACT"); [ -n "$DIFF" ] && FILES+=(@"$DIFF")
HARD_SEC=${HARD_SEC:-1200} IDLE_SEC=${IDLE_SEC:-600} tools/orchestrate/pi-guard.sh "$OUT.jsonl" -- \
  -p --model cliproxyapi/gpt-6.1-terra --thinking high --no-session --tools read "${FILES[@]}" \
"You verify UI implementation against design. Image 1 = REFERENCE (design frame render). Image 2 = ACTUAL (app).
$( [ -n "$DIFF" ] && echo 'Image 3 = pixel diff (red = differing pixels).' )
Compare region by region: layout/wrapping, spacing, sizes, typography (family, size, weight), colours, borders,
radii, icons, copy, alignment, states. Ignore regions listed as masked or deferred: ${NOTES:-none}.
List every visible difference with its region and the expected vs actual value. Do not approve approximations.
End with ONLY a JSON object on the last line:
{\"pass\": true|false, \"differences\": [{\"region\": \"...\", \"expected\": \"...\", \"actual\": \"...\", \"severity\": \"blocker|major|minor\"}]}
pass=false if any blocker or major difference." > "$OUT" 2>&1
tail -c 4000 "$OUT"
