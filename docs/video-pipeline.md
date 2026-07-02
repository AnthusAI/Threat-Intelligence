# Video pipeline (Threat Intelligence seed edition)

Papyrus can generate narrated summary videos for Threat Intelligence seed articles using [VideoML](https://github.com/AnthusAI/videoml-toolchain) (`vml` CLI). The Python CLI orchestrates DSL generation and invokes `vml pipeline` as a subprocess; VideoML handles TTS, timing, and MP4 rendering.

**Branding, pictogram policy, and content rules:** [.agents/skills/produce-video/SKILL.md](../.agents/skills/produce-video/SKILL.md)

## Prerequisites

1. **VideoML via Babulus** (preferred, one-time setup):

   Babulus ships a working `videoml-cli` pipeline. Ensure `~/Projects/Babulus` exists with dependencies installed:

   ```bash
   cd ~/Projects/Babulus
   npm install
   npx playwright install chromium
   ```

   Override with `BABULUS_ROOT=/path/to/Babulus` if needed.

   Build the Threat Intelligence pictogram browser bundle (required for animated React pictograms in videos):

   ```bash
   npm run videoml:bundle
   ```

   Output: `public/videoml/ti-browser-bundle.js` (gitignored). The video pipeline builds this automatically before render if missing.

   Legacy static SVG pictograms under `public/seed-art/threat-intelligence/*.svg` have been removed; videos use the same React pictogram components as the blog.

2. **OpenAI key** in `.papyrus/config.yaml` (gitignored):

   ```yaml
   schemaVersion: 1
   openai:
     api_key: "sk-..."
     model: gpt-4o-mini-tts
     voice: alloy
   ```

   Copy [papyrus-config.example.yaml](../papyrus-config.example.yaml) into `.papyrus/config.yaml` and set `openai.api_key`.

   Resolution order: `OPENAI_API_KEY` env var, then `.papyrus/config.yaml` `openai.api_key` (via [src/papyrus_content/papyrus_config.py](../src/papyrus_content/papyrus_config.py)).

3. **Worktree note:** `.papyrus/` is per-checkout and gitignored. When running from a git worktree that does not have its own `.papyrus/config.yaml`, either copy the file from the main clone or set:

   ```bash
   export PAPYRUS_CONFIG=/Users/ryan/Projects/Threat-Intelligence/.papyrus/config.yaml
   ```

## Commands

Probe the OpenAI key (no render):

```bash
poetry run papyrus videos seed --probe-only
```

Render all six lead-pictogram articles plus the edition overview teaser:

```bash
poetry run papyrus videos seed
```

Render only the edition overview (~1 minute teaser):

```bash
poetry run papyrus videos render --edition-overview
```

Render one article:

```bash
poetry run papyrus videos render --article the-balance-of-power-is-shifting
```

Output MP4s land in:

```text
public/seed-art/threat-intelligence/videos/edition-overview.mp4
public/seed-art/threat-intelligence/videos/<slug>.mp4
```

These paths are gitignored; regenerate with the commands above.

## Seeding videos to Amplify

After rendering MP4s locally, upload them during sandbox seed:

```bash
PAPYRUS_SEED_VIDEOS=1 npm run seed:amplify
```

Without `PAPYRUS_SEED_VIDEOS=1`, seed still creates `MediaAsset(type="video")` rows with `externalUrl` pointing at `/seed-art/...` for local Next.js serving, but skips S3 upload.

Alternatively, refresh GraphQL seed records from Python (requires JWT authoring lane):

```bash
poetry run papyrus videos attach --article the-balance-of-power-is-shifting
```

## Content model

- Edition overview: top-level `video` block in seed JSON → `Edition.metadata.editionVideo` → blog masthead teaser
- Article videos: `video` blocks on the six lead-image articles → `MediaAsset(type="video")`
- Blog reader: edition overview `<video>` below the masthead; article pages render `<video>` with dark pictogram poster; index cards show a play badge over the pictogram when a video exists.

## Pipeline shape

```text
seed article (excerpt + pullQuotes)
  → Python DSL (.babulus.xml in .videoml/work/<slug>/) with <ti-title-slide pictogramSlug=...>
  → npm run videoml:bundle (if needed) → public/videoml/ti-browser-bundle.js
  → vml pipeline (OPENAI_API_KEY + BABULUS_BROWSER_BUNDLE)
  → public/seed-art/threat-intelligence/videos/<slug>.mp4
  → seed upload (optional, PAPYRUS_SEED_VIDEOS=1)
  → MediaAsset(type=video) → blog article page
```

### Scene order

- **Article briefings:** cold-open quote → pictogram title → excerpt → second quote → dated CTA (`THREAT INTELLIGENCE` in tomato red + edition date + tagline).
- **Edition overview:** cold-open quote (first lead article) → edition title + first lead pictogram → edition teaser (date + headline list) → six spotlights → dated CTA.

Backgrounds are flat solid `#191918` paper — no gradients. See the produce-video skill for full policy.

Override VideoML CLI location with `VIDEOML_CLI_DIR=/path/to/VideoML/cli` if needed.
