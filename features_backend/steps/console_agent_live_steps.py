from __future__ import annotations

import os
from pathlib import Path

from behave import given, then, when

from live_console_agent_smoke import run_scenario


@given("live console agent tests are enabled")
def step_live_console_agent_tests_enabled(context) -> None:
    assert (
        os.environ.get("PAPYRUS_LIVE_AGENT_BDD") == "1"
    ), "Set PAPYRUS_LIVE_AGENT_BDD=1 to run live LLM/AppSync console-agent BDD tests."


@when('I run the live console agent smoke scenario "{scenario}"')
def step_run_live_console_agent_smoke_scenario(context, scenario: str) -> None:
    repo_root = Path(__file__).resolve().parents[3]
    keep = os.environ.get("PAPYRUS_LIVE_AGENT_KEEP") == "1"
    attempts = 3 if scenario == "docs-progressive" else 1
    last_error: Exception | None = None
    for _ in range(attempts):
        try:
            context.live_console_agent_smoke_result = run_scenario(
                scenario,
                repo_root=repo_root,
                keep=keep,
            )
            return
        except RuntimeError as error:
            last_error = error
    assert last_error is not None
    raise last_error


@then("the live console agent smoke scenario should pass")
def step_live_console_agent_smoke_scenario_should_pass(context) -> None:
    assert context.live_console_agent_smoke_result.get("ok") is True


@then('the live console agent smoke result should include tool call "{tool_call}"')
def step_live_console_agent_smoke_should_include_tool_call(context, tool_call: str) -> None:
    api_calls = context.live_console_agent_smoke_result.get("apiCalls") or []
    assert tool_call in api_calls, f"Expected {tool_call}; saw {', '.join(api_calls)}"


@then("the live console agent smoke result should include exactly {count:d} assignment")
def step_live_console_agent_smoke_should_include_assignments(context, count: int) -> None:
    assignment_ids = context.live_console_agent_smoke_result.get("assignmentIds") or []
    assert len(assignment_ids) == count, f"Expected {count} assignments; saw {len(assignment_ids)}"
