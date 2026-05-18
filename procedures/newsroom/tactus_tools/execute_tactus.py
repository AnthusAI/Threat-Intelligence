"""Single Papyrus newsroom tool exposed to Tactus agents."""

from __future__ import annotations

import sys
from pathlib import Path


PAPYRUS_ROOT = Path(__file__).resolve().parents[3]
SRC_ROOT = PAPYRUS_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from papyrus_newsroom.tactus_runtime import execute_tactus  # noqa: E402,F401
