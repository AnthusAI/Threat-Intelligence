# Papyrus

Papyrus is a Next.js/React layout lab for a newspaper-style news site powered by
[`@chenglou/pretext`](https://github.com/chenglou/pretext).

Papyrus is meant to be a general-purpose automated newsroom, not an AI/ML-only
publication. The current AI/ML corpus content is pilot data. A publication about
soccer, oil markets, cryptocurrency, knitting, sailing, local politics, or any
other domain should be created by changing the publication configuration,
corpus set, category/graph steering state, edition plans, and worker instructions,
not by changing Papyrus code to know that domain.

The project is exploring a specific publication problem: how to make responsive
web pages behave more like a printed newspaper. The front page shows carefully
cut excerpts from multiple stories. Those stories resume from the next exact
word on planned inside pages. Continuation pages can combine more than one
article, and solver-owned editorial furniture such as images and pull quotes
changes how much space is available for copy.

Pretext is the text-fit oracle. Papyrus owns the edition layout plan,
responsive grids, page regions, block geometry, scoring, continuation labels,
and React rendering.

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

## News Desk

`/news-desk` is the Papyrus newsroom operations workspace. The default desk tab
is `Categories`; `?tab=assignments` opens the assignment culling desk. The page
is driven by the configured corpora for the publication, not by hard-coded
corpus names. Papyrus owns the human steering state in GraphQL: corpora, import
runs, artifacts, accepted category sets, strict-tree categories, proposals,
append-only decisions, and projection rows.

Assignment dispatch is the next newsroom lane. The Tactus editor procedure in
`procedures/newsroom/editor.tac` plans assignment rows as `Item` records with
`type: "assignment"` and `status: "dispatched"`, then returns one downstream
reporter procedure input per assignment. Assignments are workflow records, not
reader-facing article items. The default dispatch ratio is `3/2`: for each
section target, the editor can send a small surplus of assignments so weaker
drafts can be culled without flooding reviewers. Reporter output creates a
separate draft article item and preserves the assignment item as the audit row.
The editor-only `Assignments` desk tab at `/news-desk?tab=assignments` selects
the latest edition with assignment rows, groups candidates by section, and lets
editors manually cull or restore assignment candidates. Manual culling marks the
assignment Item and any linked draft article Item as `culled`, with the previous
workflow status preserved in `editorial.newsroom.culling` for restore.

The News Desk should feel like another section of the newspaper, not a separate
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

Biblicus remains the artifact and worker tool boundary. Workers may run
Biblicus commands that create reproducible artifacts, but Papyrus code should
not edit Biblicus corpus sidecars, catalogs, or internals directly. The local
`corpora/` folder is a working-copy convenience; durable corpus storage lives in
the production Amplify Storage bucket under `corpora/`. The committed
`corpora/papyrus-steering.yml` file is the v1 steering config contract that
names the publication corpora, their roles, local classifier ids, and S3
prefixes. Mirror that YAML to S3 beside the corpus data and materialize it into
GraphQL with `categories import-config`.

Private canonical publishing records are versioned in place: `Item`, `Edition`,
`CategorySet`, and `Category` carry lineage, version number, previous version,
version state, author/time metadata, change reason, and content hash. There are
no separate version tables. `EditionItem` rows belong to an exact edition
version and point to exact item versions.

Public readers use only published projections: `PublishedEdition`,
`PublishedEditionItem`, `PublishedItem`, `PublishedMediaAsset`,
`PublishedCategorySet`, and `PublishedCategory`. Private canonical tables are
editor/admin and JWT-authoring only; API-key reads are limited to the projection
tables. Publishing materializes approved current versions into projections, so
the reader path stays a direct AppSync read without a Lambda call.

Raw Biblicus payloads, source notes, full metadata, and import internals live in
`CategoryRawPayload`, which is private to editor/admin users and the
JWT-authorized worker lane. Stable IDs such as Biblicus `item_id`,
`category_key`, classifier ids, snapshot/artifact refs, corpus identity, and
category lineage ids are the API contract; display names are editable copy, not
keys.

Category proposal review writes an append-only `CategoryDecision` and creates
new `Category` versions when accepted edits change category copy or tree state.
Accepted category trees are modeled as strict parent/child `Category` rows under
a versioned `CategorySet`; full Biblicus taxonomy manifests stay private in
`CategoryRawPayload`. Signed-in editor/admin readers see passive News Desk
appendix pages after each edition. Public readers get the normal newspaper
edition with no appended category pages. The Biblicus labels `recommend`,
`do_not_recommend`, and
`needs_clarification` are agent recommendation labels, not Papyrus human review
actions; the News Desk exposes `accept` and `reject` as explicit human decisions.
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
npm run sandbox
npm run seed:amplify
npm run content -- content inspect
npm run content -- categories import-config --config corpora/papyrus-steering.yml
npm run content -- categories import-steering --config corpora/papyrus-steering.yml --corpus-key <key>
npm run content -- categories import-steering --bundle <steering-export.json>
npm run content -- categories export-category-set --category-set <id> --output <accepted-category-set.json>
npm run content -- categories import-projection --config corpora/papyrus-steering.yml --target-corpus-key <key> --authority-corpus-key <key> --bundle <projection.json>
npm run test:bdd
```

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

The full production authoring and category/graph steering runbook lives in
`docs/category-steering-runbook.md`.

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
