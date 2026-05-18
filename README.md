# Papyrus

You are focused on a topic. For us, it is AI/ML information systems. For you,
it might be golf club technology, underwater basket weaving, oil markets, local
politics, or any other beat worth watching closely.

Papyrus turns that focus into a fully automated newsroom. Research agents
monitor the beat while you sleep, update a publication-specific knowledge base,
and surface surprising developments. Editor agents turn those signals into
assignments. Reporter agents draft publishable stories. The next morning, you
can open your publication and see what your newsroom found and created
overnight.

You steer it like an executive editor, as much or as little as you want:
choosing the canonical categories that become sections, setting editorial
policy, voting items up or down, commenting on drafts, and culling assignments
before publication. When you step back, Papyrus keeps operating from the
momentum you already gave it: accepted categories, current policy, open
assignments, prior votes, and rejected proposal memory.

The beat is configuration, not code. The current AI/ML corpus is pilot content,
not an application assumption. A Papyrus publication changes subject by
changing publication configuration, corpus set, category/graph steering state,
edition plans, and worker instructions.

## A Taxonomy-Aware, Ontology-Aware CMS

Papyrus is a CMS, but it manages the newsroom around the articles, not just the
articles themselves: references, knowledge artifacts, canonical topics,
ontology, assignments, drafts, published items, editions, and editorial
decisions.

The taxonomy layer decides what the publication covers and how those topics
map to newspaper sections. Papyrus stores an accepted, versioned category tree
as `CategorySet` + strict parent/child `Category` rows. Editors can accept,
reject, rename, move, split, merge, or ignore proposed topic changes; accepted
changes shape the publication, and rejected proposals become steering memory
for future cycles.

The ontology layer stores meaning, not just association. `Reference` records
hold strict external identifiers and provenance. `SemanticNode` records model
typed entities and concepts. `SemanticRelation` records preserve explicit,
versioned subject/object relationships, while seeded `SemanticRelationType`
records define official relationship keys, domains, inverse labels, and
context-pack tags. `SemanticRelation.predicate` remains a compatibility field;
new relation writers also denormalize `relationTypeId`, `relationTypeKey`, and
`relationDomain`. Together they let Papyrus track what a
thing is, what it refers to, how it relates to other things, and why it matters
to the publication.

Papyrus cultivates that model with human review plus aggregate, unsupervised,
and semi-supervised proposal cycles. Automated analysis can find patterns in
the knowledge base, propose topics, suggest ontology relationships, cluster
references, or identify weak sections. Editors can guide heavily, lightly, or
not at all for a while; the CMS keeps the accepted model stable and carries
rejected ideas forward as constraints.

That makes agent context richer than vector search alone. Instead of retrieving
only nearby text, research, editor, and reporter agents can receive context
packs with accepted taxonomy, steering decisions, citations and references,
related publication items, semantic neighbors, open assignments, and the
relationship paths that explain why something matters. The same model can power
reader-facing structure: coherent sections, source-grounded context,
related-article links, and navigation around emerging ideas.

