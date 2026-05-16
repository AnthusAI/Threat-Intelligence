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
edition layout plans, responsive page grids, regions, block geometry, cut
policies, page heights, furniture variants, scoring, continuation labels, and
rendering contracts.

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
  edition plan. Front-page jump labels should read like `SEE READING ON A3`,
  and continuation headings should read like `READING FROM A1`. If an article
  has no `shortSlug`, use `MORE` in the jump label and omit the slug in the
  continuation heading, for example `SEE MORE ON A2` and `FROM A1`.
- Exact cursor handoff matters. Never duplicate or skip article text between
  front-page excerpts and continuation pages.
- Headline scale is an editorial token, not a CSS tweak or a side effect of
  block order. Use canonical `typography.headlineScale` names: `banner`,
  `feature`, `standard`, `rail`, and `brief`.
- Use Papyrus's canonical newspaper vocabulary when discussing layout changes
  with users and other agents. Prefer phrases like `feature headline`,
  `rail headline`, `articleFrame composition`, `local grid`, `media inset`,
  `planned continuation`, and `solver-owned furniture` over generic wording
  like "make it bigger" or "move the image around."
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

- responsive page grids, regions, local block grids, and continuation routing;
- story box, block, column, page, and furniture geometry;
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

- `Article` is the editorial source: slug, optional newspaper `shortSlug`,
  section, headline, deck, byline, dateline, primary image, optional reusable
  assets, pull quotes, and body.
- `ArticleImageAsset` is the reusable image model for adaptive page furniture.
- `getArticleText(article)` returns the text stream Pretext consumes.
- `getArticleImageAssets(article)` returns explicit image assets when present,
  or adapts the legacy `article.image` into a continuation-capable asset.
- Keep fixture articles here for reproducible tests and scenario generation.

Papyrus no longer uses a local Markdown content store. Do not add back a
`content/articles/` runtime source. Edition content should come from Amplify
GraphQL (or `?scenario=<id>` fixture overrides for tests/debug only).

`lib/publication-items.ts` owns the generic publication model:

- `PublicationItem` is the normalized item union consumed by the layout solver.
- Supported item types are `article`, `brief`, `correction`, `promo`, `ad`,
  and `sectionHeader`.
- `articleToPublicationItem` adapts legacy/fixture `Article` objects into
  generic items.
- `publicationItemToArticle` adapts article items back to `Article` for direct
  `/articles/[slug]` routes.
- `getPublicationItemText` and `getPublicationItemImageAssets` are the solver
  helpers for item text streams and reusable media assets.

`lib/content-types.ts` and `lib/content-repository.ts` own the content boundary:

- `EditionContent` is the normalized app input: edition metadata plus
  `PublicationItem[]` and a required `EditionLayoutPlan`.
- `ContentRepository` is the source abstraction for loading edition content,
  resolving one article by slug, and listing article slugs.
- The current repository uses Amplify GraphQL by default and named scenario
  content only when `?scenario=<id>` is present.
- `?scenario=<id>` always selects named scenario content from
  `lib/layout-scenarios.ts`.
- Amplify Data is loaded through `lib/graphql-content-repository.ts`.
- UI routes should use the repository boundary, not import fixture arrays
  directly.

`lib/graphql-content-repository.ts` owns cloud normalization:

- It loads the active `Edition`, its `EditionItem` placements, attached `Item`
  records, and `MediaAsset` records from Amplify Data.
- It resolves `MediaAsset.storagePath` to temporary signed URLs with Amplify
  Storage `getUrl`.
- It never persists signed URLs back into GraphQL. Store stable paths and media
  metadata in Data; generate signed URLs at request time.
- It maps cloud records into `PublicationItem`, `ArticleImageAsset`, and
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
- `amplify/seed/seed.ts` seeds the sandbox from fixture content, uploads images,
  and upserts CMS records.
- `amplify_outputs.json` is generated output and must stay ignored.
- Do not put BDD fixtures in production content records.
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
- The CLI is GraphQL authoring and inspection.
- `scripts/lib/papyrus-graphql-authoring.cjs` owns JWT-authenticated GraphQL
  authoring calls.
- In the current CLI authoring path, media assets must use external URLs. Do
  not add half-working direct S3 uploads without also introducing an
  authenticated Storage strategy that matches the chosen credentials model.
