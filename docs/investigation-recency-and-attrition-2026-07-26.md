# Investigation: age-decay in production + TI-5eaa89 attrition

Branch: `docs/recency-and-attrition-investigation`  
Date: 2026-07-26  
Scope: read-only probes on Threat Intelligence production and Papyrus-main. No sync, no rebuild.

---

## 1. Does age-decay actually work in production?

**Short answer: yes, end-to-end, on the four newly accepted TI references — with caveats.**

### Method

Four accepted TI refs from the c46828 exercise:

| Title | Current id (suffix) |
|---|---|
| Prompt injection breaks today's AI agents (CSO) | `…eb0cf5f5…` |
| Indirect prompt injection… (Help Net Security) | `…fe38f260…` |
| Prompt Injection Attacks… (CyCognito) | `…7a354c94…` |
| The Hidden Dangers of Browsing AI Agents (arXiv) | `…4d1e22a5…` |

Checked GraphQL fields → S3 vector metadata on the TI index → live `knowledge-query` structured ranking.

### Results

| Check | CSO / Help Net / CyCognito | arXiv PDF |
|---|---|---|
| GraphQL `sourcePublishedAt` | null | **2025-05-19** |
| GraphQL `retrievedAt` | null | **2026-07-26** |
| Vector `sourcePublishedAtDay` | **absent** | **20227** |
| Vector `retrievedAtDay` | **20660** | **20661** |
| Query `recencyKnown` | **true** | **true** |
| Query `recencyScore` | **0.9962** | **1.0** |

- All 36 matched content vectors for these four lineages have day metadata; none sit at the 0.5 neutral default.
- Live query for “Hidden Dangers of Browsing AI Agents” returned `recencyKnown: true` on every top hit, with scores **1.0 vs 0.9962** (not flat).
- Contrast: earlier post-hybrid probe on Papyrus-main had **0/200** vectors with day fields and inert recency. That is no longer the whole story — TI has working examples.

### Caveats (honest)

1. **HTML trio still lack GraphQL `retrievedAt` / `sourcePublishedAt`.** Vectors got `retrievedAtDay` from the indexer’s fallback (`retrievedAt || importedAt || updatedAt`). TI-71ce66’s accession stamping is only fully visible on the arXiv row in GraphQL.
2. **`sourcePublishedAtDay` is only on 1/4** (arXiv). The feature is “on” via retrieval/import day for the HTML rows.
3. **Score variation is tiny** because ranking takes `max(published, updated, retrieved)`. For arXiv, published day 20227 loses to retrieved day 20661 → score 1.0 (age 0). Publication age is present in metadata but does not move the score when a fresher retrieved/import day exists.

**Verdict for question 1:** The plumbing works. `recencyKnown` is true; scores are not stuck at 0.5; query returns the fields. What we have *not* proven is useful publication-age discrimination under the current max-date policy.

---

## 2. Diagnose TI-5eaa89 — 55 accepted, “no extracted text”

Corpus: `knowledge-corpus-ai-ml-research` on Papyrus-main.  
Lexical manifest (built 2026-07-26T19:39:19Z): `eligibleCount=1376`, `skipped.missing_extracted_text=55`, `referenceCount=1321`.

### What we expected vs what is true now

| Expectation from the ticket | Live finding (2026-07-26 evening) |
|---|---|
| 55 accepted refs with no `extracted_text` attachment | **False now.** All 55 have `ReferenceAttachment` rows with `role=extracted_text` (41 also have `extracted_text_raw`; all 55 have `role=source`). |
| Unfindable by either retriever | **Half-true.** Absent from the **lexical** artifact (still 1321). Present in the **vector** index as **summary-only** (`reference_summary` ×1 each) — no passage vectors. |
| Growing leak | **No evidence of growth.** All 55 share `curationStatusUpdatedAt` / import month **2026-05**. Historical cohort. |

### Classification of the 55

| Dimension | Count |
|---|---|
| Primary class | **55/55** title-stub or broken extract (not “no attachment”) |
| Media | PDF 46 · HTML 4 · text/plain 5 |
| Host | almost all arXiv |
| `role=source` archive | **55/55** |
| S3 `extracted_text` object | ok 40 · missing 15 · empty 0 |
| S3 payload size (ok) | min 5 · median **62** · max 219 bytes |
| Vector shape | **55× `reference_summary` only** (1 vector each) |

