"""Single Papyrus newsroom tool exposed to Tactus agents."""

from __future__ import annotations

import sys
from pathlib import Path


PAPYRUS_ROOT = Path(__file__).resolve().parents[3]
SRC_ROOT = PAPYRUS_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from papyrus_newsroom.tactus_runtime import execute_tactus_harnessed as _execute_tactus_harnessed  # noqa: E402


def execute_tactus(
    tactus: str,
    harness: str = "raw",
    assignment_id: str = "",
    assignment_item_json: str = "",
    corpus_key: str = "",
    max_evidence_items: int = 20,
    research_mode: str = "",
) -> dict:
    """Execute a Papyrus Tactus snippet through the newsroom runtime.

    Use harness="research" when the caller should provide only the research body.
    The research harness preloads the assignment item, OpenAI web search helper,
    corpus key, and dry-run research-plan finisher.
    """

    return _execute_tactus_harnessed(
        tactus,
        harness=harness,
        assignment_id=assignment_id,
        assignment_item_json=assignment_item_json,
        corpus_key=corpus_key,
        max_evidence_items=max_evidence_items,
        research_mode=research_mode,
    )
