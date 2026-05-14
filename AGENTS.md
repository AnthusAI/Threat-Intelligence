# AGENTS.md

This file is the operating manual for AI agents maintaining Papyrus. Read it
before changing the layout engine, renderer, fixture data, or publication model.

## Project Purpose

Papyrus is a Next.js/React newspaper layout lab using `@chenglou/pretext` for
precise text fitting. The goal is not just to render articles. The goal is to
experiment with a reusable design language for newspaper-style publications:
front-page teasers, planned continuation pages, shared article tails, adaptive
solver-owned furniture, and exact word-for-word continuation handoff.

Pretext owns text measurement. Papyrus owns everything around that measurement:
edition planning, page recipes, block geometry, cut policies, page heights,
image variants, scoring, continuation labels, and rendering contracts.

## Core Rules

- Do not commit unless the user explicitly asks.
- Preserve unrelated uncommitted work. This project is often dirty because it is
  being iterated in conversation.
- Keep the current one-page React flipper. Do not reintroduce Turn.js, jQuery,
  or DOM-mutating layout loops.
- Do not make React measure rendered DOM to decide layout. The solver should
  decide geometry before render using shared tokens and Pretext.
- Do not use CSS line clamping for measured article copy. Text lines must come
  from Pretext.
- Every rendered measured line must be vertically all-or-nothing. A line should
  not appear unless its full paint box fits inside the clipped text area.
- Continuation routing is planned, not emergent. Page labels must come from the
  edition plan.
- Exact cursor handoff matters. Never duplicate or skip article text between
  front-page excerpts and continuation pages.
- Keep cloud content behind `ContentRepository`. Amplify, GraphQL, and Storage
  types must not leak into `lib/newspaper-layout.ts`.
- Do not make the S3 bucket raw-public. Use Amplify Storage access rules and
  signed `getUrl` URLs for reader media unless the architecture is explicitly
  changed.
- Use an AWS profile for local Amplify/AWS access.
- `.env` is for Papyrus runtime settings and the seed editor credentials used by
  `npm run seed:amplify`. `.env*` must stay ignored, and `.env.example` is the
  committed template.
- The CLI authoring flow uses `PAPYRUS_GRAPHQL_ENDPOINT` plus
  `PAPYRUS_GRAPHQL_JWT` from `.env`. That JWT is sent directly to AppSync
  through the Lambda authorizer lane. Do not add a Papyrus editor login flow or local
  auth-session cache for CLI publishing.

## Solver vs. Renderer Boundary

The newspaper pages are not browser-flow layouts. They are solved layouts that
React renders.

The solver lives in `lib/newspaper-layout.ts`. It owns:

- page recipes, section splits, and continuation routing;
- story box, section, column, page, and furniture geometry;
- every call to Pretext and every measured `TextLine`;
- text cursors and `PlacedTextRange` handoff;
- candidate generation and scoring for images, pull quotes, and other adaptive
  furniture;
- the final page heights and renderer contracts.

The renderer lives mostly in `components/newspaper.tsx` and `app/globals.css`.
It owns:

- mapping solved objects to markup;
- passing solver values through CSS variables or inline dimensions;
- visual styling, page flipping, links, and interaction chrome;
- clipping already-solved text lines inside their solved containers.

Do not move layout decisions into React effects, DOM reads, CSS line clamps,
`getBoundingClientRect()` loops, or browser-native column balancing for the
newspaper pages. Browser layout can style the solved objects, but it should not
decide which article words are visible. If a visual element changes available
copy space, add it to the solver contract as geometry before `layoutTextLines`
runs.

## Main Data Contracts

`lib/articles.ts` owns fixture content:

- `Article` is the editorial source: slug, section, headline, deck, byline,
  dateline, primary image, optional reusable assets, pull quotes, and body.
- `ArticleImageAsset` is the reusable image model for adaptive page furniture.
- `getArticleText(article)` returns the text stream Pretext consumes.
- `getArticleImageAssets(article)` returns explicit image assets when present,
  or adapts the legacy `article.image` into a continuation-capable asset.
- Keep fixture articles here for reproducible tests and scenario generation.

`content/articles/` owns development editorial content:

- Store development Markdown articles here, one article per `*.md` file.
- Use YAML frontmatter for metadata: `slug`, `section`, `byline`, `dateline`,
  `image`, optional `assets`, and optional `pullQuotes`.
- The first `#` heading is the article headline. The first `##` heading is the
  deck. Remaining paragraph blocks become `Article.body`.
