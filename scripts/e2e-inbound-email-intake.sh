#!/usr/bin/env bash
# Fresh inbound-email E2E against production: upload synthetic MIME, receive, process, verify archive.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROFILE="${AWS_PROFILE:-Ryan}"
REGION="${AWS_REGION:-us-east-1}"
RECEIVE_FN="${PAPYRUS_INBOUND_RECEIVE_FUNCTION:-amplify-dbsyytcm9drqa-mai-papyrussesinboundreceive-vneS3Lzu34l2}"
PROCESSOR_FN="${PAPYRUS_EMAIL_PROCESSOR_FUNCTION:-amplify-dbsyytcm9drqa-mai-papyrusemailsubmissionpr-TP0Pll3fvbHs}"
SENDER="${PAPYRUS_INBOUND_TEST_SENDER:-ryan@anth.us}"
RECIPIENT="${PAPYRUS_INBOUND_TEST_RECIPIENT:-submissions@p.apyr.us}"

aws_cli() { aws --profile "$PROFILE" --region "$REGION" "$@"; }

BUCKET="${PAPYRUS_MEDIA_BUCKET_NAME:-}"
if [[ -z "$BUCKET" && -f amplify_outputs.json ]]; then
  BUCKET="$(python3 -c "import json; print(json.load(open('amplify_outputs.json')).get('storage',{}).get('bucket_name',''))")"
fi
if [[ -z "$BUCKET" ]]; then
  echo "ERROR: set PAPYRUS_MEDIA_BUCKET_NAME" >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RAND="$(python3 -c 'import secrets; print(secrets.token_hex(8))')"
S3_KEY="inbound-email/e2e-${STAMP}-${RAND}"
# Unique DOI per run so catalog registration creates a new Reference.
TEST_URL="https://doi.org/10.5555/papyrus.e2e.${STAMP}.${RAND}"
MIME_FILE="$(mktemp)"
trap 'rm -f "$MIME_FILE"' EXIT

cat >"$MIME_FILE" <<EOF
From: ${SENDER}
To: ${RECIPIENT}
Subject: Papyrus E2E inbound ${STAMP}
Content-Type: text/plain; charset=utf-8

Please add this direct citation: ${TEST_URL}
EOF

echo "Uploading s3://${BUCKET}/${S3_KEY}"
aws_cli s3 cp "$MIME_FILE" "s3://${BUCKET}/${S3_KEY}"

EVENT_FILE="$(mktemp)"
trap 'rm -f "$MIME_FILE" "$EVENT_FILE" "$RECEIVE_OUT" "$PROC_OUT"' EXIT
cat >"$EVENT_FILE" <<EOF
{
  "source": "aws.s3",
  "detail": {
    "bucket": {"name": "${BUCKET}"},
    "object": {"key": "${S3_KEY}"}
  }
}
EOF

echo "Invoking receive Lambda..."
RECEIVE_OUT="$(mktemp)"
aws_cli lambda invoke \
  --function-name "$RECEIVE_FN" \
  --payload "file://${EVENT_FILE}" \
  --cli-binary-format raw-in-base64-out \
  "$RECEIVE_OUT" >/dev/null
python3 -m json.tool "$RECEIVE_OUT"
MESSAGE_ID="$(python3 -c "import json; print(json.load(open('$RECEIVE_OUT')).get('messageId',''))")"
if [[ -z "$MESSAGE_ID" ]]; then
  echo "ERROR: receive Lambda did not return messageId" >&2
  exit 1
fi

echo "Invoking processor for ${MESSAGE_ID} (may take 1-3 minutes)..."
PROC_OUT="$(mktemp)"
aws_cli lambda invoke \
  --function-name "$PROCESSOR_FN" \
  --payload "{\"messageId\":\"${MESSAGE_ID}\"}" \
  --cli-binary-format raw-in-base64-out \
  "$PROC_OUT" \
  --cli-read-timeout 600 >/dev/null
python3 -m json.tool "$PROC_OUT"

python3 <<PY
import json, sys
proc = json.load(open("$PROC_OUT"))
ok = proc.get("ok") is True and proc.get("status") == "completed"
mime = proc.get("mimeRelease") or {}
released = mime.get("released") is True or mime.get("alreadyArchived") is True
refs = int(proc.get("registeredReferenceCount") or 0)
if not ok:
    sys.exit("processor did not complete: " + json.dumps(proc))
if not released:
    sys.exit("MIME was not archived: " + json.dumps(mime))
if refs < 1:
    sys.exit(f"expected at least one registered reference, got {refs}")
print("E2E PASS", proc.get("messageId"), "refs=", refs, "url=", "$TEST_URL")
PY

echo "Checking S3 archive prefix..."
if aws_cli s3 ls "s3://${BUCKET}/inbound-email-archived/" | grep -q "${S3_KEY#inbound-email/}"; then
  echo "Archived object present."
else
  echo "WARN: archived object not listed (may use different listing timing)" >&2
fi
