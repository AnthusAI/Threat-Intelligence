#!/usr/bin/env bash
# Fresh inbound-email E2E against production: upload synthetic MIME, receive, wait for processor, verify archive.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROFILE="${AWS_PROFILE:-Ryan}"
REGION="${AWS_REGION:-us-east-1}"
RECEIVE_FN="${PAPYRUS_INBOUND_RECEIVE_FUNCTION:-amplify-dbsyytcm9drqa-mai-papyrussesinboundreceive-vneS3Lzu34l2}"
SENDER="${PAPYRUS_INBOUND_TEST_SENDER:-ryan@anth.us}"
RECIPIENT="${PAPYRUS_INBOUND_TEST_RECIPIENT:-submissions@p.apyr.us}"
WAIT_SECONDS="${PAPYRUS_INBOUND_E2E_WAIT_SECONDS:-240}"

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
REL_KEY="e2e-${STAMP}-${RAND}"
S3_KEY="inbound-email/${REL_KEY}"
ARCHIVE_KEY="inbound-email-archived/${REL_KEY}"
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
trap 'rm -f "$MIME_FILE" "$EVENT_FILE"' EXIT
cat >"$EVENT_FILE" <<EOF
{
  "source": "aws.s3",
  "detail": {
    "bucket": {"name": "${BUCKET}"},
    "object": {"key": "${S3_KEY}"}
  }
}
EOF

echo "Invoking receive Lambda (starts async processor)..."
RECEIVE_OUT="$(mktemp)"
trap 'rm -f "$MIME_FILE" "$EVENT_FILE" "$RECEIVE_OUT"' EXIT
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

echo "Waiting up to ${WAIT_SECONDS}s for MIME archive (processor runs asynchronously)..."
deadline=$(( $(date +%s) + WAIT_SECONDS ))
archived=0
while [[ $(date +%s) -lt $deadline ]]; do
  if aws_cli s3api head-object --bucket "$BUCKET" --key "$ARCHIVE_KEY" >/dev/null 2>&1; then
    archived=1
    break
  fi
  sleep 10
done

if [[ "$archived" -ne 1 ]]; then
  echo "ERROR: timed out waiting for s3://${BUCKET}/${ARCHIVE_KEY}" >&2
  echo "Intake prefix listing:" >&2
  aws_cli s3 ls "s3://${BUCKET}/inbound-email/" | tail -5 >&2 || true
  exit 1
fi

if aws_cli s3api head-object --bucket "$BUCKET" --key "$S3_KEY" >/dev/null 2>&1; then
  echo "WARN: intake copy still present (delete may be delayed)" >&2
fi

echo "E2E PASS messageId=${MESSAGE_ID} archived=${ARCHIVE_KEY} url=${TEST_URL}"
