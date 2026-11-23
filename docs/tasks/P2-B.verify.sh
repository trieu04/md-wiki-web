set -e
pnpm --filter @md-wiki/web test
pnpm design:shots >/dev/null
ls design/reference/crops/*/*.png | wc -l | awk '{exit !($1>0)}'
pnpm visual:shots --task P2-B --gallery
