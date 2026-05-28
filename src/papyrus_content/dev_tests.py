from __future__ import annotations

import subprocess

from .env import PAPYRUS_ROOT


def run_category_mapper_tests(_flags: list[str]) -> None:
    _run_unittest_modules(
        [
            "procedures.newsroom.tests.test_categories_steering",
            "procedures.newsroom.tests.test_relations_commands",
        ]
    )


def run_identifier_backfill_tests(_flags: list[str]) -> None:
    _run_unittest_modules(["procedures.newsroom.tests.test_references_commands"])


def _run_unittest_modules(modules: list[str]) -> None:
    args = ["poetry", "run", "python", "-m", "unittest", "-v", *modules]
    result = subprocess.run(args, cwd=PAPYRUS_ROOT, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"Python unittest run failed with exit code {result.returncode}.")
