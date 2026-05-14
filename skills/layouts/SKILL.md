# Layout Authoring Skill

Use this skill when editing Papyrus edition layouts, adding pages for content,
or explaining how a page should be composed with the current layout-plan
language.

The audience is a coding agent working on publication content. Most layout work
should be done by editing `content/edition.json` or an edition's cloud
`layoutPlan`. Only change TypeScript when the existing layout vocabulary cannot
describe the intended page.

Papyrus layouts are solved layouts, not browser-flow layouts. The edition plan
stores editorial intent. The TypeScript solver turns that intent into concrete
page columns, block boxes, media rectangles, pull-quote obstacles, Pretext text
lines, exact cursors, and page heights. React only renders the solved result.

## Files To Read First

- `content/edition.json`: the local editable edition plan. Start here.
- `content/articles/*.md`: development article content and metadata.
- `lib/layout-plan.ts`: the Zod contract for valid layout JSON. Use this when
  the JSON shape is unclear.
- `lib/publication-items.ts`: the normalized item model used by layout blocks.

Read `lib/newspaper-layout.ts` only when changing how layouts are solved.
Read `components/newspaper.tsx` only when solved output needs different
rendering.

Do not put test fixtures in `content/articles/`. Development/editorial content
belongs there; BDD edge cases belong in `lib/layout-scenarios.ts`.

## CLI Setup And Use

Use the content CLI to inspect and sync the cloud GraphQL edition. Do not edit
cloud content blind.

Local CLI configuration belongs in `.env`. That file is gitignored by
`.gitignore`; do not commit it. Keep `.env.example` as the committed template.

Required `.env` values for authoring:

```bash
PAPYRUS_GRAPHQL_ENDPOINT=https://...
PAPYRUS_GRAPHQL_JWT=...
PAPYRUS_EDITION_SLUG=current
```

The endpoint can come from `amplify_outputs.json` when that file exists, or
from the AppSync API in AWS. The JWT is a direct authoring token accepted by the
AppSync Lambda authorizer. It is not a Cognito login session. If the JWT is
missing or expired, the CLI cannot inspect or sync cloud content.

Basic CLI checks:

```bash
npm run content -- content inspect
npm run content -- content list articles
npm run content -- content diff edition current
```

Sync only after reviewing the diff:

```bash
npm run content -- content sync edition current
```

Use the CLI workflow this way:

1. Edit Markdown articles and `content/edition.json` locally.
2. Run `npm run content -- content diff edition current`.
3. Confirm the diff changes only the intended records.
4. Run `npm run content -- content sync edition current`.
5. Verify the deployed site or GraphQL-backed local app.

If the task is only to inspect the live layout, do not sync. Query or diff
first.

## What You Are Authoring

You are not authoring CSS boxes. You are authoring a newspaper plan:

- which pages exist;
- which items appear on each page;
- which articles start or continue;
- which page a teaser jumps to;
- which regions share the page;
- which blocks use wide or narrow local column grids;
- which images, pull quotes, promos, ads, or rails are required or optional.

The solver owns the actual rectangles, line breaks, chosen image sizes, omitted
optional furniture, and page height.

## Mental Model

The layout hierarchy is:

```text
Edition.layoutPlan
  pages[]
    regions[]
      blocks[]
        local grid
        optional media / pull quote furniture
        Pretext text flow
```

Use this model when authoring:

- A page chooses a broad preset and responsive page grid.
- A region allocates an area of that page.
- A block places one content item or a small furniture cluster inside a region.
- `articleFrame` blocks may consume or resume article text with exact cursors.
- Media and pull quotes are solver-owned furniture. If they affect copy space,
  they must be in the layout plan before Pretext runs.

## Page Setup Checklist

For every new page:

1. Pick a `pageNumber`.
2. Pick a page `presetId`.
3. Set the page grid, usually `{ "columns": { "min": 1, "preferred": 6, "max": 6 } }`.
4. Add one or more `regions`.
5. Add blocks inside each region.
6. Reference content by stable `itemId` slug.
7. For article continuations, use the same `flowKey` as the teaser and set
   `startCursor: "current"`.
8. For front-page teasers that should continue, add
   `cutPolicy.jumpTargetPage`.
