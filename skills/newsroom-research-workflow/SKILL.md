---
name: newsroom-research-workflow
description: Use this skill when a coding agent needs to run or inspect Papyrus research assignments, research packets, web-search handoffs, proposed references, or reference-intake follow-up work.
---

# Newsroom Research Workflow Skill

Use this skill when you are acting as a coding agent around Papyrus newsroom
research work, not only when editing Tactus procedures. It explains how to use
the same workflow through CLI tools, the packaged Python entrypoint, and the
Newsroom UI.

## Core Model

The `Assignment` is the workflow spine. Agents and humans append work products
to it.

- Research work products are private `Message` records with
  `messageKind = "research_packet"` and `messageDomain = "assignment_work"`.
- Each research-packet `Message` links to the live `Assignment` with a current
  `SemanticRelation` whose `relationTypeKey` is `comment`.
- `AssignmentEvent` remains lifecycle/audit only: claim, release, complete,
  cancel, reopen, or status changes.
- `Assignment.assigneeKey` is the flexible claim/lease identity. It only needs
  to be meaningful within the competing worker pool; it can represent a human,
  procedure run, worker process, or coding-agent session.
- Fresh web search results are reference prospects, not evidence. They belong
  in `sourceSnapshots` and `proposedReferences` until intake registers them as
  `Reference` records.
- Only current accepted `Reference` records are evidence-eligible.

Do not treat `source_snapshots`, `proposed_references`, or research packets as
folders. They are structured metadata fields in private GraphQL work products
or dry-run plans.

## Claiming Policy

Claiming is an execution lease, not durable ownership. Assignment-type policy
decides whether a claim is required:

- `analysis.reindex`: exclusive claim required before any Biblicus command runs.
- `curation.reference-intake`: exclusive claim is preferred before accept/reject
  decisions.
- `research.edition-candidate`: claim is optional unless the assignment should
  produce one canonical packet.

For agent or worker claims, prefer a run-scoped `assigneeKey` and a TTL:

```bash
npm run content -- assignments claim \
  --assignment <assignment-id> \
  --assignee-key "procedure-run:<run-id>" \
  --claim-ttl-seconds 7200
```

An unexpired claim blocks different `assigneeKey` values. The same
`assigneeKey` can re-claim to refresh the lease, and expired claims can be
taken over by another worker.

For analysis assignments, two canonical execution modes are supported:

- explicit mode: create assignment -> claim -> execute -> verify -> complete;
- immediate mode: `analysis run-now` does create/claim/execute/complete in one
  command while still writing full assignment and event records.

Queue worker mode is also supported through
`assignments process-queue --type analysis.reindex ...` with deterministic
ordering and bounded batch size.

When worker operations mutate `Assignment`, `AssignmentEvent`, `Message`,
`Reference`, `SemanticRelation`, `SemanticNode`, or category/import records,
the worker must update the Newsroom aggregate snapshot in the same logical
operation or run an explicit correction pass:

```bash
npm run content -- newsroom recount-summary --apply
```

Use the shared summary delta helpers and `updateNewsroomSummary` integration
paths in `scripts/content-cli.cjs`; do not hand-edit
`knowledge-raw-payload-newsroom-summary-current`.

## Standard Coding-Agent Flow

1. Inspect the live assignment and context:

   ```bash
   npm run content -- assignments list --status open
   npm run content -- assignments build-context --assignment <assignment-id> --context-profile reporting
   npm run content -- assignments research-packets --assignment <assignment-id>
   poetry run papyrus-newsroom search-semantic-nodes --query "taxonomy ontology knowledge graph" --limit 8
   ```

   Context assembly is additive and budgeted: include desk/focus category context
   and semantic entity/node context whenever available, then compact to the
   profile token budget.

2. Run or dry-run the researcher through the packaged Poetry entrypoint or the
   Tactus procedure. Keep mutation dry-run unless the user explicitly asks for a
   live write path that exists.

   ```bash
   poetry run papyrus-newsroom execute-tactus 'local api = api_list{}; return api'

   poetry run tactus run procedures/newsroom/researcher.tac \
     --no-sandbox \
     --real-all \
     --param assignment_item_id="<assignment-id>" \
     --param corpus_key="<corpus-key>" \
     --param research_questions="<focused research request>" \
     --param max_evidence_items=3
   ```

3. Verify the returned `research_record_plan`. For live assignments it should
   contain exactly a `Message` create and a `SemanticRelation` create for the
   research packet. It should not contain `Item`, `EditionItem`, `Reference`, or
   `uses_evidence` records for fresh web candidates.