- This directory is not a test fixture store. Do not put BDD edge cases here.

`lib/markdown-content-repository.ts` owns Markdown normalization:

- It parses frontmatter with `gray-matter`.
- It maps Markdown files into the same `Article` shape used by fixture and
  future API content.
- Keep Markdown parsing and default metadata decisions here, not inside the
  solver or renderer.

`lib/content-types.ts` and `lib/content-repository.ts` own the content boundary:

- `EditionContent` is the normalized app input: edition metadata plus
  `Article[]`.
- `ContentRepository` is the source abstraction for loading edition content,
  resolving one article by slug, and listing article slugs.
- The current repository selects among Markdown development content, base
  fixture content, and named scenario content.
- `?scenario=<id>` always selects named scenario content from
  `lib/layout-scenarios.ts`.
- In `NODE_ENV=development`, no scenario should load Markdown content from
  `content/articles/`.
- In production/build, no scenario uses fixture content unless it is the active
  content source.
- `PAPYRUS_CONTENT_SOURCE=fixture|markdown|graphql` can override the default
  source.
- `PAPYRUS_CONTENT_SOURCE=graphql` loads Amplify Data through
  `lib/graphql-content-repository.ts`.
- UI routes should use the repository boundary, not import fixture arrays
  directly.

`lib/graphql-content-repository.ts` owns cloud normalization:

- It loads the active `Edition`, its `EditionItem` placements, attached `Item`
  records, and `MediaAsset` records from Amplify Data.
- It resolves `MediaAsset.storagePath` to temporary signed URLs with Amplify
  Storage `getUrl`.
- It never persists signed URLs back into GraphQL. Store stable paths and media
  metadata in Data; generate signed URLs at request time.
- It maps cloud records into `Article`, `ArticleImageAsset`, and
  `EditionContent`.
- Routes that use GraphQL content must stay dynamic because signed media URLs
  expire.
- The read path does not require a hand-managed token in `.env`. It uses
  `amplify_outputs.json` plus Amplify runtime configuration.
- The public read path should keep using `authMode: "apiKey"` even though the
  API default authorization mode is `userPool`.

`amplify/` owns the cloud backend:

- `amplify/auth/resource.ts` defines email auth and the `editor` group.
- `amplify/data/resource.ts` defines the CMS model: `Item`, `Tag`, `ItemTag`,
  `MediaAsset`, `Edition`, and `EditionItem`.
- `amplify/storage/resource.ts` defines private S3-backed media storage with
  guest read and editor write/delete access on `media/*`.
- `amplify/seed/seed.ts` seeds the sandbox from `content/articles/*.md`, uploads
  images, and upserts CMS records.
- `amplify_outputs.json` is generated output and must stay ignored.
- Do not put BDD fixtures in `content/articles/` to make cloud seeding easier.
  That directory is editorial development content only.
- Local sandbox, seed, and deploy operations should use the caller's AWS
  profile, typically via `AWS_PROFILE` and `AWS_REGION`.
- `amplify/seed/seed.ts` signs into Cognito as the seed editor using
  `PAPYRUS_SEED_USERNAME`, `PAPYRUS_SEED_PASSWORD`, and
  `PAPYRUS_SEED_EMAIL`. Those belong in `.env`, not in source control.
- The data API supports public API-key reads, Cognito user-pool auth, and a
  separate Lambda JWT authorizer lane. Match the intended `../Plexus/dashboard` shape:
  public API-key access stays available, Cognito remains available, and utility
  clients can send a raw bearer JWT accepted by AppSync Lambda-authorizer auth.
- Lambda-authorizer auth deployment requires an Amplify secret named
  `PAPYRUS_JWT_SECRET`. The model rules allow public reads, Cognito `editor`
  group writes, and custom JWT-authorizer writes.

`scripts/` owns the content authoring CLI:

- `scripts/content-cli.cjs` is the entrypoint exposed by `npm run content --`.
- The CLI is Markdown-first and edition-aware.
- `content/edition.json` is the local source of truth for edition metadata and
  article order.
- `scripts/lib/papyrus-graphql-authoring.cjs` owns JWT-authenticated GraphQL
  authoring calls.
- `scripts/lib/papyrus-markdown.cjs` owns Markdown and edition normalization for
  the CLI.
- In the current CLI authoring path, media assets must use external URLs. Do
  not add half-working direct S3 uploads without also introducing an
  authenticated Storage strategy that matches the chosen credentials model.
