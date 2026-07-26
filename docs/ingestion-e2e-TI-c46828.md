# E2E ingestion exercise — TI-c46828

Branch: `epic/e2e-ingestion`. Environment: Threat Intelligence production (`ur2anu…` / `d3on1y5vlrxmam`).  
Hard stop: **operator curation**. Accession S3 archive + index sync + retrieval resume after accepts.

## Red baseline

| Check | Result |
|---|---|
| `test_references_commands` | 66 passed |
| Corpus current | pending 978 → **996** after intake; accepted **5**; archived 815 |
| Vector audit | **0/5** accepted indexed; **0** with extracted text; 1 stray vector |
| Lexical S3 key `corpora/knowledge-index/lexical/` | **absent** |

## Step log (expected → observed → delta)

### 1. Research
- **Expected:** `create-research` + `process-research-now` yields a research packet with ~10–20 `proposedReferences`.
- **Observed:** Assignment `assignment-research-e2e-ingestion-exercise-ai-agent-tool-use-security-advisories-and-html-primary-so-20260726T193857938451Z` created (`research.edition-candidate`, section `mission`). Research wall-clock **~1280s**. Packet `message-research-packet-f2bf3426c7b188f6`. **18** proposals. `--max-evidence-items 15` was overridden to 20 in the generated tactus invocation.
- **Delta:** Worked, but slow/hung-looking for ~12m with empty stdout; CLI arg for max evidence not honored by cloud.tac generation.

### 2. Intake
- **Expected:** Pending References; ingestion rationale preserved; nothing accepted; curation assignments created.
- **Observed:** 18 pending References (`status: pending`, none accepted). Catalog has `registration_note`; live `Reference.metadata` is **null**. `curationAssignmentCount: 0`. `urlText.eligible: 0`; metadata generation skipped all 18 for missing text.
- **Delta / defects:** [TI-a9cb3a](TI-a9cb3a), [TI-1ad2f4](TI-1ad2f4), [TI-4db70d](TI-4db70d).

### 3. Triage
- **Expected:** Lane distribution for new batch; rationales decidable without opening source.
- **Observed:** Full-queue plan `assisted-triage-20260726T200140Z-a7c6dc5b` (~25s). Pending scanned 996; human queue 967; lanes uncertain 964 / likely_accept 3 / likely_reject 0. All **18** new prospects → **uncertain**. Rationales are inventory (“domain X; 5 accepted; none matched closely”) — **0/18** decidable without opening source (`kanbus-ec5555` still open).
- **Delta:** Fresh prospects do not improve triage signal vs stale queue measurement.

### 4. Curate
- **STOP for operator.** Queue: `.papyrus-runs/c46828-e2e/operator-queue.json` (18 items). Prefer HTML news/advisory pages (e.g. CSO Online, Help Net Security); avoid Reddit/GitHub issue noise unless intentional.

### 5. Accession (partial — pre-accept probe only)
- **Expected after accept:** extracted text + `role=source` archive; HTML `mediaType` not default PDF; S3 object + sha256 match.
- **Observed without accept:** `download_reference_source_material` on CSO Online HTML pending ref → `mediaType=text/html`, 252384 bytes, sha256 match, looks like HTML, **not** defaulted to `application/pdf`. Artifact: `.papyrus-runs/c46828-e2e/html-fetch-probe.json`.
- **Delta:** Live HTTP HTML fetch path works in isolation. Full GraphQL attachment + S3 `role=source` write still **unproven** until operator accepts and accession runs.

### 6–7. Sync / query
- **Blocked** on operator accepts + accession. Pre-state: vector index empty for all accepted; lexical artifact absent on TI bucket.

## Cost / time (rough)

| Stage | Wall-clock |
|---|---|
| process-research-now | ~21 min |
| triage-plan | ~25 s |
| HTML download probe | ~4 s |

OpenAI/Tavily spend not itemized by the CLI JSON; research explorer used `gpt-5.4-mini` via Tactus.

## Resume checklist (after operator accepts)

1. Confirm accepted ids from the 18.
2. `references process-create-accession-assignments` / `process-accession-now` for those ids.
3. Verify `ReferenceAttachment` role=source, S3 object, sha256, mediaType.
4. `knowledge-vector-index --action sync --corpus-id knowledge-corpus-threat-intelligence` (incremental; no rebuild).
5. Check lexical artifact path if present on this tip; do not edit `src/papyrus_knowledge_query/`.
6. Query for content unique to new accepts + an identifier query.