9. Add media/pull quotes as optional unless the page cannot work without them.
10. Run validation/build checks before committing.

Minimal page:

```json
{
  "id": "page-4",
  "pageNumber": 4,
  "presetId": "page.regionStack",
  "grid": { "columns": { "min": 1, "preferred": 6, "max": 6 } },
  "regions": [
    {
      "id": "page-4-main",
      "type": "fullPage",
      "blocks": [
        {
          "id": "some-article-page-4",
          "type": "articleFrame",
          "presetId": "article.standard",
          "itemId": "some-article",
          "flowKey": "some-article",
          "startCursor": "beginning"
        }
      ]
    }
  ]
}
```

## Current Layout Vocabulary

Page presets:

- `front.mosaic`: front page with teaser blocks and planned cutpoints.
- `page.regionStack`: vertical stack of one or more editorial regions.
- `page.railMain`: rail plus main content page.
- `page.full`: one full-page region.

Region types:

- `fullPage`: one region using the page body.
- `stack`: one band in a top/bottom page.
- `split`: a side-by-side region pattern.
- `railMain`: a rail/main structure.
- `strip`: a short horizontal strip region.

Block types:

- `articleFrame`: article-like text flow, including teasers and continuations.
- `itemFrame`: non-article item card/frame.
- `mediaCluster`: triptych or mosaic media cluster for one item.
- `itemStack`: corrections, briefs, masthead-style rail items.
- `promoStrip`: horizontal strip of linked items.
- `adBlock`: image ad or region ad placeholder.
- `rule`: simple separator.
- `masthead`: masthead/chrome block.

Article frame presets:

- `front.teaser`: front-page excerpt with optional planned jump.
- `article.standard`: headline/deck plus text columns, no required furniture.
- `article.mediaInset`: article text flowing around media/pull-quote obstacles.
- `article.mediaPrelude`: media cluster before headline/copy.

Media cluster presets:

- `media.triptych`: up to three images above or beside editorial content.
- `media.mosaic`: dominant image plus supporting images under one caption.

Ad presets:

- `ad.fullPage`
- `ad.region`

## Responsive Grids

The solver supports page column counts `6, 5, 4, 3, 2, 1`. It chooses the
largest count that preserves readable column width and forces one column on
mobile.

Use span policies everywhere a width should adapt:

```json
{ "min": 1, "preferred": 4, "max": 4 }
```

Rules of thumb:

- Use `preferred: 6` for broad article bodies that should use the whole page.
- Use `preferred: 4` for a strong center feature inside a six-column page.
- Use `preferred: 1` for rails, narrow teasers, and side notes.
- Keep `min` realistic. If `min: 4`, the block cannot preserve that shape on
  tablet/mobile and may become invalid or collapse poorly.
- For mobile-friendly features, use `min: 1` and a `collapse` policy on media.

## Media Placement

Media placement is responsive intent, not solved geometry:

```json
{
  "required": true,
  "assetRole": "lead",
  "placement": {
    "anchor": "center",
    "span": { "min": 1, "preferred": 4, "max": 4 },
    "vertical": "top",
    "collapse": "inline",
    "crop": "preserve",
    "wrapsText": false
  }
}
```

Anchors:

- `left`: start at the left edge of the local grid.
- `right`: end at the right edge of the local grid.
- `center`: center inside the local grid.
- `outer` / `inner`: reserved for alternating page-side semantics.
- `inline`: collapse into the text flow on narrow layouts.

Vertical placement:

- `top`
- `upperThird`
- `middle`
- `lowerThird`

Collapse policy:

- `inline`: use an inline/mobile-friendly placement.
- `fullWidth`: span all available columns when the preferred span cannot fit.
- `omit`: drop optional furniture when it cannot fit.

Crop policy:

- `preserve`: prefer the asset aspect ratio.
- `cropAllowed`: allow the solver/renderer to crop for a stronger editorial
  rectangle.

Use `required: true` only when the page design cannot work without media.
Optional media should be allowed to disappear if it collides, creates dead
columns, or makes copy fit worse.

## Pull Quotes

Pull quotes are display furniture. They do not consume the article cursor.

