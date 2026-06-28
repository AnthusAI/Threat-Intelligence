#!/usr/bin/env bash
# Request SES verification for addresses that receive inbound submission feedback email.
# In SES sandbox, outbound mail (feedback replies) may only go to verified identities.
#
# Usage:
#   AWS_PROFILE=YourAdminProfile ./scripts/verify-ses-feedback-recipients.sh \
#     rap@endymion.com ryan@anth.us
#
# Each address receives an email from AWS with a confirmation link. Feedback cannot be
# delivered to that address until VerificationStatus is SUCCESS.
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
PROFILE="${AWS_PROFILE:-}"

aws_cli() {
  if [[ -n "$PROFILE" ]]; then
    aws --profile "$PROFILE" --region "$REGION" "$@"
  else
    aws --region "$REGION" "$@"
  fi
}

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <email> [<email> ...]" >&2
  echo "Example: AWS_PROFILE=Ryan $0 rap@endymion.com ryan@anth.us" >&2
  exit 1
fi

echo "SES region: $REGION"
echo ""

for email in "$@"; do
  normalized="$(printf '%s' "$email" | tr '[:upper:]' '[:lower:]')"
  echo "== $normalized =="
  if aws_cli sesv2 create-email-identity --email-identity "$normalized" 2>/tmp/ses-create-identity.err; then
    echo "Verification email requested (new identity)."
  else
    if grep -q "AlreadyExistsException" /tmp/ses-create-identity.err 2>/dev/null; then
      echo "Identity already exists; checking status..."
    else
      cat /tmp/ses-create-identity.err >&2
      exit 1
    fi
  fi
  status="$(aws_cli sesv2 get-email-identity --email-identity "$normalized" \
    --query 'VerificationStatus' --output text 2>/dev/null || echo "UNKNOWN")"
  echo "VerificationStatus: $status"
  if [[ "$status" == "SUCCESS" ]]; then
    echo "Ready to receive feedback mail from SES."
  elif [[ "$status" == "PENDING" ]]; then
    echo "Action required: open the AWS verification message in this inbox and click the link."
    echo "If the mail is old or missing, delete and recreate the identity to resend:"
    echo "  aws sesv2 delete-email-identity --email-identity $normalized --region $REGION"
    echo "  aws sesv2 create-email-identity --email-identity $normalized --region $REGION"
  else
    echo "Check SES console → Verified identities → $normalized"
  fi
  echo ""
done

rm -f /tmp/ses-create-identity.err
echo "Done. Sandbox accounts may still need production access to mail arbitrary addresses."
