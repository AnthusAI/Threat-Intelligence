"""Papyrus newsroom Python package."""

from __future__ import annotations

from typing import Any

__all__ = ["execute_tactus", "main"]


def __getattr__(name: str) -> Any:
    if name == "execute_tactus":
        from .tactus_runtime import execute_tactus

        return execute_tactus
    if name == "main":
        from .cli import main

        return main
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
