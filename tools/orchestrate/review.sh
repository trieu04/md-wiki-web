#!/usr/bin/env bash
# review.sh <ID> <reviewer-model> <attempt>  -> JSON verdict on stdout tail; reviewer cannot edit
set -uo pipefail
ID=$1; MODEL=$2; ATT=$3
ROOT=$(git rev-parse --show-toplevel); cd "$ROOT"
mkdir -p .orchestrate/reviews
git add -A -N
R=.orchestrate/reviews/$ID-$ATT-$MODEL-input.md
{
  echo "You are a pragmatic code reviewer. Do NOT modify any file. Review the diff below against the task spec,"
  echo "AGENTS.md, docs/system-logic.md and docs/design-system.md. Read any repo file you need."
  echo
  echo "Severity rubric (D-28) - be strict about this, it decides whether the task is redone:"
  echo "- blocker/major ONLY when at least one is true: an acceptance criterion or the Verify command is not met;"
  echo "  a contract drifts (system-logic.md, DTOs, error codes); a business rule is in the wrong layer or wrong;"
  echo "  a rule in the spec or system-logic.md section 11 has no test; design was invented; a security hole is reachable"
  echo "  in normal use (path traversal, auth bypass, injection, secret leak); or a bug breaks the intended workflow in normal use."
  echo "- NOT blocker/major (use minor or omit): hypothetical or rare edge cases outside the spec (PID reuse, exotic or"
  echo "  non-default configs, paths with spaces, races needing unusual timing); hardening beyond the spec; style, naming,"
  echo "  refactors, performance, duplication; 'more tests would be nice' for behaviour the spec does not require."
  echo "- Report at most 3 minor issues, one sentence each. Minor issues never set pass=false."
  echo "- If this is a retry (an 'Attempt N' / previous-review context appears in the spec), check that the previous"
  echo "  findings are fixed and nothing regressed. Do not raise NEW findings on code unchanged since the last attempt"
  echo "  unless they are blockers."
  echo "When unsure whether something is major, it is minor."
  echo
  echo "Answer with ONLY a JSON object on the last line:"
  echo '{"pass": true|false, "issues": [{"file": "...", "line": 0, "severity": "blocker|major|minor", "detail": "..."}]}'
  echo "pass=false only for blocker/major issues. Lockfiles (pnpm-lock.yaml, uv.lock) are intentionally omitted from the diff; do not report them missing."
  echo; echo "## Task spec"; tools/orchestrate/brief.sh "$ID" review >/dev/null; sed '1,/^---$/d' .orchestrate/briefs/$ID-review.md
  # D-28: on a retry, give the reviewer the previous verdict so it checks fixes instead of hunting new nits
  PREV=$(ls -t .orchestrate/reviews/$ID-*-*.txt 2>/dev/null | grep -v -- "-$ATT-" | head -1)
  if [ -n "$PREV" ]; then echo; echo "## Previous review (this is a retry: verify these are fixed, check regressions only)"; grep -o '{"pass".*' "$PREV" | tail -1; fi
  echo; echo "## Diff (staged baseline -> working tree)"; echo '```diff'; git diff -- ${PATHS:-.} ':(exclude)pnpm-lock.yaml' ':(exclude)**/uv.lock' | head -c 400000; echo '```'
} > "$R"
OUT=.orchestrate/reviews/$ID-$ATT-$MODEL.txt
HARD_SEC=${HARD_SEC:-1500} IDLE_SEC=${IDLE_SEC:-600} tools/orchestrate/pi-guard.sh "$OUT.jsonl" -- \
  -p --model "cliproxyapi/$MODEL" --thinking high --no-session --tools read @"$R" "Review now." > "$OUT" 2>&1
tail -c 6000 "$OUT"
