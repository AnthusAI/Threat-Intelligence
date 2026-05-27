# Newsroom Assignment Work Product Workflow

Papyrus newsroom automation revolves around `Assignment` records and private work
products. Research and reporting agents do not normally create reader-facing
copy. They create structured context packets that let editors decide what should
be selected, merged, briefed, held, killed, or sent to copywriting.

This file keeps the older automated-publication research path aligned with the
current general model. Automated-publication systems may be one covered beat, but
the workflow is publication-neutral: change the corpus config, accepted
taxonomy, ontology, sections, doctrine, and edition plan, and the same machinery
should work for another publication.

## Mental Model

Use these objects as distinct editorial concepts:

- `NewsroomSection`: the operational desk lens. It supplies mission, policy,
  assignment guidance, kill criteria, visual guidance, and recent desk memory.
- `Category`: the accepted taxonomy scope. It says what body of knowledge the
  work belongs to.
- `SemanticNode`: the richer coverage concept, entity, or question. It lets
  several sections work on the same underlying topic without collapsing their
  editorial angles.
- `Assignment`: the private unit of work for a human, agent, or procedure.
- `Message`: the private work product attached to an assignment.
- `ModelAttachment`: the structured body and metadata payload for a private
  work product or event.
- `Item`: reader-facing publication copy. It is created only after editor
  selection, copywriting, or explicit publishing workflow.
- `EditionItem`: layout placement. It is never created by packet generation or
  packet review.

The normal graph shape is:

```text
Edition
  <- planned_for_edition - Assignment
Assignment
  - targets_section -> NewsroomSection
  - targets_topic -> Category
  - requests_work_on -> SemanticNode
  - targets_lane -> SemanticNode(editorial.form.*)
  - uses_evidence -> accepted Reference
  - produces -> Message(research_packet or reporting_context_packet)
  - derived_from -> source Assignment or source Message
```

New packet writes use `Assignment --produces--> Message`. Existing
`Message --comment--> Assignment` packet links remain readable for compatibility.

## Packet Types

`research_packet` is the exploratory evidence product. It can summarize accepted
internal evidence, source snapshots, proposed references, unresolved gaps,
queries, source-diversity notes, and an intake handoff. Fresh web findings are
source-material prospects, not accepted evidence.

`reporting_context_packet` is the edition-candidate product. It packages the
context required for possible copywriting of one article or brief. It should
include:

- `summary`, `section_key`, `edition_id`, `candidate_rank`, `slot_target`
- `why_now`, `nut_graf_candidate`, `recommended_angle`
- `confirmed_facts`, `source_trail`, `accepted_reference_ids`
- `proposed_references`
- `recent_desk_memory_used`, `coverage_gaps`, `open_questions`
- `risk_flags`, `verification_needs`, `source_diversity_notes`
- knowledge-orientation trace: `source_trail`, `knowledge_queries`,
  `papyrus_uris_inspected`, and optional `knowledge_blocked_reason`
- `copywriter_brief`
- `editor_recommendation`: `select`, `merge`, `brief`, `hold`, or `kill`

Both packet types are private `Message` rows with
`messageDomain = "assignment_work"` plus `ModelAttachment` payloads. The
human-readable body lives in a `ModelAttachment` with role `message_body`; the
structured packet lives in a `ModelAttachment` with role `metadata`.

## Context Order

Agents should assemble context in this order:

1. Publication mission and policies.
2. Section mission, section policies, assignment guidance, and kill criteria.
3. Assignment brief, editor questions, candidate rank, slot target, and angle.
4. Accepted taxonomy and coverage concept context.
5. Accepted knowledge-base evidence only.
6. Recent section memory and shared coverage-node memory.
7. Fresh-source needs and proposed-reference gaps.

Doctrine is private operating guidance. It shapes packet judgment but should not
be copied into reader-facing fields.

## Reference Boundary

Only current accepted `Reference` records are evidence-eligible. Pending
reference prospects and rejected scope memory remain visible for curation and
training workflows, but they are not source support for reader-facing claims.

When a researcher or reporter finds a new web source, the packet should store it
as `sourceSnapshots` and/or `proposedReferences` with an ingestion rationale.
Reference intake then registers the prospect as pending. Curation later accepts
or rejects it. Only accepted references can become `uses_evidence` links,
knowledge-query evidence, desk memory, or copywriting support.

## Story-Cycle Run

The repeatable smoke-test and operator flow is CLI-first. In editor-facing
language, one run is a Coverage Theme: a shared topic or coverage question
worked through multiple section lenses. The CLI command remains
`assignments run-story-cycle` for compatibility.

