"""Papyrus newsroom Python package."""

from .cli import main
from .tactus_runtime import execute_tactus

__all__ = ["execute_tactus", "main"]
