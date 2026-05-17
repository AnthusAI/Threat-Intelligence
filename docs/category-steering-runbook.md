# Category And Graph Steering Runbook

Papyrus is the human steering system. Biblicus is the artifact producer. Papyrus
imports accepted category sets, steering proposals, private reference metadata,
semantic relation rows, artifact references, decisions, and stable external IDs.
It does not import corpus contents into GraphQL. Source text, PDFs, transcripts,
and extraction output stay in private S3/corpus storage; Papyrus `Reference`
records store strict metadata and associations only.

This runbook is written against the current AI/ML pilot corpora, but the system
is domain-neutral. A publication about any area of interest should be configured
by changing corpus keys, S3 prefixes, topic classifiers, steering decisions, and
agent instructions. Papyrus application code should not know whether a corpus is
about research papers, sports, markets, crafts, local government, or any other
beat.

## Publication Configuration Model

The publication is assembled from configuration plus artifacts:

- `corpora/papyrus-steering.yml` names the publication, the canonical topic-set
  authority, each corpus key, corpus role, local classifier ids, local working
  copy path, and S3 prefix.
- Biblicus owns corpus artifacts: source documents, sidecars, extraction
  snapshots, topic-modeling results, graph snapshots, proposal bundles,
  classifier manifests, and projection output.
- Papyrus owns human steering state and publication state: canonical topic copy,
  proposal review decisions, accepted topic revisions, private `Reference`
  metadata, private `SemanticRelation` links, CMS `Item` records, editions,
  edition layouts, and reader-facing media.
- Future research agents should be configured by publication/corpus instruction
  files rather than hard-coded in Papyrus. Those instructions should tell agents
  what sources to inspect, what editorial voice and beats matter, how to use
  accepted category sets and graph steering, and what artifacts to produce for
  Papyrus import. The instruction surface does not exist yet; when it does, keep
  it beside the publication/corpus config and mirror it to S3 with the corpus
  data.

For a new publication, start by creating or replacing the steering config and
corpus prefixes. Then import the config, run Biblicus artifact-producing
commands for those corpora, and import only steering/topic/reference-link
outputs into Papyrus. Do not create application branches that special-case a
domain.

## Durable Corpus Storage

Publication corpora live durably in the production Amplify Storage bucket under
a private `corpora/` prefix. Local folders are working copies only. The current
AI/ML corpora are the pilot data set; future publications can configure one,
two, or many differently named corpora.

```bash
export AWS_PROFILE=Ryan
export AWS_REGION=us-east-1
export PAPYRUS_CORPORA_BUCKET="amplify-dbsyytcm9drqa-mai-papyrusmediabucket0dab24-4hstaautjdqo"
```

Current prefixes:

- `s3://$PAPYRUS_CORPORA_BUCKET/corpora/AI-ML-research/`
- `s3://$PAPYRUS_CORPORA_BUCKET/corpora/AI-ML-history/`
- `s3://$PAPYRUS_CORPORA_BUCKET/corpora/papyrus-steering.yml`

The bucket is managed by Amplify as `papyrusMedia`. The `media/*` prefix is for
reader media. The `corpora/*` prefix is private and is not raw-public; browser
access goes through Amplify Storage rules, and worker access uses AWS IAM.

For the pilot, use AWS S3 sync for the full Biblicus corpus artifact trees.
Biblicus remote-source support is a one-way raw/source mirror into
`imports/remote/...`; do not use `biblicus source set` or `biblicus source pull`
as the full-corpus artifact sync unless the Biblicus agent confirms that
contract has changed.

Initial upload, reviewed before writing:

```bash
aws s3 sync \
  /Users/ryan/Projects/Biblicus/corpora/AI-ML-research \
  s3://$PAPYRUS_CORPORA_BUCKET/corpora/AI-ML-research/ \
  --exclude ".DS_Store" \
  --exclude "*/.DS_Store" \
  --dryrun

aws s3 sync \
  /Users/ryan/Projects/Biblicus/corpora/AI-ML-history \
  s3://$PAPYRUS_CORPORA_BUCKET/corpora/AI-ML-history/ \
  --exclude ".DS_Store" \
  --exclude "*/.DS_Store" \
  --dryrun
```

