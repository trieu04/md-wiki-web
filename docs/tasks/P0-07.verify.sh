set -e
make up
pnpm --filter @md-wiki/api test -- ping
cd services/worker && uv run pytest -q -k ping
