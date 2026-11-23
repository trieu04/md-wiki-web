#!/usr/bin/env bash
# review.sh <ID> <reviewer-model> <attempt>  -> JSON verdict on stdout tail; reviewer cannot edit
set -uo pipefail
ID=$1; MODEL=$2; ATT=$3
ROOT=$(git rev-parse --show-toplevel); cd "$ROOT"
mkdir -p .orchestrate/reviews
git add -A -N
R=.orchestrate/reviews/$ID-$ATT-$MODEL-input.md
{
  echo "You are a strict code reviewer. Do NOT modify any file. Review the diff below against the task spec,"
  echo "AGENTS.md, docs/system-logic.md and docs/design-system.md. Check: spec and acceptance criteria met;"
  echo "business rules in the right layer; tests cover rules and edge cases; no contract drift; no invented design;"
  echo "security (path traversal, auth, injection); obvious bugs. Read any repo file you need."
  echo "Answer with ONLY a JSON object on the last line:"
  echo '{"pass": true|false, "issues": [{"file": "...", "line": 0, "severity": "blocker|major|minor", "detail": "..."}]}'
  echo "pass=false only for blocker/major issues. Lockfiles (pnpm-lock.yaml, uv.lock) are intentionally omitted from the diff; do not report them missing."
  echo; echo "## Task spec"; tools/orchestrate/brief.sh "$ID" review >/dev/null; sed '1,/^---$/d' .orchestrate/briefs/$ID-review.md
  echo; echo "## Diff (staged baseline -> working tree)"; echo '```diff'; git diff -- ${PATHS:-.} ':(exclude)pnpm-lock.yaml' ':(exclude)**/uv.lock' | head -c 400000; echo '```'
} > "$R"
OUT=.orchestrate/reviews/$ID-$ATT-$MODEL.txt
HARD_SEC=${HARD_SEC:-1500} IDLE_SEC=${IDLE_SEC:-600} tools/orchestrate/pi-guard.sh "$OUT.jsonl" -- \
  -p --model "cliproxyapi/$MODEL" --thinking high --no-session --tools read @"$R" "Review now." > "$OUT" 2>&1
tail -c 6000 "$OUT"