After reviewing the dry runs, repeat without `--dryrun`. Do not use `--delete`
on the first upload.

Worker refresh from S3 into local Biblicus working copies:

```bash
aws s3 sync \
  s3://$PAPYRUS_CORPORA_BUCKET/corpora/AI-ML-research/ \
  /Users/ryan/Projects/Biblicus/corpora/AI-ML-research/ \
  --exclude ".DS_Store" \
  --exclude "*/.DS_Store"

aws s3 sync \
  s3://$PAPYRUS_CORPORA_BUCKET/corpora/AI-ML-history/ \
  /Users/ryan/Projects/Biblicus/corpora/AI-ML-history/ \
  --exclude ".DS_Store" \
  --exclude "*/.DS_Store"
```

After a worker runs Biblicus commands that create artifacts, push the changed
working copy back to S3. Use a dry run first. Use `--delete` only when this
worker is intentionally reconciling S3 to its complete local working copy.

```bash
aws s3 sync \
  /Users/ryan/Projects/Biblicus/corpora/AI-ML-research \
  s3://$PAPYRUS_CORPORA_BUCKET/corpora/AI-ML-research/ \
  --exclude ".DS_Store" \
  --exclude "*/.DS_Store" \
  --dryrun
```

Only one writer should update a corpus prefix at a time until there is a
Biblicus-owned full-corpus locking or sync command.

## Steering Config

`corpora/papyrus-steering.yml` is the v1 Papyrus steering config contract. It is
committed in the Papyrus repo and mirrored to S3 beside the corpus data. The
config names the publication, identifies the canonical topic-set authority, and
assigns each corpus a stable key, display name, local path, S3 prefix, role, and
classifier ids.

Config resolution for the content CLI is:

1. `--config <path>`;
2. `PAPYRUS_STEERING_CONFIG`;
3. `corpora/papyrus-steering.yml`.

After changing the config, upload it to S3 and materialize the configured
`KnowledgeCorpus` records into GraphQL:

```bash
aws s3 cp \
  corpora/papyrus-steering.yml \
  s3://$PAPYRUS_CORPORA_BUCKET/corpora/papyrus-steering.yml

npm run content -- categories import-config \
  --config corpora/papyrus-steering.yml
```

Use corpus keys from the config for steering imports and projection imports.
Avoid display-name fallbacks; display names are editable copy, not stable
identity.

## Production Authoring JWT

The content CLI writes through AppSync's Lambda-authorizer lane. It does not use
a browser login or a local Cognito session. The CLI needs two process
environment values:

```bash
export PAPYRUS_GRAPHQL_ENDPOINT="https://64hviw44q5cq5nwjcigmasowlq.appsync-api.us-east-1.amazonaws.com/graphql"
export PAPYRUS_GRAPHQL_JWT="<short-lived production JWT>"
```

The JWT is an HS256 token signed with the production Amplify
`PAPYRUS_JWT_SECRET`. The secret lives in SSM Parameter Store for the production
Amplify branch:

```text
/amplify/dbsyytcm9drqa/main-branch-cb38ada667/PAPYRUS_JWT_SECRET
```

Mint the token from the AWS profile that owns Papyrus production, usually
`Ryan`. Do not print the secret, commit it, or write the token into `.env`.

```bash
export AWS_PROFILE=Ryan
export AWS_REGION=us-east-1
export PAPYRUS_GRAPHQL_JWT="$(node - <<'NODE'
const { execFileSync } = require("node:child_process");
const { createHmac } = require("node:crypto");

const parameterName = "/amplify/dbsyytcm9drqa/main-branch-cb38ada667/PAPYRUS_JWT_SECRET";
const raw = execFileSync("aws", [
  "ssm",
  "get-parameter",
  "--name",
  parameterName,
  "--with-decryption",
  "--output",
  "json",
], { encoding: "utf8" });

const secret = JSON.parse(raw).Parameter.Value;
const now = Math.floor(Date.now() / 1000);
const header = { alg: "HS256", typ: "JWT" };
const payload = {
  iss: "papyrus-cli",
  sub: "local-production-authoring",
  aud: "papyrus-authoring",
  iat: now,
  nbf: now - 30,
  exp: now + 6 * 60 * 60,
  scope: "papyrus:write",
  groups: ["editor"],
};

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const unsigned = `${encode(header)}.${encode(payload)}`;
const signature = createHmac("sha256", secret).update(unsigned).digest("base64url");
process.stdout.write(`${unsigned}.${signature}`);
NODE
)"
```

