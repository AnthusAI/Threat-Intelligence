---
name: newsroom-research-workflow
description: Use this skill when a coding agent needs to run or inspect Papyrus research assignments, research packets, web-search handoffs, proposed references, or reference-intake follow-up work.
---

# Newsroom Research Workflow Skill

Use this skill when you are acting as a coding agent around Papyrus newsroom
research work, not only when editing Tactus procedures. It explains how to use
the same workflow through CLI tools, the packaged Python entrypoint, and the
Newsroom UI.

For reusable Reference summaries and quality ratings that feed ranking or
context packs, use
[`skills/reference-curation-signals/SKILL.md`](/Users/ryan/Projects/Papyrus/skills/reference-curation-signals/SKILL.md).

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
- `Assignment.sectionKey` names the configurable Newsroom section that owns the
  work. Treat sections as desks. Use `topicScopeCategoryKeys` and
  `primaryFocusCategoryKey` only as knowledge/retrieval scope.
- Fresh web search results are reference prospects, not evidence. They belong
  in `sourceSnapshots` and `proposedReferences` until intake registers them as
  `Reference` records.
- Only current accepted `Reference` records are evidence-eligible.
- Each research run persists as one `research_packet` Message. Internal
  orientation, source discovery, and synthesis are phases inside that one
  packet, not separate Messages.

Do not treat `source_snapshots`, `proposed_references`, or research packets as
folders. They are structured metadata fields in private GraphQL work products
or dry-run plans.

## Research Modes

Research assignments must name the intended mode. Generic CLI-created research
assignments default to `source_discovery`.

- `internal_brief`: search accepted Papyrus knowledge and synthesize what the
  publication already knows. Web search is optional and usually unnecessary.
- `source_discovery`: orient with accepted internal knowledge, then run at
  least one web search for new source-material prospects. If web discovery
  cannot run, return a packet with `blockedReason`.
- `full_research`: orient internally, discover external prospects, then produce
  one integrated synthesis in the same packet. If discovery cannot run, return
  a packet with `blockedReason`.

Use `internal_brief` when the deliverable is a briefing from existing
knowledge. Use `source_discovery` when the assignment is to find new references.
Use `full_research` when the assignment needs both the internal state of
knowledge and new external prospects integrated into one brief.

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
Use `--section <section-key>` when the worker should process only one section's
queue.

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

1. Create a live research assignment when the user asks for new research and
   no suitable assignment already exists:

   ```bash
   npm run content -- assignments create-research \
     --title "<research assignment title>" \
     --summary "<brief operator-facing summary>" \
     --section <section-key> \
     --corpus-key <corpus-key> \
     --research-mode source_discovery \
     --topic-scope <optional-category-keys> \
     --apply
   ```

   Omit `--section` only when the assignment is intentionally unsectioned.
   Generic research assignments default to `source_discovery`; pass
   `--research-mode internal_brief` when the user only wants a brief from
   existing Papyrus knowledge.

2. Inspect the live assignment and context:

   ```bash
   npm run content -- assignments list --status open
   npm run content -- assignments build-context --assignment <assignment-id> --context-profile reporting
   npm run content -- assignments research-packets --assignment <assignment-id>
   poetry run papyrus-newsroom search-semantic-nodes --query "taxonomy ontology knowledge graph" --limit 8
   ```

   Context assembly is additive and budgeted: include desk/focus category context
   and semantic entity/node context whenever available, then compact to the
   profile token budget.

