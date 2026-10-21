# The public site is a static projection

`threat-intelligence.anth.us` serves the standard Papyrus front end: pages are written to the S3 projection bucket by the CMS backend (`backend.publication` in `papyrus.config.ts`, `staticDir: "web"`) and served by CloudFront distribution `E20NJAIXZ1WKWD` (stack `papyrus-edge-threat-intelligence`). The newsroom is unchanged: `/newsroom`, `/api/*`, `/_next/*` and `/cyclotron` go to this app on Amplify SSR (`main.d12wnrx15qbcc2.amplifyapp.com`). The staging host `threat-intelligence-staging.anth.us` is still plain Amplify SSR (drafts).

## What the site owns

- `web/projection.json`: settings. Six desks (`AI`, `AWS`, `Azure`, `Gaming`, `Mission`, `Newsroom`) are sections at `/<desk>/`; the Newsroom desk is at `/inside-the-newsroom/` because `/newsroom` is the CMS.
- `web/css/site-theme.css`: the look (theme tokens and layout from the redesign handoff; light, dark, system).
- `web/hooks.py`: header, masthead, footer, front page, post page, desk pages and 404 body. `web/pictograms.py` holds the static copies of each post's pictogram plate (keyed by slug) and the masthead web. A new post without an entry has no figure.
- Editorial values (title, description, date, aliases) are item front matter in the CMS. `bin/front_matter_migration.py` wrote them from the legacy headline and deck columns on 2026-10-21 (columns kept, so the Amplify reader still renders).

## URL shapes

Posts moved from `/posts/<slug>` to `/<desk>/<slug>/`. Each old `/posts/<slug>` and `/articles/<slug>` (with and without the trailing slash) is a 301 through the redirects key-value store (an alias on each item). `/settings` redirects to `/`; `/icon.png` and `/icon-light.png` redirect to `/assets/`.

## Dropped on purpose

The in-page Log in button no longer starts the Cognito flow on the public pages: it links to `/newsroom`. The `/settings` page is gone (the theme switch is in the header). The masthead web no longer animates around the title. Relative times ("3d ago") became dates.

## Operations

`papyrus ops content project --all` re-renders the site (the backend deploy does this itself). One `/*` invalidation per full render.

## Rollback

The Amplify app still serves the old public pages at `/` and `/posts/<slug>` (items keep their legacy columns). Update `papyrus-edge-threat-intelligence` with `infra/edge/threat-intelligence-amplify-origin.yaml` (the template as deployed before the cutover; give it `CertificateArn` and leave the other parameters out), read the change set (expect Modify on `CmsMainDistribution`, removal of the site function and OAC), execute it, then invalidate `/*` on `E20NJAIXZ1WKWD`. Aliases, certificate and DNS never moved.