The Lambda authorizer verifies:

- signature: HS256 with `PAPYRUS_JWT_SECRET`;
- issuer: `papyrus-cli`;
- audience: `papyrus-authoring`;
- scope: `papyrus:write`;
- expiration and not-before timestamps.

Check the token before writing:

```bash
npm run content -- content inspect
```

## Steering Import

Use the production endpoint and JWT, and point Papyrus at the local Biblicus
checkout:

```bash
export BIBLICUS_WORKDIR="/Users/ryan/Projects/Biblicus"

npm run content -- categories import-steering \
  --config corpora/papyrus-steering.yml \
  --corpus-key AI-ML-research
```

The import is idempotent and intentionally lean. It imports private canonical
category records, reference metadata, semantic links, and raw payloads:

- `KnowledgeCorpus`;
- `KnowledgeImportRun`;
- `CategorySet`;
- `Category`;
- `KnowledgeArtifact`;
- `SteeringProposal`;
- `Reference`;
- `ReferenceAttachment`;
- `SemanticNode`;
- `KnowledgeComment`;
- `SemanticRelation`;
- private `KnowledgeRawPayload` rows for steering objects.

It does not import Biblicus corpus contents. `Reference` rows store strict
metadata only: stable external `item_id`, title, authors, source URI, corpus/S3
path, media type, checksums, dates, and sanitized provenance. Abstracts,
excerpts, extracted text, bodies, transcripts, and source notes do not belong in
the GraphQL record. Source files and auxiliary files such as transcripts or
Deepgram JSON remain in the existing private Amplify Storage bucket under
`corpora/*`; Papyrus stores one `ReferenceAttachment` row per file with the
Storage path and metadata only. Existing `s3://<bucket>/corpora/...` paths are
normalized to Amplify Storage paths like `corpora/...`; out-of-prefix files are
recorded as external source URIs and should be copied into `corpora/*` only by
an explicit corpus sync step. Category seeds, holdouts, proposal evidence,
assignment evidence, and semantic links keep stable external `item_id` strings
and connect to `Reference` lineages when Papyrus can resolve them.

Biblicus import rationale is stored as private append-only `KnowledgeComment`
records. Comments target exact private object versions and can optionally be
typed by ontology links through `SemanticRelation`; for example, an import
rationale comment links to the seeded `comment.import_rationale` semantic node.
If a Biblicus taxonomy artifact exists, `import-steering` resolves
`analysis/taxonomy/<snapshot>/taxonomy.json` from the artifact reference and
imports accepted category nodes under the versioned `CategorySet`. If no
accepted taxonomy artifact exists yet, Papyrus creates a root-only category tree
from the accepted category set so signed-in editor/admin readers can still
append a canonical category register.

## Export, Train, Project

After a human edits or accepts category copy from the `Categories` tab in the
News Desk at `/news-desk`, export the accepted category set:

```bash
npm run content -- categories export-category-set \
  --category-set category-set-category-corpus-ai-ml-research-ai-ml-research \
  --output /tmp/accepted-ai-ml-research-category-set.json
```

When accepted taxonomy nodes have been reviewed, export the taxonomy manifest
for Biblicus:

```bash
npm run content -- categories export-category-tree \
  --category-set category-set-category-corpus-ai-ml-research-ai-ml-research \
  --output /tmp/accepted-ai-ml-research-taxonomy.json
```

The taxonomy export uses the Biblicus accepted taxonomy JSON shape, including
`parent_topic_uid`, `seed_item_ids`, and `holdout_item_ids`.

Export Papyrus human steering feedback as a separate machine-readable feedback
file before the next taxonomy or graph proposal cycle:

```bash
npm run content -- categories export-steering-feedback \
  --category-set category-set-category-corpus-ai-ml-research-ai-ml-research \
  --output /tmp/ai-ml-research-steering-feedback.json
```

