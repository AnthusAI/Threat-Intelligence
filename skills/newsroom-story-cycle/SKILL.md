---
name: newsroom-story-cycle
description: Use this skill when running or inspecting Papyrus story-cycle workflows that research one topic through multiple Newsroom sections, dispatch parallel reporting assignments, retrieve private packet output, or prepare editor selection without creating final copy.
---

# Newsroom Story Cycle Skill

Use this skill when a coding agent needs a repeatable operator path for:

- researching one topic through several `NewsroomSection` lenses;
- dispatching multiple parallel reporting assignments per section;
- finding the resulting private information packets;
- preserving the boundary between assignment work product and publication copy.

The story-cycle is a newsroom budget loop, not an article generator. It creates
private context for editors and copywriters.

## Domain Model

Keep these concepts separate:

- **Section**: the operational news desk lens, backed by `NewsroomSection`
  mission, policy, guidance, and kill criteria.
- **Topic**: accepted taxonomy scope, backed by `Category`.
- **Coverage concept**: the richer question or concept, backed by
  `SemanticNode`.
- **Research packet**: private `Message` work product with
  `messageKind = "research_packet"`.
- **Reporting packet**: private `Message` work product with
  `messageKind = "reporting_context_packet"`.
- **Draft Item**: reader-facing copy shell created only after editor
  `select`/`brief`.
- **EditionItem**: placement in a reader edition; never created by story-cycle
  packet generation or packet review.

New packet writes use `Assignment --produces--> Message`. Legacy
`Message --comment--> Assignment` packet links may still be read.

## Default Smoke Command

Run dry-run first. Treat the run as a Coverage Theme in editor-facing language:
one shared topic worked through multiple section lenses. The Python
`coverage-themes run` command is the primary operator surface; the older Node
`assignments run-story-cycle` name remains a compatibility alias.

```bash
poetry run papyrus-newsroom coverage-themes run \
  --date 2026-05-21 \
  --topic "AI in video games" \
  --category AI-ML-research \
  --coverage-key coverage.ai-in-video-games \
  --sections culture,methods,business,law \
  --section-budgets culture:2,methods:1,business:1,law:1 \
  --research-mode source_discovery \
  --max-parallel-research 2 \
  --max-parallel-reporting 3 \
  --through reporting \
  --json
```

Use the assignment-desk signal feed before edition planning when the topic is
not already chosen:

```bash
poetry run papyrus-newsroom signals trend-report \
  --corpus-key AI-ML-research \
  --topic "AI in video games" \
  --sections culture,methods,business,law \
  --json
```

Use `--through plan` for assignment graph only, `--through research` to stop
after private research packets, and `--through reporting` to stop after private
reporting packets. `--through reporting` is the default. Story-cycle runs do not
auto-select packets or run copywriting.

The command is dry-run unless `--apply` is supplied. Dry-run writes local output
under `.papyrus-runs/story-cycle-<run-id>/` and should create no GraphQL
records.

Use `--apply` only when the plan is acceptable and the current
`PAPYRUS_GRAPHQL_ENDPOINT` / `PAPYRUS_GRAPHQL_JWT` point at the intended
environment. Apply mode may persist `Assignment`, `AssignmentEvent`, `Message`,
`ModelAttachment`, and `SemanticRelation` records. It must not create `Item` or
`EditionItem` records during packet generation.

Applied reruns reuse existing packet Messages by default so a Coverage Theme can
resume downstream phases without re-running successful upstream agents. Pass
`--refresh-packets` only when the intent is to regenerate those packet payloads.

In live apply smoke tests, pass `--require-agent-success` so degraded agent
output fails instead of being masked by deterministic fallback packets. Pass
`--allow-fallback` only when fallback behavior is the thing being tested.

## Output Discovery

After a run, inspect the grouped private output:

```bash
poetry run papyrus-newsroom story-budget output \
  --run-id <coverage-theme-run-id> \
  --json
```

The output should be grouped by section and show:

- research packet id or dry-run packet path;
- reporting packet ids or dry-run packet paths;
- reporting angle;
- editor recommendation;
- accepted evidence count;
- proposed reference count;
- risk flags;
- coverage gaps;
- open questions;
- copywriter brief.

For applied runs, the Story Budget board in `/newsroom/assignments?view=budget`
should show Coverage Theme phase state: plan, research, reporting, review,
copywriting, or draft, with reporting candidates grouped by edition and section.

## Section Lenses

The canonical smoke uses:

- `culture`: creative workflows, game design, player experience, generative
  media.
- `methods`: implementation patterns, NPC behavior, procedural generation,
  evaluation.
- `business`: studios, tooling markets, labor, production economics.
- `law`: copyright, likeness, licensing, liability, platform policy.

If runtime section ids differ, use the configured `NewsroomSection` ids. The
story-cycle code currently maps common operator aliases such as `culture` to the
configured `arts` section and `law` to `law-policy` when those are the deployed
section ids.

## Reporting Assignment Shape

Reporting assignments should use:

- `assignmentTypeKey = "reporting.edition-candidate"`;
- `sectionKey` / `sectionId` for the desk lens;
- `topicScopeCategoryKeys` and `primaryFocusCategoryKey` for taxonomy scope;
- coverage concept metadata such as `coverageConceptKey`;
- `slotTarget` with section slots, candidate rank, and dispatch count;
- `angleDiversity` with the reporting lens and duplicate-angle metadata;
- `expectedOutput = "Private reporting context packet for editor selection and copywriting, not reader copy."`.

Multiple reporting assignments in one section may share the same coverage
concept, but they must carry distinct angle metadata.

## Packet Requirements

Reporter output must include:

- `editor_recommendation`
- `recommended_angle`
- `risk_flags`
- `coverage_gaps`
- `open_questions`
- `accepted_reference_ids`
- `proposed_references`
- `copywriter_brief`

It should also preserve lineage to the section research assignment or research
packet with `derived_from`.

Fresh web findings remain `proposed_references` until reference intake accepts
them. Do not promote proposed references to evidence or copywriting support
inside the story-cycle run.

## Editor Selection

Review a reporting packet with:

```bash
npm run content -- assignments review-reporting-packet \
  --assignment <assignment-id> \
  --message <message-id> \
  --decision select|merge|brief|hold|kill \
  --note "<editor rationale>" \
  --dry-run
```

Use `--apply` only after reviewing the plan.

- `select` creates a child `copywriting.article-draft` Assignment and
  `derived_from` relations to the reporting Assignment and packet Message.
- `brief` creates a child `copywriting.brief-draft` Assignment and
  `derived_from` relations to the reporting Assignment and packet Message.
- `merge` requires `--target-item <id>` and links to that Item.
- `hold` and `kill` write only the review event and metadata attachment.

No packet review creates `Item` or `EditionItem` placement. Run copywriting
after selection with:

```bash
npm run content -- assignments run-copywriting \
  --assignment <copywriting-assignment-id> \
  --dry-run
```

## Verification

For story-cycle or packet-review changes, run:

```bash
node scripts/test-category-mappers.cjs
python procedures/newsroom/tests/test_newsroom_tools.py
```

Run `npm run lint` and `npm run typecheck` when code or UI files changed.
