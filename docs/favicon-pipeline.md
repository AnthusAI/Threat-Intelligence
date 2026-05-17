# Favicon Generation Pipeline

Papyrus favicon assets are generated from the Lucide `newspaper` icon with
theme colors pulled from `app/globals.css`.

## Inputs

- Icon source: `node_modules/lucide-static/icons/newspaper.svg`
- Theme tokens: `--paper` and `--ink` from `app/globals.css`
- Tuning config: `scripts/favicon/favicon.config.json`

## Generate

Run:

```bash
npm run favicon:generate
```

This script will:

- Resolve light/dark colors in a headless Playwright browser context.
- Apply configured `final.strokeWidth` and `final.padding`.
- Write production assets:
  - `public/icon-light.png`
  - `public/icon-dark.png`
  - `public/icon.png`
- Write local tuning previews:
  - `scripts/favicon/previews/icon-preview-light.png`
  - `scripts/favicon/previews/icon-preview-dark.png`

Preview PNGs are gitignored and should be regenerated locally as needed.

## Runtime Behavior

Papyrus metadata uses a light PNG favicon by default. At runtime,
`app/layout.tsx` applies `window.matchMedia("(prefers-color-scheme: dark)")`
to switch between `icon-light.png` and `icon-dark.png`.

This keeps light mode as the deterministic fallback and avoids SVG favicon
selection quirks in Safari. The layout also appends a version query string to
favicon URLs to force cache refresh when favicon behavior changes.

## Tune

Edit `scripts/favicon/favicon.config.json`:

- `final.strokeWidth`, `final.padding`: production icon values.
- `preview.strokeWidths`, `preview.paddings`: candidate matrix values for
  preview grids.

Regenerate after each change:

```bash
npm run favicon:generate
```

## Current Production Selection

- `final.strokeWidth`: `1.6`
- `final.padding`: `0`