This export is the bridge that makes editor rejections matter to future worker
cycles. It contains append-only Papyrus decisions, accepted proposals, rejected
proposals, and a normalized `suppressions` list scoped by category set, corpus,
classifier, and root topic. Pass it to Biblicus with `--steering-feedback` so
rejected child topics, labels, relationship assertions, and weak patterns are
not proposed again under the same root. The accepted taxonomy JSON remains the
source for what **is** accepted; the steering feedback JSON is the
negative/positive review memory for what was accepted or rejected during review.

Record the accepted taxonomy in Biblicus, then run taxonomy discovery with the
Papyrus feedback suppressions:

```bash
cd /Users/ryan/Projects/Biblicus

uv run biblicus taxonomy record \
  --corpus corpora/AI-ML-research \
  --input /tmp/accepted-ai-ml-research-taxonomy.json

uv run biblicus taxonomy discover \
  --corpus corpora/AI-ML-research \
  --classifier ai-ml-research \
  --extraction-snapshot pipeline:a64a3abbd70b9ed011be83b678bdb321e0a138a9e33de446033b4b5bee6f175a \
  --steering-feedback /tmp/ai-ml-research-steering-feedback.json \
  --format json > /tmp/ai-ml-research-taxonomy-proposals.json
```

`biblicus taxonomy discover` validates the Papyrus feedback export and
suppresses rejected child-topic patterns that match the same classifier and root
topic. Suppressed candidates should show up as warnings, not as new proposal
records.

Render the seed manifest and train/project with Biblicus from the Biblicus
checkout. These commands write Biblicus corpus artifacts only.

```bash
cd /Users/ryan/Projects/Biblicus

uv run biblicus steering render-seed-manifest \
  --input /tmp/accepted-ai-ml-research-category-set.json \
  --output corpora/AI-ML-research/metadata/topic-classifiers/ai-ml-research/seed-manifest.json

uv run biblicus topic-classifier train \
  --corpus corpora/AI-ML-research \
  --manifest corpora/AI-ML-research/metadata/topic-classifiers/ai-ml-research/seed-manifest.json \
  --configuration configurations/topic-classifier.yml \
  --extraction-snapshot pipeline:a64a3abbd70b9ed011be83b678bdb321e0a138a9e33de446033b4b5bee6f175a

uv run biblicus topic-classifier project \
  --classifier-corpus corpora/AI-ML-research \
  --target-corpus corpora/AI-ML-history \
  --classifier ai-ml-research \
  --extraction-snapshot pipeline:6e29472b5050a806062496b74b290628234ffd26926c2e8d3f205b195e5c9d60 \
  --all \
  --record \
  --format json > /tmp/ai-ml-history-projection.json
```

Import projection output back into Papyrus. This creates or versions one
private `Reference` per projected Biblicus item, records private
`ReferenceAttachment` rows for source/transcript/analysis files, stores optional
import rationale as `KnowledgeComment`, and writes current `SemanticRelation`
rows from the exact reference/comment versions to matching category or ontology
versions:

```bash
cd /Users/ryan/Projects/Papyrus

npm run content -- categories import-projection \
  --config corpora/papyrus-steering.yml \
  --target-corpus-key AI-ML-history \
  --authority-corpus-key AI-ML-research \
  --bundle /tmp/ai-ml-history-projection.json \
  --classifier ai-ml-research
```

## Graph Steering

Graph steering follows the same boundary. Biblicus creates graph snapshots,
signals, and proposal artifacts. Papyrus imports the resulting steering proposal
rows and raw proposal payloads. Accepted graph or ontology artifacts can also
materialize private `SemanticNode` and `SemanticRelation` rows so News Desk and
procedure code can query ontological relationships directly.

```bash
cd /Users/ryan/Projects/Biblicus

uv run biblicus graph extract \
  --corpus corpora/AI-ML-research \
  --extractor simple-entities \
  --extraction-snapshot pipeline:a64a3abbd70b9ed011be83b678bdb321e0a138a9e33de446033b4b5bee6f175a \
  --configuration configurations/graph/simple-entities.yml

uv run biblicus steering graph-signals \
  --corpus corpora/AI-ML-research \
  --classifier ai-ml-research \
  --graph-snapshot simple-entities:<snapshot_id> \
  --steering-feedback /tmp/ai-ml-research-steering-feedback.json \
  --format json > /tmp/ai-ml-research-graph-signals.json
```

