# E2E ingestion exercise — TI-c46828

Branch: `epic/e2e-ingestion` (merged `origin/develop` for age-decay + hybrid lexical).  
Environment: Threat Intelligence production (`ur2anu…` / `d3on1y5vlrxmam`).

## Red baseline

| Check | Result |
|---|---|
| `test_references_commands` | 66 passed (pre); +1 accession replacement unit test |
| Corpus | pending ~996 after intake; accepted 5 → **9** current after curation+accession; rejected **14** (`policy_exclusion`); archived 815 |
| Vector audit (start) | **0/5** accepted indexed; **0** extracted text; lexical S3 key **absent** |
| Vector audit (end) | **4/9** accepted indexed (36 vectors); lexical `corpora/knowledge-index/lexical/v1/` present (docs=32, refs=4) |

## Curation (Ryan)

Accepted (publisher-grade + one PDF path):
1. CSO Online — Prompt injection breaks today's AI agents…
2. Help Net Security — Indirect prompt injection…
3. CyCognito — Prompt Injection Attacks: Types…
4. arXiv PDF — The Hidden Dangers of Browsing AI Agents

Rejected **14** with `policy_exclusion` (Reddit, GitHub issues, Medium, Hackernoon, dev.to, thin vendor/community blogs) — scope-training negatives for kanbus-02dced.  
Artifact: `.papyrus-runs/c46828-e2e/curation-apply.json`.

## Step log (expected → observed → delta)

### 1–3. Research / intake / triage
See earlier section in git history / first-half comments. Bugs: [TI-a9cb3a](TI-a9cb3a), [TI-1ad2f4](TI-1ad2f4), [TI-4db70d](TI-4db70d). Triage rationales still inventory-style ([kanbus-ec5555](kanbus-ec5555)).

### 4. Curate
Operator decisions applied via CLI with reason codes.

### 5. Accession
- **Expected:** role=source archive on S3; sha256 match; HTML `mediaType=text/html` not PDF; GraphQL paths filled; extracted text attached.
- **Observed:**
  - Live HTTP fetch wrote local imports with correct sidecar media types.
  - First run: Biblicus reindex failed (missing `metadata/`) → **no S3, no GraphQL**; assignments stuck `claimed` ([TI-db8f79](TI-db8f79)).
  - Default path skips S3 without `--sync-s3-apply`.
  - After metadata + `--sync-s3-apply`: S3 objects verified for all 4 (sha match; HTML not defaulted to PDF).
  - GraphQL failed: replacement mode rewrote create→update → DynamoDB conditional failure ([TI-b55c36](TI-b55c36)). **Fixed on this branch** + unit test; re-run succeeded; proposal lineages superseded.
  - Intake left empty `role=source` stubs (`storagePath`/`sha256` null; arXiv as `text/html`) ([TI-b23f9e](TI-b23f9e)).
  - Default extract selected **title-only** metadata-text (~40–72 B) ([TI-e5d8df](TI-e5d8df)); workaround: `--stage pass-through-text` / `pdf-text` with `--force`. HTML still raw HTML, not article-text.
- **Verify artifact:** `.papyrus-runs/c46828-e2e/accession-verify-final.json`.

### 6. Sync
- **Expected:** force sync activates age-decay epoch-day fields; lexical incremental artifact appears.
- **Observed:** Branch initially lacked age-decay merge — merged `origin/develop`. Force sync wrote 36 vectors + lexical index.
  - Sampled vectors: `retrievedAtDay` on 36/37; `sourcePublishedAtDay` **absent** until dates exist ([TI-71ce66](TI-71ce66)).
  - Manual `sourcePublishedAt=2025-05-19` on arXiv → sample `reference-passage-7dac212165c2a1246ea5` has `sourcePublishedAtDay: 20227`. Recorded on [kanbus-4b0aa6](kanbus-4b0aa6).
  - `--reference-id` sync rebuilt lexical for one ref only ([TI-9b6971](TI-9b6971)); full sync restored docs=32.

### 7. Query
- Content-only-new: *risks of browsing AI agents* → rank 1 arXiv Hidden Dangers (`.papyrus-runs/c46828-e2e/query-content.json`).
- Identifier: `arXiv:2505.13076` → rank 1 same ref with `fusion.lexicalRank: 1`, `rrfScore: 1.0` (`.papyrus-runs/c46828-e2e/query-identifier.json`).

## Bugs filed (this exercise)

| ID | Half | Title |
|---|---|---|
| TI-a9cb3a | 1 | catalog registration_note not on Reference.metadata |
| TI-1ad2f4 | 1 | curationAssignmentCount=0 |
| TI-4db70d | 1 | url-text eligible 0 / metadata skipped |
| TI-b55c36 | 2 | accession replacement create→update conditional fail (**fix on branch**) |
| TI-db8f79 | 2 | reindex hard-fail blocks S3/GraphQL |
| TI-e5d8df | 2 | metadata-text titles win as extracted_text |
| TI-71ce66 | 2 | null sourcePublishedAt/retrievedAt after accession |
| TI-b23f9e | 2 | empty intake source stubs |
| TI-9b6971 | 2 | --reference-id sync shrinks lexical |

## Cost / time (rough)

| Stage | Wall-clock |
|---|---|
| process-research-now | ~21 min |
| triage-plan | ~25 s |
| accession (4, with retries) | ~2–3 min successful path; longer with failures |
| extract-text (retries) | ~4–5 min total |
| vector sync --force | ~5–15 s per run |
| knowledge-query (local) | ~3–4 s |

## Manual interventions that should have been automatic

1. Copy corpus `metadata/` into worktree before accession.
2. Pass `--sync-s3-apply` (not default).
3. Code fix for replacement GraphQL augment.
4. Re-extract with non-default stages after title-only selection.
5. Sync extracted/ to S3 (extract path did not always).
6. Merge develop for age-decay/lexical code mid-exercise.
7. Manually set `sourcePublishedAt` on arXiv for `sourcePublishedAtDay`.
