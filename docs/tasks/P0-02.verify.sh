set -e
cd services/worker && uv sync && uv run ruff check . && uv run mypy src && uv run pytest -q
uv run python -c "import sys; assert sys.version_info[:2]==(3,12), sys.version"
