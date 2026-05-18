"""
Compatibility shim for Tactus plugin loading.

The canonical implementation lives in the Poetry-managed ``papyrus_newsroom``
package under ``src/``.
"""

from __future__ import annotations

import sys
from pathlib import Path


PAPYRUS_ROOT = Path(__file__).resolve().parents[3]
SRC_ROOT = PAPYRUS_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from papyrus_newsroom.cli import main  # noqa: E402
from papyrus_newsroom.newsroom import *  # noqa: F401,F403,E402


if __name__ == "__main__":
    raise SystemExit(main())
