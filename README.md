# Papyrus

Papyrus is a Next.js/React layout lab for a newspaper-style news site powered by
[`@chenglou/pretext`](https://github.com/chenglou/pretext).

The project is exploring a specific publication problem: how to make responsive
web pages behave more like a printed newspaper. The front page shows carefully
cut excerpts from multiple stories. Those stories resume from the next exact
word on planned inside pages. Continuation pages can combine more than one
article, and solver-owned editorial furniture such as images and pull quotes
changes how much space is available for copy.

Pretext is the text-fit oracle. Papyrus owns the edition plan, templates,
routing, page geometry, scoring, continuation labels, and React rendering.

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

Papyrus treats this as a deterministic layout-solving problem. It uses named
newspaper recipes rather than a fully open-ended optimizer, then asks Pretext to
measure exactly which lines fit inside each solved block.

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

Development editorial articles live in `content/articles/*.md`. These files use
YAML frontmatter for metadata and Markdown headings for editorial structure:
the first `#` heading becomes the headline, the first `##` heading becomes the
deck, and the remaining paragraph blocks become the article body. This folder is
for development content only.

Fixture articles still live in `lib/articles.ts`. They are the stable base for
tests and reproducible layout scenarios. Edge-case BDD fixture variants live in
`lib/layout-scenarios.ts`, not in `content/articles/`.

The app does not read any store directly from UI components. Content flows
through a `ContentRepository` boundary, which returns normalized
`EditionContent`: edition metadata plus articles. In development, the default
front page loads Markdown content. URLs with `?scenario=<id>` always load named
scenario fixture content. Production/build defaults to fixture content unless
`PAPYRUS_CONTENT_SOURCE` is set. `PAPYRUS_CONTENT_SOURCE=fixture|markdown|graphql`
can override the default source.

The GraphQL repository maps Amplify Data records into the same `Article`,
`ArticleImageAsset`, and `EditionContent` shape before layout starts. Storage
media is stored as S3 paths on `MediaAsset` records, then resolved into signed
display URLs at request time.

`buildNewspaperLayout` in `lib/newspaper-layout.ts` builds the active edition
from normalized content, the current page width, and viewport height. It creates
article flows, solves the front page, then solves planned continuation pages.

Each article flow keeps a cursor into prepared Pretext text. When a block lays
out text, it consumes from the current cursor and returns a new cursor. That
range is recorded as a `PlacedTextRange`, which is the source of truth for
continuations.

The front page uses solver-owned story boxes. The solver measures each story's
label, headline, deck, byline, body slot, and continuation jump area so stories
in the same row share the same rendered height.

Continuation pages are planned before layout starts. Page labels such as
`Continued on page 3` come from the edition plan, not from whatever page happens
to be generated next.

Adaptive continuation pages try a bounded set of reusable furniture templates.
The solver can inset aspect-preserving images into one or more columns, place or
omit optional pull quotes, change text column heights, and then use Pretext to
fit the remaining copy around the resulting obstacles. The best valid variant is
chosen deterministically.

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

Cloud content is seeded from `content/articles/*.md`; the Markdown files remain
development content, not BDD fixtures. The seed uploads article images to
Storage and creates the related CMS records. It does not create a CMS UI.

## Current Edition

- Page 1 is a front-page teaser grid with six fixture articles.
- Page 2 is a photo continuation for `Harbor Microgrids Take Shape Before the
  Summer Peak`, preferring a centered two-column image inset on desktop.
- Page 3 is a shared continuation page for `Reading Labs Replace Remediation
  With Daily Practice` and `Old Market Hall Finds a Second Life as a Food
  Factory`, using alternating column image insets when space allows.
- Direct article routes remain available at `/articles/[slug]`.

## Commands

```bash
npm run dev
npm run lint
npm run typecheck
npm run build
npm run sandbox
npm run seed:amplify
npm run test:bdd
```

`npm run test:bdd` runs the Gherkin layout scenarios against a running app. It
defaults to `http://localhost:3001`; set `PAPYRUS_BASE_URL` to test another
server.

In development, no query string means Markdown content from `content/articles/`.
Use `/?scenario=current-edition` or another named scenario id when you need the
reproducible fixture layer.

For Amplify development, run `npm run sandbox` to provision a local cloud
sandbox. After the sandbox has generated `amplify_outputs.json`, run
`npm run seed:amplify` to upload Markdown content and media. Then start the app
with `PAPYRUS_CONTENT_SOURCE=graphql` to read the cloud edition.

## Layout Scenario Tests

Executable BDD scenarios live in `features/*.feature`. They describe newspaper
layout behaviors in durable product language: open a named scenario at a
viewport size, flip to a page, and assert outcomes such as no cropped measured
lines, no furniture overlap, no dead continuation columns, and a specific image
template winning.

Scenario URLs such as `/?scenario=shared-blank-column-pressure` select named
fixture content through the same content repository boundary used by the app.
They are not a renderer-side bypass.

Do not put BDD scenario fixtures in `content/articles/`. That directory is for
editorial development content. Test scenarios belong in `lib/layout-scenarios.ts`
so they remain deliberate, reproducible examples.

The step definitions use Playwright to inspect both rendered DOM rectangles and
the solved layout exposed as `window.__PAPYRUS_LAYOUT__`. That lets a scenario
check the visible page and the solver decision without encoding rectangle math
inside the feature file.

## Important Files

- `lib/articles.ts` contains fixture article data, image asset metadata, and
  helpers for article text and image assets.
- `content/articles/` contains Markdown development articles. Frontmatter
  supplies metadata; `#` and `##` headings supply headline and deck.
- `lib/content-repository.ts` defines the current fixture/scenario repository
  and the source selector for fixture, Markdown, and GraphQL-backed content.
- `lib/graphql-content-repository.ts` loads Amplify Data records, resolves
  Storage paths to signed URLs, and normalizes cloud content into `Article`
  objects.
- `amplify/` defines the Gen2 Auth, Data, Storage, and seed resources for the
  cloud content backend.
- `lib/markdown-content-repository.ts` parses Markdown development content with
  `gray-matter` and returns normalized `Article` objects.
- `lib/content-types.ts` defines `EditionContent` and `ContentRepository`.
- `lib/layout-scenarios.ts` contains reproducible layout scenario fixture sets
  used by the app and BDD tests.
- `lib/newspaper-layout.ts` owns the Pretext layout engine, edition plan,
  recipes, solver variants, placed text ranges, adaptive images, and solved page
  heights.
- `components/newspaper.tsx` renders the solved newspaper, one-page flipper,
  measured text lines, continuation photos, and direct article links.
- `features/` contains executable Gherkin scenarios and Playwright-backed step
  definitions for layout behavior.
- `app/articles/[slug]/page.tsx` renders full direct article pages.
- `app/globals.css` contains the newspaper visual language and the CSS variables
  consumed from solver output.

Pretext measurement depends on browser canvas APIs, so the newspaper layout is
computed after client hydration. The server-rendered shell is intentionally
minimal.