The output is a real newspaper-style reader experience: a Next.js/React site
powered by [`@chenglou/pretext`](https://github.com/chenglou/pretext), with
planned front page teasers, exact continuation handoff, shared continuation
pages, and solver-owned editorial furniture such as images and pull quotes.
Pretext is the text-fit oracle. Papyrus owns the edition layout plan,
responsive grids, page regions, block geometry, scoring, continuation labels,
and React rendering.

## Newspaper layout, not web layout

Normal web layouts usually let text flow in a single article view. Newspapers do
something more complex:

- put several article starts on one front page;
- stop each article at a precise cutpoint;
- continue articles elsewhere without duplicating or skipping words;
- combine more than one article tail on a shared page;
- use photos, optional pull quotes, rules, and page furniture to balance short or long
  copy;
- keep the whole layout responsive.

Papyrus treats this as a deterministic layout-solving problem. It uses a
validated composable layout language rather than a fully open-ended optimizer:
an edition has pages, pages have regions, regions have blocks, and blocks can
own local grids and furniture. The solver turns those editorial instructions
into concrete geometry, then asks Pretext to measure exactly which lines fit
inside each solved block.

## Solver vs. Renderer

In a normal browser-first layout, React renders article markup and CSS gives the
browser constraints such as columns, width, floats, and line height. The browser
then decides the actual line breaks and element positions during layout. That is
great for ordinary article pages, but it makes newspaper continuations hard:
the app does not naturally know which exact word was last visible on page 1, or
where page 3 should resume.

Papyrus flips that responsibility. The solver runs before the newspaper page is
drawn. It takes articles, page width, viewport context, edition recipes, planned
continuation pages, and optional furniture candidates. It asks Pretext to fit
text into explicit boxes and around explicit obstacles. The solver then returns
the finished layout: page heights, story boxes, measured text lines, image and
pull-quote rectangles, continuation labels, and exact text cursors.

The renderer is deliberately simpler. `components/newspaper.tsx` and CSS draw
the solved result. They should not decide how many lines fit, where an article
continues, whether a pull quote fits, or how tall a page should be. If an object
changes the available copy area, it belongs in the solver first so Pretext can
measure text around it.

## Layout System Guide

The durable rules for the current design system are documented in
`docs/layout-system.md`. Read that guide before changing vertical rhythm,
masthead chrome, responsive front-page recipes, article-frame composition,
continuation height policy, furniture sufficiency, captions, the front footer,
or the archive grid.

## How It Works

Fixture articles still live in `lib/articles.ts`. They are the stable base for
tests and reproducible layout scenarios. Edge-case BDD fixture variants live in
`lib/layout-scenarios.ts`.

The app does not read any store directly from UI components. Content flows
through a `ContentRepository` boundary, which returns normalized
`EditionContent`: edition metadata, generic publication items, and a required
layout plan. The default content source is Amplify GraphQL in every environment.
URLs with `?scenario=<id>` load named fixture scenarios for BDD/debug only.

The GraphQL repository maps Amplify Data records into the same
`PublicationItem`, `ArticleImageAsset`, and `EditionContent` shape before
layout starts. Storage media is stored as S3 paths on `MediaAsset` records,
then resolved into signed display URLs at request time.

`buildNewspaperLayout` in `lib/newspaper-layout.ts` builds the active edition
from normalized publication items, the edition layout plan, the current page
width, and viewport height. It creates article flows, solves each page region,
solves each block, and returns generic solved pages for React to render.

Each article flow keeps a cursor into prepared Pretext text. When a block lays
out text, it consumes from the current cursor and returns a new cursor. That
range is recorded as a `PlacedTextRange`, which is the source of truth for
continuations.

The front page is now just a composable page using the `front.mosaic` preset
with `articleFrame` blocks. Those blocks still use solver-owned story boxes:
the solver measures each story's label, headline, deck, byline, body slot, and
continuation jump area so stories in the same row share the same rendered
height.

Continuation pages are planned before layout starts. The plan lives on the
Amplify `Edition.layoutPlan` record. It names page presets, regions,
blocks, local grid preferences, cut policies, jump targets, media placement
rules, pull-quote options, and content requirements. Page labels such as
`SEE READING ON A3` come from that plan, not from whatever page happens to be
generated next. Continuation headings use the article's `shortSlug` when it
exists, as in `READING FROM A1`; without one they fall back to `FROM A1`.

Article blocks try a bounded set of responsive local-grid and furniture
variants. The solver can inset aspect-preserving images into one or more
columns, place or omit optional pull quotes, change text column heights, and
then use Pretext to fit the remaining copy around the resulting obstacles. The
best valid variant is chosen deterministically. The stored plan controls
placement intent and constraints; TypeScript remains the source of truth for
how those constraints are solved.

`components/newspaper.tsx` renders the solved layout. It does not decide where
text cuts, how tall pages are, or which image variant wins. It receives placed
pages, blocks, lines, images, and CSS variables from the layout engine.

## Cloud Content

Papyrus includes an Amplify Gen2 backend in `amplify/`. The backend is defined
in TypeScript:

- Auth creates an `editor` group for seed/editor writes.
- Data exposes a general CMS model centered on `Item`, plus `Tag`,
  `MediaAsset`, `Edition`, and `EditionItem`.
- Storage keeps media in a private S3 bucket with guest read through Amplify
  Storage APIs and editor write/delete on `media/*`. The same Amplify bucket
  also owns private `corpora/*` prefixes for Biblicus corpus working data.

The first cloud media strategy uses signed Storage URLs, not raw public S3
object URLs. `MediaAsset.storagePath` is stable data. `GraphQLContentRepository`
calls Amplify Storage `getUrl` and injects temporary URLs into normalized
article image assets. Because signed URLs expire, GraphQL-backed pages render
dynamically.

The Data API is multi-auth. Public site reads use the API key from Amplify
outputs. Cognito user-pool auth remains available for future app/editor
surfaces. CLI authoring uses the separate Lambda authorizer, with
`PAPYRUS_GRAPHQL_JWT` sent directly to AppSync. Deploying that lane requires an
Amplify secret named `PAPYRUS_JWT_SECRET`; the authorizer also enforces the
configured issuer, audience, and scope values.

Cloud content is seeded from fixture content in `lib/articles.ts` and
`lib/layout-plan.ts`. The seed uploads article images to Storage and creates the
related CMS records. It does not create a CMS UI.

## Credentials

Use an AWS profile for AWS access. That is the right credential mechanism for
Amplify sandbox, deployment, and seeding from a local machine.

Papyrus already follows that split:

- AWS credentials come from the normal AWS SDK/CLI chain, usually
  `AWS_PROFILE` plus your local `~/.aws` config.
- App-level settings belong in `.env`.
- The seed script can still use Cognito editor credentials when seeding through
  Amplify Auth.
- The content CLI uses a direct bearer token in `PAPYRUS_GRAPHQL_JWT` for
  authoring requests. It does not log into a Papyrus user pool.

Papyrus has three distinct GraphQL auth lanes:

- the site reads GraphQL content with API-key auth;
- Cognito user-pool auth remains available for app/editor surfaces;
- the authoring CLI writes content with a JWT accepted by AppSync through the
  configured Lambda authorizer.

## Newsroom

`/newsroom` is the Papyrus newsroom operations workspace. `Topics` is the
taxonomy steering tab. `Desks` is the operational root-topic desk surface.
`Doctrine` is the publication-wide mission and policies surface. The page is
driven by the configured corpora for the publication, not by hard-coded corpus
names. Papyrus owns the human steering state in GraphQL: knowledge corpora,
import runs, artifacts, accepted category sets, strict-tree categories, private
`Reference` metadata, private `SemanticRelation` links, proposals, and
append-only decisions.

Edition planning and assignment dispatch use first-class private `Assignment`
records, not `Item` rows with assignment types. Follow
[skills/edition-planning/SKILL.md](skills/edition-planning/SKILL.md) when
creating a dated edition, planning section slots, or dispatching surplus
research assignments. The dated private `Edition` record is created or updated
first; each assignment is then linked to that edition, its root-desk category,
its publication lane, and its evidence with `SemanticRelation` rows. The default
lanes are `reporting`, `analysis`, and `briefs`; `opinion` is opt-in through
publication or desk policy. The default dispatch ratio is `3/2`: for each
desk/lane target, dispatch a small surplus of research assignments so editors
can select the strongest outputs without publishing every result. Assignments
remain private workflow records with append-only `AssignmentEvent` audit rows
and `SemanticRelation` links to categories, references, graph entities,
comments, and eventual drafts. Only selected outputs become reader-facing
article `Item` records and `EditionItem` placements. The editor-only
`Assignments` desk tab at `/newsroom/assignments` is the review surface for
these private queues.

The Newsroom should feel like another section of the newspaper, not a separate
administrative app. Steering proposals are optional editorial notes: the
publication keeps following the accepted category set unless a human chooses to
accept, reject, or rewrite a proposal while reading. Ignoring a proposal is also
valid steering: no decision is recorded, and the accepted course continues.

The steering system is publication-neutral. `corpora/papyrus-steering.yml`
selects the canonical corpus, lists any source/supporting corpora, names local
classifiers, and points at the S3 corpus prefixes. The AI/ML entries in the
checked-in config are the current production example, not a schema assumption.
Future research agents should read their domain-specific instructions from
configuration beside the corpus/publication data, produce Biblicus artifacts,
and import only stable steering outputs into Papyrus.

Researcher behavior should follow
[skills/researcher-doctrine/SKILL.md](skills/researcher-doctrine/SKILL.md):
publication doctrine is the global editorial constitution, root-desk doctrine
is the local beat standard, and the assignment brief is the immediate task.
Doctrine stays private and editable in Papyrus data; the skill defines how
agents apply it while gathering evidence and preparing research packets.

Biblicus remains the artifact and worker tool boundary. Workers may run
Biblicus commands that create reproducible artifacts, but Papyrus code should
not edit Biblicus corpus sidecars, catalogs, or internals directly. The local
`corpora/` folder is a working-copy convenience; durable corpus storage lives in
the production Amplify Storage bucket under `corpora/`. The committed
`corpora/papyrus-steering.yml` file is the v1 steering config contract that
names the publication corpora, their roles, local classifier ids, and S3
prefixes. Mirror that YAML to S3 beside the corpus data and materialize it into
GraphQL with `categories import-config`.

Private canonical publishing and knowledge records are versioned in place:
`Item`, `Edition`, `CategorySet`, `Category`, `Reference`, and `SemanticNode`
carry lineage, version number, previous version, version state, author/time
metadata, change reason, and content hash. There are no separate version
tables. `EditionItem` rows belong to an exact edition version and point to exact
item versions; `SemanticRelation` rows point to exact subject/object versions.

Public readers use only published projections: `PublishedEdition`,
`PublishedEditionItem`, `PublishedItem`, `PublishedMediaAsset`,
`PublishedCategorySet`, and `PublishedCategory`. Private canonical tables are
editor/admin and JWT-authoring only; API-key reads are limited to the projection
tables. Publishing materializes approved current versions into projections, so
the reader path stays a direct AppSync read without a Lambda call.

Raw Biblicus steering payloads and import internals live in `KnowledgeRawPayload`,
which is private to editor/admin users and the JWT-authorized worker lane.
Actual corpus contents do not belong in GraphQL. `Reference` records store only
strict metadata such as Biblicus `item_id`, title, authors, source URI, S3/corpus
path, media type, checksum, dates, and sanitized provenance. Stable IDs such as
`category_key`, classifier ids, snapshot/artifact refs, corpus identity, and
category lineage ids are the API contract; display names are editable copy, not
keys. New knowledge-base source materials should follow
[skills/reference-intake/SKILL.md](skills/reference-intake/SKILL.md): register
references and attachment metadata in Papyrus, keep corpus contents in S3 and
Biblicus artifacts, and do not model references as publication `Item` rows.
Research packets and assignment evidence should also follow
[skills/researcher-doctrine/SKILL.md](skills/researcher-doctrine/SKILL.md) so
agents apply publication doctrine, inherited root-desk doctrine, assignment
briefs, graph context, and recent desk activity in the correct order.

Category proposal review writes an append-only `SteeringDecision` and creates
new `Category` versions when accepted edits change category copy or tree state.
Accepted category trees are modeled as strict parent/child `Category` rows under
a versioned `CategorySet`; full Biblicus taxonomy manifests stay private in
`KnowledgeRawPayload`. Signed-in editor/admin readers see passive Newsroom
appendix pages after each edition. Public readers get the normal newspaper
edition with no appended category pages. The Biblicus labels `recommend`,
`do_not_recommend`, and
`needs_clarification` are agent recommendation labels, not Papyrus human review
actions; the Newsroom exposes `accept` and `reject` as explicit human decisions.
Editors can ignore a proposal by leaving it alone.

Rejected proposals must influence future category steering. Before a new taxonomy,
ontology, or graph proposal cycle, export the Papyrus review memory:

```bash
npm run content -- categories export-steering-feedback \
  --category-set <category-set-id> \
  --output /tmp/papyrus-steering-feedback.json
```

That JSON contains append-only decisions, reviewed proposals, and normalized
`suppressions` scoped by category set, corpus, classifier, and root topic. Workers
must pass it to `biblicus taxonomy discover` and
`biblicus steering graph-signals` with `--steering-feedback` so rejected child
topics, labels, relationships, or weak patterns are not proposed again.
Accepted taxonomy exports define the current tree; steering-feedback exports
carry the positive and negative review memory.

Keyword evidence and ignored-term steering are also first-class private
Newsroom data. `CategoryKeyword` rows show the weighted terms that define each
category or subcategory, while `LexicalSteeringRule` rows capture ignored terms
such as citation/header noise. Defaults live in
`corpora/papyrus-lexical-steering.yml` and are materialized by
`categories import-config`. Export active lexical steering before a new analysis
cycle with:

```bash
npm run content -- categories export-lexical-steering \
  --output /tmp/papyrus-lexical-steering.json
```

Papyrus exports this contract now; Biblicus support for consuming it during
taxonomy discovery or classifier train/project must be confirmed by the Biblicus
agent before workers rely on it.

## Current Production Edition

The production `edition-current` record is the AI/ML corpus first edition dated
`2026-05-13`. The live content source of truth is Amplify Data, especially
`Edition.layoutPlan`, `EditionItem`, `Item`, `Tag`, `ItemTag`, and `MediaAsset`
records.

- Page 1 is a `front.mosaic` page with six planned `articleFrame` teaser blocks.
- Pages 2 through 7 are planned continuation pages for the front-page AI/ML
  corpus stories.
- Page 8 is a stacked page containing the ASR correction story and ML history
  story.
- Production sections mirror Biblicus topic categories, such as
  `Self-Evolving LLM Agents`,
  `AI Agent Reliability and Evaluation`,
  `Autonomous AI Scientific Discovery`,
  `Multimodal Document Understanding Pretraining`,
  `LLM Confidence Calibration and Instruction Tuning`,
  `ASR Error Correction and System Combination`, and
  `Early Machine Learning in Games and Backpropagation History`.
- Direct article routes remain available at `/articles/[slug]`.

When production content changes, inspect the live `Edition.layoutPlan` instead
of trusting this README as the layout source of truth.

## Commands

```bash
npm run dev
npm run lint
npm run typecheck
npm run build
poetry install
poetry run papyrus-newsroom --help
poetry run papyrus-newsroom execute-tactus 'return api_list{}'
poetry run python procedures/newsroom/tests/test_newsroom_tools.py
npm run sandbox
npm run seed:amplify
npm run content -- content inspect
npm run content -- categories import-config --config corpora/papyrus-steering.yml
npm run content -- categories import-steering --config corpora/papyrus-steering.yml --corpus-key <key>
npm run content -- categories import-steering --bundle <steering-export.json>
npm run content -- categories export-category-set --category-set <id> --output <accepted-category-set.json>
npm run content -- categories import-projection --config corpora/papyrus-steering.yml --target-corpus-key <key> --authority-corpus-key <key> --bundle <projection.json>
npm run content -- relations import-types --config corpora/papyrus-semantic-relation-types.yml
npm run content -- relations backfill --config corpora/papyrus-semantic-relation-types.yml --apply
npm run test:bdd
```

## Python Newsroom Package

Papyrus now packages its Python newsroom tooling as the Poetry-managed
`papyrus-newsroom` module.

Use Poetry as the canonical Python entrypoint:

```bash
poetry install
poetry run papyrus-newsroom --help
poetry run papyrus-newsroom build-assignment-agent-context --assignment-id <assignment-id>
poetry run papyrus-newsroom execute-tactus 'return api_list{}'
poetry run python procedures/newsroom/tests/test_newsroom_tools.py
```

Newsroom agents use the single-tool Tactus pattern from Plexus. Their Tactus
procedures load only `execute_tactus` from `procedures/newsroom/tactus_tools/`;
inside that tool, snippets use the packaged `papyrus` host module for GraphQL
reads, desk context assembly, Biblicus evidence, docs/API discovery, and dry-run
record-plan builders. The older compatibility shims under
`procedures/newsroom/tools/` still exist for path-based tooling, but the
canonical implementation now lives in `src/papyrus_newsroom/`.

Copy `.env.example` to `.env` when you need local overrides. `.env*` is ignored
by git, while `.env.example` is intentionally committed as the template.

`npm run test:bdd` runs the Gherkin layout scenarios against a running app. It
defaults to `http://localhost:3001`; set `PAPYRUS_BASE_URL` to test another
server.

In development, no query string means the live GraphQL edition. Use
`/?scenario=current-edition` or another named scenario id only when you need a
reproducible fixture layer for testing.

For Amplify development, run `npm run sandbox` to provision a local cloud
sandbox. After the sandbox has generated `amplify_outputs.json`, run
`npm run seed:amplify` to upload fixture content and media.

For content inspection and admin against a deployed API:

```bash
npm run content -- content inspect
npm run content -- content list articles
npm run content -- categories import-config --config corpora/papyrus-steering.yml
npm run content -- categories import-steering --config corpora/papyrus-steering.yml --corpus-key <key>
npm run content -- categories export-category-set --category-set <id> --output accepted-category-set.json
npm run content -- categories import-projection --config corpora/papyrus-steering.yml --target-corpus-key <key> --authority-corpus-key <key> --bundle projection-results.json
npm run content -- content delete all --yes
```

Set `PAPYRUS_GRAPHQL_ENDPOINT` and `PAPYRUS_GRAPHQL_JWT` before running
authoring commands. The JWT is sent in the AppSync `Authorization` header using
the Papyrus Lambda-authorizer scheme. No Papyrus editor login or local
auth-session cache is involved.

The CLI still contains legacy `diff` and `sync` commands for source-driven
publishing, but those commands require a local source adapter. The runtime no
longer has a committed `content/articles` Markdown store, so do not cite
`content sync edition current` as the production publishing path unless a
current source payload exists and has been validated.

`content delete all --yes` removes CMS records through the same
JWT/Lambda-authorizer authoring lane. Use it only for an explicitly requested
reset. Do not use it for production content refreshes.

For local cloud work, use an AWS profile, for example:

```bash
AWS_PROFILE=default AWS_REGION=us-east-1 npm run sandbox
AWS_PROFILE=default AWS_REGION=us-east-1 npm run seed:amplify
AWS_PROFILE=default npm run dev
```

## Production Content Operations

Production content lives in Amplify Data. The reader path uses API-key GraphQL
reads through `ContentRepository`; production writes and repairs should use the
JWT/Lambda-authorizer authoring lane or an explicit AWS-backed maintenance
script. Do not repair production by adding a runtime Markdown content source.

Production authoring uses the deployed AppSync API, not the sandbox:

```bash
export AWS_PROFILE=Ryan
export AWS_REGION=us-east-1
export PAPYRUS_GRAPHQL_ENDPOINT=https://64hviw44q5cq5nwjcigmasowlq.appsync-api.us-east-1.amazonaws.com/graphql
```

Mint a fresh short-lived JWT from the production Amplify SSM secret. Do not
write the token or secret into `.env`:

The full production authoring and category/graph steering guide lives in the
agent skill at [skills/category-steering/SKILL.md](skills/category-steering/SKILL.md).

```bash
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

Then verify the authoring lane before writing:

```bash
npm run content -- content inspect
npm run content -- content list articles
```

For production content refreshes, use targeted GraphQL upserts. The safe pattern
is:

1. Dump or inspect `edition-current`, its `EditionItem` records, referenced
   `Item` records, media, and tags.
2. Generate a planned diff before mutations.
3. Confirm the diff targets only `edition-current` and the intended
   `Item`, `Tag`, `ItemTag`, `EditionItem`, and `MediaAsset` records.
4. Apply only targeted upserts/deletes. Do not run `npm run seed:amplify`, do
   not run sandbox provisioning, and do not run `content delete all --yes`.
5. Re-run `content list articles` and smoke-check the deployed site.

When deriving sections from a corpus, set `Item.section`, `Tag.label`, and
`ItemTag.tagSlug` to the corpus topic taxonomy. Do not leave generic placeholder
sections if the edition is meant to reflect corpus categories.

If the deployed production code is older than the local layout-plan schema, a
newer `Edition.layoutPlan` can make production return `500` during layout-plan
validation. Prefer deploying the current app before publishing advanced
layout-plan fields. If production must be restored without a deploy, make a
targeted compatibility repair to `edition-current.layoutPlan`, then re-smoke the
site and document exactly which fields were removed.

The production archive has one important invariant: a published edition must
have all of these fields set:

- `Edition.status = "published"`
- `Edition.editionDate`, for canonical date routes such as `/2026/may/13`
- `Edition.publishedAt`, for archive listing and freshness sort order

If the home page or a date route can load an edition but `/archive` says
`No published editions are available yet`, check `publishedAt` first. The
archive API lists editions through the `status + publishedAt` index, so records
created before that field was populated can be published and still absent from
the archive. Backfill the edition with a stable timestamp such as
`2026-05-13T12:00:00.000Z`, then verify the archive endpoint returns at least
one preview:

```bash
curl -sS "$PAPYRUS_BASE_URL/api/archive/editions?limit=1"
```

For local sandbox content, use `npm run seed:amplify`. That seed path uses
fixture content and Cognito editor credentials, uploads media to Storage, and
sets `publishedAt` on the seeded edition. Treat it as a sandbox/dev workflow,
not as an implicit production publish command.

## Layout Scenario Tests

Executable BDD scenarios live in `features/*.feature`. They describe newspaper
layout behaviors in durable product language: open a named scenario at a
viewport size, flip to a page, and assert outcomes such as no cropped measured
lines, no furniture overlap, no dead continuation columns, and a specific image
template winning.

Scenario URLs such as `/?scenario=shared-blank-column-pressure` select named
fixture content through the same content repository boundary used by the app.
They are not a renderer-side bypass.

Do not put BDD scenario fixtures in production content records. Test scenarios
belong in `lib/layout-scenarios.ts` so they remain deliberate, reproducible
examples.

The step definitions use Playwright to inspect both rendered DOM rectangles and
the solved layout exposed as `window.__PAPYRUS_LAYOUT__`. That lets a scenario
check the visible page and the solver decision without encoding rectangle math
inside the feature file.

## Important Files

- `docs/layout-system.md` explains the current layout-system invariants:
  vertical rhythm, mastheads, responsive front recipes, article composition,
  continuations, height policy, furniture, captions, footer, and archive.
- `lib/articles.ts` contains fixture article data, image asset metadata, and
  helpers for article text and image assets.
- `lib/content-repository.ts` loads GraphQL content by default and supports
  `?scenario=<id>` overrides for BDD/debug fixtures.
- `lib/graphql-content-repository.ts` loads Amplify Data records, resolves
  Storage paths to signed URLs, and normalizes cloud content into
  `PublicationItem` objects.
- `amplify/` defines the Gen2 Auth, Data, Storage, and seed resources for the
  cloud content backend.
- `scripts/content-cli.cjs` is the JWT-backed content authoring CLI for
  GraphQL inspect/list/diff/sync workflows.
- `lib/content-types.ts` defines `EditionContent` and `ContentRepository`.
- `lib/publication-items.ts` defines generic publication items and article
  adapters used by the solver and direct article routes.
- `lib/layout-scenarios.ts` contains reproducible layout scenario fixture sets
  used by the app and BDD tests.
- `lib/layout-plan.ts` defines and validates the Zod-backed composable layout
  language: pages, regions, blocks, responsive spans, media placement, pull
  quote placement, and content requirements.
- `lib/newspaper-layout.ts` owns the Pretext layout engine, responsive page
  grids, region/block solving, placed text ranges, adaptive furniture, and
  solved page heights.
- `components/newspaper.tsx` renders the solved newspaper scroll edition,
  measured text lines, continuation photos, and direct article links.
- `features/` contains executable Gherkin scenarios and Playwright-backed step
  definitions for layout behavior.
- `app/articles/[slug]/page.tsx` renders full direct article pages.
- `app/globals.css` contains the newspaper visual language and the CSS variables
  consumed from solver output.

Pretext measurement depends on browser canvas APIs, so the newspaper layout is
computed after client hydration. The server-rendered shell is intentionally
minimal.
