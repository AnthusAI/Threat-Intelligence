# Vertical Rhythm Skill (Newsroom)

Use this skill when a Papyrus Newsroom UI surface looks visually "off-grid"
against the rhythm overlay, especially after typography, control, or spacing
changes.

This skill is for **layout alignment** only. Do not change product behavior,
data flow, filters, or interaction semantics while doing rhythm work.

## Scope

- Primary target: `/newsroom/*` surfaces.
- Primary stylesheet: `app/globals.css`.
- Typical affected components:
  - detail headers and metadata rows
  - card list/grid rows
  - filter bars and toolbar controls
  - form controls and select rows

## Core Contract

Papyrus geometry must follow `--paper-rhythm` row units.

- Spacing/sizing should be rhythm multiples.
- Text rows that must sit on-grid should use explicit rhythm line-height.
- Allowed exceptions:
  - `1px` hairlines/rules/borders
  - fixed icon glyph box sizes

When a `1px` border exists on a rhythm row, compensate with:

- `padding-top: calc(var(--paper-rhythm) - 1px)`
- `padding-bottom: calc(var(--paper-rhythm) - 1px)`

or equivalent geometry that keeps total block height on rhythm.

## Common Failure Modes (Seen In Newsroom References)

1. **Mixed leading tokens in strict rows**
   - Problem: row uses `--news-desk-text-leading` (or decimal line-height) in a
     section that should be strict rhythm.
   - Fix: force `line-height: var(--paper-rhythm)` for that row/cell.

2. **Implicit row growth from wrapping**
   - Problem: metadata/date cells wrap (`UNDATED`, long ids/urls), making row
     height non-rhythm.
   - Fix for single-row cells:
     - `white-space: nowrap`
     - `overflow: hidden`
     - `text-overflow: ellipsis`

3. **Height not hard-locked for control rows**
   - Problem: control/select rows visually drift.
   - Fix: set full contract:
     - `height`, `min-height`, `max-height` to same rhythm multiple.

4. **Double spacing from sibling rules**
   - Problem: two adjacent selectors both add top margin, creating accidental
     extra rows.
   - Fix: define adjacency spacing explicitly (`A + B`) and zero conflicting
     overrides.

5. **Card chrome not rhythm-compensated**
   - Problem: border + padding produce heights like `... + 1px` drift.
   - Fix: use rhythm-compensated padding with hairline borders.

## Implementation Checklist

1. Identify the exact DOM node drifting in DevTools.
2. Read computed `height`, `line-height`, `padding`, `border`.
3. Replace decimal/px ad-hoc geometry with rhythm tokens.
4. For strict one-row text/control cells, enforce full row contract:
   - `line-height`, `min-height`, and where needed `height/max-height`.
5. Add nowrap/ellipsis only for fields intended to remain single-row.
6. Re-check adjacency margins between neighboring rows/blocks.
7. Re-check with rhythm overlay at current zoom and at 100%.
8. Run `npm run -s typecheck`.

## Quick Debug Heuristic

If DevTools shows non-rhythm heights (for example `19.44px`, `41.04px`,
`61.55px`) in strict rows, you still have mixed leading, wrapping, or
uncompensated border/padding.

## Change Discipline

- Keep fixes localized to Newsroom selectors.
- Avoid broad global typography changes when only one desk row is drifting.
- Do not add compatibility fallbacks or alternate legacy paths.
