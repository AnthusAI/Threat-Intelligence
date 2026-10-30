# Threat Intelligence

Practical AI/ML security analysis for teams defending systems, data and operational workflows. Live at [threat-intelligence.anth.us](https://threat-intelligence.anth.us). It is pre-production.

This is not a vulnerability feed. The pattern is trend, failure mode, defensive lesson, then checks you can actually run. Masthead: practical advice for staying secure as the threat landscape shifts.

## What this repository is

This repository is one publication built on Papyrus. It holds the beat (corpus, doctrine, sections, steering), the brand and theme, and the static site settings. It does not hold the engine.

| Repository | Role |
| --- | --- |
| [Papyrus](https://github.com/AnthusAI/Papyrus) | The engine: the `@anthusai/papyrus` npm package and the `papyrus-newsroom` PyPI package, released in lockstep. This site pins an exact version. |
| This repository | The Threat Intelligence site: `papyrus.config.ts`, `publication/`, `web/`, `corpora/`, `infra/`. |
| [Cyclotron](https://github.com/AnthusAI/Cyclotron) | The relevance engine Papyrus uses for include and exclude decisions. Configuration lives in the Papyrus backend, not here. |
| [Biblicus](https://github.com/AnthusAI/Biblicus) and [Tactus](https://github.com/AnthusAI/Tactus) | Corpus tooling and the procedure language that Papyrus newsroom procedures use. |
| [Prospectus](https://github.com/AnthusAI/Prospectus) | A separate product. This site only shares the Amplify and account conventions. |

The sister Papyrus sites are Anth.us, Pilobol.us, Tactus, Markus and p.apyr.us. Engine rules for all of them are in the Papyrus [AGENTS.md](https://github.com/AnthusAI/Papyrus/blob/main/AGENTS.md); the documentation index is [docs/README.md](https://github.com/AnthusAI/Papyrus/blob/main/docs/README.md).

## Where it runs

| Thing | Value |
| --- | --- |
| AWS account | `papyrus-production`, `712236451410`, `us-east-1` |
| Public site | `https://threat-intelligence.anth.us`. A static projection in S3, served by CloudFront distribution `E20NJAIXZ1WKWD` (stack `papyrus-edge-threat-intelligence`). |
| CMS and newsroom | `https://threat-intelligence.anth.us/newsroom`, plus `/api/*`, `/_next/*` and `/cyclotron*`. The edge sends these to the Amplify app. |
| Amplify app | `d12wnrx15qbcc2` (`threat-intelligence-cms`). Branch `main` is production (auto-build off), branch `staging` is beta (auto-build on). |
| Staging | `https://threat-intelligence-staging.anth.us`, straight to Amplify. It answers with a redirect rather than 200 when you are not signed in. |
| CDK stack | `amplify-app-shell-threat-intelligence-cms`, described by `infra/site.json`. |
| Repository | Public, `AnthusAI/Threat-Intelligence`. Default branch `main`. |
| Analytics | Google Analytics 4 (`G-31SC26SDGX`) with Consent Mode v2 and a cookie banner; the privacy link goes to `https://anth.us/privacy/`. |

## Quick start

Prerequisites: Node 22 and npm. Python 3 with `pip install papyrus-newsroom` is needed only for the `papyrus` CLI (content, projection, knowledge). For anything that touches AWS, use `AWS_PROFILE=papyrus-production` after `aws sso login`.

```bash
npm ci
npm test            # publication unit tests (no AWS needed)
npm run dev         # papyrus-app sync, then next dev on port 3001
```

`npm run dev` and `npm run build` need a generated `amplify_outputs.json` (git-ignored) from a backend. CI uses an empty stub, which is enough for type checking:

```bash
echo '{}' > amplify_outputs.json
npx papyrus-app sync && npx tsc --noEmit && npm test
```

The pinned engine is `@anthusai/papyrus` `5.61.0`, set in `package.json` and in `infra/site.json` (`papyrusVersion`). The two must agree with `package-lock.json`.

## How a change reaches production

1. Branch from `main` and open a pull request to `main`. (`develop` and `staging` exist on GitHub but `develop` is stale; do not use it.)
2. The `CI and deploy` workflow (`.github/workflows/deploy.yml`) runs `npm ci`, `papyrus-app sync`, `tsc --noEmit` and `npm test` on the pull request.
3. On a green push to `main`, the same workflow calls the reusable `AnthusAI/Papyrus/.github/workflows/amplify-deploy.yml`, which assumes the GitHub OIDC role `threat-intelligence-github-deploy` (no stored keys) and starts an Amplify RELEASE job for the merged commit on app `d12wnrx15qbcc2`.
4. The Amplify build (`amplify.yml`) runs `npx ampx pipeline-deploy`, which redeploys the CMS backend and re-projects the site, then builds the Next app. Every merge to `main` therefore deploys, including docs-only ones.

Engine upgrades: Papyrus releases through semantic-release (`feat:` and `fix:` release; `chore:` and `docs:` do not). To take a release, bump the exact pin in `package.json` and `infra/site.json` in the same change, run `npm install`, and merge. Details are in [AGENTS.md](AGENTS.md) and the Papyrus [releasing](https://github.com/AnthusAI/Papyrus/blob/main/docs/releasing.md) and [site hosting](https://github.com/AnthusAI/Papyrus/blob/main/docs/site-hosting.md) docs.

## Where to read next

- [AGENTS.md](AGENTS.md): the operating manual for agents and people (map, tasks, hard rules, current state).
- [docs/static-reader.md](docs/static-reader.md): how the public static site is built and how to roll it back.
- [docs/bootstrap.md](docs/bootstrap.md): the corpus and doctrine configuration files.

---

Built by [Anthus AI Solutions](https://anth.us). This is the Anthus newsroom pointed at threat intelligence. If you need this operated, not just cloned, [talk to us](https://anth.us/engage).
