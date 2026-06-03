#!/usr/bin/env bash
# Production smoke test for web console chat (DynamoDB → console-chat-responder → execute_tactus).
# Requires AWS CLI credentials (e.g. AWS_PROFILE=Ryan) and deploy on main with commit 0c39cbb or later.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROFILE="${AWS_PROFILE:-Ryan}"
REGION="${AWS_REGION:-us-east-1}"
APP_ID="${PAPYRUS_AMPLIFY_APP_ID:-dbsyytcm9drqa}"
BRANCH="${PAPYRUS_AMPLIFY_BRANCH:-main}"

RESPONDER_FN="${PAPYRUS_CONSOLE_RESPONDER_FUNCTION:-amplify-dbsyytcm9drqa-mai-ConsoleChatResponderFunc-PnFuItfGGO4D}"
MESSAGE_TABLE="${PAPYRUS_MESSAGE_TABLE:-Message-s4sclnevjjbzpmj4vhallzvw3e-NONE}"

aws_cli() {
  aws --profile "$PROFILE" --region "$REGION" "$@"
}

echo "== Web Console Chat Production Test =="
echo "Profile: $PROFILE  Region: $REGION"
echo "Testing fix: PR #23 / commit 0c39cbb - SSM GetParameters IAM permission"
echo ""

# Check Lambda configuration
echo "=== 1. Lambda Configuration ==="
LAMBDA_CONFIG=$(aws_cli lambda get-function-configuration --function-name "$RESPONDER_FN" 2>&1)
if [[ $? -ne 0 ]]; then
  echo "ERROR: Cannot access Lambda function $RESPONDER_FN"
  echo "$LAMBDA_CONFIG"
  exit 1
fi

echo "$LAMBDA_CONFIG" | jq '{
  LastModified: .LastModified,
  State: .State,
  LastUpdateStatus: .LastUpdateStatus,
  Timeout: .Timeout,
  MemorySize: .MemorySize,
  CodeSize: .CodeSize
}'

# Check IAM role and SSM permissions
echo ""
echo "=== 2. IAM Role SSM Permissions Check ==="
ROLE_ARN=$(echo "$LAMBDA_CONFIG" | jq -r '.Role')
ROLE_NAME=$(echo "$ROLE_ARN" | cut -d'/' -f2)
echo "Role: $ROLE_NAME"

# Get inline and attached policies
echo ""
echo "Checking for SSM permissions..."
SSM_FOUND=false

# Check attached policies
ATTACHED_POLICIES=$(aws_cli iam list-attached-role-policies --role-name "$ROLE_NAME" 2>/dev/null | jq -r '.AttachedPolicies[].PolicyArn')
for policy_arn in $ATTACHED_POLICIES; do
  VERSION=$(aws_cli iam get-policy --policy-arn "$policy_arn" --query 'Policy.DefaultVersionId' --output text)
  POLICY_DOC=$(aws_cli iam get-policy-version --policy-arn "$policy_arn" --version-id "$VERSION" --query 'PolicyVersion.Document')
  
  # Check if policy has SSM actions
  SSM_ACTIONS=$(echo "$POLICY_DOC" | jq -r '.Statement[] | select(.Action[]? | contains("ssm:")) | .Action[]' 2>/dev/null || echo "")
  if [[ -n "$SSM_ACTIONS" ]]; then
    echo "✓ Found SSM permissions in policy: $(basename $policy_arn)"
    echo "$SSM_ACTIONS" | grep -E "ssm:GetParameter" | while read action; do
      echo "  - $action"
    done
    
    # Check for both GetParameter and GetParameters
    if echo "$SSM_ACTIONS" | grep -q "ssm:GetParameters"; then
      echo "  ✓ Has ssm:GetParameters (REQUIRED for fix)"
      SSM_FOUND=true
    fi
    if echo "$SSM_ACTIONS" | grep -q "ssm:GetParameter" && ! echo "$SSM_ACTIONS" | grep -q "ssm:GetParameters"; then
      echo "  ⚠ Has ssm:GetParameter but missing ssm:GetParameters"
      echo "  This may cause JWT minting to fail - deploy needs commit 0c39cbb or later"
    fi
    
    # Show resource ARNs
    RESOURCES=$(echo "$POLICY_DOC" | jq -r '.Statement[] | select(.Action[]? | contains("ssm:")) | .Resource[]' 2>/dev/null | head -5)
    if [[ -n "$RESOURCES" ]]; then
      echo "  Resource ARNs:"
      echo "$RESOURCES" | while read res; do
        echo "    $res"
      done
    fi
  fi
done

# Check inline policies
INLINE_POLICIES=$(aws_cli iam list-role-policies --role-name "$ROLE_NAME" 2>/dev/null | jq -r '.PolicyNames[]')
for policy_name in $INLINE_POLICIES; do
  POLICY_DOC=$(aws_cli iam get-role-policy --role-name "$ROLE_NAME" --policy-name "$policy_name" --query 'PolicyDocument')
  
  SSM_ACTIONS=$(echo "$POLICY_DOC" | jq -r '.Statement[] | select(.Action[]? | contains("ssm:")) | .Action[]' 2>/dev/null || echo "")
  if [[ -n "$SSM_ACTIONS" ]]; then
    echo "✓ Found SSM permissions in inline policy: $policy_name"
    echo "$SSM_ACTIONS" | grep -E "ssm:GetParameter" | while read action; do
      echo "  - $action"
    done
    
    if echo "$SSM_ACTIONS" | grep -q "ssm:GetParameters"; then
      echo "  ✓ Has ssm:GetParameters (REQUIRED for fix)"
      SSM_FOUND=true
    fi
  fi
