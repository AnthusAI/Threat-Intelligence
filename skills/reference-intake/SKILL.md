---
name: reference-intake
description: Use this skill when ingesting or registering new Papyrus knowledge-base references, source materials, corpus attachments, reference-intake assignments, or Biblicus handoffs.
---

# Reference Intake Skill

Use this skill when new source materials need to become visible in Papyrus as
knowledge-base references, or when debugging why newly ingested corpus materials
are not visible in the Newsroom.

Papyrus owns newsroom visibility, reference metadata, assignments, comments,
semantic links, and editorial steering state. Biblicus owns corpus ingestion,
source files, extraction artifacts, classifier artifacts, graph artifacts, and
reproducible worker commands. Do not edit `/Users/ryan/Projects/Biblicus`
source from Papyrus.

## Completion Contract

If the user asks to ingest, import, add, or research new references without
saying "local only," the task is not done until the new references are
cloud-visible:

1. the materials are in the correct local Biblicus corpus working copy;
2. Biblicus ingest/extraction has succeeded locally;
3. the changed corpus working copy has been synced to the configured private S3
   `corpora/*` prefix, using a reviewed `aws s3 sync --dryrun` first;
4. the Papyrus production curation cycle has completed through the JWT
   authoring lane;
5. Newsroom/GraphQL verification shows the new `Reference` rows or explains
   why they are not expected yet.

"Do not run production casually" means run production steps deliberately with
the correct AWS profile, JWT, endpoint, and config. It does not mean stop before
S3 sync or GraphQL import when the user asked for cloud import.

If you lack AWS access, a production JWT, or permission to mutate production,
state the exact blocker and report "local-only / not imported into Papyrus."
Do not claim references are imported into Papyrus until the curation cycle and
verification have succeeded.

## Files To Read First

- `corpora/papyrus-steering.yml`: configured corpora, corpus keys, local paths,
  S3 prefixes, roles, and classifier ids.
- `skills/category-steering/SKILL.md`: production JWT setup, curation-cycle
  commands, S3 corpus rules, and Biblicus escalation rules.
- `scripts/lib/papyrus-categories.cjs`: current reference, attachment, comment,
  assignment, and semantic-relation import mappers.
- `amplify/data/resource.ts`: `Reference`, `ReferenceAttachment`,
  `KnowledgeComment`, `Assignment`, and `SemanticRelation` schema/auth rules.
- `lib/category-repository.ts`: private Newsroom data shape for references and
  assignments.

Read Biblicus docs only for command contracts. If the handoff contract is
missing, ask the Biblicus agent for it instead of patching Biblicus source.

## Data Boundary

Knowledge-base source materials are `Reference` records, not publication
`Item` rows. Publication `Item` rows are CMS objects such as articles, briefs,
promos, ads, and reader-facing edition content. Assignments are private
`Assignment` records. Do not create `Item` rows with `type: "assignment"` and
do not use `Item` rows for corpus references.

GraphQL stores strict private metadata and relationships only:

- `Reference`: stable Biblicus `item_id`, title, authors, source URI,
  normalized S3/corpus path, media type, checksums, dates, sanitized metadata.
- `ReferenceAttachment`: private file-path metadata for source PDFs, text,
  transcripts, extraction JSON, and auxiliary corpus files.
- `KnowledgeComment`: append-only commentary such as import rationale.
- `Assignment`: private work item such as `curation.reference-intake`.
- `SemanticRelation`: links from assignments/comments/references to exact
  target lineages such as `Reference`, `Category`, or `SemanticNode`.

Do not store source text, PDFs, transcripts, abstracts, raw extraction payloads,
or private source notes directly in GraphQL. Those stay in private S3
`corpora/*` prefixes or Biblicus corpus working copies. GraphQL may store a
path, checksum, media type, and sanitized provenance.

## Stable IDs

Use stable identifiers everywhere:

- corpus identity comes from `corpora/papyrus-steering.yml`;
- Biblicus item identity is `item_id`;
- Papyrus reference lineage is derived from corpus id plus `item_id`;
- attachment identity is derived from reference version, role, sort key, and
  storage/source path;
- category links use current category lineages, not display names;
- checksums and S3 paths are metadata, not primary identity.

Display names, titles, and source labels are editable copy. Do not key records
or URLs from them.

