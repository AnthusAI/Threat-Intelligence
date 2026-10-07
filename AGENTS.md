# Threat Intelligence publication

This repository holds only what is specific to Anthus Threat Intelligence. The newsroom application, the Pretext reader, the Amplify Gen 2 backend and the deployment constructs come from the pinned `@anthusai/papyrus` package. Do not copy Papyrus application code (`app/`, `lib/`, `components/`, `amplify/functions/`) into this repository. Fix Papyrus in the Papyrus repository and bump the pin.

## Layout

- `papyrus.config.ts`: registers the brand and the backend options (`defineSite`).
- `publication/brand.ts`: the brand (masthead, rhythm blog layout, fonts, theme tokens, component slots, video slot).
- `publication/theme.css`: the look. Loaded by `withPapyrus()` after Papyrus styles.
- `publication/pictograms/`, `publication/blog-defense/`: article figure and header artwork components.
- `publication/videoml/`: TI video scene components. Videos do not play on this stack until the video-script loader port lands.
- `publication/seed/`: seed edition content (reference data; the database is the authority).
- `publication/tests/`: TI static and unit tests (`npm test`).
- `amplify/backend.ts`, `amplify/data/resource.ts`: one-line re-exports from the package.
- `infra/site.json`: the CDK app shell description (`papyrus-infra synth --site infra/site.json`).
- `corpora/`, `skills/`, `docs/`, `public/`: beat configuration, agent skills, runbooks and brand assets.

## Workflow

1. `npm ci` then `npm run dev` (runs `papyrus-app sync`, which writes route shims that are gitignored).
2. Build against a backend with a generated `amplify_outputs.json` (gitignored): `npm run build`.
3. Changing the Papyrus version: edit the exact pin in `package.json` and `infra/site.json` together.
4. Never commit secrets, real email addresses or `amplify_outputs.json`.

## Rules

- No line-level comments. Use long, clear names.
- Gherkin first for any behavior change.
- Do not read or write the `project/` Kanbus directory directly; use `kbs`.