4. If the packet proposes new source material, convert those proposals into
   reference-intake work through the catalog registration CLI. Do not manually
   create GraphQL records.

5. After references are accepted, use accepted-only analysis manifests for
   topic modeling, graph analysis, context packs, desk memory, and edition
   planning.

## Research Packet Contract

For live assignments, the packet is stored as:

- `Message.body`: concise human-readable packet summary.
- `Message.summary`: short one-line packet summary.
- `Message.metadata.kind`: `research.packet.created`.
- `Message.metadata.assignmentId`: live `Assignment.id`.
- `Message.metadata.research`: structured private research packet.

Inside `Message.metadata.research`, use these fields:

- `summary`: concise finding or handoff summary.
- `queries`: corpus/web queries used.
- `sourceSnapshots`: auditable source result snapshots.
- `proposedReferences`: candidate source materials with `ingestion_rationale`.
- `evidenceItemIds`: accepted evidence ids only.
- `recommendedAngle`: non-promotional editorial angle.
- `openQuestions`: unresolved questions.
- `coverageGaps`: missing viewpoints, weak evidence, or absent source classes.
- `doctrineContext`: private availability/constraint notes, not reader copy.

For legacy assignment-shaped `Item` inputs, the old dry-run path may still write
the packet under `Item.editorial.newsroom.research`. Do not extend that legacy
path for live assignment work.

## Web Search And Source Prospects

Fresh web search is provided by the Tactus standard library, not Papyrus-owned
provider adapters. Inside Tactus snippets:

```tactus
local web = require("tactus.web")
local search = web.search{
  provider = "openai",
  query = "current source about automated publication systems in newsroom workflows",
  model = "gpt-5.4-mini",
  max_results = 3,
}
```

For coding-agent use, prefer the researcher harness when possible because it
preloads the correct requirements and helper functions:

```bash
poetry run papyrus-newsroom execute-tactus \
  --harness research \
  --assignment-id <assignment-id> \
  --corpus-key <corpus-key> \
  'local search = web_search("specific current query for this assignment")
   return finish_research_from_search(search, {
     recommended_angle = "Non-promotional editorial angle.",
   })'
```

The body passed to `execute-tactus --harness research` can also be this snippet:

```tactus
local search = web_search("specific current query for this assignment")
return finish_research_from_search(search, {
  recommended_angle = "Non-promotional editorial angle.",
})
```

Do not put `evidence_candidate_id` values from web search into
`evidence_item_ids`. They are not accepted `Reference` ids.

## Reference Intake Follow-Up

Use `skills/reference-intake/SKILL.md` for the full intake rules. The shortest
safe path from proposed reference to visible curation record is:

```bash
npm run content -- references register-catalog \
  --config corpora/papyrus-steering.yml \
  --corpus-key <corpus-key> \
  --catalog <catalog.json> \
  --status pending \
  --ingestion-rationale "<summary, research focus, editorial mission fit>" \
  --apply
```

Rejected source material is still useful scope memory when it has a structured
reason:

```bash
npm run content -- references register-catalog \
  --config corpora/papyrus-steering.yml \
  --corpus-key <corpus-key> \
  --catalog <catalog.json> \
  --status rejected \
  --reason-code out_of_scope \
  --note "Outside the current editorial scope." \
  --apply
```

`register-catalog` writes only `Reference`, `ReferenceAttachment`, curation
`Message`, `curation.reference-intake` `Assignment`, and workflow/audit
`SemanticRelation` rows. It must not create publication `Item`, `EditionItem`,
`classified_as`, or `uses_evidence` records.

## Accepted-Only Exports

Before running downstream analysis, export accepted-only manifests:

```bash
npm run content -- references export-analysis-manifest \
  --config corpora/papyrus-steering.yml \
  --corpus-key <corpus-key> \
  --output <accepted-manifest.json>

npm run content -- references export-scope-training \
  --config corpora/papyrus-steering.yml \
  --corpus-key <corpus-key> \
  --output <scope-training.json>
```

Pending and rejected references remain visible in the Reference Ledger, but they
do not enter evidence sets, topic modeling, graph analysis, desk memory, context
packs, assignment evidence, or edition planning.

## Verification

Use these checks after changing research workflow code or docs:

```bash
poetry run python procedures/newsroom/tests/test_newsroom_tools.py
tactus validate procedures/newsroom/researcher.tac
node scripts/test-category-mappers.cjs
npm run typecheck
```

If `npm run typecheck` fails in a dirty tree, report the exact unrelated files
and errors instead of claiming the research workflow is unverified.
