#!/usr/bin/env bash
# land.sh <ID> <commit-message-file>   (D-29, D-27)
# Commits the task worktree, rebases onto main (pnpm-lock.yaml regenerated on conflict; any other conflict stops),
# re-runs the gate, fast-forwards main, removes the worktree and branch.
set -uo pipefail
ID=$1; MSG=$2
ROOT=$(git rev-parse --show-toplevel); WT="$(dirname "$ROOT")/md-wiki-web-wt-$ID"
[ -d "$WT" ] || { echo "no worktree $WT"; exit 2; }
cd "$WT"
git add -A && git commit -q -F "$MSG" || { echo "nothing to commit"; exit 2; }
if ! git rebase -q main >/dev/null 2>&1; then
  while :; do
    C=$(git diff --name-only --diff-filter=U)
    [ -z "$C" ] && break
    if [ "$C" != "pnpm-lock.yaml" ]; then echo "CONFLICT needs a human/OPUS merge in $WT:"; echo "$C"; exit 1; fi
    git show main:pnpm-lock.yaml > pnpm-lock.yaml && pnpm install --prefer-offline >/dev/null 2>&1 && git add pnpm-lock.yaml
    GIT_EDITOR=true git rebase --continue >/dev/null 2>&1 && break
  done
fi
tools/orchestrate/gate.sh "$ID" land 2>&1 | grep -E "^(FAIL|GATE)"
grep -q "^GATE PASS" ".orchestrate/gates/$ID-land.txt" || { echo "gate failed after rebase — not landing"; exit 1; }
cd "$ROOT" && git merge --ff-only -q "task/$ID" && git worktree remove --force "$WT" && git branch -q -d "task/$ID" && git log --oneline -1
