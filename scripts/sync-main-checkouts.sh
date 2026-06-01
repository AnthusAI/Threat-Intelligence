#!/usr/bin/env bash
# Fast-forward Papyrus and Papyrus-production to origin/main (same GitHub repo).
set -euo pipefail

for dir in "${PAPYRUS_ROOT:-$HOME/Projects/Papyrus}" "${PAPYRUS_PRODUCTION_ROOT:-$HOME/Projects/Papyrus-production}"; do
  if [[ ! -d "$dir/.git" ]]; then
    echo "skip (not a git repo): $dir" >&2
    continue
  fi
  echo "==> $dir"
  git -C "$dir" fetch origin main
  git -C "$dir" checkout main
  git -C "$dir" pull --ff-only origin main
  git -C "$dir" log -1 --oneline
done
