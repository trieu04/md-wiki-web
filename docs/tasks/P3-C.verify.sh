set -e
pnpm --filter @md-wiki/web test
pnpm design:shots >/dev/null
pnpm visual:shots --task P3-C --gallery
