---
name: seed-update
description: >-
  Update Threat Intelligence seed content (articles, edition metadata, videos,
  pictogram-backed MP4s) in Amplify sandbox or the live TI reader production
  backend. Use when seeding TI editions, refreshing GraphQL after seed JSON or
  pictogram changes, uploading seed videos to S3, targeting threat-intelligence.anth.us,
  or when agents confuse Papyrus main (dbsyytcm9drqa) with TI reader production
  (d3on1y5vlrxmam).
---

# Threat Intelligence Seed Update

Operational runbook for pushing TI seed content to Amplify backends. For video
branding, pictogram policy, and render details, read
[produce-video](../produce-video/SKILL.md) and
[video-pipeline.md](../../docs/video-pipeline.md) first.

## When to use

- Seed JSON, article copy, or video scenes changed
- Pictograms changed (`art.tsx` / `registry.ts`) and MP4s must be re-rendered
- Sandbox GraphQL is stale vs local seed (e.g. `editionVideo.storagePath: null`, `scenes: []`)
- Pushing seed content to TI reader production (`threat-intelligence.anth.us`)

## Backend identity map (critical)

| Role | Amplify app | AppSync (example host prefix) | S3 media bucket pattern | Notes |
|------|-------------|-------------------------------|-------------------------|-------|
| **Reader production** (`threat-intelligence.anth.us`) | `d3on1y5vlrxmam` ("Threat Intelligence") | `ur2anu47d5f67eq7sjzoqpyuze` | `amplify-d3on1y5vlrxmam-ma-papyrusmediabucket0dab24-vq9lqoedok0k` | **THIS is live TI production** |
| Papyrus main (often mislabeled "production") | `dbsyytcm9drqa` | `64hviw44q5cq5nwjcigmasowlq` | different bucket | Do **not** assume this is TI reader production |
| Ryan sandbox | papyrus ryan-sandbox | `nkqutxchyzf3rkk6d5knpicdoi` / api id `b44efjcruvarvmkkfxgjopet4m` | `amplify-papyrus-ryan-sand-papyrusmediabucket0dab24-dncrpdxqhvwa` | Local `.env` usually points here |

**Always verify** which backend the live reader uses (signed S3 URLs or AppSync
endpoint in the reader JS bundle) before writing.

### Mislabeling warning

`skills/category-steering/SKILL.md` and some Papyrus docs treat
`dbsyytcm9drqa` / `64hviw44q5cq5nwjcigmasowlq` as "production authoring." That
is **Papyrus main**, not the Threat Intelligence reader. TI reader production is
`d3on1y5vlrxmam` / `ur2anu47d5f67eq7sjzoqpyuze`. Bootstrap JWT path for TI:

```text
PAPYRUS_JWT_SECRET_SSM_PARAM=/amplify/d3on1y5vlrxmam/main-branch-aeb7dfa526/PAPYRUS_JWT_SECRET
```

(Confirm the branch suffix from the authorizer Lambda `AMPLIFY_SSM_ENV_CONFIG`
if the path drifts.)

`auth refresh-jwt` auto-picks the Papyrus-main secret only when the GraphQL
endpoint host is `64hviw44q5cq5nwjcigmasowlq`; otherwise it defaults to the
**ryan-sandbox** secret. For TI production you **must** set
`PAPYRUS_JWT_SECRET_SSM_PARAM` (or pass `--ssm-param`) explicitly.

## Local source of truth

| Asset | Path | Notes |
|-------|------|-------|
| Seed edition | `publications/threat_intelligence/seed/seed-edition-content.json` | Articles, layout intent, video scene metadata |
| Pictograms | `publications/threat_intelligence/pictograms/{art.tsx,registry.ts}` | Frontend + VideoML browser bundle; **not** GraphQL art payloads |
| Rendered MP4s | `public/seed-art/threat-intelligence/videos/*.mp4` | Dark + light (`*-light.mp4`) variants |

Pictograms are baked into MP4s at render time. GraphQL stores only scene
metadata (pictogram **slug strings**, duration, captions) — not the React art.

Sandbox GraphQL can lag local seed even when JSON is current. Trust local seed
JSON + local MP4s; treat remote `editionVideo` with `storagePath: null` or
`scenes: []` as stale until re-seeded.

## CLI entry points