- The CLI should expose `inspect`, `list`, `diff`, `sync`, and explicit
  `content delete all --yes`; do not add `content login` or `content logout`
  unless the auth model changes again.

`lib/layout-plan.ts` owns the edition layout-plan contract:

- `EditionLayoutPlan` is stored with edition content as editorial intent, not
  solved geometry.
- `content/edition.json` carries the local development plan; Amplify stores the
  same shape on `Edition.layoutPlan`.
- The plan may choose page recipes, front-page cut policies, continuation
  sections, split variants, and ordered image/pull-quote template preferences.
- Template IDs are stable public contracts, but executable geometry and scoring
  stay in TypeScript.
- A missing plan falls back to the current default plan. A present invalid plan
  should throw a descriptive publishing error.

`lib/newspaper-layout.ts` owns layout and solver state:

- `ArticleFlow` tracks one article's current Pretext cursor and placed ranges.
- `PlacedTextRange` records `{ articleId, pageId, blockId, startCursor,
  endCursor, exhausted }`. Treat this as the source of truth for continuation
  correctness.
- `EditionPlan` is the normalized internal form of `EditionLayoutPlan`.
- `PlannedPage` chooses the recipe kind: `singleContinuation`,
  `photoContinuation`, or `dualContinuation`.
- `FrontBlock` is the renderer contract for front-page story geometry.
- `ContinuationPage` and `ContinuationSection` are the renderer contracts for
  inside pages.
- `ContinuationImage` and `ContinuationPullQuote` describe solver-selected
  furniture geometry, including template id, column start, column span, absolute
  body coordinates, and rendered dimensions.
- `PageRecipe` and `LayoutBlock` are the beginning of the reusable newspaper
  design-language model.

`components/newspaper.tsx` should remain mostly a renderer. It can map solved
objects to markup and CSS variables, but it should not decide text cutpoints,
page heights, section splits, or image variant scores.

`features/` owns executable BDD layout scenarios:

- `.feature` files are the durable behavior artifact. Keep them readable and
  product-level.
- Step definitions may use Playwright and geometry helpers to inspect DOM
  rectangles, but do not copy those details into scenario prose.
- Prefer adding a named fixture set in `lib/layout-scenarios.ts` when a bug
  depends on article length, viewport size, images, or pull quotes.
- Do not store test scenarios or edge-case fixtures in `content/articles/`.
  That folder is for development/editorial content only.
- The home page accepts `?scenario=<id>` as a content-source selector. It should
  go through `ContentRepository.loadEditionContent`, not bypass the content
  boundary in the renderer.
- The client exposes `window.__PAPYRUS_LAYOUT__` plus
  `window.__PAPYRUS_SCENARIO__` for test assertions.
- Scenarios should assert both rendered geometry and solver choices when a rule
  matters. For example, a blank-column repair should check that no continuation
  column is dead and that the intended image or furniture template won.

## Solver Flow

1. `buildNewspaperLayout(articles, pageWidth, viewportHeight, layoutPlan)`
   creates layout config, article flows, and a normalized internal
   `EditionPlan`.
2. The front page consumes article text first. Front cut policies constrain
   planned jumps so continuation destinations stay stable.
3. Each front-page story gets a solver-owned row height, measured chrome, body
   slot, and bottom-aligned jump area.
4. Continuation pages consume from the cursors left by the front page.
5. Page 2 uses `photoContinuation`: it tries bounded image-inset and
   text-height variants for Harbor, scores them, and commits only the winning
   range.
6. Page 3 uses `dualContinuation`: it tries section split variants, and each
   section can also use adaptive column image insets and optional pull quotes.
7. The layout returns solved pages, solved heights, front blocks, continuation
   sections, placed text ranges, and measured lines for React to render.

## Text Fitting Invariants

`layoutTextLines` is the local Pretext wrapper. Preserve these rules:

- Derive visible line capacity from `linePaintHeight`, not just baseline
  `lineHeight`.
- Keep `TextLine.lineHeight` as the baseline advance.
- Keep `TextLine.paintHeight` as the rendered paint box height.
- `MeasuredLines` must render span height from `paintHeight`.
- `hasMore` should probe after the last fully visible line, not after a
  partially visible line.
- If text runs out, leave remaining space blank or spend it with planned
  furniture. Do not stretch lines or move neighboring stories.

## Page Geometry Invariants

- Page height is solver-owned and content-driven.
- Front-page row heights are capped. Extra viewport height should not stretch
  rows unless a recipe intentionally spends that space on furniture.
