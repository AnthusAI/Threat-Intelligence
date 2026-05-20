---
name: reference-curation-signals
description: Use this skill when creating, updating, querying, or consuming Papyrus Reference summaries and quality ratings for curation, ranking, context packs, or Tactus procedures.
---

# Reference Curation Signals Skill

Use this skill after references exist in Papyrus and need reusable curation
signals for retrieval, ranking, agent context, or editorial review.

Reference summaries and quality ratings are semantic graph signals. They are
not source ingestion, not curation-status decisions, and not publication Items.

## Quality Contract

A Reference's accepted quality rating is one current `SemanticRelation`:

```text
Reference --quality_rating_is--> SemanticNode
```

Ranking and context-pack code should read the relation first:

- `relationTypeKey = "quality_rating_is"` or fallback `predicate = "quality_rating_is"`.
- `relationState = "current"`.
- `subjectKind = "reference"`.
- `objectKind = "semanticNode"`.
- `score = 1..5`.

The object node gives semantic meaning and validation:

- `quality.rating.1_star`
- `quality.rating.2_star`
- `quality.rating.3_star`
- `quality.rating.4_star`
- `quality.rating.5_star`

There should be exactly one current quality relation per current Reference
lineage. Updating quality supersedes stale `quality_rating_is` relations; do
not hard-delete them. If no current relation exists, treat quality as unknown,
not zero.

Manual quality setting does not require an LLM:

```bash
poetry run papyrus-newsroom references quality set \
  --reference <reference-id> \
  --rating 4 \
  --note "Strong source for context building." \
  --actor-label "<operator-or-agent>" \
  --apply
```

Inspect quality:

```bash
poetry run papyrus-newsroom references quality get --reference <reference-id>

poetry run papyrus-newsroom references quality list \
  --corpus-key <corpus-key> \
  --min-rating 4
```

## Summary Contract

Each generated Reference summary is a private `Message`:

- `messageKind = "reference_summary"`.
- `messageDomain = "summarization"`.
- `status = "active"`.
- `summary = <generated summary text>`.
- `source = "papyrus-summary-generator"`.

The summary `Message` links to the summarized Reference through a budgeted
relation:

```text
Message --reference_summary_100_tokens--> Reference
Message --reference_summary_200_tokens--> Reference
Message --reference_summary_500_tokens--> Reference
```

The relation type is the lookup contract. If an agent needs a short summary,
query current incoming Reference relations and select
`reference_summary_100_tokens`. If it needs a longer summary, select
`reference_summary_500_tokens`.

`knowledgeQuery` reads all current summary sizes it can find for each
Reference, measures their actual token cost, and renders at most one selected
summary for that source. It prefers the largest summary that fits the source's
allocated budget because a deliberately short summary is usually more useful
than truncating a longer one mid-thought. The selected summary counts against
that source's context budget before semantic vector chunks or extracted-text
passages are added.

Context-pack diversity affects summary selection indirectly:

- `focused` can allocate more budget to a top source and therefore may choose a
  larger summary plus extra passages.
- `balanced` usually chooses a medium summary when it fits and keeps room for
  source spread.
- `broad` favors many sources, so it often chooses shorter summaries and limits
  extra chunks.

List references before selecting a target:

```bash
poetry run papyrus-newsroom references list \
  --corpus-key <corpus-key> \
  --status accepted \
  --limit 25
```

The list command returns current references newest-first by default, using
import/update timestamps from GraphQL.

There should be exactly one current summary relation per
`(reference lineage, maxTokens)`. Refreshing a summary creates a new `Message`
and supersedes the old summary relation. Historical `Message` rows remain.

Summary metadata is stored both on the `SemanticRelation.metadata` and as a
`ModelAttachment` on the `Message` because the current deployed `Message`
schema does not carry inline metadata. Expected metadata keys include:

- `maxTokens`
- `actualTokenEstimate`
- `tokenizer`
- `model`
- `promptVersion`
- `sourceContentHash`
- `referenceLineageId`
- `runId`
- `assignmentId`
- `generatedAt`
- `rationale`
- `doctrineContextStatus`
- `doctrineSlugs`
- `doctrineContentHash`
- `doctrineScope`
- `policyUse`

LLM-generated summaries include publication-level doctrine context by default.
The generator reads private doctrine `Item` records for
`editorial-doctrine-mission` and `editorial-doctrine-policy` and stores
`promptVersion = "reference-summary-v2-publication-doctrine"`.

Editorial policies are context only. They describe standards for downstream
published Papyrus content; they are not rules that the source `Reference` must
satisfy. Summary and quality-assessment prompts must preserve this distinction.
Older summaries may have `promptVersion = "reference-summary-v1"` and no
doctrine metadata. Refresh those explicitly with `--refresh` if needed.

Manual summaries supplied through `--summary-text` do not load doctrine and
record `doctrineContextStatus = "not_used_manual_summary"`.

Generate or dry-run a single summary:

```bash
poetry run papyrus-newsroom references summarize \
  --reference <reference-id> \
  --max-tokens 100 \
  --summary-text "Manual or externally generated summary."
```

Apply the write:

```bash
poetry run papyrus-newsroom references summarize \
  --reference <reference-id> \
  --max-tokens 100 \
  --summary-text "Manual or externally generated summary." \
  --apply
```

If `--summary-text` is omitted, the command uses `OPENAI_API_KEY` and the
configured model to generate the summary from resolved source text. Prefer
passing `--source-text-file` when local source text resolution is uncertain.

Batch missing summaries:

```bash
poetry run papyrus-newsroom references summarize-batch \
  --corpus-key <corpus-key> \
  --budgets 100,200,500 \
  --only-missing true \
  --max-count 25
```

Add `--apply` only after reviewing the dry-run output.

Read summaries already linked to a reference:

```bash
poetry run papyrus-newsroom references summaries \
  --reference <reference-id> \
  --max-tokens 100
```

## Tactus Use

The Tactus runtime exposes these APIs:

- `reference.list`
- `reference.quality_get`
- `reference.quality_set`
- `reference.summarize`
- `reference.summaries`

Use Tactus for agent-scored quality or generated summaries when the procedure
needs doctrine, rubric, retrieval, or LLM reasoning. Agent quality prompts may
include publication doctrine, but must not use publication policies as the
quality scoring rubric; quality is scored by the explicit quality rubric. Use
the CLI for direct operator curation or smoke tests. Both paths use the same
Python planner and write the same graph contracts.

## Operational Rules

- Run `relations import-types` and the normal semantic concept import path after
  adding or deploying the seed contract.
- Mutations should update the Newsroom aggregate summary snapshot. If summary
  update fails or drift is suspected, run:

  ```bash
  npm run content -- newsroom recount-summary --apply
  ```

- Do not store raw source text in `Message.summary`, `Message` payloads, or
  DynamoDB metadata. Source text stays in Biblicus/local corpus/S3 files.
- Do not use quality ratings as curation status. `Reference.curationStatus`
  still controls accepted/pending/rejected/archived eligibility.
- Ranking code should use `SemanticRelation.score` for quality and should treat
  missing quality as unknown.