| Goal | Command |
|------|---------|
| Upsert seed GraphQL (+ optional S3 media) | `poetry run papyrus ops content seed-edition --profile threat-intelligence` |
| Preview seed changes | add `--dry-run` |
| GraphQL metadata only (S3 already current) | add `--upload-media false` |
| Render all lead + edition-overview videos | `poetry run papyrus videos seed` |
| Re-render overview from local seed (no GraphQL) | `poetry run papyrus videos render --edition-overview --theme both --from-article` |
| Mint authoring JWT | `poetry run papyrus auth refresh-jwt --write-env .env.local` |
| Sandbox Cognito seed (bypasses JWT authorizer) | `PAPYRUS_SEED_VIDEOS=1 npm run seed:amplify` |

**Not** `papyrus content seed-edition` — `content` lives under `ops`.

### Flags and defaults

- **Default is APPLY.** Omitting `--dry-run` writes. Always say so; use
  `--dry-run` first when unsure.
- `--upload-media false`: refresh GraphQL records without uploading files.
  Requires a resolvable bucket only when upload is enabled.
- `PAPYRUS_SEED_VIDEOS=1`: required for video S3 upload during
  `ops content seed-edition` and `npm run seed:amplify`. Without it, seed still
  writes video metadata with local `externalUrl` paths.

### `videos render` and GraphQL

- Default render path fetches authored VideoML DSL from GraphQL → needs a working JWT.
- `--from-article` generates DSL from local seed JSON → **no GraphQL**. Prefer
  this when the JWT authorizer is broken or only pictograms/scenes changed.

### Env loading (`.env` vs `.env.local`)

`src/papyrus_content/env.py` loads `.env` then `.env.local`. Only these keys in
`.env.local` override values already present in the process environment:

- `PAPYRUS_GRAPHQL_JWT`
- `PAPYRUS_GRAPHQL_ENDPOINT`
- `PAPYRUS_JWT_TTL_SECONDS`

So mint production JWTs into `.env.local` and set the production endpoint there.
Set `PAPYRUS_JWT_SECRET_SSM_PARAM` in the **shell** (or only in `.env.local` if
it is not already in `.env`) before `auth refresh-jwt`. Restore / remove
production overrides in `.env.local` after the job so local defaults stay sandbox.

## Deterministic S3 storage paths

Edition slug in seed is `current`:

| Asset | storagePath |
|-------|-------------|
| Edition overview (dark) | `media/editions/current/edition-overview.mp4` |
| Edition overview (light) | `media/editions/current/edition-overview-light.mp4` |
| Article video (dark) | `media/articles/<slug>/video-<slug>.mp4` |
| Article video (light) | `media/articles/<slug>/video-<slug>-light.mp4` |

Manual upload example:

```bash
aws s3 cp public/seed-art/threat-intelligence/videos/edition-overview.mp4 \
  s3://<target-bucket>/media/editions/current/edition-overview.mp4
```

Then refresh GraphQL with `--upload-media false`.

## Recommended workflows

### A. Pictograms changed (art/registry only)

1. Rebuild VideoML browser bundle if needed (`npm run videoml:bundle`; render
   usually rebuilds when missing).
2. Re-render videos whose scenes reference the new pictogram slugs. Edition
   overview references many article pictograms; lead article videos may only use
   lead pictograms.
3. Prefer `--from-article` if GraphQL JWT is unreliable:

   ```bash
   poetry run papyrus videos render --edition-overview --theme both --from-article
   # and/or affected leads:
   poetry run papyrus videos render --article <slug> --theme both --from-article
   ```

4. Upload MP4s to the target S3 bucket at the deterministic paths above (via
   `PAPYRUS_SEED_VIDEOS=1` seed, or `aws s3 cp`).
5. Refresh GraphQL metadata:

   ```bash
   poetry run papyrus ops content seed-edition --profile threat-intelligence --dry-run
   poetry run papyrus ops content seed-edition --profile threat-intelligence
   # or, if S3 already uploaded:
   poetry run papyrus ops content seed-edition --profile threat-intelligence --upload-media false
   ```

6. Verify via public apiKey read of `getPublishedEdition` →
   `metadata.editionVideo` (`storagePath`, `durationSeconds`, `scenes` with
   pictogram slugs).

### B. Seed JSON / article copy / video scenes changed

1. Update `publications/threat_intelligence/seed/seed-edition-content.json`.
2. Re-render affected videos if scenes or duration changed (see produce-video).
3. Target the correct backend (sandbox `.env` vs production overrides in
   `.env.local`).
4. Mint JWT for **that** backend's SSM secret.
5. `poetry run papyrus ops content seed-edition --profile threat-intelligence`
   (use `--dry-run` first when unsure).
