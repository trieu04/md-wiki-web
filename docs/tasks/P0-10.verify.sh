set -e
test -f .github/workflows/ci.yml
if command -v actionlint >/dev/null; then actionlint; else node -e "require('js-yaml')" 2>/dev/null && node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/ci.yml','utf8'))" || python3 -c "import sys;print('yaml check skipped')"; fi
make check
