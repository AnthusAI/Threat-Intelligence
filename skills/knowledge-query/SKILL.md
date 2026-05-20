---
name: knowledge-query
description: Use this skill when generating, testing, debugging, or designing Papyrus knowledgeQuery context packs for agents, articles, reviews, chat, or newsroom research.
---

# Knowledge Query Skill

Use this skill when an agent needs model-ready context from the Papyrus
knowledge base. `knowledgeQuery` is the shared query path for research,
reporting, editing, reviewing, chat grounding, and context-pack experiments.

The same Python engine powers both entrypoints:

- AppSync custom query: `knowledgeQuery(input: AWSJSON!): AWSJSON`
- CLI: `PYTHONPATH=src python -m papyrus_newsroom knowledge-query`

Keep behavior changes in `src/papyrus_knowledge_query/` so Lambda and CLI stay
identical.

## Query Shape

The input is one JSON object:

```json
{
  "anchors": [
    { "kind": "reference", "id": "<version-id>", "lineageId": "<lineage-id>" }
  ],
  "semanticQuery": "production measurement and reliability evaluation for LLM agents",
  "scope": {
    "depth": 1,
    "topK": 12,
    "semanticSeedLimit": 5,
    "relatedRecordLimit": 8
  },
  "profile": "editor",
  "output": {
    "format": "both",
    "maxTokens": 1200,
    "seeAlsoMaxTokens": 200
  }
}
```

All top-level fields are optional, but useful context usually needs either
`anchors`, `semanticQuery`, or both.

## Anchors

Use `anchors` for exact Papyrus objects. Supported kinds are:

- `reference`
- `item`
- `category`
- `categorySet`
- `semanticNode`
- `semanticRelation`
- `message`
- `assignment`
- `steeringProposal`

Prefer stable lineage ids when available. The rendered markdown uses stable
Papyrus URIs:

```text
papyrus://<kind>/<lineageId-or-id>
```

When anchors are references, they are target records. Multiple reference
anchors render under `## Target Records`; each record keeps its metadata and
excerpts together.

## Semantic Query Behavior

If `semanticQuery` is provided, semantic search uses that text.

If `semanticQuery` is omitted but anchors are provided, the engine derives a
semantic query from resolved anchor metadata such as title, authors, deck,
summary, description, category key, and node key. This derived query is used to
find supplemental `See Also` records.

If neither anchors nor `semanticQuery` are supplied, semantic search has no
meaningful input and the result will be empty except for warnings/debug data.

Semantic vector hits with text chunk metadata become passage evidence, not
generic related concepts. Non-anchor semantic matches may become `See Also`
records when they are strong matches, graph neighbors, or share corpus/category
context with the anchors.

## Scope Options

`scope.depth`: graph expansion depth, clamped to `0..3`.

`scope.topK`: semantic search limit, clamped to `1..100`.

`scope.semanticSeedLimit`: when there are no anchors, maximum semantic matches
to promote as graph-expansion seeds. Default `5`, maximum `20`.

`scope.relatedRecordLimit`: maximum related records to keep for `See Also`.
Default `8`, maximum `30`.

`scope.relationTypes`: explicit relation type allowlist. If present, it
overrides the default knowledge-only relation policy.

`scope.includeRelationDomains` / `scope.excludeRelationDomains`: optional
domain controls for graph relation filtering.

`scope.includeOperationalContext`: set `true` only for admin, debugging, or
workflow contexts. Default knowledge packs exclude commentary, ingestion,
publication, and workflow relations.

`scope.tokenizerModel`: optional tokenizer model override. Prefer leaving this
unset unless a downstream model requires exact model-specific counting.

## Profiles

Valid profiles are:

- `researcher`
- `reporter`
- `editor`
- `reviewer`
- `chat`

Profiles tune default graph depth, semantic `topK`, and context emphasis. They
do not override the default knowledge-only relation policy.

## Output Options

`output.format`:

- `structured`: return structured data only.
- `markdown`: return rendered context only.
- `both`: return both.

`output.maxTokens`: total markdown token budget. Budgets use `tiktoken` with
`o200k_base` by default and fall back to the regex counter only if `tiktoken`
is unavailable.

`output.seeAlsoMaxTokens`: optional budget override for `## See Also`. Default
is `min(12% of maxTokens, 300)`, or `300` when no total budget is supplied.

`output.maxPassages`: maximum extracted-text passages to select. Default `5`,
maximum `20`.

`output.maxPassageTokens`: per-passage cap. Default `160`, clamped to
`40..500`.