```bash
poetry run papyrus assignments run-story-cycle \
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

`--through plan` creates only the Coverage Theme assignment graph.
`--through research` also persists private `research_packet` work products.
`--through reporting` also persists private `reporting_context_packet` work
products and is the default. Story-cycle orchestration never auto-selects
packets or runs copywriting.

Dry-run is the default. It creates local output under
`.papyrus-runs/story-cycle-<run-id>/`: `manifest.json`, child research logs,
child reporting logs, packet JSON files, and `story-cycle-output.json`.

Cloud procedure runs also write structured per-call LLM context trace artifacts
under each run directory:

- `llm-context/summary.json`: indexed metadata and call list
- `llm-context/calls.jsonl`: one record per LLM call with the exact message
  array sent to the model (system prompt + history + user/tool messages)
- `llm-context/execute_tactus_calls.jsonl`: one record per `execute_tactus`
  call, including harness, args, and the exact `tactus` snippet passed to the
  runtime

Use these files as the canonical local audit trail for context engineering
debugging and verification.

Apply mode persists private work products only: `Assignment`, `AssignmentEvent`,
`Message`, `ModelAttachment`, and `SemanticRelation`. It must not create
`Item` or `EditionItem` records during packet generation. In live apply mode,
degraded agent output fails unless `--allow-fallback` is explicit; use
`--require-agent-success` in smoke tests when fallback packets should be treated
as a failure. Applied reruns reuse existing packet Messages by default so a
Coverage Theme can resume downstream phases; pass `--refresh-packets` only when
the intent is to regenerate already persisted packet payloads.

Inspect output with:

```bash
poetry run papyrus assignments story-cycle-output \
  --run-id <story-cycle-run-id> \
  --json
```

For applied Coverage Themes, output is rediscovered from GraphQL first and uses
the local manifest only for log paths and diagnostics. The output is grouped by
section and shows the research packet, reporting
packets, angles, editor recommendations, accepted evidence counts, proposed
reference counts, risk flags, gaps, open questions, and copywriter briefs.

## Editor Selection

Editors review `reporting_context_packet` rows from `/newsroom/assignments` or
the CLI:

```bash
poetry run papyrus assignments review-reporting-packet \
  --assignment <assignment-id> \
  --message <message-id> \
  --decision select|merge|brief|hold|kill \
  --note "<editor rationale>" \
  --dry-run
```

Decision effects:

- `select`: create a child `copywriting.article-draft` Assignment, link it back
  to the reporting Assignment and packet Message with `derived_from`, and record
  the event.
- `brief`: create a child `copywriting.brief-draft` Assignment, link it back to
  the reporting Assignment and packet Message with `derived_from`, and record
  the event.
- `merge`: require `--target-item <id>`, link the assignment to that target
  `Item`, and record the event.
- `hold`: record the event and keep the packet private.
- `kill`: record the event and keep the packet private.

Run the copywriting Assignment after selection:

```bash
poetry run papyrus assignments run-copywriting \
  --assignment <copywriting-assignment-id> \
  --dry-run
```

Copywriting creates or versions draft `Item` records. Packet review itself does
not create `Item` or `EditionItem` records.

Packet review never creates `EditionItem` placement. Placement remains a later
copyediting/layout step after a draft exists.

## UI Surface

`/newsroom/assignments` has two related views:

- `Queue`: lifecycle and worker coordination, including claim, release,
  complete, cancel, and reopen.
- `Story Budget`: editorial budget review for `reporting.edition-candidate`
  assignments grouped by edition and section.

Keep those workflows separate. Lifecycle actions answer "who is working this
assignment and is it done?" Story Budget decisions answer "what should happen to
this reporting packet?"

## Procedure Usage

Researchers use `procedures/newsroom/research_explorer.tac` or
`procedures/newsroom/researcher.tac` to produce `research_packet` payloads.
Reporters use `procedures/newsroom/reporter.tac` to produce
`reporting_context_packet` payloads for live `reporting.edition-candidate`
assignments. Agents do not own persistence mechanics; the CLI/procedure layer
turns payloads into deterministic `Message`, `ModelAttachment`, and
`SemanticRelation` writes.

Reporting runs are immutable packet history. Multiple packet Messages may exist
for one Assignment, and downstream copywriting should treat the most recent
successful `reporting_context_packet` Message as canonical unless an explicit
editor workflow chooses a specific Message id.

When current external evidence is required, Tactus snippets should import the
standard web module:

```tactus
local web = require("tactus.web")
```

Use `web.search{...}` or `web.synthesize{...}` with `provider = "openai"`.
Papyrus consumes the normalized result in private packet fields; it does not
write accepted source records directly from web search.
