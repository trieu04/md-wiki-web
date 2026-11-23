set -e
set -a; . ./.env; set +a
nc -z 127.0.0.1 5432 && nc -z 127.0.0.1 6379 || make up
pnpm --filter @md-wiki/web test
pnpm design:shots >/dev/null
pnpm visual:shots --task P3-D --gallery
pnpm e2e
