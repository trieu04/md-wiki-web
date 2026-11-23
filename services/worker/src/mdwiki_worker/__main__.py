"""Enable ``python -m mdwiki_worker`` as the worker executable (``serve`` or ``eval``)."""

from .cli import main

if __name__ == "__main__":
    raise SystemExit(main())