3. Query the accepted knowledge base before searching the public web. Use
   `knowledge-query` to retrieve accepted-reference passages, ontology context,
   and quality-aware ranking signals. Keep the query tight and budgeted.

   Exploratory researchers should use the knowledge-aware procedure when the
   assignment benefits from a bounded ReAct-style loop:

   ```bash
   tactus run procedures/newsroom/research_explorer.tac \
     --param assignment_item_id=<assignment-id> \
     --param corpus_key=<corpus-key> \
     --param context_profile=researcher \
     --param research_mode=source_discovery \
     --param research_questions="Find gaps around the assignment focus"
   ```

   Policy for that procedure is internal-first: assignment context, broad
   `knowledge_query`, optional `papyrus://` URI lookup or anchored follow-up,
   mode-dependent OpenAI web search, then one final Message-backed research
   packet. In `source_discovery` and `full_research`, web search is mandatory
   unless the packet records a `blockedReason`. Use it for exploratory and
   gap-finding work; keep `researcher.tac` for the constrained one-shot web
   handoff.

   ```bash
   AWS_PROFILE=Ryan AWS_REGION=us-east-1 \
     PYTHONPATH=../Tactus:src \
     python -m papyrus_newsroom knowledge-query \
       --query "<specific assignment research question>" \
       --profile researcher \
       --format both \
       --max-tokens 1200 \
       --top-k 8 \
       --depth 1
   ```

   Use the returned accepted-reference context to decide what is already known.
   Use web search only for freshness, missing source classes, corroboration, or
   candidate references not already in the accepted evidence set.

4. For normal source-discovery work, use the one-command handoff. It runs the
   exploratory researcher, persists one `research_packet` when `--apply` is
   present, converts `proposedReferences` into a run-local catalog, and registers
   those prospects as pending references with curation assignments. It does not
   accept evidence or publish anything.

   ```bash
   npm run content -- assignments research-intake-now \
     --assignment <assignment-id> \
     --config corpora/papyrus-steering.yml \
     --corpus-key <corpus-key> \
     --research-mode source_discovery \
     --max-evidence-items 20 \
     --apply \
     --json
   ```

   Omit `--apply` first when testing. For automation, prefer
   `npm --silent run content -- ... --json` so stdout is one compact JSON
   object. The JSON output includes the packet id, generated catalog path,
   import run id, registered reference count, skipped duplicate count, curation
   assignment count, a compact `references[]` list, and the next status command.

5. Use the lower-level commands only when debugging or reviewing intermediate
   artifacts. Run or dry-run the researcher through the packaged Poetry
   entrypoint or the Tactus procedure, then persist the vetted packet explicitly.

   The default `max_evidence_items` is `20` across `assignments run-research`,
   `research_explorer.tac`, and the `papyrus-newsroom execute-tactus --harness research`
   path. Raise or lower it explicitly per run when needed.

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

   If the active Python environment imports an older global Tactus package,
   prefix local test runs with `PYTHONPATH=../Tactus:src` or use
   `poetry run papyrus-newsroom` after installing the local Poetry environment.
   The researcher harness requires the Tactus stdlib `tactus.web` module.

6. Verify the returned `research_record_plan`. For live assignments it should
   contain exactly one `Message`, its `ModelAttachment` payload rows, and a
   `SemanticRelation` create for the research packet. It should not contain
   `Item`, `EditionItem`, `Reference`, or `uses_evidence` records for fresh web
   candidates.

   Procedure output is dry-run by default. Persist a vetted packet explicitly:

   ```bash
   npm run content -- assignments apply-research-packet \
     --assignment <assignment-id> \
     --research-json <packet.json> \
     --apply
   ```

   Omit `--apply` first when testing. CLI output should say `dry-run` or
   `persisted`; do not infer persistence from a successful Tactus procedure run.

7. If a packet has already been persisted and only the proposal intake step is
   needed, use `intake-proposals` instead of manually building a catalog:

   ```bash
   npm run content -- assignments intake-proposals \
     --assignment <assignment-id> \
     --config corpora/papyrus-steering.yml \
     --corpus-key <corpus-key> \
     --status pending \
     --apply \
     --json
   ```

   It defaults to the latest linked `research_packet`; pass
   `--message <message-id>` to intake a specific packet. It deduplicates by
   normalized URL, preserves each proposal's ingestion rationale, writes
   `.papyrus-runs/<run-id>/research-proposals-catalog.json`, and uses the
   targeted research-proposal registration path. Re-runs should return the same
   reference rows as existing/no-op records, not create duplicate curation work.
   Use low-level `references register-catalog` only for arbitrary manual
   catalogs, compatibility debugging, or fallback inspection.

