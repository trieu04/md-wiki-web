set -e
nc -z 127.0.0.1 5432 && nc -z 127.0.0.1 6379 || make up
pnpm --filter @md-wiki/domain test
pnpm --filter @md-wiki/api exec prisma migrate deploy
pnpm --filter @md-wiki/api test
pnpm contracts:check
