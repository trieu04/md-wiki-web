set -e
make up
cp -n .env.example .env 2>/dev/null || true
pnpm --filter @md-wiki/api test
pnpm check
