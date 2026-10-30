# AGENTS.md: Threat Intelligence

Operating manual for any agent or person working in this repository, whatever the tool. Start with [README.md](README.md) for what this is and where it runs. Engine-level rules (layout, content, cloud, newsroom, git policy for the engine) live in the Papyrus [AGENTS.md](https://github.com/AnthusAI/Papyrus/blob/main/AGENTS.md); this file does not repeat them. Papyrus docs index: [docs/README.md](https://github.com/AnthusAI/Papyrus/blob/main/docs/README.md).

This repository holds only what is specific to Threat Intelligence (threat-intelligence.anth.us, pre-production). The newsroom application, the Amplify Gen 2 backend and the deployment constructs come from the pinned `@anthusai/papyrus` package. Never copy Papyrus application code (`app/`, `lib/`, `components/`, `amplify/functions/`) into this repository. Fix Papyrus in the Papyrus repository, release it, then bump the pin.

## Map of the parts

| Part | Where in this repo | Docs |
| --- | --- | --- |
| Site registration and backend options | `papyrus.config.ts` (`defineSite`: `s3-projection` publication, `staticDir: "web"`, `reprojectOnDeploy: true`, edge distribution ARN, console responder, Slack, inbound email and storage backups all off) | [site-hosting](https://github.com/AnthusAI/Papyrus/blob/main/docs/site-hosting.md) |
| Brand and theme | `publication/brand.ts`, `publication/theme.css`, `publication/pictograms/`, `publication/blog-defense/`, `publication/redesign/` | [site-theme-packs](https://github.com/AnthusAI/Papyrus/blob/main/docs/site-theme-packs.md), [blog-layout-brand-slots](https://github.com/AnthusAI/Papyrus/blob/main/docs/blog-layout-brand-slots.md) |
| Standard projector (the public static site) | `web/projection.json` (settings), `web/css/site-theme.css`, `web/hooks.py` (header, masthead, footer, front page, post page, section pages, 404), `web/pictograms.py`, `web/assets/` | [building-a-papyrus-static-site](https://github.com/AnthusAI/Papyrus/blob/main/docs/building-a-papyrus-static-site.md), local [docs/static-reader.md](docs/static-reader.md) |
| CMS backend and newsroom console | The package's `amplify/backend.ts` and `amplify/data/resource.ts`, re-exported by one-line files here; served at `/newsroom` | [newsroom-operations](https://github.com/AnthusAI/Papyrus/blob/main/docs/newsroom-operations.md), [site-hosting](https://github.com/AnthusAI/Papyrus/blob/main/docs/site-hosting.md) |
| The edge | `infra/edge/threat-intelligence.yaml` (CloudFront stack `papyrus-edge-threat-intelligence`: S3 default origin; `/newsroom*`, `/_next/*`, `/api/*`, `/cyclotron*` to Amplify). `infra/edge/threat-intelligence-amplify-origin.yaml` is the pre-cutover rollback template. | [edge-under-the-cms-backend](https://github.com/AnthusAI/Papyrus/blob/main/docs/hosting/edge-under-the-cms-backend.md) (design notes) |
| CDK app shell | `infra/site.json` (account, hosted zone, domains, Cognito prefix, GitHub ids, `papyrusVersion`) | [site-hosting](https://github.com/AnthusAI/Papyrus/blob/main/docs/site-hosting.md) |
| Agent-readable output | Switched on in `web/projection.json` (`agents`: Markdown twins, `llms.txt`, `llms-full.txt`; `pageActions` for copy and open-in-AI) | [agent-readable-sites](https://github.com/AnthusAI/Papyrus/blob/main/docs/agent-readable-sites.md) |
| GA4 and consent | `chrome.ga_measurement_id` and `chrome.consent_mode` in `web/projection.json`; the footer link to Cookie settings | [site-hosting, Consent Mode v2](https://github.com/AnthusAI/Papyrus/blob/main/docs/site-hosting.md) |
| Beat, doctrine, steering | `corpora/*.yml` and `corpora/papyrus-required-procedures.json` (the Tactus procedures the CLI requires) | [steering-and-relevance](https://github.com/AnthusAI/Papyrus/blob/main/docs/steering-and-relevance.md), local [docs/bootstrap.md](docs/bootstrap.md) |
| Agent skills | `skills/seed-update`, `skills/produce-video` | the skill files |
| Video | `publication/videoml/`, `docs/video-pipeline.md`. Not played on the static site. | [video-pipeline](https://github.com/AnthusAI/Papyrus/blob/main/docs/video-pipeline.md) |
| Migration script | `bin/front_matter_migration.py` (one-time, run 2026-10-21) | [docs/static-reader.md](docs/static-reader.md) |

Papyrus features that are part of the deployed backend and not configured by files here: the shared relevance Cyclotron and review requests (the `/cyclotron*` route reaches it), the Hacker News monitoring router ([monitoring-cloud](https://github.com/AnthusAI/Papyrus/blob/main/docs/monitoring-cloud.md) lists `threat-intelligence` as a routed publication), the procedure runner ([procedure-runner](https://github.com/AnthusAI/Papyrus/blob/main/docs/procedure-runner.md)), [automations](https://github.com/AnthusAI/Papyrus/blob/main/docs/automations.md), the weekly knowledge run ([knowledge-cloud-run](https://github.com/AnthusAI/Papyrus/blob/main/docs/knowledge-cloud-run.md), [knowledge-workstation-run](https://github.com/AnthusAI/Papyrus/blob/main/docs/knowledge-workstation-run.md)) and reader steering ([reader-steering](https://github.com/AnthusAI/Papyrus/blob/main/docs/reader-steering.md)). Not enabled by this repository's config: the newsletter plugin ([newsletter](https://github.com/AnthusAI/Papyrus/blob/main/docs/newsletter.md)); no `plugins` are set in `papyrus.config.ts`. Whether Cyclotron, the knowledge run or reader steering are switched on for this site in the live backend was not verified when this file was written.

## Common tasks

Use `AWS_PROFILE=papyrus-production` (account `712236451410`) for anything that touches AWS, and prefer read-only calls.

**Run the tests**

```bash
npm ci
npm test
echo '{}' > amplify_outputs.json   # stub for type checking; git-ignored
npx papyrus-app sync && npx tsc --noEmit
```

These are exactly the CI steps. `npm test` runs four Node tests in `publication/tests/`. The Gherkin files in `features/` are specifications; this repository has no runner for them.

**Preview locally**: `npm run dev` (port 3001) after `npm ci`. It needs an `amplify_outputs.json` from a backend, and `papyrus-app sync` writes route shims that are git-ignored.

**Bump the Papyrus pin**

1. Check the release exists (`npm view @anthusai/papyrus version`) and read its release notes.
2. In one change, set the same exact version in `package.json` (`dependencies["@anthusai/papyrus"]`) and `infra/site.json` (`papyrusVersion`), then run `npm install` so `package-lock.json` agrees.
3. Run the CI steps above, open a pull request to `main`, merge when green. The merge deploys the backend and re-projects the site. Never bump `package.json` alone: the production build runs `papyrus-infra deploy`, so the version in `infra/site.json` decides the template that ships.

**Deploy**: merge a pull request to `main`. The `CI and deploy` workflow then starts the Amplify job for that commit on app `d12wnrx15qbcc2` through GitHub OIDC (role `threat-intelligence-github-deploy`). Amplify's own auto-build on `main` is off. Never run `ampx pipeline-deploy` from a local machine. After a merge, check `https://threat-intelligence.anth.us/` returns 200 and `aws amplify list-jobs --app-id d12wnrx15qbcc2 --branch-name main --max-results 3` shows the merged commit. Webhooks and jobs can be minutes late.

**Re-project safely** (after changing `web/` hooks, CSS or `projection.json` without a backend deploy):

```bash
papyrus ops content project --reconcile --dry-run     # reports drift, deletes nothing
papyrus ops content project --all                      # re-render every page
```

A backend deploy re-projects by itself (`reprojectOnDeploy`). Read [site-hosting](https://github.com/AnthusAI/Papyrus/blob/main/docs/site-hosting.md) (reconcile and deletion guard) before any non-dry-run reconcile.

**Register a site procedure**: add the procedure under the Papyrus procedure conventions and list its CLI binding in `corpora/papyrus-required-procedures.json`. Runbook: [newsroom-procedures-runbook](https://github.com/AnthusAI/Papyrus/blob/main/docs/newsroom-procedures-runbook.md).

**Create an automation**: [automations](https://github.com/AnthusAI/Papyrus/blob/main/docs/automations.md). Only `monitor` triggers run today.

**Add the site to the Hacker News routing**: it is already listed as a routed publication in the Papyrus monitoring docs. Changes go through the router config in [monitoring-cloud](https://github.com/AnthusAI/Papyrus/blob/main/docs/monitoring-cloud.md); tell the Papyrus owners first because the router is shared.

**Start a new Papyrus site**: [building-a-papyrus-static-site](https://github.com/AnthusAI/Papyrus/blob/main/docs/building-a-papyrus-static-site.md) and [site-hosting](https://github.com/AnthusAI/Papyrus/blob/main/docs/site-hosting.md). Copy the shape of `papyrus.config.ts`, `web/` and `infra/site.json`, not Papyrus code.

**Add a post figure**: a new post without an entry in `web/pictograms.py` has no figure.

## Hard rules

- Never run `papyrus ops content project --reconcile` for real without the deployed plugin list (the CLI refuses without a readable `amplify_outputs.json` or a matching `PAPYRUS_PLUGINS`). Never use `--allow-deletions`. Always dry-run first.
- Projections that write the site bucket take the projection lease; do not start a second one by hand while a deploy or a knowledge run is projecting.
- Secrets go in SSM Parameter Store as SecureString, created by infrastructure code, never in this repository, never in Secrets Manager unless a service requires it. Never commit `.env*` or `amplify_outputs.json`.
- No real email addresses anywhere in the repository. Use placeholders. Allowlists live in AWS configuration.
- Shared checkouts: never switch branches and never `git stash`. Use `git worktree add` or a fresh clone.
- Gherkin specs for every behaviour change, written first. Add scenarios under `features/` in narrative, complete form. Unit tests alone are not enough.
- Pull requests go to `main`. Commit with conventional commits (`feat:`, `fix:`, `docs:`, `chore:`). Never force-push `main`.
- No line-level comments in code; use long, clear names.
- Do not read or write a Kanbus `project/` directory directly; use `kbs`. This repository has no `project/` directory today, and the product board is the Papyrus `PPY` board.
- Wording: never write "desk" for a section or an editorial role; say "section". Attribution is "AI", never a model or vendor name. Use "Account", not "Organization", for the shared directory tenant.
- Google Analytics follows the anth.us standard: Consent Mode v2 with the banner, region defaults from gtag, a Cookie settings link. Do not set `analytics_only` here.
- Human review is never a story state. Use review requests in the Papyrus backend.
- Do not edit Papyrus-generated shims (the block in `.gitignore` marked `papyrus-app sync`).

## Ownership and coordination

- Engine changes belong in the Papyrus repository and its owners. This repository follows by bumping the pin.
- Tell the Papyrus session before changing shared infrastructure: the monitoring router, the procedure runner, the shared Cyclotron, and `AnthusAI/Papyrus` workflow `amplify-deploy.yml` (this repository's deploy job calls it at `@main`).
- Never touch Anth.us from here.
- Ryan owns this site. It is pre-production, so move fast, but still use a pull request.

## Current state (2026-10-23)

- Live: `https://threat-intelligence.anth.us/` returns 200 (static projection, CloudFront `E20NJAIXZ1WKWD`); `/newsroom`, `/llms.txt` and `/feed.xml` return 200; GA4 and the consent banner are in the page.
- Pinned to Papyrus `5.58.0`.
- The staging host `threat-intelligence-staging.anth.us` is plain Amplify SSR and redirects when signed out.
- Planned or open: videos do not play on this stack until the video-script loader port lands. `docs/organizer-cms-rollout.md` is a historical rollout note; its statement that `amplify.yml` does not deploy the backend is out of date (it runs `ampx pipeline-deploy` today). `docs/bootstrap.md` still describes older CLI and SSM details; check it against `papyrus --help` before relying on it.
- The `develop` branch on GitHub is stale. Work from `main`.

## Where the docs live

This repository: `docs/` (`static-reader.md`, `bootstrap.md`, `organizer-cms-rollout.md`, `video-pipeline.md`) and `skills/`. Everything about the engine: [Papyrus docs index](https://github.com/AnthusAI/Papyrus/blob/main/docs/README.md). The product board for engine work is the Papyrus `PPY` Kanbus project.
