# Knowledge Retrieval Roadmap

Cerebras published a description of their internal knowledge base
([How We Built Our Knowledge Base](https://www.cerebras.ai/blog/how-we-built-our-knowledge-base)):
hybrid lexical + semantic retrieval fused with reciprocal rank fusion, LLM
distillation before embedding, contextual chunk embeddings with signal gating,
age decay, a small-LLM rerank pass with context expansion, scoped "projects,"
and MCP-exposed retrieval primitives. This document evaluates each of those
ideas against the Papyrus retrieval stack and lays out a prioritized adoption
roadmap.

Read [docs/internal-knowledge-research.md](internal-knowledge-research.md)
first for how the current retrieval path works. This document is about where
it should go next.

## Framing: Papyrus is not behind wholesale

Papyrus already has capabilities the Cerebras system lacks:

- **Curation gating.** Only accepted references are vector-indexed and
  evidence-eligible. Cerebras ingests everything; Papyrus's accepted-evidence
  gate is a deliberate editorial control and stays.
- **Knowledge-graph expansion** along ontology/classification/evidence
  relations, budgeted per query.
- **Quality-aware ranking** from `quality_rating_is` relations, with
  profile-selectable weights.
- **Token-budgeted context packs** shaped per consumer profile (researcher,
  reporter, editor, reviewer, chat).

The gaps are specific retrieval techniques, not the overall architecture.
Cerebras's core lesson — no single scorer is trusted on its own; fuse several
retrieval views of the same corpus — is the one Papyrus has not yet absorbed:
retrieval today is embedding-only.

## Second source: graph engineering

A second document informs this roadmap: "Graph Engineering: 4 Models to 4
Prompts" (Boris Cherny, *Full Course From Scratch*, July 2026), independently
compiled from Anthropic's Knowledge Graph Cookbook, Building Effective AI
Agents, and Claude API documentation. It is **not an Anthropic publication and
is not endorsed by Anthropic**, and its demonstration corpus is six Wikipedia
articles — so its techniques are worth adopting while its measurements are
illustrative rather than evidence.

The two sources solve different layers, which is why both are here.

**Cerebras is retrieval-centric**: how do I *find* the right thing in a large
pile? The unit is the document or chunk, answers are grounded in passages, and
the architecture compensates for any single scorer's weakness by fusing several
ranked lists.

**The graph note is representation-centric**: how do I *represent* what a
document says? The unit is the entity and the triple, answers are grounded in
edges with provenance, and the argument is that four separately-trained NLP
systems — named-entity recognition, relation classification, entity resolution,
summarization — collapse into four LLM prompts, because a schema now does the
work labeled training data used to.

They compose rather than compete. Graph traversal has a cold-start problem the
note does not address: traversal needs a seed entity, and search is how you find
one. Retrieval finds the seed; the graph expands from it.

The note matters disproportionately to Papyrus because **we already have the
graph it describes building**. `SemanticNode` (with `nodeKey`, `aliases`,
`authorityScore`), `SemanticRelation` with typed predicates including
`mentions`, and query-time graph expansion are all in place. What we lack is a
construction pipeline that populates the graph densely — which is precisely
what the note is a recipe for. Its most transferable single idea is that the
**one-line entity description written during extraction** is what makes later
resolution work: string similarity cannot merge two aliases with no character
overlap, but a grounded per-entity description can.

## Architectural decisions

### AD-1: Graph traversal is a retriever, not a separate answering mode

When graph-grounded retrieval matures, it contributes a ranked list fused via
RRF alongside the semantic and lexical lists. It does not become a second query
pipeline with its own LLM call and output shape.

The engine already blends graph signal into a single ranked list, using
hand-tuned constants in `_rank_structured_records` (`engine.py:2161`): 1.0 for
anchors, 0.9 when a semantic match is also a graph neighbor, 0.6 for shared
context metadata, 0.8 for expanded objects. Fusion is therefore continuous with
the existing architecture, and RRF *replaces* those arbitrary constants with a
principled rank-consensus score — it deletes heuristics rather than adding
machinery. A separate answering mode would instead require a query-time LLM
call, breaking the LLM-free-at-query-time property this design protects
everywhere except the feature-flagged reranker, plus query entity-linking to
find seed nodes. Under fusion the seeds come free from semantic and lexical
hits, which is already how `_expand_semantic_seed_matches` works.

Consequence: `fuse_ranked_lists()` must accept N ranked lists with per-list
weights from the start. Do not hardcode two arms.

### AD-2: Entity metadata augments retrieval; it never gates it (v1)

Entity metadata boosts and joins results; it is not a restrictive filter until
extraction recall has been measured. Incomplete metadata used as an exclusion
filter silently hides references the extractor missed, with total confidence.
The dangerous failure of entity extraction is omission, not hallucination.

### AD-3: Entity merges need a curation gate

Resolution errors are editorial errors, not retrieval-quality errors. Merging
two distinct threat actors would cause the publication to make false attribution
claims laundered through its own citation machinery — a correction-worthy
mistake, and the worst kind, because it looks well-sourced. Merges land as
proposals requiring human confirmation, mirroring the accepted-reference gate.
Un-merging must stay cheap.

### AD-4: Measure before changing, and land serially

No retrieval-changing work merges before a golden-query baseline exists (see the
roadmap below). Separately, the scoring cleanup, hybrid lexical, and age-decay
work all touch `engine.py` and `ranking.py` within lines of each other;
dispatching them concurrently produces merge conflicts at best and semantic
conflicts at worst. Land one at a time and re-verify line references after each
merge.

## Design constraints: scale-to-zero, many publications

Two constraints bound every idea in this document and are non-negotiable:

**Everything must scale to zero.** This is a low-budget project. The current
stack already complies — DynamoDB on-demand, AppSync per-request, Lambda,
S3, and S3 Vectors are all pay-per-use with no idle floor. The roadmap must
preserve that: no provisioned-capacity services, no always-on containers, no
per-deployment fixed monthly costs. Anything with a capacity floor (an
OpenSearch domain, a hosted vector database, a warm container) is
disqualified regardless of how well it fits technically.

**The economics assume a fleet of single-publication instances.** Each
Papyrus installation is one publication — its own stack, tables, buckets,
and vector index (`knowledgeVectorIndexName`, `amplify/backend.ts:35`).
Multi-tenancy is explicitly a non-goal: a new publication is a new instance,
not a tenant, and nothing in this roadmap should introduce tenant awareness.
The constraint is purely economic and applies at service-selection time: the
strategy is to run many of these instances simultaneously, almost all idle
at any given moment, so the question to ask of any AWS service is "what does
this cost multiplied by N mostly-idle instances?" That is why the OpenSearch
rejection below is structural, not situational — a ~$350/month floor becomes
~$350 × N — while pay-per-use components cost approximately nothing times N.

One useful cost lens for the LLM-dependent ideas: distillation (idea 4) is a
**one-time per-document** cost that scales with ingestion, which curation
already throttles; in-engine rerank (idea 7) is the only idea that adds a
**recurring per-query** LLM cost, which is part of why it is last and
feature-flagged.

## Current state, verified

Facts below were verified against source at the time of writing; line numbers
drift, symbol names are stable.

**Ranking is a weighted linear blend, not rank fusion.** `PROFILE_WEIGHTS`
(`src/papyrus_knowledge_query/ranking.py:13`) defines relevance/quality/
graphContext weights (0.70/0.25/0.05 balanced); `score_record`
(`ranking.py:236`) computes `finalScore` as a weighted sum and
`ranking_sort_key` (`ranking.py:269`) sorts on it. Candidate sources
(semantic matches, anchors, graph-expanded objects) are scored independently
and deduped — never fused by rank position. Nothing RRF-like exists.

**No recency signal.** `sourcePublishedAt`/`sourceUpdatedAt` appear only in
display text. They are not written into vector metadata —
`_base_reference_metadata` (`src/papyrus_knowledge_query/vector_index.py:759`)
omits them — so age decay needs an index-schema addition, not just a ranking
change.

**Lexical search is a vestigial fallback.** `lexical_relevance`
(`ranking.py:225`) does keyword-set overlap against title/summary metadata,
and only when a record has neither `score` nor `distance`
(`relevance_score_from_record`, `ranking.py:210`). There is no index over
body text. A query for an exact identifier — a CVE ID, a file hash, a domain —
is served purely by embedding similarity, which is exactly the case Cerebras
found embeddings blur.

**Passage scoring still carries boosts from a prior corpus.**
`_passage_score` (`src/papyrus_knowledge_query/engine.py:2994`) and
`PASSAGE_HEADING_BOOSTS` (`engine.py:43`) were tuned for an AI/ML-research
corpus: boosts for tokens like "reliability", "evaluation", "agents",
"practitioners" (`engine.py:3011`), penalties for "uc berkeley" and
"ibm research" (`engine.py:2999`), heading boosts for "abstract" and
"introduction". Threat-intel report structure — "Executive Summary",
"Key Judgments", "IOCs", "Attribution", "Detections", "MITRE ATT&CK
Mapping" — gets no boost. The keyword regex `[A-Za-z][A-Za-z0-9_-]{2,}`
(`engine.py:3016`, `ranking.py` `keyword_set`) drops digit-leading hashes and
splits dotted domains and IP addresses.

**Chunking has no contextual prefix and almost no gating.** `_prepare_chunks`
(`vector_index.py:720`) embeds the raw cleaned chunk text; title, subtitle,
and summary go into metadata but never into the embedded string. Gating is a
120-character floor (`vector_index.py:731`) plus a hard cap of 8 chunks per
reference (`VectorIndexOptions.max_chunks_per_reference`,
`vector_index.py:79`). At 180 words per chunk, a long report is semantically
searchable only through its first ~1,440 words.

**Structured distillation is roughly 40% built.** `reference_summary` vectors
already embed a composite artifact — title + subtitle + canonical LLM summary
+ authors + sourceUri + first 2,400 chars (`_prepare_source_vector`,
`vector_index.py:673`), with the summary produced by
`procedures/newsroom/reference_summarization.tac`. What is missing is the
normalized entity layer: no CVE, threat-actor, malware-family, or IOC
extraction exists anywhere in `src/`.

**Scoped defaults are roughly 30% built.** The filter mechanism exists —
scope keys pass through `_normalize_request` (`engine.py:298`) to the S3
Vectors metadata filter, and Tactus procedures inject per-procedure scope
defaults (`knowledge_query_scope`, `src/papyrus_newsroom/tactus_runtime.py:1112`).
But defaults cover only object/message/assignment-kind filters, the
knowledge-query CLI exposes kind filters but no corpus or named-scope flag,
and there is no named-bundle ("project") concept.

**Planner/fan-out is roughly 60% built.**
`procedures/newsroom/research_explorer.tac` is a bounded ReAct loop (≤6 tool
calls across knowledge queries, URI lookups, and web searches) that already
plays the role of Cerebras's planner → executor for research work.

**No rerank pass exists.**

**The Lambda constraint that shapes everything.** The `knowledge-query`
Lambda (`amplify/functions/knowledge-query/`) is Python 3.12 on ARM64 with
512 MB, bundled by copying `src/papyrus_knowledge_query` verbatim with an
intentionally empty `requirements.txt` for deploy stability. Any new
retrieval machinery must be stdlib-only.

## Idea 1 — Hybrid lexical + semantic retrieval with RRF

*Effort: L. Dependencies: none. Three other ideas stack on it.*

**Cerebras.** Full-text search catches exact tokens that embeddings blur
(pasted error strings, flag names); embedding search catches paraphrase; IDF
separates signal from filler. Each retriever produces its own ranked list and
the lists are fused with reciprocal rank fusion: `score(d) = Σ weight/(60 +
rank)` per list the document appears in.

**Why it matters most here.** Threat intelligence is dense with exact
identifiers — CVE IDs, malware family names, actor aliases, file hashes,
domains, ATT&CK technique IDs. When a researcher queries `CVE-2024-3400`, a
lexical match in an accepted reference is almost always the best evidence,
and no amount of semantic similarity should outrank it. Today that query is
served by embeddings alone.

**Design.**

- New module `src/papyrus_knowledge_query/lexical_index.py`: a pure-Python
  BM25 inverted index (postings, doc lengths, IDF table) serialized as
  gzipped JSON to the existing storage bucket under a versioned key such as
  `knowledge-index/lexical/v1/index.json.gz`. Each instance carries its own
  artifact in its own bucket as a natural consequence of the stack layout —
  no tenant logic needed. The cost is a few megabytes of S3 storage and one
  GET on Lambda cold start: effectively zero per instance, idle or busy.
- Build it inside the existing `index_reference_passages` sync pass
  (`vector_index.py:91`), which already lists accepted references, reads
  extracted text, and chunks it. Same pass, same cadence — lexical staleness
  matches vector staleness by construction, and `audit` can compare the
  artifact manifest against the reference listing.
- Document unit = chunk key (referenceLineageId + chunkIndex), so lexical
  hits align with the existing passage-evidence model. Store `corpusId` per
  document so scope filters apply post-scoring.
- Domain-aware tokenizer: preserve CVE IDs, hashes, domains, IPs, and ATT&CK
  technique IDs as atomic terms; normalize defanged IOCs (`hxxp` → `http`,
  `[.]` → `.`) at both index and query time.
- Query side: `BM25LexicalProvider` implementing the existing
  `SemanticSearchProvider` protocol (`src/papyrus_knowledge_query/services.py:185`)
  so it returns the same match-record shape. Lazy-load the index into a
  module-level global in the Lambda — a few MB of gzipped JSON inflates in
  well under a second, comfortably inside 512 MB.
- Fusion: new `fuse_ranked_lists()` in `ranking.py` implementing RRF with
  k = 60. Call it in `run_knowledge_query` where semantic search runs today
  (`engine.py:194`), running both providers in parallel threads (the
  embedding HTTP call dominates latency). Record per-source ranks on each
  match (`fusion: {semanticRank, lexicalRank, rrfScore}`) for debuggability
  and for a later rerank stage. Map the normalized RRF score into the
  existing `relevance` component so quality/graphContext weighting is
  preserved. Queries matching an identifier regex can up-weight the lexical
  arm.
- Same-PR cleanup: replace the AI/ML-era `_passage_score` boosts and
  `PASSAGE_HEADING_BOOSTS` with threat-intel equivalents, and fix the
  keyword regex for digit-leading and dotted tokens.

**Alternatives rejected.**

- *OpenSearch Serverless*: minimum ~2 OCUs (roughly $350+/month) for a corpus
  whose entire extracted text is tens of megabytes; a second system of record
  to keep in sync; new infra dependency. Laptop-scale problem, datacenter
  price — and despite the name it does not scale to zero, so the floor
  multiplies per publication stack. Structurally disqualified, not just
  expensive.
- *DynamoDB inverted index*: one item per term, batched reads per query term,
  write amplification on every sync, hand-rolled IDF maintenance — more code
  and failure modes than a single blob, no latency win at this scale.
- *SQLite FTS5*: `sqlite3` is stdlib, but FTS5 availability depends on how
  the Lambda runtime's libsqlite3 was compiled — an environmental gamble the
  empty-requirements bundling philosophy exists to avoid. Keep as a fallback
  if the index outgrows the blob approach.

## Idea 2 — Age decay in ranking

*Effort: S. Dependencies: none; full effect needs one metadata backfill.*

**Cerebras.** Two threads can answer the same question; the one from six
months ago may describe infrastructure that no longer exists. When relevance
is otherwise equal, the newer answer wins.

**Papyrus fit.** Threat-intel evidence rots even faster than internal Q&A —
actor infrastructure, tooling, and mitigations all change. There is currently
no recency signal anywhere in ranking.

**Design.**

- Write `sourcePublishedAt` / `sourceUpdatedAt` / `retrievedAt` into vector
  metadata as epoch-day integers (filterable) in `_base_reference_metadata`
  (`vector_index.py:759`). Requires a one-time index rebuild or forced sync.
- Add a `recency` component to `score_record` and `PROFILE_WEIGHTS`
  (`ranking.py:13`, `ranking.py:236`): exponential half-life, default ~180
  days, configurable as `ranking.recencyHalfLifeDays`. Missing dates score
  neutral (0.5), mirroring the `missingQuality` pattern (`ranking.py:75`).
- Keep the weight small (0.05–0.10, renormalized): recency is a tie-breaker,
  not a dominator — an authoritative two-year-old reference should still beat
  a thin fresh one. Make profile variants explicit rather than letting
  recency silently swamp quality.
- Thread the date through the semantic-match normalization metadata copy and
  passage ranking so it reaches `score_record`.

## Idea 3 — Scoped search defaults ("projects")

*Effort: S–M. Dependencies: none; idea 1's lexical provider must honor the
same filters.*

**Cerebras.** Projects are named bundles of data sources; a per-user default
project scopes queries automatically, so "search everything everywhere" stops
being the default as the corpus grows.

**Papyrus fit.** The mechanism is mostly present (metadata filters, Tactus
per-procedure kind defaults); the missing piece is the named bundle. The
Papyrus analog of a per-user default is a per-desk / per-procedure default.
Scope bundles operate entirely within one instance — desks, corpora,
initiatives inside a single publication. (The publication boundary itself is
the installation, so bundles never need publication awareness.) Keeping
bundles as plain config means a freshly spun-up instance ships with a
starter bundle file rather than code changes.

**Design.**

- A named-bundle registry mapping scope names to filter sets: `corpusId`,
  `categorySetId`, object/message kinds, `vectorKinds`, ranking profile.
  Cheapest v1 is a small config document (JSON attachment or table keyed by
  name).
- Resolve `scope.scopeName` in `_normalize_request` (`engine.py:298`),
  merging bundle values under any explicitly provided scope keys.
- Expose `--scope-name` in the knowledge-query CLI and wire desk-level
  defaults into the Tactus `knowledge_query_scope` plumbing
  (`tactus_runtime.py:1112`), which already demonstrates the merge pattern.

## Idea 4 — Structured distillation before embedding

*Effort: L. Dependencies: independent; enriches ideas 1, 5, and 6. Sequence
its index rebuild together with idea 5's.*

**Cerebras.** They do not embed raw Slack transcripts. An LLM distills each
thread into a normalized artifact (question, summary, resolution, systems,
code refs) and that is what gets embedded; accuracy increased significantly.

**Papyrus fit.** Half exists: canonical LLM summaries are already embedded in
`reference_summary` vectors. The missing half is the normalized entity layer,
which for this publication means threat-intel entities.

**Design.**

This splits into two sequenced pieces of work: extraction, then resolution.

**Extraction.**

- New procedure `procedures/newsroom/reference_distillation.tac` (clone the
  `reference_summarization.tac` pattern) producing one normalized JSON
  artifact per accepted reference: summary, key findings, typed `entities[]`,
  `cves[]`, `threat_actors[]`, `malware_families[]`, `affected_products[]`,
  `attack_techniques[]`, `iocs{hashes, domains, ips}`, `report_type`,
  `source_org`. Persist as a `ModelAttachment` with role `distillation`,
  alongside the existing `metadata` attachment.
- **Every entity carries a one-line description grounded in that document.**
  This is the graph note's key insight and the single most important schema
  element: it costs nothing at extraction time and is the only thing that makes
  resolution work later. String similarity cannot merge two aliases with no
  character overlap; a grounded description can.
- Validate extracted identifiers against the source text verbatim (after
  defang normalization) and drop what does not appear, logging drop counts.
  Note that the *dangerous* failure is omission rather than hallucination —
  hence AD-2.
- Index side: in `_prepare_source_vector` (`vector_index.py:673`), embed the
  distilled artifact text (entities + findings + summary) instead of
  title + summary + first-2,400-chars, falling back to current behavior when
  no artifact exists. Write capped entity arrays into vector metadata.
- Feed the entity terms into the idea-1 lexical documents so alias and
  identifier lookup benefits from extraction, not just verbatim text.
- Use the cheap fast model tier: extraction is high-volume and
  schema-constrained, so the schema does most of the work.

**Resolution and graph promotion** (separate follow-on).

- A second procedure clusters surface forms into canonical entities with alias
  sets, one entity type per call, using the extraction descriptions as the
  disambiguation signal, and resolving incrementally against the existing
  canonical set. This needs the stronger model tier — it is reasoning-heavy
  clustering rather than schema-filling.
- Confirmed entities become `SemanticNode` rows with `mentions`
  `SemanticRelation` edges, so existing graph expansion and `authorityScore`
  accrue to them with no query-engine changes. This is also the foundation for
  a future "which desk has covered this before" capability.
- Merges are curation-gated per AD-3, and both failure modes get reported every
  run: silent loss (a surface form in no cluster) and over-merging (a specific
  entity folded into a broader one). Over-merging is the dangerous one here.

## Idea 5 — Contextual chunk embeddings + signal gating

*Effort: M. Dependencies: soft on idea 1 (IDF stats) and idea 4 (better
prefix); land after idea 4 so the corpus is re-embedded once.*

**Cerebras.** "Bursting": individual message runs are embedded with the
thread topic prepended (Anthropic's contextual-retrieval result), and a
signal gate (IDF ≥ 4.0, minimum length, social signals) keeps low-value
chunks out of the index entirely.

**Design.**

- In `_prepare_chunks` (`vector_index.py:720`), change the embedded text to
  a contextualized form — `"{title} — {subtitle or source_org}
  ({published date}). Section: {heading}.\n\n{chunk}"`. The title/subtitle
  are already threaded in; the section heading is already captured by
  `_chunk_text` and currently discarded at index time. Keep the *stored*
  metadata `text` as the raw chunk so rendered evidence is unchanged.
- Replace the 120-character floor with a real gate: minimum token count,
  maximum stopword ratio, and an IDF-sum threshold computed from the corpus
  term statistics the idea-1 lexical build already produces.
- Lift the 8-chunk cap (`vector_index.py:79`). With gating, indexing full
  documents is safe, and it fixes the only-first-1,440-words defect.
- Cost note: contextual prefixes change every embedding input, so this is a
  full corpus re-embed — modest at this corpus size (dollars, not hundreds),
  but batch it with idea 4's rebuild.

## Idea 6 — MCP retrieval primitives

*Effort: M. Dependencies: idea 1 (a `search_lexical` primitive is the main
draw); benefits from idea 3 (scope names as a tool parameter).*

**Cerebras.** MCP tools expose retrieval building blocks — intentionally
simple and LLM-free — so any agent (Claude Code included) becomes the
orchestration engine. The full planner → executor → synthesis pipeline exists
separately for the web UI.

**Papyrus fit.** Papyrus has the full pipeline (`knowledgeQuery` context
packs) and an agent harness (`execute_tactus` + `knowledge_search`), but
external agents cannot reach retrieval without the Tactus/Plexus dependency.

**Design.**

- A thin MCP server (e.g. `src/papyrus_knowledge_query/mcp_server.py`, or a
  small wrapper invoking the Lambda) exposing LLM-free primitives: `search`
  (hybrid fused), `search_semantic`, `search_lexical`, `get_reference`,
  `expand_graph`, `get_chunk_context`. This factors `run_knowledge_query`'s
  existing stage seams into callable pieces rather than only the monolithic
  context-pack pipeline.
- Keep the pipeline for production newsroom procedures; primitives are for
  Claude Code sessions and ad-hoc research. `search_lexical` for exact-IOC
  lookup by coding agents is the headline capability.

## Idea 7 — In-engine rerank + context expansion

*Effort: M. Dependencies: hard on idea 1 — rerank consumes the fused list;
without hybrid recall it polishes a biased pool.*

**Cerebras.** After RRF fusion and dedup, a small reranker model scores the
top ~20 against the query (0–10), the top 10 are kept, and winners get
neighboring sections re-attached so chunking-split context isn't lost.

**Design.**

- New `src/papyrus_knowledge_query/reranker.py`, invoked between fusion and
  match normalization, gated by `ranking.rerank: true` (default off; profiles
  opt in — likely chat only). One batched small-LLM call scoring title +
  summary/chunk text; write `ranking.rerankScore` and fold into relevance.
  Degrade gracefully to fused order on any error.
- Honest caveat: this puts an LLM call inside a currently LLM-free query
  Lambda (embeddings are the only external call today). Expect +1–3 s
  latency and a new failure mode. The alternative — letting the calling
  agent rerank, which `research_explorer.tac` already does implicitly — may
  be sufficient outside the chat profile. Ship feature-flagged with an eval
  comparing fused order vs reranked order before defaulting it on anywhere.
- Context expansion is nearly free: chunk metadata already carries
  `chunkIndex`/`startChar`/`endChar`, and the evidence path already re-reads
  source text. Add adjacent-chunk stitching (`chunkIndex ± 1`) for winners
  via the existing corpus-text provider.

## Dependencies and rebuild coupling

```
1 Hybrid+RRF ──────┬──> 7 Rerank + expansion   (hard)
  (lexical index)  ├──> 5 Contextual chunks    (IDF stats, soft)
                   └──> 6 MCP primitives       (search_lexical, soft)
4 Distillation ────┬──> enriches 1 (entity terms in lexical docs)
                   ├──> enriches 5 (prefix quality)
                   └──> enables entity filters for 3
2 Age decay ─────────── independent (needs metadata backfill)
3 Scoped defaults ───── independent (1 must honor its filters)
```

Ideas 2, 4, and 5 all mutate vector metadata or embedding input. Batch them
into at most two index rebuilds: idea 2 alone is metadata-only and can ride
along with any sync; ideas 4 + 5 change embedding input and should share one
full re-embed.

## Prioritized roadmap

**Phase 0 — measure first.**

0. **Retrieval eval harness** — a golden query set built from the real corpus,
   scored with hit@5, hit@10, and MRR, with a baseline captured and committed
   *before* anything else lands. Without it we can ship every idea below and be
   unable to distinguish improvement from regression — and rank fusion can
   genuinely make things worse, since a lexical arm that confidently ranks weak
   matches on natural-language queries dilutes decent semantic results. Cerebras
   could read their lessons off 15,000 daily queries; we have no such signal and
   must manufacture one. Per-category scoring matters more than the aggregate: a
   change that improves paraphrase while destroying identifier lookup must be
   visible. The identifier category is expected to score poorly at baseline —
   that failure is the business case for the next item.

Alongside it, and tracked on the board rather than here because it is an
ingestion concern rather than a retrieval one: **archive raw source bytes for
every accepted reference**. Everything in this document is re-derivable from
stored artifacts — chunking, embeddings, distillation, entity extraction, the
whole index. The original fetched bytes are the exception, and today they are
archived only for PDFs. That gap, not retrieval architecture, is what actually
gates growing the corpus.

**Phase 1 — subtract, then add cheaply.**

0.5. **Delete dead ranking configuration.** Nothing in the codebase ever sets
   `ranking.profile` or `ranking.diversity` — three ranking profiles, three
   diversity profiles, roughly 27 constants, and exactly one path has ever
   executed. Deleting them (plus the 0.05-weight `graphContext` signal and its
   four hand-tuned constants, which AD-1 supersedes) is a net negative diff that
   simplifies the very code the next two items modify. Do it first.

1. **Passage-scoring cleanup** — retire the prior corpus's boosts, extend
   heading boosts for threat-intel report structure, fix the token regex.
2. **Hybrid lexical + RRF** — fixes the worst domain gap (exact-identifier
   lookup is embedding-only today), three other items stack on it, and it is the
   lossless safety net under every lossy transformation that follows.
3. **Age decay** — small change, high domain value; the metadata addition is
   backward-compatible and rides along with any rebuild.
4. **Scoped defaults** — mostly plumbing over existing filters; makes
   multi-corpus and per-desk usage safe before the index grows.

**Phase 2 — representation (shares one rebuild).**

5. **Reference entity extraction** — an LLM-extracted artifact per accepted
   reference, embedded in place of the raw composite, with entity metadata
   additive-only per AD-2. Every entity carries a grounded one-line description,
   which costs nothing now and is what makes the next item possible.
6. **Entity resolution + graph promotion** — cluster surface forms into
   canonical nodes with alias sets and promote them into the existing
   `SemanticNode`/`mentions` graph, curation-gated per AD-3.
7. **Contextual chunks + gating** — prepend document context to embedded chunks,
   gate low-signal chunks, lift the 8-chunk cap. Batch its re-embed with item 5.

**Phase 3 — discovery, surfaces, polish.**

7.5. **Exploratory research budget.** Every other item here narrows focus, and
   ranking by similarity structurally cannot surface what you did not ask about.
   Deliberately spending a fraction of research effort on adjacent, unsteered
   territory is the counterweight that lets the system surprise its operators.
   It has to be budgeted on purpose; it will not emerge from better retrieval.

8. **MCP primitives** — once hybrid search exists to expose. *Deferred:* useful,
   not load-bearing, since agents already reach retrieval via the Tactus
   harness.
9. **In-engine rerank** — last: the only recurring per-query LLM cost in the
   roadmap, and the fused, decayed, and distilled stack may make it unnecessary
   outside the chat profile. Its context-expansion half is cheap and lands
   regardless of the rerank verdict.

## What Papyrus should not copy

- **Enterprise-scale cost assumptions.** Cerebras serves 15,000+ queries a
  day for one well-funded deployment; always-on infrastructure amortizes.
  Papyrus optimizes for the opposite shape — a fleet of small
  single-publication instances, most idle at any given moment — so every
  component must cost nothing while idle.
- **Ingest-everything.** Cerebras indexes raw Slack at firehose scale with
  no curation step. Papyrus's accepted-evidence gate is an editorial feature,
  not a limitation — it is why quality signals and citations can be trusted.
  It is also the cost governor: curation throttles ingestion, which is what
  keeps per-document LLM costs (summarization, distillation) bounded.
- **Socket-Mode-style real-time ingestion.** Papyrus's cadence is editorial
  (assignment-driven research, scheduled dispatches), not conversational.
  Per-source freshness tuning already exists at the corpus/dispatch level.
- **Per-user default projects.** The Papyrus analog is per-desk and
  per-procedure defaults (idea 3); individual reader personalization is not
  a newsroom-tooling goal.
- **A separate graph answering pipeline.** The graph note's query prompt
  reasons over a serialized subgraph in its own LLM call. We fuse instead
  (AD-1) — same capability, no second pipeline, no query-time LLM call, and it
  retires hand-tuned scoring constants on the way in.