- The CLI should expose `inspect`, `list`, `diff`, `sync`, and explicit
  `content delete all --yes`; do not add `content login` or `content logout`
  unless the auth model changes again.

`lib/layout-plan.ts` owns the edition layout-plan contract:

- `EditionLayoutPlan` is stored with edition content as editorial intent, not
  solved geometry.
- Amplify stores this shape on `Edition.layoutPlan`.
- The plan is composable: `pages[]` contain `regions[]`, and regions contain
  typed `blocks[]`.
- Page presets currently include `front.mosaic`, `page.regionStack`,
  `page.railMain`, and `page.full`.
- Region types currently include `stack`, `split`, `railMain`, `strip`, and
  `fullPage`.
- Block types currently include `articleFrame`, `itemFrame`, `mediaCluster`,
  `itemStack`, `promoStrip`, `adBlock`, `rule`, and `masthead`.
- `articleFrame` presets currently include `front.teaser`,
  `article.standard`, `article.mediaInset`, and `article.mediaPrelude`.
- Media placement uses responsive intent: anchor, span range, vertical
  placement, collapse policy, crop policy, and wrap behavior.
- `articleFrame.typography.headlineScale` names the headline treatment with
  canonical newspaper terms: `banner`, `feature`, `standard`, `rail`, or
  `brief`. Do not infer headline scale from array position or patch it with CSS.
  When a user asks for a larger or smaller headline, map that request to one of
  these scale names and state the chosen name back in the implementation notes.
- `articleFrame.editorialPriority` names sequential importance with canonical
  terms: `primary`, `secondary`, `tertiary`, or `supporting`. This is separate
  from visual role and headline scale. In `front.mosaic`, one-column layouts
  use this priority so the `primary story` appears first even if it is centered
  or offset in a wide layout.
- `articleFrame.composition` can place label, headline, deck, byline, media,
  and pull quote slots on a local grid. Title slots reserve chrome above the
  body. Lead slots become solver-owned display obstacles inside the body and do
  not consume article cursors.
- Runtime validation uses Zod. A missing or invalid required plan is a
  publishing error; do not add a compatibility layer for previous plan shapes.
- Solved geometry, line positions, selected rectangles, and Pretext cursors must
  not be stored in the plan.

`lib/newspaper-layout.ts` owns layout and solver state:

- `ArticleFlow` tracks one article's current Pretext cursor and placed ranges.
- `PlacedTextRange` records `{ articleId, pageId, blockId, startCursor,
  endCursor, exhausted }`. Treat this as the source of truth for continuation
  correctness.
- `SolvedPage`, `SolvedRegion`, and `SolvedBlock` are the renderer contracts.
- `SolvedFurniture` includes image, pull quote, media cluster, and ad
  furniture with explicit solver-owned geometry.
- `buildNewspaperLayout(items, pageWidth, viewportHeight, layoutPlan)` receives
  generic publication items and the validated edition plan.
- The browser/client solver trusts the repository-normalized plan. Keep Zod
  validation in the content boundary and server/tooling path so Zod does not
  bloat the client newspaper bundle.

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
- Do not store test scenarios or edge-case fixtures in production edition
  records.
- The home page accepts `?scenario=<id>` as a content-source selector. It should
  go through `ContentRepository.loadEditionContent`, not bypass the content
  boundary in the renderer.
- The client exposes `window.__PAPYRUS_LAYOUT__` plus
  `window.__PAPYRUS_SCENARIO__` for test assertions.
- Scenarios should assert both rendered geometry and solver choices when a rule
  matters. For example, a blank-column repair should check that no continuation
  column is dead and that the intended image or furniture template won.

## Solver Flow

1. `buildNewspaperLayout(items, pageWidth, viewportHeight, layoutPlan)` creates
   layout config, publication item lookups, article flows, and page-grid
   choices.
2. The solver chooses a responsive page column count from supported counts
   `6, 5, 4, 3, 2, 1`, using the largest count that preserves readable column
   width and forcing one column on mobile.
3. Pages solve in edition-plan order. Page 1 normally uses `front.mosaic`; later
   pages can use region-stack, rail/main, strip, or full-page presets.
4. Each page solves its regions, and each region solves typed blocks inside the
   page grid.