`output.includeExtracts`: defaults to `true`. Set `false` only when metadata
and graph structure are enough.

`output.includeProvenanceAppendix`: defaults to `false`. Set `true` to render
operational/curation facts at the end instead of mixing them into the knowledge
body.

`output.tokenizerModel`: optional tokenizer model override. This takes
precedence over `scope.tokenizerModel`.

## Relation Policy

Default policy is `knowledge_only`.

Included relation domains:

- `knowledge`
- `ontology`
- `classification`
- `evidence`

Excluded by default:

- commentary and curation notes
- ingestion rationale
- workflow and assignment routing
- publication planning edges
- generic record-keeping edges

Do not include operational relations in ordinary research, writing, review, or
chat context packs. Opt in only when the user is debugging Papyrus itself.

## Markdown Structure

Single primary reference:

```markdown
# <source title>
Papyrus URI: papyrus://reference/<lineage-id>

## Context Summary
...

## Full Source Text
...
```

If the full extracted text does not fit, the engine renders source excerpts
instead.

Multiple target references:

```markdown
## Knowledge Summary

## Target Records

### <target title>
Papyrus URI: papyrus://reference/<lineage-id>
...

## See Also

### <related title>
Object: papyrus://reference/<lineage-id>
Why related: ...
...
```

`See Also` is supplemental and should stay concise. Do not confuse `See Also`
matches with target records.

## Output Fields

The response envelope includes:

- `structured`: resolved anchors, semantic matches, semantic passages, evidence
  passages, related records, relations, expanded objects, and request metadata.
- `context`: rendered markdown text and token metadata when requested.
- `warnings`: non-fatal issues such as missing extracted text or unavailable
  providers.
- `provenance`: graph and semantic provider names.
- `debug`: counts, timings, tokenizer metadata, and semantic query source.

Check `structured.request.semanticQuerySource`:

- `explicit`: caller supplied `semanticQuery`.
- `anchor_derived`: engine derived it from anchors.
- `none`: no semantic query was available.

## CLI Usage

Semantic-only smoke:

```bash
PYTHONPATH=src python -m papyrus_newsroom knowledge-query \
  --query "agent memory systems" \
  --format both \
  --max-tokens 600
```

Input-file smoke:

```bash
PYTHONPATH=src python -m papyrus_newsroom knowledge-query \
  --input .papyrus-runs/knowledge-query/input.json |
  jq
```

Write markdown for review:

```bash
PYTHONPATH=src python -m papyrus_newsroom knowledge-query \
  --input .papyrus-runs/knowledge-query/input.json \
  > .papyrus-runs/knowledge-query/result.json

jq -r '.context.text // ""' \
  .papyrus-runs/knowledge-query/result.json \
  > .papyrus-runs/knowledge-query/context.md
```

The CLI uses local environment configuration:

- `PAPYRUS_GRAPHQL_ENDPOINT`
- `PAPYRUS_GRAPHQL_JWT`
- optional `PAPYRUS_S3_VECTOR_INDEX_ARN`
- optional `OPENAI_API_KEY`

## AppSync Usage

The AppSync query receives the same JSON object, stringified as `AWSJSON`:

```bash
INPUT_JSON="$(jq -c . .papyrus-runs/knowledge-query/input.json)"
jq -n --arg input "$INPUT_JSON" '{
  query: "query KnowledgeQuery($input: AWSJSON!) { knowledgeQuery(input: $input) }",
  variables: { input: $input }
}' |
curl -sS "$PAPYRUS_GRAPHQL_ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: PapyrusJwt $PAPYRUS_GRAPHQL_JWT" \
  --data-binary @- |
jq '.data.knowledgeQuery | fromjson? // .'
```

Use the CLI for fast context-pack iteration. Deploy Lambda only when the shared
logic is ready to validate through AppSync.

## Vector Indexing

When S3 Vectors is configured, accepted reference extracted-text passages can be
indexed with:

```bash
PYTHONPATH=src python -m papyrus_newsroom knowledge-vector-index \
  --corpus-id <corpus-id> \
  --max-references 25 \
  --dry-run
```

Remove `--dry-run` only after reviewing the candidate count and configured
vector index.

## Verification

Run local checks before committing query behavior changes:

```bash
python -m compileall src/papyrus_knowledge_query src/papyrus_newsroom
PYTHONPATH=src python -m unittest procedures.newsroom.tests.test_knowledge_query procedures.newsroom.tests.test_newsroom_tools
npm run typecheck
```

For context-pack design changes, regenerate example outputs under
`.papyrus-runs/knowledge-query/` and inspect the markdown as model context.
