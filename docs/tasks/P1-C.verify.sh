set -e
make up
pnpm --filter @md-wiki/domain test
pnpm --filter @md-wiki/api exec prisma migrate deploy
pnpm --filter @md-wiki/api test
pnpm contracts:check