A worker or agent then converts the graph signals into a validated
`SteeringProposalBundle` and records it with Biblicus:

```bash
uv run biblicus steering proposals validate \
  --input /tmp/ai-ml-research-graph-proposals.json

uv run biblicus steering proposals record \
  --corpus corpora/AI-ML-research \
  --input /tmp/ai-ml-research-graph-proposals.json
```

Re-import steering so the News Desk shows the graph proposal rows:

```bash
cd /Users/ryan/Projects/Papyrus

npm run content -- categories import-steering \
  --config corpora/papyrus-steering.yml \
  --corpus-key AI-ML-research
```

## Taxonomy And Ontology Steering

Biblicus now uses the unified steering proposal contract for taxonomy and
ontology work as well as graph work. A steering export can include flattened
proposal rows and `proposal_bundles` for kinds such as:

- `create-taxonomy-node`;
- `move-taxonomy-node`;
- `merge-taxonomy-nodes`;
- `split-taxonomy-node`;
- `archive-taxonomy-node`;
- `add-ontology-relationship`;
- `add-relationship-type`;
- `suppress-entity-or-edge`.

Papyrus imports these rows into `SteeringProposal` and keeps full details in
private `KnowledgeRawPayload`. Typed summary fields are best-effort display
fields: taxonomy proposals can map `topic_uid`, `parent_topic_uid`, display
copy, and document evidence; ontology proposals can map `assertion_id`,
`source_ref`, `relationship_uid`, `target_ref`, and evidence IDs. The accepted
taxonomy and ontology manifests themselves are Biblicus artifacts, not embedded
top-level fields in the current steering export.

Keep this distinction clear in review UI and automation:

- Category proposal kinds such as `rename-category`, `create-category`, and
  `move-category` create new `Category` versions when accepted. There is no
  separate revision table.
- Ontology and GraphRAG proposal kinds stay in the generic queue for v1.
  Accepting or rejecting them records a Papyrus decision and updates proposal
  status. Ignoring a row is intentional no-op steering: no decision is recorded,
  and the accepted course continues.
- Biblicus proposal labels `recommend`, `do_not_recommend`, and
  `needs_clarification` are agent recommendation labels. Papyrus human review
  actions are `accept` and `reject`; ignoring a proposal is represented by
  leaving it unreviewed.

When steering is re-imported from Biblicus, Papyrus preserves reviewed proposal
state for existing accepted or rejected rows. This keeps repeated artifact
imports from reopening proposals that editors already handled. Accepted
category nodes are exported through `categories export-category-tree`; rejected rows
remain as Papyrus decision/proposal state and should be consulted by proposal
generation workers before they create the next bundle. Use
`categories export-steering-feedback` to make that review state available outside
Papyrus.

Biblicus supports that feedback file directly on `biblicus taxonomy discover`
and `biblicus steering graph-signals` via
`--steering-feedback <papyrus-feedback.json>`. Use that option for every
post-review proposal generation cycle.

Accepted category summaries now have a small first-class editor surface in
Papyrus: `/news-desk` shows accepted subcategories beside the canonical category
register, and signed-in editor/admin readers can see passive category appendix
pages after the edition. Public display stays limited to published category
projections and published issue content. `Reference`, `ReferenceAttachment`,
`SemanticNode`, `KnowledgeComment`, `SemanticRelation`, and `Knowledge*` tables
are private and have no API-key read path; readers never receive a published
citation/reference/comment projection.

## Local Corpus Working Copies

The corpus data under `corpora/*` in Papyrus is local-only and ignored by git.
Only `corpora/papyrus-steering.yml` is tracked. Local corpus folders can be
symlinks to Biblicus corpora during the pilot, but the S3 `corpora/` prefixes
are the durable source of truth. Papyrus code must not edit sidecars, catalog
files, or extracted artifacts directly. Use Biblicus CLI commands for corpus
work, then sync the resulting working copy to S3.
