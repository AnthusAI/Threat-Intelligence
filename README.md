# Papyrus

Papyrus is a Next.js/React layout lab for a newspaper-style news site powered by
[`@chenglou/pretext`](https://github.com/chenglou/pretext).

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
  Storage APIs and editor write/delete on `media/*`.

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

## Current Edition

- Page 1 is a `front.mosaic` page with six `articleFrame` teaser blocks.
- Page 2 is a stacked editorial page containing a Harbor `article.mediaInset`
  block with responsive image placement.
- Page 3 is a stacked editorial page containing Reading Labs and Market Hall
  `article.mediaInset` blocks, each solved with its own local grid, image
  obstacles, and optional pull quote.
- Direct article routes remain available at `/articles/[slug]`.

## Commands

```bash
npm run dev
npm run lint
npm run typecheck
npm run build
npm run sandbox
npm run seed:amplify
npm run content -- content inspect
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

For content authoring against a deployed API:

```bash
npm run content -- content inspect
npm run content -- content list articles
npm run content -- content diff edition current
npm run content -- content sync article agent-procedure-patterns
npm run content -- content sync edition current
npm run content -- content delete all --yes
```

Set `PAPYRUS_GRAPHQL_ENDPOINT` and `PAPYRUS_GRAPHQL_JWT` before running
authoring commands. The JWT is sent directly as the AppSync `Authorization`
bearer token and is validated through the configured Lambda authorizer. No
Papyrus editor login or local auth-session cache is involved.

`content delete all --yes` removes CMS records through the same JWT/Lambda-authorizer
authoring lane. It does not use API-key reads and should not be replaced with a
direct DynamoDB cleanup unless that is explicitly requested.

For local cloud work, use an AWS profile, for example:

```bash
AWS_PROFILE=default AWS_REGION=us-east-1 npm run sandbox
AWS_PROFILE=default AWS_REGION=us-east-1 npm run seed:amplify
AWS_PROFILE=default npm run dev
```

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