6. Verify reader / GraphQL.

### C. Sandbox full re-seed (preferred when Cognito seed creds available)

Use when the sandbox JWT authorizer rejects valid tokens (`isAuthorized: false`
even when claims match). Cognito seed bypasses the Lambda authorizer.

1. Ensure `amplify_outputs.json` is sandbox (`npm run outputs:sandbox` if needed).
2. Set seed editor creds in `.env`: `PAPYRUS_SEED_USERNAME`,
   `PAPYRUS_SEED_PASSWORD`, `PAPYRUS_SEED_EMAIL`.
3. Run:

   ```bash
   PAPYRUS_SEED_VIDEOS=1 npm run seed:amplify
   ```

### D. Production TI reader (`d3on1y5vlrxmam`)

1. Point `PAPYRUS_GRAPHQL_ENDPOINT` at TI production AppSync
   (`https://ur2anu47d5f67eq7sjzoqpyuze.appsync-api.us-east-1.amazonaws.com/graphql`).
2. Point `PAPYRUS_JWT_SECRET_SSM_PARAM` at that app's JWT secret SSM path
   (discover from authorizer Lambda `AMPLIFY_SSM_ENV_CONFIG` if needed).
3. Mint JWT to `.env.local`:

   ```bash
   export PAPYRUS_JWT_SECRET_SSM_PARAM=/amplify/d3on1y5vlrxmam/main-branch-aeb7dfa526/PAPYRUS_JWT_SECRET
   poetry run papyrus auth refresh-jwt --write-env .env.local
   # ensure .env.local also has PAPYRUS_GRAPHQL_ENDPOINT for TI production
   ```

4. Prefer `--upload-media false` if MP4s were already uploaded via `aws s3 cp`.
5. Never assume `dbsyytcm9drqa` is the TI reader.
6. Restore `.env.local` (remove production endpoint/JWT) so local defaults stay sandbox.

## Sandbox JWT authorizer caveat

The ryan-sandbox Lambda authorizer
(`amplify-papyrus-ryan-sand-papyrusgraphqljwtauthori-tiZBzIjhROBj`) reads SSM
`/amplify/papyrus/ryan-sandbox-adcd88a186/PAPYRUS_JWT_SECRET` but may still deny
freshly minted JWTs (`isAuthorized: false` even when claims match).

When that happens:

- Prefer **workflow C** (`npm run seed:amplify` via Cognito), or
- Upload MP4s with `aws s3 cp` and refresh metadata only if a working authoring
  path exists, or
- Fix/redeploy the authorizer — do not invent CLI compatibility shims.

## Stale media deletion (correct behavior)

`list_stale_seed_media_records` in `src/papyrus_content/seed_edition.py` must
delete **only orphans**: media rows for seed payload items whose IDs are **not**
in the expected IDs built from seed records.

Correct behavior:

1. Build `expected_ids` for `MediaAsset` / `PublishedMediaAsset` from the seed
   records about to be applied.
2. List current media for each payload article item.
3. Delete only rows whose `id` is **not** in `expected_ids`.

A prior bug listed all media for payload items and treated them as stale,
deleting **all** media instead of only orphans. Do not reintroduce that. If
seed-edition unexpectedly wipes videos/images, inspect this filter first.

## Safety

- Do not commit unless the user asks.
- Do not run destructive `content delete all` unless asked.
- Default of `seed-edition` is apply (not dry-run).
- Stale media deletion must only remove orphans not in the seed payload expected IDs.
- Restore `.env.local` after production targeting so local defaults stay sandbox.
- Do not commit secrets or JWTs (`.env*` stays gitignored).

## Verification checklist

- [ ] GraphQL `editionVideo.durationSeconds` and `scenes` match seed JSON
- [ ] S3 objects exist at the `storagePath` values in GraphQL
- [ ] Reader signed URLs point at the expected bucket (TI prod vs sandbox)
- [ ] For pictogram changes: extract a frame from `edition-overview.mp4`, or
      confirm render used current `public/videoml/ti-browser-bundle.js`
      containing the new pictogram slugs
- [ ] After production writes, `.env.local` no longer forces production endpoint/JWT

## Related

- Video branding / pictograms / render: [produce-video](../produce-video/SKILL.md)
- Pipeline details: [video-pipeline.md](../../docs/video-pipeline.md)
- TI bootstrap env: [bootstrap.md](../../docs/bootstrap.md)
- Papyrus operating rules: [AGENTS.md](../../../../AGENTS.md)