## After Proposal Intake

`assignments research-intake-now --apply` is not the end of ingestion. It turns
web discoveries into pending `Reference` prospects plus
`curation.reference-intake` assignments. The normal next step is a
conversation-backed screening loop with the user.

1. List the pending source prospects and their source readiness:

   ```bash
   npm run content -- references source-status \
     --config corpora/papyrus-steering.yml \
     --corpus-key <corpus-key> \
     --status pending
   ```

2. For each prospect, inspect the title, URL, source domain, ingestion
   rationale, and any linked curation assignment. Discuss whether it belongs in
   the knowledge base. Do not batch-accept unclear references just because the
   research agent found them.

3. Record the curation decision:

   ```bash
   npm run content -- references review-curation \
     --reference <reference-id> \
     --action accept \
     --note "<why this source is in scope>"

   npm run content -- references review-curation \
     --reference <reference-id> \
     --action reject \
     --reason-code out_of_scope \
     --note "<why this source should remain scope memory only>"
   ```

   Accepted references become evidence-eligible. Rejected references remain
   useful scope memory but must not be used as evidence.

4. If an accepted prospect is URL-only, it is visible but not analysis-ready.
   Create or run corpus-accession work so the source file is materialized under
   the configured corpus and synced to S3, then run extraction and attach the
   selected extracted-text snapshot:

   ```bash
   npm run content -- references create-accession-assignments \
     --config corpora/papyrus-steering.yml \
     --corpus-key <corpus-key> \
     --status accepted \
     --apply

   npm run content -- references source-status \
     --config corpora/papyrus-steering.yml \
     --corpus-key <corpus-key> \
     --status accepted
   ```

5. After acceptance and text readiness, generate reusable curation signals for
   the accepted references when useful:

   ```bash
   poetry run papyrus-newsroom references summarize \
     --reference <reference-id> \
     --max-tokens 100 \
     --apply

   poetry run papyrus-newsroom references quality set \
     --reference <reference-id> \
     --rating 4 \
     --note "Strong evidence for the assignment focus." \
     --apply
   ```

   Summaries and quality ratings are semantic graph signals. They improve
   retrieval, ranking, and later agent context packs; they do not change
   `Reference.curationStatus`.

   If the user and agent agree on a quality rating manually, use
   `references quality set --rating <1-5>`. If the agent should classify
   quality from the source and rubric, use `references quality assess`.

6. Sync the derived semantic vector index after accepted references have
   summaries and/or extracted-text attachments. The source of truth is still
   GraphQL plus S3 attachments; the vector store is derived and must be audited
   or synced explicitly:

   ```bash
   AWS_PROFILE=<profile> AWS_REGION=<region> PYTHONPATH=src \
     python -m papyrus_newsroom knowledge-vector-index --action audit

   AWS_PROFILE=<profile> AWS_REGION=<region> PYTHONPATH=src \
     python -m papyrus_newsroom knowledge-vector-index --action sync \
     --corpus-id <corpus-id> \
     --max-references 25 \
     --dry-run
   ```

   Remove `--dry-run` only after reviewing the vector-index target and prepared
   write count.

7. After references are accepted and ready, use accepted-only analysis manifests
   for topic modeling, graph analysis, context packs, desk memory, and edition
   planning:

   ```bash
   npm run content -- references export-analysis-manifest \
     --config corpora/papyrus-steering.yml \
     --corpus-key <corpus-key> \
     --output .papyrus-runs/<run-id>/accepted-analysis-manifest.json
   ```

## Research Packet Contract

For live assignments, the packet is stored as:

- `Message.body`: concise human-readable packet summary.
- `Message.summary`: short one-line packet summary.
- `Message.metadata.kind`: `research.packet.created`.
- `Message.metadata.assignmentId`: live `Assignment.id`.
- `Message.metadata.research`: structured private research packet.

Inside `Message.metadata.research`, use these fields:

- `researchMode`: `internal_brief`, `source_discovery`, or `full_research`.
- `summary`: concise finding or handoff summary.
- `internalFindings`: accepted internal evidence, Papyrus URIs inspected, and
  what the accepted knowledge base already says.