```json
{
  "required": false,
  "placements": [
    {
      "anchor": "right",
      "span": { "min": 1, "preferred": 1, "max": 2 },
      "vertical": "middle",
      "collapse": "omit",
      "crop": "preserve",
      "wrapsText": true
    }
  ]
}
```

Prefer optional pull quotes. A clean page without a pull quote is better than a
crowded page with overlapping furniture.

## Article Flow And Continuations

Use `flowKey` to connect excerpts and continuations for the same article.

Front-page teaser:

```json
{
  "id": "front-agent-procedure-patterns",
  "type": "articleFrame",
  "presetId": "front.teaser",
  "itemId": "agent-procedure-patterns",
  "flowKey": "agent-procedure-patterns",
  "startCursor": "beginning",
  "span": { "min": 1, "preferred": 4, "max": 4 },
  "cutPolicy": { "maxBodyLines": 22, "jumpTargetPage": 2 }
}
```

Continuation:

```json
{
  "id": "agent-procedure-patterns-page-2",
  "type": "articleFrame",
  "presetId": "article.mediaInset",
  "itemId": "agent-procedure-patterns",
  "flowKey": "agent-procedure-patterns",
  "startCursor": "current",
  "localGrid": {
    "columns": { "min": 2, "preferred": 6, "max": 6 }
  }
}
```

Rules:

- The first block for an article normally uses `startCursor: "beginning"`.
- Continuation blocks use `startCursor: "current"`.
- Keep `flowKey` stable across all blocks that should share cursor handoff.
- Put `jumpTargetPage` on the teaser block, not on the continuation block.
- Never store solved cursors, line positions, page heights, or selected media
  rectangles in JSON.

## Common Patterns

### Front Page: Left Rail, Center Feature, Right Rail

Use three top-row `articleFrame` blocks whose spans add to six:

```json
[
  {
    "id": "front-left-rail",
    "type": "articleFrame",
    "presetId": "front.teaser",
    "itemId": "schools-reading-lab",
    "flowKey": "schools-reading-lab",
    "startCursor": "beginning",
    "span": { "min": 1, "preferred": 1, "max": 1 }
  },
  {
    "id": "front-center-feature",
    "type": "articleFrame",
    "presetId": "front.teaser",
    "itemId": "agent-procedure-patterns",
    "flowKey": "agent-procedure-patterns",
    "startCursor": "beginning",
    "span": { "min": 1, "preferred": 4, "max": 4 },
    "media": [
      {
        "required": true,
        "assetRole": "lead",
        "placement": {
          "anchor": "center",
          "span": { "min": 1, "preferred": 4, "max": 4 },
          "vertical": "top",
          "collapse": "inline",
          "crop": "preserve",
          "wrapsText": false
        }
      }
    ],
    "cutPolicy": { "maxBodyLines": 22, "jumpTargetPage": 2 }
  },
  {
    "id": "front-right-rail",
    "type": "articleFrame",
    "presetId": "front.teaser",
    "itemId": "market-hall",
    "flowKey": "market-hall",
    "startCursor": "beginning",
    "span": { "min": 1, "preferred": 1, "max": 1 }
  }
]
```

### Front-Page Headline Scale

Front-page headline size must be controlled by editorial role, not by accidental
array position.

In a rail / feature / rail layout, the two one-column rails should have matching
headline treatment. The four-column center feature should be the visually larger
story. A common bug is making the first block in the array a left rail and then
letting the solver treat index `0` as the lead story. That makes the left rail
headline larger than the right rail headline even though both are one-column
side stories.

When authoring front-page blocks, set explicit roles:

```json
[
  {
    "id": "front-left-rail",
    "type": "articleFrame",
    "presetId": "front.teaser",
    "role": "rail",
    "itemId": "schools-reading-lab",
    "flowKey": "schools-reading-lab",
    "startCursor": "beginning",
    "span": { "min": 1, "preferred": 1, "max": 1 }
  },
  {
    "id": "front-center-feature",
    "type": "articleFrame",
    "presetId": "front.teaser",
    "role": "feature",
    "itemId": "agent-procedure-patterns",
    "flowKey": "agent-procedure-patterns",
    "startCursor": "beginning",
    "span": { "min": 1, "preferred": 4, "max": 4 },
    "media": [
      {
        "required": true,
        "assetRole": "lead",
        "placement": {
          "anchor": "center",
          "span": { "min": 1, "preferred": 4, "max": 4 },
          "vertical": "top",
          "collapse": "inline",
          "crop": "preserve",
          "wrapsText": false
        }
      }
    ]
  },
  {
    "id": "front-right-rail",
    "type": "articleFrame",
    "presetId": "front.teaser",
    "role": "rail",
    "itemId": "market-hall",
    "flowKey": "market-hall",
    "startCursor": "beginning",
    "span": { "min": 1, "preferred": 1, "max": 1 }
  }
]
```

