#!/usr/bin/env bash
# gate.sh <ID> <attempt>  -> runs standard checks + task verify; exit 0 = pass
set -uo pipefail
ID=$1; ATT=$2
ROOT=$(git rev-parse --show-toplevel); cd "$ROOT"
mkdir -p .orchestrate/gates
OUT=.orchestrate/gates/$ID-$ATT.txt; : > "$OUT"
FAIL=0
step() { echo "### $*" >> "$OUT"; if ( eval "$*" ) >> "$OUT" 2>&1; then echo "PASS: $*" >> "$OUT"; else echo "FAIL: $*" >> "$OUT"; FAIL=1; fi; }
if [ -f package.json ] && grep -q '"check"' package.json; then
  step "pnpm install --prefer-offline >/dev/null"
  step "pnpm build"
  step "pnpm lint"
  step "pnpm typecheck"
  step "pnpm test"
fi
if [ -f services/worker/pyproject.toml ] && [ -n "$(git status --porcelain services/worker)" ]; then
  step "cd services/worker && uv sync -q && uv run ruff check . && uv run mypy src && uv run pytest -q"
fi
if [ -f docs/tasks/$ID.verify.sh ]; then step "bash docs/tasks/$ID.verify.sh"; fi
grep -E '^(PASS|FAIL):' "$OUT"
[ $FAIL -eq 0 ] && echo "GATE PASS" || { echo "GATE FAIL (details: $OUT)"; }
exit $FAIL
