#!/usr/bin/env bash
# run.sh <ID> <model> <attempt> [extra-context-file]
set -uo pipefail
ID=$1; MODEL=$2; ATT=$3; EXTRA=${4:-}
ROOT=$(git rev-parse --show-toplevel); cd "$ROOT"
mkdir -p .orchestrate/logs .pi-sessions
BRIEF=$(tools/orchestrate/brief.sh "$ID" "$ATT" "$EXTRA")
LOG=.orchestrate/logs/$ID-$ATT-$MODEL.log
echo "[$(date +%T)] run $ID attempt $ATT model $MODEL brief $BRIEF" | tee "$LOG"
tools/orchestrate/pi-guard.sh ".orchestrate/logs/$ID-$ATT-$MODEL.jsonl" -- \
  -p --model "cliproxyapi/$MODEL" --thinking high --session-dir .pi-sessions -n "$ID-$ATT" @"$BRIEF" \
  "Execute the task in the attached brief now." >> "$LOG" 2>&1
RC=$?
echo "[$(date +%T)] exit $RC" >> "$LOG"
tail -40 "$LOG"
exit $RC
