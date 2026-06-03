from __future__ import annotations

import argparse
import stat
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


SIGNATURE = "# papyrus-gitblock\n"


@dataclass(frozen=True)
class RepoPaths:
    root: Path
    git_dir: Path
    hooks_dir: Path


def _run_git(args: list[str], *, cwd: Path) -> str:
    p = subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return p.stdout.strip()


def _detect_repo_paths(repo: Path) -> RepoPaths:
    root = Path(_run_git(["rev-parse", "--show-toplevel"], cwd=repo))
    git_dir = Path(_run_git(["rev-parse", "--git-dir"], cwd=root))
    if not git_dir.is_absolute():
        git_dir = root / git_dir
    hooks_dir = git_dir / "hooks"
    return RepoPaths(root=root, git_dir=git_dir, hooks_dir=hooks_dir)


def _sh_single_quote(s: str) -> str:
    # POSIX shell-safe single-quoted string: close, escape, reopen.
    return "'" + s.replace("'", "'\"'\"'") + "'"


def _hook_content(message: str) -> str:
    # Print exactly what the caller asked for (no timestamps, no prefixes).
    return (
        "#!/bin/sh\n"
        f"{SIGNATURE}"
        "printf '%s\\n' " + _sh_single_quote(message) + " >&2\n"
        "exit 1\n"
    )


def _is_ours(path: Path) -> bool:
    try:
        return SIGNATURE.strip() in path.read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        return False


def _write_executable(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    mode = path.stat().st_mode
    path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def gitblock_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="gitblock",
        description="Install local git hooks that block commits with a message.",
    )
    parser.add_argument("--repo", default=".", help="Path inside target git repo.")
    parser.add_argument(
        "--message",
        required=True,
        help="Message to print when blocking the commit (printed verbatim).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing hooks even if they don't look like ours.",
    )
    args = parser.parse_args(argv)

    repo = Path(args.repo).resolve()
    try:
        paths = _detect_repo_paths(repo)
    except Exception as e:
        print(f"ERROR: not a git repo (or git failed): {repo}\n{e}", file=sys.stderr)
        return 2

    paths.hooks_dir.mkdir(parents=True, exist_ok=True)
    content = _hook_content(args.message)

    for name in ["pre-commit", "commit-msg"]:
        hook_path = paths.hooks_dir / name
        if hook_path.exists() and not args.force and not _is_ours(hook_path):
            print(f"ERROR: refusing to overwrite existing hook: {hook_path}", file=sys.stderr)
            print("Pass --force to overwrite it.", file=sys.stderr)
            return 3
        _write_executable(hook_path, content)

    return 0


def gitunblock_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="gitunblock",
        description="Remove local commit-blocking git hooks.",
    )
    parser.add_argument("--repo", default=".", help="Path inside target git repo.")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Remove existing hooks even if they don't look like ours.",
    )
    args = parser.parse_args(argv)

    repo = Path(args.repo).resolve()
    try:
        paths = _detect_repo_paths(repo)
    except Exception as e:
        print(f"ERROR: not a git repo (or git failed): {repo}\n{e}", file=sys.stderr)
        return 2

    for name in ["pre-commit", "commit-msg"]:
        hook_path = paths.hooks_dir / name
        if not hook_path.exists():
            continue
        if not args.force and not _is_ours(hook_path):
            print(f"ERROR: refusing to remove existing hook: {hook_path}", file=sys.stderr)
            print("Pass --force to remove it.", file=sys.stderr)
            return 3
        hook_path.unlink()

    return 0

