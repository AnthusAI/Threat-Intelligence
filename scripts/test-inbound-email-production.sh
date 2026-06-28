#!/usr/bin/env bash
# Production smoke test for inbound email (SES → S3 → receive → processor → archive).
# Requires AWS CLI credentials (e.g. AWS_PROFILE=Ryan) and deploy on main.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROFILE="${AWS_PROFILE:-Ryan}"
REGION="${AWS_REGION:-us-east-1}"
APP_ID="${PAPYRUS_AMPLIFY_APP_ID:-dbsyytcm9drqa}"
BRANCH="${PAPYRUS_AMPLIFY_BRANCH:-main}"

RECEIVE_FN="${PAPYRUS_INBOUND_RECEIVE_FUNCTION:-amplify-dbsyytcm9drqa-mai-papyrussesinboundreceive-vneS3Lzu34l2}"
PROCESSOR_FN="${PAPYRUS_EMAIL_PROCESSOR_FUNCTION:-amplify-dbsyytcm9drqa-mai-papyrusemailsubmissionpr-TP0Pll3fvbHs}"
ATTACHMENT_FN="${PAPYRUS_MODEL_ATTACHMENT_FUNCTION:-amplify-dbsyytcm9drqa-mai-papyrusmodelattachmentup-0NrJE6OT1JlE}"

aws_cli() {
  aws --profile "$PROFILE" --region "$REGION" "$@"
}

echo "== Inbound email production smoke test =="
echo "Profile: $PROFILE  Region: $REGION"

if [[ -f amplify_outputs.json ]]; then
  BUCKET="$(python3 -c "import json; o=json.load(open('amplify_outputs.json')); print((o.get('storage') or {}).get('bucket_name',''))")"
else
  BUCKET=""
fi
BUCKET="${PAPYRUS_MEDIA_BUCKET_NAME:-$BUCKET}"
if [[ -z "$BUCKET" ]]; then
  echo "ERROR: Set PAPYRUS_MEDIA_BUCKET_NAME or run from repo with amplify_outputs.json" >&2
  exit 1
fi
echo "Media bucket: $BUCKET"

echo ""
echo "-- Lambda environment (bucket env required for GraphQL resolvers) --"
for fn in "$RECEIVE_FN" "$PROCESSOR_FN" "$ATTACHMENT_FN"; do
  echo "Function: $fn"
  aws_cli lambda get-function-configuration --function-name "$fn" \
    --query 'Environment.Variables.{PAPYRUS_MEDIA:PAPYRUS_MEDIA_BUCKET_NAME,papyrusMedia:papyrusMedia_BUCKET_NAME}' \
    --output table
done

echo ""
echo "-- S3 prefixes --"
echo "inbound-email/ (pending intake; excludes SES setup notification):"
aws_cli s3 ls "s3://${BUCKET}/inbound-email/" || true
echo ""
echo "inbound-email-archived/ (processed MIME):"
aws_cli s3 ls "s3://${BUCKET}/inbound-email-archived/" | tail -5 || true

echo ""
echo "-- Retry sweep (re-process any eligible MIME still under inbound-email/) --"
RETRY_OUT="$(mktemp)"
aws_cli lambda invoke \
  --function-name "$RECEIVE_FN" \
  --payload '{"source":"papyrus.inbound-email","action":"retry-pending"}' \
  --cli-binary-format raw-in-base64-out \
  "$RETRY_OUT" >/dev/null
python3 -m json.tool "$RETRY_OUT"
rm -f "$RETRY_OUT"

if [[ -n "${MESSAGE_ID:-}" ]]; then
  echo ""
  echo "-- Processor invoke for MESSAGE_ID=$MESSAGE_ID (may take several minutes) --"
  PROC_OUT="$(mktemp)"
  aws_cli lambda invoke \
    --function-name "$PROCESSOR_FN" \
    --payload "{\"messageId\":\"${MESSAGE_ID}\"}" \
    --cli-binary-format raw-in-base64-out \
    "$PROC_OUT" \
    --cli-read-timeout 600
  python3 -m json.tool "$PROC_OUT"
  rm -f "$PROC_OUT"
fi

echo ""
echo "-- Latest Amplify deploy on $BRANCH --"
aws_cli amplify list-jobs --app-id "$APP_ID" --branch-name "$BRANCH" --max-results 1 \
  --query 'jobSummaries[0].[jobId,status,commitId]' --output table

echo ""
echo "Done. For a full E2E test, send mail with a URL/DOI from a registered user to"
echo "submissions@p.apyr.us or suggestions@p.apyr.us, then re-run this script."
