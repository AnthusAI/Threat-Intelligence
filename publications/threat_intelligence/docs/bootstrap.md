# Threat Intelligence Bootstrap

Anthus Threat Intelligence uses the standard Papyrus publication bootstrap path with TI-specific configuration under `corpora/`.

## Configuration files

| File | Purpose |
|------|---------|
| `corpora/papyrus-publication-doctrine.yml` | Global mission and policy |
| `corpora/papyrus-newsroom-sections.yml` | TI desk definitions (Mission, Newsroom, AWS, Azure, AI, Gaming) |
| `corpora/papyrus-steering.yml` | Canonical corpus `threat-intelligence` |
| `corpora/papyrus-public-topics.yml` | Public topic teasers |
| `corpora/papyrus-analysis-profiles.yml` | Biblicus re-index profiles for TI |
| `corpora/papyrus-required-procedures.json` | Required Tactus procedure seeds |

## Environment

```bash
PAPYRUS_SITE_BRAND=threat-intelligence
PAPYRUS_SEED_PROFILE=threat-intelligence
PAPYRUS_INBOUND_EMAIL_CORPUS_KEY=threat-intelligence
PAPYRUS_GRAPHQL_ENDPOINT=<from amplify_outputs.json>
PAPYRUS_JWT_SECRET_SSM_PARAM=/amplify/d3on1y5vlrxmam/main-branch-aeb7dfa526/PAPYRUS_JWT_SECRET
```

Mint a CLI JWT:

```bash
PYTHONPATH=src python -m papyrus.cli auth refresh-jwt --write-env .env
```

## Materialize newsroom config

```bash
PYTHONPATH=src python -m papyrus.cli sections import-doctrine --config corpora/papyrus-publication-doctrine.yml
PYTHONPATH=src python -m papyrus.cli sections import --config corpora/papyrus-newsroom-sections.yml
PYTHONPATH=src python -m papyrus.cli ops categories import-config --config corpora/papyrus-steering.yml
PYTHONPATH=src python -m papyrus.cli knowledge concepts import-types --config corpora/papyrus-semantic-relation-types.yml
PAPYRUS_SEED_PROFILE=threat-intelligence npm run seed:amplify
```

## Corpus accession

Canonical layout:

```text
corpora/threat-intelligence/
  metadata/
    config.json
    catalog.json
  imports/
```

Register references:

```bash
PYTHONPATH=src python -m papyrus.cli references prepare-catalog \
  --config corpora/papyrus-steering.yml \
  --corpus-key threat-intelligence \
  --catalog corpora/threat-intelligence/metadata/catalog.json \
  --output .papyrus-runs/ti-bootstrap/prepared-catalog.json

PYTHONPATH=src python -m papyrus.cli references create-from-catalog \
  --config corpora/papyrus-steering.yml \
  --corpus-key threat-intelligence \
  --catalog .papyrus-runs/ti-bootstrap/prepared-catalog.json \
  --status accepted
```

`prepare-catalog` writes optional operator context to each item's
`metadata.registration_note` only. It does not create GraphQL `Message` rows.

### Cleaning up legacy intake noise (optional)

If an earlier bootstrap registered references as `pending` with auto intake
assignments or `ingestion_rationale` messages, you can tidy the live desk
without re-importing corpus files:

1. Cancel or complete open `curation.reference-intake` and
   `curation.reference-refresh` assignments that only exist because of bulk
   registration (keep real research/reporting assignments).
2. Delete `Message` rows with `messageKind = ingestion_rationale` that are
   boilerplate from `prepare-catalog` (keep explicit `insight` and
   `reference_curation` audit rows).
3. Re-run `references create-from-catalog --status accepted` only for net-new
   catalog items; existing `externalItemId` rows remain deduped.

Sync accession to S3:

```bash
PYTHONPATH=src python -m papyrus.cli ops corpora sync-to-cloud \
  --config corpora/papyrus-steering.yml \
  --corpus-key threat-intelligence
```

## Biblicus handoff

Analysis profiles reference these Biblicus configs:

- `configurations/topic-modeling/threat-intelligence-fine.yml` (global topic granularity)
- `configurations/topic-classifier.yml` (canonical classifier retrain)
- `configurations/graph/ner-entities.yml` (entity graph)

Seed manifest path: `corpora/threat-intelligence/metadata/topic-classifiers/threat-intelligence/seed-manifest.json`

After accepted references have extracted text, create re-index assignments:

```bash
PYTHONPATH=src python -m papyrus.cli analysis create-reindex-assignment \
  --profiles corpora/papyrus-analysis-profiles.yml \
  --profile global-topic-granularity \
  --corpus-key threat-intelligence
```

## Knowledge query smoke test

```bash
PYTHONPATH=src python -m papyrus_newsroom.cli knowledge-query \
  --query "AWS S3 sensitive data exposure" \
  --execution remote \
  --top-k 5
```

Vector index sync (after text attachments exist):

```bash
PYTHONPATH=src python -m papyrus.cli knowledge vector-index --action sync
```

## Newsroom sections

Match the seed edition reader desks only:

| id | title |
|----|-------|
| `mission` | Mission |
| `newsroom` | Newsroom |
| `aws` | AWS |
| `azure` | Azure |
| `ai` | AI |
| `gaming` | Gaming |

See also: [`docs/new-publication-from-corpus.md`](new-publication-from-corpus.md), [`skills/publication-bootstrap/SKILL.md`](../skills/publication-bootstrap/SKILL.md).
