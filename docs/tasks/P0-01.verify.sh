set -e
pnpm install
pnpm build
pnpm check
for p in apps/web apps/api packages/domain packages/contracts; do test -f $p/package.json; done
grep -q '"noUncheckedIndexedAccess": true' tsconfig.base.json
grep -q '"exactOptionalPropertyTypes": true' tsconfig.base.json
grep -q 'design/runtime/' .gitignore && grep -q '.orchestrate/' .gitignore