- `sourceDiscovery`: web searches, source snapshots, proposed references, and
  blocked-discovery notes.
- `synthesis`: final brief, recommended angle, open questions, and coverage
  gaps.
- `researchTrace`: compact audit of knowledge queries, URI lookups, web
  searches, selected evidence ids, and unresolved gaps.
- `queries`: compatibility field for corpus/web queries used.
- `sourceSnapshots`: compatibility field for auditable source result snapshots.
- `proposedReferences`: compatibility field for candidate source materials with
  `ingestion_rationale`.
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
preloads the correct requirements and helper functions. `knowledge_search`
returns accepted Papyrus knowledge context; `web_search` returns fresh external
reference prospects. `resolve_papyrus_uri(uri)` hydrates a promising internal
object, and `knowledge_search_uri(uri, options)` runs an anchored follow-up
query. Use `evidence_item_ids_from_knowledge(knowledge)` when accepted Reference
results should become packet evidence ids.

```bash
poetry run papyrus-newsroom execute-tactus \
  --harness research \
  --assignment-id <assignment-id> \
  --corpus-key <corpus-key> \
  --research-mode source_discovery \
  'local knowledge = knowledge_search("specific accepted-knowledge query", { max_tokens = 900 })
   local search = web_search("specific current query for this assignment")
   return finish_research_from_search(search, {
     research_mode = "source_discovery",
     recommended_angle = "Non-promotional editorial angle.",
     evidence_item_ids = evidence_item_ids_from_knowledge(knowledge),
     coverage_gaps = knowledge.warnings or {},
	   })'
```

Use a compact trace in exploratory packets so the next agent can continue
without reading terminal scrollback:

```tactus
local knowledge = knowledge_search("production agent evaluation", { top_k = 12, max_tokens = 1200 })
local anchored = knowledge_search_uri("papyrus://reference/reference-1", { max_tokens = 900 })
local evidence_ids = evidence_item_ids_from_knowledge(knowledge)
return finish_research{
  research_mode = "internal_brief",
  summary = "Internal context identified one accepted evidence cluster.",
  queries = {"production agent evaluation"},
  internalFindings = {
    knowledgeQueries = {"production agent evaluation"},
    papyrusUrisInspected = {"papyrus://reference/reference-1"},
    evidenceItemIds = evidence_ids,
  },
  synthesis = {
    brief = "Accepted evidence clusters around production evaluation methods.",
    recommendedAngle = "Compare operational evaluation methods.",
  },
  source_snapshots = {},
  proposed_references = {},
  evidence_item_ids = evidence_ids,
  recommended_angle = "Compare operational evaluation methods.",
  researchTrace = {
    knowledgeQueries = {"production agent evaluation"},
    papyrusUrisInspected = {"papyrus://reference/reference-1"},
    webSearches = {},
    acceptedEvidenceIds = evidence_ids,
    unresolvedGaps = {},
  },
}
```

The body passed to `execute-tactus --harness research` can also be this snippet:

```tactus
local knowledge = knowledge_search("specific accepted-knowledge query", { max_tokens = 900 })
local search = web_search("specific current query for this assignment")
return finish_research_from_search(search, {
  research_mode = "source_discovery",
  recommended_angle = "Non-promotional editorial angle.",
  evidence_item_ids = evidence_item_ids_from_knowledge(knowledge),
  coverage_gaps = knowledge.warnings or {},
})
```

Do not put `evidence_candidate_id` values from web search into
`evidence_item_ids`. They are not accepted `Reference` ids.

## Reference Intake Follow-Up

Use `skills/reference-intake/SKILL.md` for the full intake rules. The shortest
safe path from a persisted research packet to visible curation records is:

```bash
npm run content -- assignments intake-proposals \
  --assignment <assignment-id> \
  --config corpora/papyrus-steering.yml \
  --corpus-key <corpus-key> \
  --status pending \
  --apply
```

The manual fallback is direct catalog registration:

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
