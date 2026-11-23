set -e
pnpm --filter @md-wiki/web test
pnpm --filter @md-wiki/domain test
pnpm design:shots >/dev/null
ls design/reference/crops/*/*.png | wc -l | awk '{exit !($1>0)}'