## Current Intake Path

The current production path does not have a dedicated `references` CLI yet.
Reference visibility is created through Biblicus corpus work, S3 sync, and
curation import/projection outputs:

1. Put each source material in the correct configured Biblicus corpus. For the
   current pilot, journalism/publishing/automated-news papers belong in
   `AI-ML-journalism` unless they are intentionally part of the canonical
   `AI-ML-research` authority corpus.
2. Run or verify Biblicus ingest/extraction from the Biblicus checkout with
   `uv run biblicus ...`, producing local corpus artifacts.
3. Sync the changed corpus working copy to the configured S3 prefix. Review the
   dry run first and do not use `--delete` unless explicitly reconciling the
   complete prefix:

   ```bash
   aws s3 sync \
     /Users/ryan/Projects/Biblicus/<configured-corpus-path> \
     s3://<bucket>/corpora/<corpus-key>/ \
     --exclude ".DS_Store" \
     --exclude "*/.DS_Store" \
     --dryrun
   ```

   Repeat the same command without `--dryrun` only after reviewing the output.
4. Papyrus imports Biblicus artifacts through the JWT authoring lane:

   ```bash
   npm run content -- categories import-steering \
     --config corpora/papyrus-steering.yml \
     --corpus-key <corpus-key>

   npm run content -- categories import-projection \
     --config corpora/papyrus-steering.yml \
     --target-corpus-key <source-corpus-key> \
     --authority-corpus-key <canonical-corpus-key> \
     --bundle <projection.json> \
     --classifier <classifier-id>
   ```

5. The mapper creates or updates private `Reference` rows, private
   `ReferenceAttachment` rows, optional import-rationale `KnowledgeComment`
   rows, `curation.reference-intake` `Assignment` rows, and `SemanticRelation`
   links.
6. The Newsroom reads the private models for signed-in editor/admin users.

Prefer the full repeatable cycle when the goal is category/reference visibility
after new corpus work:

```bash
export BIBLICUS_WORKDIR="/Users/ryan/Projects/Biblicus"
npm run content -- categories run-curation-cycle --config corpora/papyrus-steering.yml
```

Use `skills/category-steering/SKILL.md` for the full cycle and JWT setup. The
cycle does not sync S3; do the S3 sync explicitly before the cycle when corpus
files changed.

## Newsroom Verification

After import, verify from the editor/private side:

- `/newsroom/references` shows the new references or updated reference counts.
- `/newsroom/assignments` shows `curation.reference-intake` assignments for
  references that need human or agent review.
- a selected reference has attachment metadata, import rationale if available,
  and semantic links to categories or other graph objects when expected.
- the curation-cycle `verification.json` has nonzero current references and no
  unresolved reference relations when projections were expected.

CLI checks:

```bash
npm run content -- content inspect
npm run content -- categories run-curation-cycle --config corpora/papyrus-steering.yml
```

Inspect `.papyrus-runs/<timestamp>/verification.json` after the cycle.

When reporting completion, include: corpus key, Biblicus `item_id`s, whether S3
sync completed, curation-cycle run directory, verification result, and any
references that failed to surface.

## Future Direct Intake CLI

The desired direct Papyrus intake command does not exist yet. Do not pretend it
does.

When implemented, it should live under:

```bash
npm run content -- references ...
```

The future command family should register candidate source materials in Papyrus,
create or update strict `Reference` metadata, link `ReferenceAttachment` file
paths, create `curation.reference-intake` assignments, and hand off a stable
manifest to Biblicus for actual corpus ingestion and artifact production.

Biblicus should remain responsible for source ingestion, extraction, corpus
sidecars, classifier artifacts, graph artifacts, and reproducible analysis
commands. Papyrus should remain responsible for the GraphQL visibility layer,
editor review workflow, assignments, comments, and semantic links.

If the direct CLI needs a Biblicus feature, ask the Biblicus agent for a stable
contract such as Papyrus intake id to Biblicus `item_id` mapping, artifact path
mapping, full-corpus S3 sync, or locking. Do not patch Biblicus source from
Papyrus.

## Verification Checklist

Run these after changing reference-intake docs or mappers:

```bash
npm run test:categories
npm run lint
npm run typecheck
```

Run `npm run build` only when runtime, schema, or UI code changed.
