#!/usr/bin/env bash
# task.sh <ID> <impl-model> <review-model> <attempt> [ctx-file] [review-paths]
# run -> gate -> review, in the current checkout (main or a worktree). Prints agent STATUS block, gate result, verdict.
set -uo pipefail
ID=$1; IMPL=$2; REV=$3; ATT=$4; CTX=${5:-}; RP=${6:-.}
cd "$(git rev-parse --show-toplevel)"
if [ -n "$CTX" ] && [ ! -f "$CTX" ]; then echo "task.sh: context file $CTX not found"; exit 2; fi
tools/orchestrate/run.sh "$ID" "$IMPL" "$ATT" $CTX >/dev/null 2>&1
LOG=.orchestrate/logs/$ID-$ATT-$IMPL.log
if ! grep -q "^STATUS" "$LOG" 2>/dev/null; then echo "=== agent produced no STATUS (see $LOG) — not gating"; tail -5 "$LOG" 2>/dev/null; exit 3; fi
echo "=== agent"; grep -A12 "^STATUS" "$LOG" | head -14
if grep -q "^STATUS: BLOCKED" "$LOG"; then echo "=== BLOCKED — no gate/review"; exit 0; fi
echo "=== gate"; tools/orchestrate/gate.sh "$ID" "$ATT" 2>&1 | grep -E "^(FAIL|GATE)"
echo "=== review ($REV)"; PATHS="$RP" tools/orchestrate/review.sh "$ID" "$REV" "$ATT" >/dev/null 2>&1
grep -o '{"pass".*' ".orchestrate/reviews/$ID-$ATT-$REV.txt" | tail -1
