Seed profiles let one Papyrus codebase support site-specific fixture content.

How it works:

1. Set `PAPYRUS_SEED_PROFILE=<profile-id>`.
2. Add `seed-edition-content.json` at:
   `amplify/seed/profiles/<profile-id>/seed-edition-content.json`
3. Run `npm run seed:amplify`.

If the profile file is missing, the seed script falls back to:

`amplify/seed/seed-edition-content.json`

Use this to keep base Papyrus fixture content intact while allowing custom
fixture editions per site deployment.
