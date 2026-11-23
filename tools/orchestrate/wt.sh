#!/usr/bin/env bash
# wt.sh <ID>  -> creates ../md-wiki-web-wt-<ID> on branch task/<ID> from main (D-29); prints its path
set -euo pipefail
ID=$1; ROOT=$(git rev-parse --show-toplevel); WT="$(dirname "$ROOT")/md-wiki-web-wt-$ID"
[ -d "$WT" ] || git -C "$ROOT" worktree add -q -b "task/$ID" "$WT" main
[ -d "$ROOT/design/reference" ] && [ ! -d "$WT/design/reference" ] && cp -R "$ROOT/design/reference" "$WT/design/"
mkdir -p "$WT/.orchestrate"
[ -f "$WT/.env" ] || cp "$ROOT/.env.example" "$WT/.env"
(cd "$WT" && pnpm install --prefer-offline >/dev/null 2>&1 && cd services/worker && uv sync -q >/dev/null 2>&1) || true
echo "$WT"