5. `articleFrame` blocks create or resume an `ArticleFlow`. `startCursor:
   "beginning"` starts from the beginning; `startCursor: "current"` resumes
   from the cursor left by earlier blocks with the same `flowKey`.
6. `front.teaser` blocks consume article text first. Their `cutPolicy` can cap
   body lines and assign a planned `jumpTargetPage`.
7. Article blocks with media and pull quotes generate bounded local-grid and
   furniture candidates, convert furniture into text obstacles, run Pretext, and
   commit only the winning text range.
8. The layout returns generic solved pages, regions, blocks, furniture, placed
   text ranges, measured lines, and page heights for React to render.

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
- Article block title heights, body heights, furniture heights, and region gaps
  must be reflected in solved page height.
- Composed article-frame chrome boxes must reserve solved paint space before
  body lines are measured. Decks, bylines, images, and pull quotes placed in the
  body field are obstacles, not article text.
- CSS variables passed from React should mirror solver geometry. Avoid duplicate
  independent `clamp(...)` logic for solver-owned measurements.

## Adaptive Furniture

Images and pull quotes are the current space-balancing furniture. Both must be
solver-owned obstacles before article text is measured.

- Image assets come from `getPublicationItemImageAssets`.
- Layout plans express media intent through responsive placement specs:
  `anchor`, `span`, `vertical`, `collapse`, `crop`, and `wrapsText`.
- Article images should normally use aspect-preserving column insets. Full-width
  bands should be explicit block/placement choices, not accidental defaults.
- Placed images and pull quotes become per-column `TextObstacle` rectangles.
  Pretext lays copy into each column around those obstacles.
- Pull quotes are fixture/editorial data, not generated dynamically, and they do
  not consume the article cursor.
- Pull quotes are optional. If they collide with media or make the fit worse,
  the solver should omit them.
- The solver tries a bounded set of variants and chooses deterministically.
- Text-only variants are fallback candidates, not the preferred outcome when a
  block has usable image assets and required media constraints.

When adding a new furniture type, make the solver return explicit geometry and
update React/CSS to render that geometry. Do not make CSS invent layout after
the solver has run.

## How To Extend The Edition

To add or change article data:

- Update content in GraphQL (`Item`, `MediaAsset`, `Edition`, `EditionItem`)
  through the CLI authoring lane.
- Edit `lib/articles.ts` only for base fixture/test data and scenario work.
- Add edge-case scenario variants in `lib/layout-scenarios.ts`.
- Keep body paragraphs long enough for continuation experiments.
- Add `assets` when an article has more than one usable image.
- Add pull quotes as editorial fixture data when they are useful for balancing
  whitespace.
- Add non-article items through `PublicationItem` normalization when a layout
  needs promos, ads, corrections, masthead items, or section headers.

To add cloud content fields:

- Add CMS fields in `amplify/data/resource.ts` when the field belongs in the
  persisted content model.
- Normalize those fields in `lib/graphql-content-repository.ts` before the
  solver sees them.
- Keep GraphQL schema concerns out of `lib/newspaper-layout.ts`.
- Update `amplify/seed/seed.ts` if fixture seeding should populate the new
  field.
- Prefer secondary indexes for real query access patterns instead of filtering
  large lists in the app.

To add a planned page:

- Add a new entry under `layoutPlan.pages[]` on `Edition.layoutPlan` in GraphQL.
- Choose an existing page preset (`front.mosaic`, `page.regionStack`,
  `page.railMain`, or `page.full`) unless the page needs a new reusable preset.
- Add regions and blocks with stable ids. Reference items by slug, not by array
  position.
- Add `articleFrame.cutPolicy.jumpTargetPage` on earlier blocks when a teaser
  should advertise the planned page.
- Validate required article/image/content constraints before publishing.

To add a recipe or solver variant:

- Put main solver behavior in `lib/newspaper-layout.ts`.
- Reuse the generic block solver helpers when possible; avoid reintroducing
  page-specific continuation solvers.
- Try a small deterministic variant set.
- Score by no cropped lines, low unused space, correct cursor handoff, visual
  hierarchy, no furniture collisions, no dead columns, and stable labels.
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
npm run build
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
- Page 2 is the Harbor `article.mediaInset` block on a `page.regionStack` page.
- Page 3 is a shared `page.regionStack` with Reading Labs and Market Hall
  `article.mediaInset` blocks.
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
