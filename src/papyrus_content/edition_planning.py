from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .env import PAPYRUS_ROOT
from .graphql_authoring import PapyrusGraphQLAuthoringClient
from .node_lib_bridge import call_node_export
from .options import normalize_string, parse_comma_list

RESEARCH_EDITION_ASSIGNMENT_TYPE = "research.edition-candidate"
REPORTING_EDITION_ASSIGNMENT_TYPE = "reporting.edition-candidate"
EDITION_PLANNING_MODULE = "scripts/lib/papyrus-edition-planning.cjs"


def load_edition_planning_state(client: PapyrusGraphQLAuthoringClient) -> dict[str, Any]:
    return {
        "editions": client.safe_list_records("Edition"),
        "publishedEditions": client.safe_list_records("PublishedEdition"),
        "editionItems": client.safe_list_records("EditionItem"),
        "categorySets": client.safe_list_records("CategorySet"),
        "categories": client.safe_list_records("Category"),
        "references": client.safe_list_records("Reference"),
        "semanticRelations": client.safe_list_records("SemanticRelation"),
        "semanticNodes": client.safe_list_records("SemanticNode"),
        "assignments": client.safe_list_records("Assignment"),
        "assignmentEvents": client.safe_list_records("AssignmentEvent"),
        "newsroomSections": client.safe_list_records("NewsroomSection"),
    }


def build_edition_planning_plan(state: dict[str, Any], options: dict[str, Any]) -> dict[str, Any]:
    return call_node_export(EDITION_PLANNING_MODULE, "buildEditionPlanningPlan", state, options)


def verify_edition_planning_plan(state: dict[str, Any], plan: dict[str, Any]) -> dict[str, Any]:
    return call_node_export(EDITION_PLANNING_MODULE, "verifyEditionPlanningPlan", state, plan)


def apply_edition_planning_plan(client: PapyrusGraphQLAuthoringClient, plan: dict[str, Any]) -> dict[str, Any]:
    actionable = [record for record in plan.get("records") or [] if record.get("action") != "noop"]
    applied = 0
    for record in actionable:
        client.upsert(record["modelName"], record["expected"])
        applied += 1
        if applied == len(actionable) or applied % 25 == 0:
            print(f"edition-planning\tapply\t{applied}/{len(actionable)}", flush=True)
    return {"applied": applied, "skipped": len(plan.get("records") or []) - len(actionable)}


def write_edition_planning_report(
    plan: dict[str, Any],
    payload: dict[str, Any],
    *,
    output_dir: str | None = None,
    filename: str = "edition-planning-report.json",
) -> dict[str, str]:
    run_id = f"edition-planning-{plan.get('editionDate')}-{timestamp_for_path(plan.get('generatedAt') or _utc_now())}"
    target_dir = Path(output_dir) if output_dir else PAPYRUS_ROOT / ".papyrus-runs" / run_id
    target_dir.mkdir(parents=True, exist_ok=True)
    filepath = target_dir / filename
    filepath.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return {"outputDir": str(target_dir), "filepath": str(filepath)}


def build_edition_planning_command_plan(
    client: PapyrusGraphQLAuthoringClient,
    options: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, str]]:
    edition_date = normalize_string(options.get("date"))
    if not edition_date:
        raise ValueError("editions plan/dispatch-research requires --date YYYY-MM-DD.")
    state = load_edition_planning_state(client)
    assignment_type = options.get("assignment-type")
    plan = build_edition_planning_plan(
        state,
        {
            "editionDate": edition_date,
            "editionSlug": options.get("slug"),
            "assignmentTypeKey": REPORTING_EDITION_ASSIGNMENT_TYPE
            if assignment_type == "reporting"
            else assignment_type,
            "topDeskCount": options.get("top-desks"),
            "publicationSlots": options.get("slots"),
            "overassignmentRatio": options.get("ratio"),
            "maxAssignments": options.get("max-assignments"),
            "rotatingSectionCount": options.get("rotating-sections"),
            "focusCategories": parse_comma_list(options.get("focus-categories") or options.get("track-lenses")),
            "sectionTargets": parse_comma_list(options.get("section-targets")),
            "sectionBudgets": parse_comma_list(options.get("section-budgets")),
            "contextProfile": options.get("context-profile"),
            "targetSystemType": options.get("target-system-type"),
        },
    )
    report = write_edition_planning_report(
        plan,
        {"mode": "dry-run", "plan": plan},
        output_dir=options.get("output"),
        filename="dry-run-plan.json",
    )
    return plan, report


def print_edition_planning_summary(plan: dict[str, Any], report: dict[str, str], mode: str) -> None:
    summary = plan.get("summary") or {}
    category_set = plan.get("categorySet") or {}
    print(f"edition-planning\tmode\t{mode}")
    print(
        f"edition-planning\tedition\t{plan['edition']['id']}\t{plan['edition']['slug']}\t{plan['edition']['status']}"
    )
    print(f"edition-planning\tassignment-type\t{summary.get('assignmentTypeKey')}")
    print(f"edition-planning\tcategory-set\t{category_set.get('id')}\t{category_set.get('displayName')}")
    print(f"edition-planning\tdesks\t{len(plan.get('desks') or [])}")
    print(f"edition-planning\tsections\t{','.join(plan.get('sections') or []) or 'none'}")
    print(f"edition-planning\tassignments\t{len(plan.get('assignments') or [])}")
    print(f"edition-planning\tcontext-backed\t{summary.get('contextBackedAssignmentCount')}")
    print(
        f"edition-planning\trecords\tcreate={summary.get('createCount')}\t"
        f"update={summary.get('updateCount')}\tnoop={summary.get('noopCount')}"
    )
    print(f"edition-planning\treport\t{report['filepath']}")
    for warning in plan.get("warnings") or []:
        print(f"edition-planning\twarning\t{warning}")
    for budget in summary.get("sectionBudgets") or []:
        section = budget.get("section") or {}
        print(f"section-budget\t{section.get('id')}\tslots={budget.get('slots')}\ttype={section.get('type')}")
    for coverage in plan.get("focusCoverage") or []:
        print(
            f"focus-coverage\t{coverage.get('deskCategoryKey')}\t{coverage.get('laneKey')}\t"
            f"{coverage.get('focusCategoryKey')}\t{coverage.get('count')}\tqueue={coverage.get('queueKey') or '-'}"
        )
    for desk in plan.get("desks") or []:
        print(
            f"desk\t{desk.get('categoryKey')}\t{desk.get('opportunityScore')}\t"
            f"refs={desk.get('referenceCount')}\tsignals={desk.get('signalCount')}"
        )


def timestamp_for_path(value: str) -> str:
    return "".join(ch for ch in value if ch.isdigit() or ch in {"T", "Z"})


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