If `role` is not currently honored by the solver, fix the solver before trying
to work around this in content. The expected rule is:

- `role: "feature"` or a wide media-led teaser gets feature headline metrics.
- `role: "rail"` gets rail headline metrics.
- One-column side stories in the same row get matching headline metrics.
- Do not infer lead typography from `index === 0`.

For the current GraphQL edition, inspect the live `Edition.layoutPlan` before
changing it. The front page is stored in the cloud, not only in
`content/edition.json`; use `npm run content -- content diff edition current`
before syncing.

### Shared Continuation Page

Use `page.regionStack` with two `stack` regions:

```json
{
  "id": "page-3",
  "pageNumber": 3,
  "presetId": "page.regionStack",
  "grid": { "columns": { "min": 1, "preferred": 6, "max": 6 } },
  "regions": [
    {
      "id": "top-tail",
      "type": "stack",
      "role": "top",
      "size": { "ratio": 0.5 },
      "blocks": [
        {
          "id": "schools-reading-lab-page-3",
          "type": "articleFrame",
          "presetId": "article.mediaInset",
          "itemId": "schools-reading-lab",
          "flowKey": "schools-reading-lab",
          "startCursor": "current",
          "localGrid": { "columns": { "min": 4, "preferred": 6, "max": 6 } }
        }
      ]
    },
    {
      "id": "bottom-tail",
      "type": "stack",
      "role": "bottom",
      "size": { "ratio": 0.5 },
      "blocks": [
        {
          "id": "market-hall-page-3",
          "type": "articleFrame",
          "presetId": "article.mediaInset",
          "itemId": "market-hall",
          "flowKey": "market-hall",
          "startCursor": "current"
        }
      ]
    }
  ]
}
```

### Four-Column Article Inside A Six-Column Page

Set the page grid to six, but the article block local grid to four:

```json
"grid": { "columns": { "min": 1, "preferred": 6, "max": 6 } }
```

```json
"localGrid": { "columns": { "min": 2, "preferred": 4, "max": 4 } }
```

Use this for an article that should feel narrower than the full broadsheet
width while still living inside a six-column page system.

## Authoring Workflow

1. Identify the publication items by slug.
2. Decide page preset, region structure, and block order.
3. Assign spans that make sense at six columns first.
4. Add local grids when a block should have a different column system than the
   page.
5. Add media and pull-quote specs only when they are part of the editorial
   design.
6. Add `requires` for hard content constraints such as item type, minimum words,
   maximum words, minimum images, or image role.
7. Validate with `npm run typecheck`.
8. Run `npm run build`.
9. If changing behavior, add or update BDD scenarios and run `npm run test:bdd`
   against a running app.

## Hard Rules

- Do not add DOM measurement loops or CSS line clamps to solve newspaper copy.
- Do not make React choose layout variants.
- Do not store solved geometry in `layoutPlan`.
- Do not silently ignore missing required articles or media.
- Do not make every block required. Optional furniture is how the solver avoids
  crowded or awkward pages.
- Do not use fixed pixel layout in JSON. Use spans, anchors, region ratios,
  presets, and semantic requirements.
- Preserve exact cursor handoff: no duplicated or skipped article text.

## When To Change TypeScript

Change `content/edition.json` when the existing vocabulary can describe the
page.

Change `lib/layout-plan.ts` and `lib/newspaper-layout.ts` when you need a new
reusable layout concept, such as a new page preset, region type, block type,
media cluster preset, scoring rule, or obstacle behavior.

When adding a new JSON field:

- Add it to the Zod schema in `lib/layout-plan.ts`.
- Normalize/validate it before the solver sees it.
- Use it in the solver, not in React effects.
- Add BDD coverage when it changes visible layout behavior.
