# Papyrus Layout System

This document describes the current newspaper layout rules that are easy to
forget because many of them are enforced in the solver and BDD scenarios rather
than in prose.

## Ownership Model

Papyrus pages are solved layouts. The edition `layoutPlan` stores editorial
intent, `lib/newspaper-layout.ts` turns that intent into concrete geometry, and
React renders the solved result.

- Use `lib/layout-plan.ts` when changing the layout-plan language.
- Use `lib/newspaper-layout.ts` when changing how geometry, text, furniture, or
  page heights are solved.
- Use `components/newspaper.tsx` and `app/globals.css` only to render solved
  values, pass CSS variables, and style already-solved geometry.
- Do not use React effects, DOM reads, browser columns, CSS line clamps, or
  `getBoundingClientRect()` loops to decide newspaper copy fit.

If a visual element changes available copy space, model it as solver-owned
geometry before Pretext measures text.

## Vertical Rhythm

The solver owns the rhythm contract. `NewspaperLayout.rhythm.rowHeight` is the
common vertical row:

- `19px` for normal and wide layouts.
- `18px` for narrow layouts.

Every solved page height, page chrome block, region, article block, body frame,
furniture obstacle, caption reserve, and measured-line top should land on whole
rhythm rows. Use the solver helpers for that work:

- `snapUpToRhythm`
- `snapDownToRhythm`
- `snapToNearestRhythm`
- `reserveRhythmRows`
- `clampRhythmHeight`

Do not add independent CSS vertical measurements for solved copy areas. Renderer
CSS should consume variables such as `--paper-rhythm`, `--page-height`,
`--masthead-height`, `--inside-header-height`, and solved furniture dimensions.

The rhythm overlay is diagnostic only. `Control+=` toggles it in the edition and
archive shells. The overlay must scroll with the document and must not affect
layout, hit testing, or copy fitting.

## Mastheads And Page Chrome

Use newspaper vocabulary precisely:

- The `nameplate` is the large title wordmark area.
- The `metadata strip` is the one-row line containing date, tagline, and edition
  label.
- The visible front-page masthead chrome is the nameplate plus metadata strip.

Current front-page geometry steps down with the solved page column count:

| Page columns | Total masthead chrome | Title line box |
| --- | ---: | ---: |
| `6`, `5`, or `4` | `6` rhythm rows | `4` rhythm rows |
| `3` or `2` | `5` rhythm rows | `3` rhythm rows |
| `1` | `4` rhythm rows | `2` rhythm rows |

In compact mastheads, keep all three metadata fields visible. Move the left and
right metadata fields into the row above the nameplate, keep the center metadata
field below it, and spend the remaining rows on the title line box.

The wide front-page geometry is:

- Nameplate: `5` rhythm rows.
- Title line box: `4` rhythm rows.
- Title top margin: `0.5` rhythm row.
- Title bottom margin: `0.5` rhythm row.
- Metadata strip: `1` rhythm row.
- Total front masthead chrome: `6` rhythm rows.

The title glyphs use an optical shift token because the visible Playfair ink
sits low inside its line box. Keep that as a chrome token
(`mastheadTitleOpticalShift`) instead of a local CSS guess.

Masthead rules are optical ornamentation. The rhythm-aligned rules may sit on
rhythm boundaries, while bonus rules are allowed to sit outside the rhythm flow.
Bonus rules must not consume solver height.

Archive masthead semantics are different:

- The archive masthead is a five-row `ARCHIVE` nameplate only.
- `Previous editions` is accessible description text, not a visible subtitle row
  inside the masthead.
- The archive grid substrate starts immediately below the five-row nameplate and
  provides exactly one neutral-gray rhythm row before the first previews.

## Front Mosaic Recipes

The front page uses the `front.mosaic` preset with `articleFrame` teaser blocks.
Wide-screen placement and narrow reading order are separate concerns:

- `role` describes the visual job, such as `feature` or `rail`.
- `typography.headlineScale` describes the headline treatment: `banner`,
  `feature`, `standard`, `rail`, or `brief`.
- `editorialPriority` describes collapsed reading order: `primary`,
  `secondary`, `tertiary`, or `supporting`.

Use `responsiveLayouts` on the front region when the wide layout should collapse
into a deliberately different recipe at lower column counts.

Current defaults:

- `5` and `6` columns keep the wide mosaic behavior.
- `4` columns use the feature-top recipe: the primary story spans all four
  columns on row 1; the two secondary stories split row 2 two-up.
- `3`, `2`, and `1` columns use `editorialPriority` order with full-width
  stacking.

Responsive recipes are selected by active solver column count, not by device
name. Avoid naming rules after tablets or phones.

## Article Frame Composition

Use `articleFrame.composition` when front-page chrome and furniture need
newspaper-style placement on a local grid.

- `title` slots reserve chrome above the article body.
- `lead` slots become display obstacles inside the article body.
- `deck`, `byline`, `media`, and `pullQuote` slots do not consume article text.
- The article cursor advances only through measured body copy.

