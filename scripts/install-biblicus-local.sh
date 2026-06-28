#!/usr/bin/env bash
# Install sibling Biblicus in editable mode into the active Poetry venv (or current python).
# Use while developing entity extraction, HTML heuristics, and graph NER without publishing Biblicus.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIBLICUS="${BIBLICUS_WORKDIR:-$ROOT/../Biblicus}"
EXTRAS="${BIBLICUS_LOCAL_EXTRAS:-web,ner,markitdown}"

if [[ ! -f "$BIBLICUS/pyproject.toml" ]]; then
  echo "ERROR: Biblicus checkout not found at $BIBLICUS (set BIBLICUS_WORKDIR if needed)." >&2
  exit 1
fi

cd "$ROOT"
if command -v poetry >/dev/null 2>&1 && poetry env info -p >/dev/null 2>&1; then
  echo "Installing editable Biblicus[$EXTRAS] into Poetry venv..."
  if ! poetry run pip --version >/dev/null 2>&1; then
    poetry run python -m ensurepip --upgrade >/dev/null 2>&1 || true
  fi
  poetry run pip install -e "${BIBLICUS}[${EXTRAS}]"
else
  echo "Installing editable Biblicus[$EXTRAS] into $(command -v python3)..."
  python3 -m pip install -e "${BIBLICUS}[${EXTRAS}]"
fi

echo "Done. Verify with: poetry run python -c \"import biblicus; print(biblicus.__file__)\""
echo "Subprocess CLI paths still honor BIBLICUS_WORKDIR=$BIBLICUS"