done

if [[ "$SSM_FOUND" == "false" ]]; then
  echo ""
  echo "❌ PROBLEM: Lambda role missing ssm:GetParameters permission"
  echo "This will cause 'Could not resolve JWT signing secret' errors"
  echo "Required fix: Deploy main branch with commit 0c39cbb or later"
  echo ""
  echo "The fix adds ssm:GetParameters alongside ssm:GetParameter in:"
  echo "  amplify/functions/console-chat-responder/resource.ts"
fi

# Check recent Lambda logs
echo ""
echo "=== 3. Recent Lambda Logs (last 10 minutes) ==="
LOGS=$(aws_cli logs tail "/aws/lambda/$RESPONDER_FN" --since 10m --format short 2>&1 || echo "")
if [[ -z "$LOGS" || "$LOGS" == *"ResourceNotFoundException"* ]]; then
  echo "No recent invocations or log group not found"
  echo "This might mean no one has used web console chat recently"
else
  echo "$LOGS" | tail -100
  
  # Check for specific errors
  if echo "$LOGS" | grep -qi "Could not resolve JWT signing secret"; then
    echo ""
    echo "❌ FOUND ERROR: 'Could not resolve JWT signing secret'"
    echo "This confirms the IAM permission issue"
    echo "Lambda cannot read PAPYRUS_JWT_SECRET from SSM"
  fi
  
  if echo "$LOGS" | grep -qi "console chat message completed"; then
    echo ""
    echo "✓ Found successful console chat completions"
  fi
fi

# Check recent console_chat_turn messages
echo ""
echo "=== 4. Recent Console Chat Messages ==="
echo "Querying last 5 console_chat_turn messages..."
RECENT_MESSAGES=$(aws_cli dynamodb query \
  --table-name "$MESSAGE_TABLE" \
  --index-name messagesByMessageKindAndCreatedAt \
  --key-condition-expression 'messageKind = :kind' \
  --expression-attribute-values '{":kind":{"S":"console_chat_turn"}}' \
  --projection-expression 'id,#r,responseStatus,responseError,createdAt,updatedAt' \
  --expression-attribute-names '{"#r":"role"}' \
  --no-scan-index-forward \
  --limit 5 2>&1)

if [[ $? -eq 0 ]]; then
  echo "$RECENT_MESSAGES" | jq -r '.Items[] | "\(.createdAt.S // "N/A") - \(.role.S // "N/A") - Status: \(.responseStatus.S // "N/A")\(if .responseError.S then " - ERROR: " + .responseError.S else "" end)"' || echo "$RECENT_MESSAGES"
  
  # Check for JWT errors in response
  if echo "$RECENT_MESSAGES" | grep -qi "Could not resolve JWT"; then
    echo ""
    echo "❌ FOUND: Messages with JWT resolution errors"
    echo "Users are experiencing the IAM permission bug"
  fi
  
  # Count recent failures
  FAILED_COUNT=$(echo "$RECENT_MESSAGES" | jq '[.Items[] | select(.responseStatus.S == "FAILED")] | length' 2>/dev/null || echo "0")
  COMPLETED_COUNT=$(echo "$RECENT_MESSAGES" | jq '[.Items[] | select(.responseStatus.S == "COMPLETED")] | length' 2>/dev/null || echo "0")
  
  echo ""
  echo "Recent status: $COMPLETED_COUNT completed, $FAILED_COUNT failed (of last 5)"
  
  if [[ "$FAILED_COUNT" -gt 0 ]]; then
    echo "⚠ Found failed messages - check responseError details above"
  fi
else
  echo "Could not query messages: $RECENT_MESSAGES"
fi

# Summary
echo ""
echo "=== Summary ==="
if [[ "$SSM_FOUND" == "true" ]]; then
  echo "✓ Lambda has ssm:GetParameters permission (fix is deployed)"
  
  if [[ "$FAILED_COUNT" -eq 0 ]] && [[ "$COMPLETED_COUNT" -gt 0 ]]; then
    echo "✓ Recent messages completed successfully"
    echo "✓ Web console chat appears to be working"
  elif [[ "$FAILED_COUNT" -gt 0 ]]; then
    echo "⚠ IAM fix is deployed but recent messages failed"
    echo "Check logs above for error details"
  else
    echo "- No recent activity to verify end-to-end"
    echo "Recommend: Test by sending a message via /newsroom console"
  fi
else
  echo "❌ Lambda missing required ssm:GetParameters permission"
  echo "❌ Web console chat will fail with JWT resolution errors"
  echo ""
  echo "Fix: Deploy main branch with commit 0c39cbb or later"
  echo "  git log --oneline | grep 'console-chat-responder SSM'"
fi

echo ""
echo "Done."