Composition modes are solver-owned. At one column, composed media stacks below
title chrome, then body copy starts at least one rhythm row below the media
package. At three columns, the feature headline stays full-width above the media
inset so long words do not collide with a one-column headline rail. Wider
layouts can use top-right media insets with copy flowing beside and below them.

Composed sibling columns must share a copy band. The solver computes a shared
`copyBandTop` so one column cannot begin a row earlier than another merely
because adjacent lead furniture is shorter.

## Continuations And Cursors

Continuation routing is planned, not emergent.

- Front teasers start with `startCursor: "beginning"`.
- Continuation blocks resume with `startCursor: "current"`.
- Keep `flowKey` stable for every block that belongs to the same text stream.
- Put `cutPolicy.jumpTargetPage` on the teaser block.
- Never store solved cursors, line positions, selected furniture, or page
  heights in `layoutPlan`.

The source of truth for copy handoff is `PlacedTextRange`. A continuation should
never duplicate or skip article text. If a front teaser used an image asset, the
same article flow records that asset as used so continuation candidates cannot
repeat it.

Continuation title chrome is intentionally compact. It should not render a rule
above the first body line, and the gap from continuation headline to copy should
stay no larger than one rhythm row.

## Height Policies

The default newspaper behavior is fill-oriented: regions and blocks try to use
their allocated newspaper space so the page feels designed rather than merely
content-sized.

Use explicit height policy only when the default fill behavior is wrong:

- `region.size.shrinkToContent: true` collapses unused trailing region
  allocation after the blocks solve.
- `articleFrame.size.defaultRows` offers an article block an editorial target
  height in rhythm rows.
- `articleFrame.size.shrinkToContent: true` lets a block with `defaultRows`
  collapse below that target when the solved content is shorter.

Continuation blocks must still exhaust remaining text. They may grow beyond
`defaultRows` when needed.

## Adaptive Furniture

Images and pull quotes are solver-owned furniture. They become text obstacles
before Pretext lays out copy.

General rules:

- Prefer optional furniture unless the page design cannot work without it.
- Optional media and pull quotes may fall back to no furniture.
- Required media is only forced when a reusable asset exists and the solved
  candidate passes sufficiency checks.
- Furniture must not overlap other furniture or measured lines.
- Text-only candidates are valid fallbacks, not the preferred outcome when
  usable furniture improves the page.

Furniture sufficiency protects readability. Candidate furniture can be rejected
when it consumes too much row-column burden, creates dead columns, leaves too few
visible copy rows, or creates a one-row non-final text column.

Pull quotes are editorial content, not generated text. Their height should be
based on the rendered quote plus rule/padding, snapped to rhythm rows. They
should not use a background fill, and body copy below them should leave one
blank rhythm row after the pull quote package.

## Images And Captions

Images use reusable `ArticleImageAsset` records from normalized publication
items. The solver chooses aspect-preserving or crop-allowed rectangles according
to the media placement spec.

Captions are part of the image furniture package:

- They are italic, smaller than body copy, and rhythm-aligned.
- They reserve as many whole rhythm rows as needed to render the complete
  caption.
- They do not use a background fill.
- Body copy below an image package must leave one blank rhythm row after the
  caption.
- Captions should not push down adjacent columns unless the solved obstacle
  intentionally covers those columns.

If a caption changes available copy space, update the solved furniture height
before text is measured. Do not let CSS clipping or overflow decide the result.

## Front Footer

The front footer is front-page newspaper chrome, not a global web footer.

- It renders only on the front page.
- Its margin, row height, and total height are solver-owned rhythm rows.
- Section links come from placed front-page article sections.
- `Archive` links to `/archive`.
- `Log in` is currently disabled until auth wiring exists.

## Archive

The archive is a browsing surface for previous editions. It is not a solved
newspaper page, but it participates in the shared rhythm system.

- `/archive` server-renders the first batch of front-page previews.
- `/api/archive/editions` lazy-loads additional batches, capped at 12.
- `ArchiveGrid` appends batches through an `IntersectionObserver` sentinel and
  avoids duplicate edition ids.
- `NewspaperFrontPreview` solves each edition at canonical preview dimensions
  and scales the solved first page into a card.
- The archive shell supports the same `Control+=` rhythm overlay as the edition
  shell.
- The masthead/header and card labels sit on paper texture.
- The grid substrate and gaps use neutral `rgb(128, 128, 128)`.
- Phone layouts keep a two-column thumbnail grid by default.

Do not describe the archive as “front pages” in visible masthead copy. The
visible nameplate is `ARCHIVE`.

## BDD Coverage

Every durable layout rule should have a readable scenario in
`features/newspaper-layout.feature` and, when needed, a named fixture in
`lib/layout-scenarios.ts`.

Scenarios should assert both:

- solver decisions exposed through `window.__PAPYRUS_LAYOUT__`; and
- rendered geometry from Playwright DOM rectangles.

Use BDD for vertical rhythm, cursor handoff, no cropped measured lines,
responsive front recipes, no furniture overlap, image captions, pull quote
sufficiency, archive rhythm, and height policy behavior.
