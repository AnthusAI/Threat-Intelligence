# Retrieval evaluation environments

Papyrus retrieval changes are scored with a golden-query harness
(`procedures/newsroom/retrieval_eval.py`) against a real accepted corpus and
derived indexes. Without a pinned environment, agents invent one-off sandbox
copies and forced rebuilds, then trust MRR that may be measuring semantic-only
fallback rather than the hybrid stack.

This document is the contract for **TI-5ed2f2**.

## Principles

1. **Pin the environment.** Every committed report must name which profile from
   `procedures/newsroom/tests/fixtures/retrieval_eval_environments.json` was used
   (or an explicit override of the same fields).
2. **Read-only by default.** The canonical profile points at Papyrus-main. Eval
   runs must not sync vectors, rebuild lexical indexes, or mutate GraphQL rows.
3. **Fail loud when the lexical arm is missing.** Hybrid identifier retrieval
   is the load-bearing win of this initiative. An eval that silently falls back
   to semantic-only is invalid — not a ranking regression.
4. **A golden query is only useful if the change under test can alter its
   result.** Categories must be designed against the mechanism they claim to
   measure (see [Golden-set design](#golden-set-design)).

## Canonical environment: `papyrus-main-ai-ml-readonly`

| Field | Value |
|---|---|
| Mode | Read-only production |
| GraphQL | Papyrus-main AppSync (`64hvi…`) |
| Vector index | `…/index/papyrus-knowledge` |
| Lexical artifact | `s3://…papyrusmediabucket…/corpora/knowledge-index/lexical/v1/index.json.gz` |
| Corpus | `knowledge-corpus-ai-ml-research` |
| AWS profile | `papyrus-agent` |

### Run

```bash
export AWS_PROFILE=papyrus-agent AWS_REGION=us-east-1
export PAPYRUS_RETRIEVAL_EVAL_ENV=papyrus-main-ai-ml-readonly
# Optional: JWT secret SSM param is applied from the profile when unset.
export PAPYRUS_GRAPHQL_JWT="$(PYTHONPATH=src poetry run python3 -m papyrus.cli auth refresh-jwt)"

PAPYRUS_RETRIEVAL_EVAL_REPORT=procedures/newsroom/tests/fixtures/reports/retrieval_<label>.json \
  PYTHONPATH=src poetry run python3 procedures/newsroom/retrieval_eval.py
```

The harness:

- Loads the named environment profile and fills missing env vars
  (`PAPYRUS_GRAPHQL_ENDPOINT`, `PAPYRUS_S3_VECTOR_INDEX_ARN`,
  `PAPYRUS_STORAGE_BUCKET_NAME`, `PAPYRUS_REQUIRE_LEXICAL=1`, …).
- PrefLights the lexical artifact (doc count, unique references) against the
  profile’s minimums.
- Aborts before scoring if lexical is unavailable or below floor.
- Records lexical counts + environment id in the report `provenance` block.

### What not to do

- Do not bulk-copy production corpus data into a sandbox to “make eval work.”
- Do not `knowledge vector-index --action rebuild` as part of measuring a
  ranking change.
- Do not treat a report with identifier 0/5 and global MRR ≈ 0.6533 as a
  ranking result — that is the pre-hybrid / lexical-absent signature
  (see **TI-b9f6da**).

## Future environments (not yet implemented)

| Profile | Intent | Status |
|---|---|---|
| Seeded sandbox | Disposable AppSync + small accepted corpus + derived indexes, rebuilt by a documented script | Deferred — tracked as follow-on; do not invent ad-hoc copies |
| Checked-in fixture corpus | Tiny offline corpus for CI without AWS | Deferred — `local-fixture` covers scoring unit tests only |

The epic acceptance for **TI-5ed2f2** is met by the documented read-only production procedure above (one of the three options named in the epic). Seeded sandbox and offline fixture corpus remain optional follow-ons, not blockers.

## Golden-set design

File: `procedures/newsroom/tests/fixtures/retrieval_golden_queries.json`

| Category | Metric | What it can observe |
|---|---|---|
| `identifier` | `hit` (reference rank) | Lexical/hybrid exact-token retrieval |
| `paraphrase` | `hit` | Semantic relevance |
| `freshness` | `prefer_order` | Stale-vs-fresh **ordering** among co-retrieved pairs |
| `quality_tie` | `hit` | Quality / survey preference when relevant |
| `multi_hop` | `hit` (any expected) | Multi-reference recall |

### Freshness (`prefer_order`)

A freshness case must name **both** a preferred (fresher) and a deferred
(staler) reference, and the query must be written so both are retrievable in
the top-10. The harness scores:

- `ok` — both present, preferred ranks higher
- `wrong_order` — both present, stale ranks higher
- `incomplete` — one or both missing (recall failure; **not** a ranking win)

Hit@k / MRR for this category use the preferred reference’s rank only when
status is `ok`. An already-rank-1 singleton with no stale competitor cannot
validate age-decay.

### Noise floor

On Papyrus-main, three identical runs showed stable MRR/Hit@5 with occasional
one-position swaps at retrieved index ≥ 6 and unchanged expected ranks. Treat
those as noise. Rank changes, Hit@k/MRR moves, and category deltas are signal.

## Related issues

- **TI-5ed2f2** — this epic
- **TI-b9f6da** — identifier 0/5 when lexical arm does not contribute
- **TI-f1cc13** — recency must prefer publication dates (code fix separate)
- **TI-06361a** — publication-date coverage still too low for age-decay to move
  most pairs
