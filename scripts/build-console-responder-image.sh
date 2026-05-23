#!/usr/bin/env bash
set -euo pipefail

# Builds and pushes the console responder image to ECR, then prints an image URI
# suitable for PAPYRUS_CONSOLE_RESPONDER_IMAGE_URI.
#
# Required env:
#   AWS_REGION
#   AWS_ACCOUNT_ID
# Optional env:
#   ECR_REPOSITORY (default: papyrus-console-chat-responder)
#   IMAGE_TAG (default: git SHA or "latest")

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AWS_REGION="${AWS_REGION:-}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-}"
ECR_REPOSITORY="${ECR_REPOSITORY:-papyrus-console-chat-responder}"
IMAGE_TAG="${IMAGE_TAG:-$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo latest)}"

if [[ -z "$AWS_REGION" || -z "$AWS_ACCOUNT_ID" ]]; then
  echo "AWS_REGION and AWS_ACCOUNT_ID are required" >&2
  exit 1
fi

ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPOSITORY}"
IMAGE_URI="${ECR_URI}:${IMAGE_TAG}"

aws ecr describe-repositories --repository-names "$ECR_REPOSITORY" >/dev/null 2>&1 \
  || aws ecr create-repository --repository-name "$ECR_REPOSITORY" >/dev/null

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

docker build \
  -f "$ROOT_DIR/amplify/functions/console-chat-responder/Dockerfile" \
  -t "$IMAGE_URI" \
  "$ROOT_DIR"

docker push "$IMAGE_URI"

echo "Pushed: $IMAGE_URI"
echo "Set PAPYRUS_ENABLE_CONSOLE_RESPONDER=true"
echo "Set PAPYRUS_CONSOLE_RESPONDER_IMAGE_URI=$IMAGE_URI"