- During page-turn animation, the shell height should cover the active and
  previous page heights so pages do not clip mid-flip.
- Continuation section title heights and photo/body heights must be reflected in
  `getContinuationPageHeight`.
- CSS variables passed from React should mirror solver geometry. Avoid duplicate
  independent `clamp(...)` logic for solver-owned measurements.

## Adaptive Furniture

Images and pull quotes are the current space-balancing furniture. Both must be
solver-owned obstacles before article text is measured.

- Image assets come from `getArticleImageAssets`.
- Continuation images should normally use aspect-preserving column insets:
  `centerTwoColumnInset`, `rightTwoColumnInset`, `rightColumnInset`, or
  `leftColumnInset`.
- `wideTopBand` exists as an explicit fallback or feature template, not as the
  default continuation behavior.
- Placed images and pull quotes become per-column `TextObstacle` rectangles.
  Pretext lays copy into each column around those obstacles.
- Pull quotes are fixture/editorial data, not generated dynamically, and they do
  not consume the article cursor.
- Pull quotes are optional. If they collide with media or make the fit worse,
  the solver should omit them.
- The solver tries a bounded set of variants and chooses deterministically.
- Text-only variants are fallback candidates, not the preferred outcome when an
  article has usable image assets.

When adding a new furniture type, make the solver return explicit geometry and
update React/CSS to render that geometry. Do not make CSS invent layout after
the solver has run.

## How To Extend The Edition

To add or change article data:

- Edit `content/articles/*.md` for development editorial content.
- Edit `lib/articles.ts` only for base fixture/test data.
- Add edge-case scenario variants in `lib/layout-scenarios.ts`, not in
  `content/articles/`.
- Keep body paragraphs long enough for continuation experiments.
- Add `assets` when an article has more than one usable image.
- Add pull quotes as editorial fixture data when they are useful for balancing
  whitespace.

To add cloud content fields:

- Add CMS fields in `amplify/data/resource.ts` when the field belongs in the
  persisted content model.
- Normalize those fields in `lib/graphql-content-repository.ts` before the
  solver sees them.
- Keep GraphQL schema concerns out of `lib/newspaper-layout.ts`.
- Update `amplify/seed/seed.ts` if Markdown development content should populate
  the new field.
- Prefer secondary indexes for real query access patterns instead of filtering
  large lists in the app.

To add a planned page:

- Add the page and any front cut policies to `content/edition.json` for local
  content or `Edition.layoutPlan` for cloud content.
- Reuse an existing `PlannedPage.kind` unless the page needs new solver
  behavior.
- Ensure continuation labels point to planned page numbers.

To add a recipe or solver variant:

- Put main solver behavior in `lib/newspaper-layout.ts`.
- Reuse `solveContinuationSectionCandidate` when possible.
- Try a small deterministic variant set.
- Score by no cropped lines, low unused space, correct cursor handoff, visual
  hierarchy, and stable labels.
- Commit text ranges only after the winning candidate is chosen.

To change rendering:

- Keep `components/newspaper.tsx` declarative.
- Pass solver values through CSS variables or inline dimensions.
- Keep direct article routes in `app/articles/[slug]/page.tsx` working.
- Keep the one-page flipper behavior.

## Verification Checklist

Run these after changes:

```bash
npm run lint
npm run typecheck
npm run build
npm run test:bdd
```

Amplify checks when cloud content changes:

```bash
npm run sandbox
npm run seed:amplify
PAPYRUS_CONTENT_SOURCE=graphql npm run build
```

Only run sandbox provisioning when the user expects AWS resources to be created
or updated. It requires configured AWS credentials and may create cloud
resources.

Browser smoke test these viewports:

- `1280x900`
- `1280x1600`
- `640x1200`
- `390x900`

Check all of the following:

- Page 1 renders one active page.
- Page 2 is the Harbor `photoContinuation`.
- Page 3 is the shared Reading Labs / Market Hall `dualContinuation`.
- Front-page continuation labels route to the planned page numbers.
- No `.measured-line` is vertically cropped inside `.story-measure` or
  `.continuation-column`.
- Page flipping works one page at a time in both directions.
- No console errors appear during flip or resize.

If the user is running the dev server on port `3001`, use it for smoke tests but
do not stop or restart it unless asked.

`npm run test:bdd` expects a running app and defaults to `http://localhost:3001`.
Use `PAPYRUS_BASE_URL` for another server. Use `PAPYRUS_HEADLESS=false` or
`npm run test:bdd:headed` when debugging geometry visually.
