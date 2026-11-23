set -e
pnpm contracts:gen
git add -A -N packages/contracts services/worker >/dev/null
cp packages/contracts/openapi.json /tmp/mw-openapi-1.json
pnpm contracts:gen
cmp packages/contracts/openapi.json /tmp/mw-openapi-1.json
pnpm contracts:check
test -f packages/contracts/src/schema.d.ts
ls services/worker/src/mdwiki_worker/contracts/*.py >/dev/null
