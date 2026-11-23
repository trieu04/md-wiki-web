#!/usr/bin/env bash
# land.sh <ID> <commit-message-file>   (D-29, D-27)
# Commits the task worktree, rebases onto main (pnpm-lock.yaml regenerated on conflict; any other conflict stops),
# re-runs the gate, fast-forwards main, removes the worktree and branch.
set -uo pipefail
ID=$1; MSG=$2
ROOT=$(git rev-parse --show-toplevel); WT="$(dirname "$ROOT")/md-wiki-web-wt-$ID"
[ -d "$WT" ] || { echo "no worktree $WT"; exit 2; }
cd "$WT"
git add -A && { git diff --cached --quiet || git commit -q -F "$MSG"; }
git log -1 --format=%s | grep -q "($ID)" || { echo "no task commit on branch"; exit 2; }
if ! git rebase -q main >/dev/null 2>&1; then
  while :; do
    C=$(git diff --name-only --diff-filter=U)
    [ -z "$C" ] && break
    for f in $C; do
      if [ "$f" = pnpm-lock.yaml ]; then git show main:pnpm-lock.yaml > pnpm-lock.yaml && pnpm install --prefer-offline >/dev/null 2>&1 && git add pnpm-lock.yaml
      elif python3 -I tools/orchestrate/union-exports.py "$f"; then git add "$f"
      else echo "CONFLICT needs an OPUS merge in $WT: $f"; exit 1; fi
    done
    GIT_EDITOR=true git rebase --continue >/dev/null 2>&1 && break
  done
fi
G=$(tools/orchestrate/gate.sh "$ID" land 2>&1); echo "$G" | grep -E "^(FAIL|GATE)"
echo "$G" | grep -q "^GATE PASS" || { echo "gate failed after rebase — not landing"; exit 1; }
cd "$ROOT" && git merge --ff-only -q "task/$ID" && git worktree remove --force "$WT" && git branch -q -d "task/$ID" && git log --oneline -1
