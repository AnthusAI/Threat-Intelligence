# Produce Video (Threat Intelligence / Papyrus seed editions)

Use this skill when generating or updating narrated MP4 videos for Threat Intelligence seed
editions: video-form articles and the long-format edition video.

## Purpose

Threat Intelligence videos are **the article in video form** — not teasers, not previews, not
generic motion graphics. A viewer who presses play gets the article's full argument, adapted for
the ear:

- **Article videos** (`<slug>.mp4`): the article itself as a ~2–3 minute video. Same substance,
  same pictograms and styling, same quotes — adapted per format, not word-for-word. Written **in
  tandem** with the article body: when the body changes, revisit the video scenes in the same
  change.
- **Edition overview** (`edition-overview.mp4`): a long-format video presenting the content of
  the whole edition — every article covered, edited down but substantive (minutes, not seconds;
  not a one-line-per-article summary). Reuses each article's pictogram and strongest quote; lead
  articles get fuller segments. Assembled by condensing the article videos' scenes after those
  exist.

**No pre-roll.** The first scene is article content, given to the viewer "for free" — never
"welcome to another edition of…", never a masthead. All branding lives in the standardized
**post-roll** the pipeline appends (see below).

Voice tone: practical, calm, editorial — “mission briefing” not marketing hype.

## Branding (Threat Intelligence blog dark mode)

Videos must match the **Threat Intelligence blog dark-mode reader theme** in `app/globals.css`
(`:root[data-site-brand="threat-intelligence"]` with dark color scheme), not generic blue SaaS
gradients.

Canonical video palette (approximate hex from Radix sand-dark + tomato accent):

| Token | Hex | Use |
|-------|-----|-----|
| `--color-bg` / paper | `#191918` | Flat scene background (no gradients) |
| surface | `#21201c` | Cards / quote panels |
| text | `#eeeeec` | Headlines |
| text muted | `#b5b3ad` | Decks, excerpts |
| `--ti-alarm-red` / `--ti-section-rule` | `#e54d2e` (Radix tomato-9 dark) | Masthead wordmark, CTA title, quote accent, section rule bars |
| `--ti-pictogram-throb` | `#ac4d39` (Radix tomato-8 dark) | Pictogram pulse accent |
| pictogram edge / node | `#363a3f` / `#2e3135` (Radix slate-6 / slate-5 dark) | Pictogram strokes and fills |

Backgrounds are **flat solid `#191918` paper** — no gradient bands. This matches the TI blog brand language.

Typography intent: Helvetica Neue / system sans stack, weight **900** on headlines and section eyebrows (same as TI blog display type).

Section eyebrows on title slides mimic the blog **section header** (`.presentation-section-header`): two red bars as tall as the eyebrow text, flanking the label on both sides, with the label centered on a page-background chip. Use `var(--ti-alarm-red)` (Radix tomato-9) for all brand reds — do not substitute lighter or legacy accent hex values.

Implementation lives in `src/papyrus_content/video_pipeline.py` as `TI_SCENE_STYLES_DARK` and
`TI_BACKGROUND_PROPS_DARK`. Update those constants when the blog theme changes — do not hard-code
alternate palettes in one-off DSL files.

## Light and dark dual-render

Threat Intelligence videos support both dark and light reader themes. The render pipeline
produces two MP4s per video: a dark default (`<slug>.mp4`) and a light variant
(`<slug>-light.mp4`).

### Light palette

| Token | Hex | Use |
|-------|-----|-----|
| `--color-bg` / paper | `#f9f9f8` (sand-2 light) | Flat scene background |
| surface | `#fcfcfc` (sand-1) | Cards / quote panels |
| text | `#44403c` (sand-12) | Headlines |
| text muted | `#696964` (sand-11) | Decks, excerpts |
| `--ti-alarm-red` / `--ti-section-rule` | `#c54028` (Radix tomato-11) | WCAG-compliant on light paper |
| `--ti-pictogram-throb` | `#d9542e` (tomato-8 light) | Pictogram pulse accent |
| pictogram edge / node | `#889096` (slate-8 light) | Pictogram strokes and fills |

Light tomato uses `tomato-11` (`#c54028`) for WCAG contrast on `#f9f9f8` paper — do not use
the dark-mode `tomato-9` (`#e54d2e`) on light backgrounds.

Implementation: `TI_SCENE_STYLES_LIGHT` and `TI_BACKGROUND_PROPS_LIGHT` in
`src/papyrus_content/video_pipeline.py`. Theme selection via `scene_styles_for_theme(theme)`
and `background_props_for_theme(theme)`.

