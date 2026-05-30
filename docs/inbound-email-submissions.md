# Inbound Email Submissions

Papyrus accepts reference suggestions by email at configured addresses on the
publication domain. Messages are stored as `Message` records with
`messageKind = email_submission`, then processed by the
`submissions.email.process` Tactus procedure, which runs the reference
**create**, **find**, and **process** pipeline for direct citations only.

## Addresses

Default deployment configuration:

- `submissions@p.apyr.us` — canonical intake address
- `suggestions@p.apyr.us` — alias used for early testing

Override with:

- `PAPYRUS_INBOUND_EMAIL_DOMAIN`
- `PAPYRUS_INBOUND_EMAIL_LOCAL_PARTS` (comma-separated)

## Authorization

The sender address must match a registered `UserIdentity.email` or
`UserProfile.email`. This is a lightweight guard, not cryptographic proof of
identity.

## Submission contract

Emails must include at least one **direct citation**:

- `https://…` URL, or
- `10.xxxx/...` DOI (normalized to `https://doi.org/...`)

Open-ended research requests (for example, “research the topic of …” with no
citations) are rejected.

## Infrastructure

Amplify provisions:

1. SES receipt rules storing raw MIME under `inbound-email/` in the media bucket
2. `papyrus-ses-inbound-receive` Lambda — creates the `Message`
3. `papyrus-email-submission-processor` Lambda — runs create/find/process

Disable the stack with `PAPYRUS_ENABLE_INBOUND_EMAIL=false`.

## DNS and SES setup

Before mail flows end-to-end:

1. Verify `p.apyr.us` (or your domain) in Amazon SES.
2. Add the MX record SES provides for inbound mail.
3. Deploy the Amplify backend so the receipt rule set is active.

## Procedure seed

Seed the cloud procedure after deploy:

```bash
poetry run papyrus procedures seed-required --apply
```

## Manual test

From a registered user mailbox, send email to `suggestions@p.apyr.us` with a
subject and body that include at least one URL or DOI. Confirm a
`email_submission` message appears in GraphQL and new pending `Reference` rows
are created for the configured corpus (`PAPYRUS_INBOUND_EMAIL_CORPUS_KEY`,
default `AI-ML-research`).