Sample S3 “extracted text” bodies are literally the title string, e.g. `"Generative Reward Models"` (24 bytes). One larger stub (219 bytes) is garbled table/HTML debris, not a paper body.

So the lexical skip reason `missing_extracted_text` was right **at build time** (or treated title stubs as unusable). Since then, attachment rows were written, but extraction never produced real text. Indexing then attached a summary vector from the title and moved on. BM25 still correctly omits them.

### Recoverability

- **Yes, in principle:** every one of the 55 has a `role=source` archive. Re-run real PDF/HTML extraction from that archive; do not refetch the live web unless the archive is bad.
- **Not fixed by lexical rebuild alone:** rebuilding BM25 over title stubs would add noise, not passages.
- **Not a reason for a 1321-ref re-embed:** this is a 55-ref extraction repair + scoped vector/lexical update.

### Is the count growing?

Month histogram for the 55: **only `2026-05`**. The July TI E2E accepts are on a different corpus and are not in this set. Treat as historical residue until a new accession cohort is shown to emit title-only `extracted_text`.

---

## 3. Recommendation: corpus-wide Papyrus-main re-sync for recency?

**Recommendation: do not run a corpus-wide re-sync for recency right now.**

### Evidence

| Fact | Value |
|---|---|
| Papyrus-main vectors with day fields (sample n=2000) | **0** pub / **0** ret / **0** any |
| Live Papyrus-main query `recencyKnown` (top 5) | **all false**, score **0.5** |
| GraphQL `sourcePublishedAt` among accepted | **316 / 1376** (~23%) |
| GraphQL `retrievedAt` | **50 / 1376** |
| GraphQL `importedAt` | **1376 / 1376** |
| Recency weight | **0.07** |
| Freshness golden category | Cannot measure publication-age ordering (prior finding) |
| Cost shape | ~1321 re-embeds (and passage fan-out), real $ |

### Why a full re-sync is a poor buy today

1. **It would mostly stamp import freshness, not publication age.** The indexer sets `retrievedAtDay` from `retrievedAt || importedAt`. Ranking then takes `max(published, updated, retrieved)`. For the 316 with real `sourcePublishedAt`, a May 2026 `importedAt` still wins over a 2021 arXiv date — same pattern we already see on the TI arXiv row (score 1.0 despite May 2025 publish day). You would pay for `recencyKnown=true` everywhere while scores cluster by import batch.

2. **No instrument to know if it helped.** The freshness golden set does not test stale-vs-fresh ordering among co-retrieved candidates. Flat eval after spend would be ambiguous, not validating.

3. **TI already proved the path.** The feature is not vapor. Further money should buy *discriminative* dates and a measurable eval, not a blanket re-put of neutral-ish signals.

4. **Higher-ROI adjacent work (still not acting here):**
   - Prefer `sourcePublishedAtDay` over retrieved/import day when both exist (policy change; may not need re-embed if metadata-only updates are possible — verify before assuming).
   - Backfill GraphQL `sourcePublishedAt` for more of the 1060 without it (HTML/arXiv headers), then decide on sync.
   - Repair the **55** with real extraction from `role=source`, then scoped passage sync + lexical merge (TI-9b6971 guard applies).
   - Rebuild a freshness eval that retrieves both a stale and a fresh candidate before measuring order.

### When a full re-sync *would* be worth it

Only after (a) date policy prefers publication over import when available, (b) GraphQL publication coverage is much higher than 23%, and (c) there is an eval that can show ordering lift. Until then, ride recency metadata on the next rebuild that was already going to happen for another reason (`kanbus-4b0aa6`), and do not open a solo paid sync for a 0.07 tie-breaker.

---

## Artifacts

- `/tmp/ti-recency-probe.json` — TI GraphQL + vector day fields for the four
- `/tmp/ti-recency-query.json` — live TI query ranking excerpt
- `/tmp/pm-attrition-55.json` — full classification of the 55 (ids, roles, S3 status)