### Render command

```bash
# Render all 14 MP4s (7 dark + 7 light) — default, 3 parallel jobs
poetry run papyrus videos seed

# Render with more parallelism (each job spawns a headless Chromium)
poetry run papyrus videos seed --jobs 4

# Render only one theme
poetry run papyrus videos seed --theme dark
poetry run papyrus videos seed --theme light

# Render one article in both themes
poetry run papyrus videos render --article <slug> --theme both
```

The `--jobs` flag controls parallel renders (default: `3`). Each job renders one video's themes sequentially (dark before light) so the light variant reuses the dark variant's TTS cache. Different videos run in parallel since each has its own work directory (`videoml-work/<slug>/`).

Babulus caches TTS segments by text content hash, not visual styles. Since the voiceover text is identical across themes, the light render reuses the dark render's cached TTS with zero OpenAI API calls.

### Data flow

- Seed JSON `video.themeVariants.light.src` → `MediaAsset.metadata.themeVariants.light.sourceUrl` (GraphQL)
- Reader: `ArticleVideoFigure` uses `useResolvedPapyrusTheme()` + `resolveThemedVideoSrc()` to pick the matching `<video>` src at runtime
- The `<video>` element is keyed by src so React re-mounts on theme switch

## Pictograms (required)

Every article video scene should show the article **React pictogram** (same components as the blog):

- Source of truth: article **slug** → registry in [`lib/threat-intelligence-pictograms.ts`](../../lib/threat-intelligence-pictograms.ts) and SVG art in [`components/pictograms/pictogram-art.tsx`](../../components/pictograms/pictogram-art.tsx)
- Legacy `public/seed-art/threat-intelligence/*.svg` pictogram files are **removed** — do not reintroduce them
- VideoML DSL uses `<ti-title-slide>` with `pictogramSlug` and `pictogramSize` props (not `title-slide` + embedded SVG data URIs)
- Rendering uses a Papyrus browser bundle built by `npm run videoml:bundle` → `public/videoml/ti-browser-bundle.js`, wired via `BABULUS_BROWSER_BUNDLE` during `vml pipeline`
- Pictogram motion is **frame-driven** ([`lib/pictogram-video-motion.ts`](../../lib/pictogram-video-motion.ts)) so animation syncs with video frames

Edition overview spotlights use the same slug-based pictogram per featured article.

Build the browser bundle before rendering (automatic when using `poetry run papyrus videos seed`):

```bash
npm run videoml:bundle
```

## VideoML components

Always include visual `<layer>` elements. Voice-only DSL produces blank frames.

Preferred components:

- `video-background` — flat TI paper backdrop (`variant: solid`, dark `#191918` or light `#f9f9f8`)
- `ti-title-slide` — animated React pictogram + eyebrow / title / subtitle header (lead articles)
- `title-slide` — text-only scenes (e.g. closing)
- `quote-card` — pull-quote scenes

Do not ship scenes with `<voice>` cues only.

## Content policy

### Authoring `video.scenes` (video-form articles)

A `video` block (article or edition) with a `"scenes"` array is rendered scene-by-scene, in
order, with the standard post-roll appended by the pipeline. Two scene kinds, mapped onto the
existing components — no new browser components needed:

```json
{ "kind": "quote", "quote": "…", "attribution": "Mission", "voice": "…" }
{ "kind": "slide", "eyebrow": "…", "title": "…", "subtitle": "…", "pictogram": "slug-or-omit", "voice": "…" }
```

- `quote` → `quote-card`. `slide` → `ti-title-slide` (pictogram/eyebrow-rule) or `title-slide`.
- `voice` is required on every scene: it is the narration. Display fields are what's on screen —
  short, poster-legible, not a transcript of the voice. Same substance, adapted per medium.
- Scene ids are auto-generated (`scene-1`, `scene-2`, …). Do **not** author a closing/branding
  scene — the pipeline appends the post-roll.

Writing rules for scenes:

1. **Cold-open into content.** Scene 1 is article substance — usually the article's
   `pullQuotes[0]` as a quote scene. It is also the index poster (see poster rule below).
2. **Cover the full argument.** Target ~350–450 spoken words (~2–2.5 min) per article video:
   opening claim, the concrete example/scenario, the key metaphor or quote beats, the shift, the
   "what to check now" checks (condensed to spoken form), the article's closing thought. Edit the
   body down for the ear — don't read it verbatim, and don't drop its substance.
3. **A headline slide early is content, not branding** — an article opens with its headline. But
   its voice narrates the claim (headline + deck adapted); it never speaks the publication name
   as a welcome.
