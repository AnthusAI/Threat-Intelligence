# Automated Publication Research Workflow

Papyrus can study fully automated publication systems as a standing Newsroom
desk instead of a one-off memo. The current implementation now supports real
private `Assignment` creation through the live edition-planning path, while the
newsroom researcher and reporter procedures remain dry-run-only for research and
draft mutation. Desk and focus-topic context now come from live accepted
category state plus doctrine and recent desk memory; the old track file remains
only as transitional/demo data.

## Desk Context

- Desk: accepted root topic category
- Focus pool: accepted descendant categories under that desk
- Scope: research automation, editorial planning, drafting, publishing, QA,
  review, and human override
- Focus ordering: pinned first, then rank, then stable category key order

## Assignment Contract

Assignments created for this workflow should declare:

- `deskCategoryKey`
- `deskCategoryLineageId`
- `focusCategoryKey`
- `focusCategoryLineageId`
- `focusCategoryTitle`
- `contextProfile`
- `contextTokenBudget`
- `contextSources`

Compatibility aliases such as `researchTrackKey` and `researchLens` may still
be present during migration, but they are no longer canonical.

## Context Assembly

The private agent context pack is assembled on demand from:

- publication mission and policies
- root-desk mission and policies
- desk and focus-topic metadata
- recent desk memory from published items, assignments, assignment events,
  linked references, and knowledge comments
- fresh-evidence request parameters for the current lane/profile

Papyrus assembles the source material. Biblicus compacts it into a
token-budget-limited context pack.

## Research Packet

Keep using the private Papyrus research packet contract from
[skills/researcher-doctrine/SKILL.md](/Users/ryan/Projects/Papyrus/skills/researcher-doctrine/SKILL.md),
and add the context-aware structure inside the same private packet:

- `doctrine_context`
- `source_snapshots`
- `coverage_gaps`
- `recommended_angle`
- `comparison_findings`
- `rubric_assessments`

`doctrine_context` should record whether publication and desk doctrine were
available, and whether the packet fell back to publication doctrine because the
desk doctrine slot was empty.

## Inclusion Standard

Inclusion and risk guidance is generated from live doctrine plus the assignment
lane/profile instead of a hard-coded rubric JSON. Researchers should use that
guidance to explain where evidence is strong, weak, missing, contradictory, or
still review-gated.

## Procedure Usage

The live-first newsroom flow is:

1. The planner or CLI resolves live desks and focus topics from accepted
   category state and writes real private
   `Assignment`, `AssignmentEvent`, and `SemanticRelation` records.
2. Editors work those live queue items in `/newsroom/assignments`.
3. Researchers can build a budgeted live context pack for the same assignment,
   normalize the live assignment context into the dry-run procedure contract,
   and return a structured packet with doctrine-backed findings.
4. Reporters may use the same normalized live assignment path later, but draft
   mutation remains dry-run-only in this milestone.

This formalizes the beat without changing the public reader surface or claiming
that research-packet or draft persistence is already complete.
