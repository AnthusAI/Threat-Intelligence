from __future__ import annotations

import sys

from papyrus_content import cli as content_cli
from papyrus_newsroom import cli as newsroom_cli


def _usage() -> None:
    print("Usage: poetry run papyrus <group> <command> [options]")
    print(
        "Groups: assignments, reporting, research, references, knowledge, sections, editions, procedures, analysis, auth, batch, ops"
    )


def _delegate_content(group: str, command: str, flags: list[str]) -> None:
    content_cli.load_dotenv()
    content_cli.dispatch(group, command, flags)


def _delegate_newsroom(argv: list[str]) -> int:
    return newsroom_cli.main(argv)


def _require_command(group: str, argv: list[str]) -> tuple[str, list[str]]:
    if len(argv) < 2:
        raise ValueError(f"papyrus {group} requires <command>.")
    return argv[1], argv[2:]


def _map_reporting(command: str, flags: list[str]) -> None:
    mapped = {
        "create": "create-reporting",
        "run": "run-reporting",
        "apply": "apply-reporting-packet",
        "review": "review-reporting-packet",
        "copywriting": "run-copywriting",
        "copywriting-output": "copywriting-output",
    }.get(command)
    if not mapped:
        raise ValueError(f"Unsupported papyrus reporting command: {command}")
    _delegate_content("assignments", mapped, flags)


def _map_research(command: str, flags: list[str]) -> None:
    mapped = {
        "create": "create-research",
        "run": "run-research",
        "apply": "apply-research-packet",
        "intake": "research-intake-now",
        "packets": "research-packets",
        "intake-proposals": "intake-proposals",
    }.get(command)
    if not mapped:
        raise ValueError(f"Unsupported papyrus research command: {command}")
    _delegate_content("assignments", mapped, flags)


def _map_sections(command: str, flags: list[str]) -> None:
    mapped = {
        "import": "import-sections",
        "import-doctrine": "import-doctrine",
        "recount-summary": "recount-summary",
        "repair-message-status": "repair-message-status",
        "backfill-feed-fields": "backfill-feed-fields",
        "backfill-operational-indexes": "backfill-operational-indexes",
        "prune-attachments": "prune-attachments",
    }.get(command)
    if not mapped:
        raise ValueError(f"Unsupported papyrus sections command: {command}")
    _delegate_content("newsroom", mapped, flags)


def _map_procedures(command: str, flags: list[str]) -> int:
    if command == "seed-required":
        _delegate_content("newsroom", "seed-required-procedures", flags)
        return 0
    if command == "execute-tactus":
        return _delegate_newsroom(["execute-tactus", *flags])
    if command == "policy":
        if not flags:
            raise ValueError("papyrus procedures policy requires <command>.")
        _delegate_content("policy", flags[0], flags[1:])
        return 0
    raise ValueError(f"Unsupported papyrus procedures command: {command}")


def _map_assignments(command: str, flags: list[str]) -> int:
    if command == "run-story-cycle":
        return _delegate_newsroom(["assignments", "run-story-cycle", *flags])
    if command == "story-cycle-output":
        return _delegate_newsroom(["assignments", "story-cycle-output", *flags])
    if command == "build-assignment-agent-context":
        return _delegate_newsroom(["build-assignment-agent-context", *flags])
    _delegate_content("assignments", command, flags)
    return 0


def _map_references(command: str, flags: list[str]) -> int:
    newsroom_reference_commands = {
        "list",
        "curate-recent",
        "summaries",
        "summarize",
        "summarize-batch",
        "summary-cleanup-legacy",
        "quality",
        "title-subtitle",
    }
    if command in newsroom_reference_commands:
        return _delegate_newsroom(["references", command, *flags])
    _delegate_content("references", command, flags)
    return 0


def _map_knowledge(command: str, flags: list[str]) -> int:
    if command == "ontology":
        if not flags:
            raise ValueError("papyrus knowledge ontology requires <command>.")
        _delegate_content("ontology", flags[0], flags[1:])
        return 0
    if command == "query":
        return _delegate_newsroom(["knowledge-query", *flags])
    if command == "vector-index":
        return _delegate_newsroom(["knowledge-vector-index", *flags])
    if command == "signals":
        return _delegate_newsroom(["signals", *flags])
    if command == "topics":
        if not flags:
            raise ValueError("papyrus knowledge topics requires <command>.")
        _delegate_content("categories", flags[0], flags[1:])
        return 0
    if command == "concepts":
        if not flags:
            raise ValueError("papyrus knowledge concepts requires <command>.")
        _delegate_content("relations", flags[0], flags[1:])
        return 0
    raise ValueError(f"Unsupported papyrus knowledge command: {command}")


def _map_analysis(command: str, flags: list[str]) -> int:
    if command == "test":
        if not flags:
            raise ValueError("papyrus analysis test requires <command>.")
        _delegate_content("test", flags[0], flags[1:])
        return 0
    _delegate_content("analysis", command, flags)
    return 0


def _map_ops(command: str, flags: list[str]) -> int:
    if command not in {"content", "corpora", "categories", "relations", "messages"}:
        raise ValueError(f"Unsupported papyrus ops group: {command}")
    if not flags:
        raise ValueError(f"papyrus ops {command} requires <command>.")
    _delegate_content(command, flags[0], flags[1:])
    return 0


def main(argv: list[str] | None = None) -> int:
    args = list(argv if argv is not None else sys.argv[1:])
    if not args:
        _usage()
        return 1
    group = args[0]
    try:
        if group == "assignments":
            command, flags = _require_command(group, args)
            return _map_assignments(command, flags)
        if group == "references":
            command, flags = _require_command(group, args)
            return _map_references(command, flags)
        if group == "analysis":
            command, flags = _require_command(group, args)
            return _map_analysis(command, flags)
        if group in {"editions", "auth", "batch"}:
            command, flags = _require_command(group, args)
            _delegate_content(group, command, flags)
            return 0
        if group == "reporting":
            command, flags = _require_command(group, args)
            _map_reporting(command, flags)
            return 0
        if group == "research":
            command, flags = _require_command(group, args)
            _map_research(command, flags)
            return 0
        if group == "sections":
            command, flags = _require_command(group, args)
            _map_sections(command, flags)
            return 0
        if group == "procedures":
            command, flags = _require_command(group, args)
            return _map_procedures(command, flags)
        if group == "knowledge":
            command, flags = _require_command(group, args)
            return _map_knowledge(command, flags)
        if group == "help":
            _usage()
            return 0
        if group == "ops":
            command, flags = _require_command(group, args)
            return _map_ops(command, flags)
        raise ValueError(f"Unsupported papyrus group: {group}")
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
