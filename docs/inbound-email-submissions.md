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

**Sender guard:** the sender address must match a registered `UserIdentity.email`
or `UserProfile.email`. This is a lightweight guard, not cryptographic proof of
identity.

**AppSync access:** `papyrus-ses-inbound-receive` and
`papyrus-email-submission-processor` call GraphQL with **IAM only** (no JWT).
They are granted access via `allow.resource(...)` on the data schema and
`appsync:GraphQL` on their execution roles. JWT authoring is for CLI tools only.

## Submission contract

Emails must include at least one **direct citation**:

- `https://…` URL, or
- `10.xxxx/...` DOI (normalized to `https://doi.org/...`)

Open-ended research requests (for example, “research the topic of …” with no
citations) are rejected.

## Infrastructure

Amplify provisions:

1. SES receipt rules storing raw MIME under `inbound-email/` in the media bucket (S3 action only)
2. EventBridge `Object Created` events on that prefix invoke `papyrus-ses-inbound-receive`, which creates the `Message`
3. `papyrus-email-submission-processor` Lambda — runs create/find/process (scoped to
   references registered from that email, not the full corpus table)
4. A scheduled retry sweep (every 15 minutes) re-invokes intake for MIME objects still under `inbound-email/`

Raw MIME is **retained until processing completes successfully**. On success the processor moves the object to `inbound-email-archived/` (outside the intake prefix) so it is not retried. Failed or pending intake leaves the MIME in place so the same test email can be replayed without resending.

Intake is **idempotent per S3 object**: the `Message` id is derived from the bucket/key, and re-running intake for the same MIME re-invokes the processor instead of creating duplicates.

Disable the stack with `PAPYRUS_ENABLE_INBOUND_EMAIL=false`.

## DNS and SES setup

Before mail flows end-to-end:

1. `p.apyr.us` must have an **MX** record pointing at `inbound-smtp.us-east-1.amazonaws.com` (priority 10). The site hostname should use a Route 53 **A alias** to CloudFront (not a CNAME), so MX can coexist with web traffic.
2. Amplify provisions SES domain verification (`_amazonses.p.apyr.us` TXT) and activates the receipt rule set on deploy.
3. Deploy the Amplify backend so receipt rules and DNS verification run in CI.

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

## Harder testing

### Unit tests (fast, no AWS)

```bash
poetry run python -m unittest procedures.newsroom.tests.test_email_submissions -v
```

Covers citation parsing, S3 key filters, stable message ids, GSI fields on status
updates, MIME archive copy/delete behavior, and scoped GraphQL loads (no full-table
`listReferences` scans during processing).

GitHub Actions workflow `.github/workflows/inbound-email-tests.yml` runs the same
suite on pushes/PRs that touch inbound email code.

### Production smoke script

After deploy, from the repo (with `amplify_outputs.json` or `PAPYRUS_MEDIA_BUCKET_NAME`):

```bash
chmod +x scripts/test-inbound-email-production.sh
AWS_PROFILE=Ryan ./scripts/test-inbound-email-production.sh
```

Optional: re-run the processor for one message (slow; corpus find/process can take minutes):

```bash
MESSAGE_ID=message-email-submission-XXXXXXXX \
  AWS_PROFILE=Ryan ./scripts/test-inbound-email-production.sh
```

**Pass criteria:**

| Check | Expected |
|-------|----------|
| Receive + processor Lambdas | `PAPYRUS_MEDIA_BUCKET_NAME` set |
| `model-attachment-upload` Lambda | `PAPYRUS_MEDIA_BUCKET_NAME` / `papyrusMedia_BUCKET_NAME` set |
| After successful processing | MIME under `inbound-email-archived/`, not under `inbound-email/` (except `AMAZON_SES_SETUP_NOTIFICATION`) |
| Retry sweep | `processedCount: 0` when nothing pending; otherwise `responseStatus: COMPLETED` |

### Replay without resending mail

1. Leave (or restore) a MIME object under `inbound-email/<key>`.
2. Invoke retry sweep:

   ```bash
   aws lambda invoke --function-name <receive-fn> \
     --payload '{"source":"papyrus.inbound-email","action":"retry-pending"}' \
     --cli-binary-format raw-in-base64-out /tmp/out.json
   ```

3. Or invoke the processor directly:

   ```bash
   aws lambda invoke --function-name <processor-fn> \
     --payload '{"messageId":"message-email-submission-..."}' \
     --cli-binary-format raw-in-base64-out /tmp/out.json \
     --cli-read-timeout 600
   ```

### Common failures

| Symptom | Likely cause |
|---------|----------------|
| `Missing Papyrus storage bucket environment variable` | Resolver Lambdas missing `PAPYRUS_MEDIA_BUCKET_NAME` (deploy `backend.ts` media env block) |
| `cannot import name 'run_reference_metadata_generation_from_extracted_text'` | Wrong import in `email_submissions.py` (use `reference_metadata_generation`) |
| `papyrus-semantic-relation-types.yml` not found | Processor bundle missing `corpora/*.yml` |
| `s3:ListBucket` on archive | Processor role needs bucket-level `ListBucket` (not only object ARNs) |
| Deploy `CloudformationStackCircularDependencyError` | GraphQL Lambdas must use `resourceGroupName: "data"` **inside** `defineFunction({...})`; avoid `allow.resource()` on storage for data-stack functions |
