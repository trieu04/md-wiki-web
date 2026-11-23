set -e
pnpm --filter @md-wiki/domain test
pnpm --filter @md-wiki/domain build
