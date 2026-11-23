"""``mdwiki-worker`` command line: ``serve`` (default) and ``eval`` (system-logic §7.6.8)."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from .providers import AiSettings, make_provider
from .quality.eval import DatasetError, evaluate, format_table, read_dataset
from .quality.job import KIND
from .quality.rules import RulesError

DEFAULT_RULES = Path(__file__).resolve().parents[4] / "rules" / "quality.md"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="mdwiki-worker")
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("serve", help="consume the job queue (default)")
    ev = sub.add_parser("eval", help="score the quality check on a JSONL dataset")
    ev.add_argument("dataset", type=Path)
    ev.add_argument("--rules", type=Path, default=DEFAULT_RULES)
    ev.add_argument("--out", type=Path, default=None, help="write the JSON report here")
    ev.add_argument("--limit", type=int, default=None)
    return parser


def run_eval(args: argparse.Namespace) -> int:
    try:
        items = read_dataset(args.dataset, args.limit)
        rules_raw = args.rules.read_bytes()
        provider, config = make_provider(KIND, AiSettings())
        report = asyncio.run(evaluate(items, rules_raw, provider, config))
    except (OSError, DatasetError, RulesError, ValueError) as exc:
        print(f"eval: {exc}", file=sys.stderr)
        return 2
    if args.out is not None:
        args.out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(format_table(report))
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command == "eval":
        return run_eval(args)
    from .main import run

    run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