4. **Quote scenes follow the verbatim policy**: any displayed quote must occur verbatim in the
   article body.
5. **The echo rule applies between adjacent scenes** (see below) — read the whole voice script
   aloud in order before rendering.
6. **In tandem:** article body edits and scene edits ship together. A body change that makes a
   scene stale is a bug in the change.

**Edition overview scenes** (long-format, all 18 articles, currently ~875 words ≈ 6 min):
hook quote (edition `video.hook`) → edition thesis slide → section-by-section segments. **Lead
articles** get a pictogram slide (~55–70 spoken words, core argument) and, where one earns it, a
quote scene; **non-leads** get one slide each (~30–55 words: headline + central move + sharpest
check), with the section carried by the `eyebrow` field — no spoken section interstitials. Brief
spoken transitions at desk boundaries ("On to the cloud desks…") keep it a narrated whole rather
than a slideshow.

### Scene order (legacy fallback — articles without `video.scenes`)

Articles that have not yet been converted render the legacy teaser structure:

**Article briefings:** hook (cold-open pull quote, if present) → title (pictogram + section eyebrow + headline + deck) → briefing excerpt → second pull quote (if present) → post-roll.

**Edition overview:** hook (edition `video.hook`; falls back to first lead article's `pullQuotes[0]`) → title (edition title + first lead pictogram + tagline) → edition teaser (date + "In this edition" + headline list) → six spotlights → post-roll. This fallback stands until the long-format edition scenes are authored.

**Reader placement:** edition overview video on the blog index just above the first section header; article videos on index cards below excerpt/pictogram; article pages show video above title/deck with pictogram in body.

No separate brand-only intro scene anywhere.

### Writing for narration (seed copy contract)

For scenes-driven videos, narration is the authored `voice` fields. For the **legacy fallback**,
every narrated word comes from seed JSON fields. Scene → source:

| Scene | Voice source |
|-------|--------------|
| Hook (cold open) | article videos: `pullQuotes[0]`; edition overview: edition `video.hook` (fallback: first lead's `pullQuotes[0]`) |
| Title | `headline` + pause + `deck` |
| Briefing (article videos) | full `excerpt` |
| Overview spotlight | `headline` + **first sentence** of `excerpt` (fallback: `deck`) |
| Overview teaser | edition `description` + fixed "This edition features…" line |
| Post-roll | fixed CTA (see below) |

Rules that follow from this (the echo rule, poster rule, and verbatim-quote policy apply to
authored scenes just as much as to the fallback):

- **Excerpts are condensed article representations** (~160–215 words): index display plus summary, no longer 1–2-sentence hooks. They are the condensation *guide* when authoring `video.scenes`, not the script — scenes are written from the body.
- **First-sentence contract (legacy fallback only).** The legacy overview spotlight speaks `headline` + the excerpt's first sentence; the splitter breaks on `.` `!` `?` but NOT on em dashes or semicolons, and the sentence renders on screen truncated at 180 characters. Only matters for videos still on the fallback.
- **The legacy fallback is not publishable anymore.** With long excerpts, the fallback narrates ~180 words over one static slide showing 240 characters — a frozen minute. Every published video needs authored `video.scenes`.
- **Adjacent-scene echo rule.** The hook quote and the deck are spoken ~10 seconds apart; do not let them share distinctive phrasing (a hook of "tireless automation / tireless analysis" followed by a deck opening "Attackers bring tireless automation" reads fine on the page and grates when spoken). Likewise the overview opens tagline → `description` → fixed "practical checks" line back-to-back: keep "practical" (and other tagline words) out of `description`.
- **Deck = claim.** The deck states the thesis in one or two tight sentences and feeds the video's headline-slide voice; the excerpt summarizes the article for the index and must not merely restate the deck.
- **Pull quotes are verbatim body sentences.** `pullQuotes` are narrated cold opens and must occur verbatim in the article body; video-lead articles require `pullQuotes[0]`. Not every article needs a pull quote — drop a weak one rather than keeping a paraphrase. When weaving, never leave the quote adjacent to the sentence that used to paraphrase it.
- **Scene 1 is the poster.** Embedded videos render their first frame on the index, so `pullQuotes[0]` (and the edition `video.hook`) is display copy at headline size. Poster-grade means two short sentences, roughly 12 words each, no clause-piles or service lists — "Four ordinary findings. One path." over "AWS defense is correlation work: one finding becomes urgent when it connects to identity, data, keys, and activity." The echo rule applies doubly here: the poster sits on the same card as the headline and deck.
- **Edition hook (`video.hook`).** One edition-wide line that opens the overview video and its poster, so the edition video and the first lead article's video do not show the same quote card twice on one page. Write it in the "before → now with AI" register when it fits, and end on an invitation to press play.

### Pre-render script check

Before rendering, proofread what will be *spoken*, not just what the JSON says:

1. Simulate the full voice script for every video — authored `scenes[].voice` in order plus post-roll, and the legacy fields for unconverted videos — and read it end-to-end. Check: no dangling teases, no word pile-ups across adjacent scenes, ~350–450 spoken words per article video, spotlight subtitles ≤ 180 chars (legacy).
2. The edition's topic and vocabulary constraints apply to narrated words too — narration is public content. Run the same vocabulary checks used for article copy against every field the videos read (`scenes[].voice`, `scenes[].quote`, `headline`, `deck`, `excerpt`, `pullQuotes`, `description`).
3. Verify quote-scene text (and `pullQuotes`) still occurs verbatim in the article body — body edits can silently orphan a quote. If rendering from a git worktree, confirm its seed JSON matches the canonical copy first.

### Post-roll (every video)

The one branding block, standardized and **pipeline-appended** (`post_roll_scene()` in
`video_pipeline.py`) — never authored per-video, never varied per-video:

Slide: eyebrow `Learn more — {edition date} edition`, title `THREAT INTELLIGENCE` in tomato red (`--ti-alarm-red`), subtitle = tagline.

Voice: `To learn more, check out the {edition date} edition of Anthus Threat Intelligence. {tagline}`

Edition date comes from seed `publishDate` (formatted as `July 4, 2026` on slides and in voice).

### Other rules

- **Article videos say what the article says.** Adapted for the ear, not read verbatim — but the
  video must not add claims the article doesn't make, and must not drop the article's checks.
- Do not invent facts, incidents, or vendor claims not present in seed article copy.
- After re-rendering, re-measure and update `durationSeconds` (and captions/alt text if the
  format changed) in the seed `video` blocks.
- Keep OpenAI keys in `.papyrus/config.yaml` (`openai.api_key`) or `OPENAI_API_KEY`; never commit keys.

## Commands

```bash
# Worktree without local .papyrus/
export PAPYRUS_CONFIG=/path/to/.papyrus/config.yaml

# Render edition overview + all six lead article videos
poetry run papyrus videos seed

# Render only edition overview
poetry run papyrus videos render --edition-overview

# Render one article
poetry run papyrus videos render --article the-balance-of-power-is-shifting
```

Outputs (gitignored):

```text
public/seed-art/threat-intelligence/videos/edition-overview.mp4
public/seed-art/threat-intelligence/videos/<slug>.mp4
```

Reader URLs: `/seed-art/threat-intelligence/videos/...` (served directly from `public/`).

Upload during Amplify seed: `PAPYRUS_SEED_VIDEOS=1 npm run seed:amplify`

## Seed fixture contract

- Edition video: top-level `video` block in
  `publications/threat_intelligence/seed/seed-edition-content.json`
- Article videos: per-article `video` blocks on the six lead-pictogram articles
- `video.scenes` (article or edition) = the authored video-form script; absent → legacy fallback.
  Exemplar: the Balance article (`the-balance-of-power-is-shifting`).
- Edition video is copied into `Edition.metadata.editionVideo` during seed
- Blog reader shows edition video below the masthead via `EditionContent.editionVideo`

## When changing this pipeline

1. Read this skill and `publications/threat_intelligence/docs/video-pipeline.md`.
2. Update `publications/threat_intelligence/videoml/video_pipeline.py` (single source for theme + DSL).
3. Re-render with `poetry run papyrus videos seed`.
4. Verify a extracted frame is not solid black and pictograms are visible.
5. Update tests in `publications/threat_intelligence/tests/test_video_pipeline.py` if DSL shape changes.

## Improvement ideas (not yet implemented)

Future pipeline options — listed so nobody mistakes them for current behavior:

- **`--script-only` dry run**: a mode that prints the assembled voice script for all videos without TTS or render cost, making the pre-render script check a one-command step instead of a scratch script.
- ~~`video.voiceHook` override~~ — superseded by authored `video.scenes`, which decouple narration from index copy entirely.
- **Overview spotlight cadence** (legacy fallback only): six identical headline+tease scenes in a row is monotonous; the authored long-format edition scenes solve this by design — vary quote and slide scenes per segment.
- **Long-format edition scenes**: once all six article `video.scenes` exist, author the edition overview's scenes by condensing them — one segment per article (headline slide + strongest beat), lead articles fuller, reusing pictograms and quotes verbatim.
