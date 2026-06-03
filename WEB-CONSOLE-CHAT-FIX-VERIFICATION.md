# Production Web Console Chat IAM Fix - Verification Guide

## Summary

The production web console chat was failing with "Could not resolve JWT signing secret" errors when users tried to use Papyrus tools. This was caused by an IAM permissions mismatch.

### Root Cause

- The Python code uses boto3's `get_parameters()` (plural) API to read SSM secrets
- The Lambda IAM policy only granted `ssm:GetParameter` (singular) permission  
- Result: AccessDeniedException when trying to mint JWTs for GraphQL authoring

### The Fix

**Commit:** `0c39cbb` - Fix console-chat-responder SSM permissions for execute_tactus JWT minting  
**PR:** #23 - https://github.com/AnthusAI/Papyrus/pull/23  
**Merged:** June 3, 2026 at 21:37:48Z

**Changes:**
- Added `ssm:GetParameters` (plural) alongside existing `ssm:GetParameter` (singular)
- Updated SSM resource ARNs to include production app paths:
  - `/amplify/papyrus/*`
  - `/amplify/shared/papyrus/*`
  - `/amplify/shared/*`
  - `/amplify/dbsyytcm9drqa/*` (production app ID)
  - `/amplify/shared/dbsyytcm9drqa/*`

**File:** `amplify/functions/console-chat-responder/resource.ts` lines 114-124

### Code Flow

1. Web console message triggers console-chat-responder Lambda
2. Lambda runs execute_tactus_runner.py
3. `ensure_graphql_authoring_jwt()` is called (src/papyrus_content/env.py:129)
4. `_resolve_secret()` is called (src/papyrus_content/auth_commands.py:117)
5. `_read_ssm_secret_boto()` uses `client.get_parameters(Names=[...])` (line 71)
6. This requires `ssm:GetParameters` IAM permission (now granted)

## Verification Steps

### 1. Check Deployment Status

```bash
# Check if the fix commit is deployed
cd ~/Projects/Papyrus-production
git pull origin main
git log --oneline -5 | grep 0c39cbb

# Should show:
# 0c39cbb Fix console-chat-responder SSM permissions for execute_tactus JWT minting
```

Check Amplify Console:
- App: dbsyytcm9drqa
- Branch: main
- Look for successful deployment after commit 0c39cbb (June 3, 2026)

### 2. Verify Lambda IAM Permissions

```bash
export AWS_PROFILE=Ryan
export AWS_REGION=us-east-1

# Find the current Lambda function name
FUNCTION_NAME=$(aws lambda list-functions \
  --query 'Functions[?contains(FunctionName, `ConsoleChatResponder`)].FunctionName' \
  --output text)

echo "Found function: $FUNCTION_NAME"

# Get the IAM role
ROLE_ARN=$(aws lambda get-function \
  --function-name "$FUNCTION_NAME" \
  --query 'Configuration.Role' \
  --output text)

ROLE_NAME=$(echo "$ROLE_ARN" | awk -F'/' '{print $NF}')

echo "Role: $ROLE_NAME"

# List inline policies
aws iam list-role-policies \
  --role-name "$ROLE_NAME" \
  --output table

# Check each policy for SSM permissions
for policy in $(aws iam list-role-policies --role-name "$ROLE_NAME" --query 'PolicyNames[]' --output text); do
  echo ""
  echo "=== Policy: $policy ==="
  aws iam get-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-name "$policy" \
    --output json | jq '.PolicyDocument.Statement[] | select(.Action | contains(["ssm:GetParameters"]) or contains(["ssm:GetParameter"]))'
done
```

**Expected output:** You should see a policy statement with:
- `"Action": ["ssm:GetParameter", "ssm:GetParameters"]`
- Resources including `parameter/amplify/papyrus/*` and `parameter/amplify/dbsyytcm9drqa/*`

### 3. Test Web Console Chat

1. **Navigate to production Papyrus:**
   - Open https://papyrus.example.com/newsroom (replace with actual URL)
   - Sign in as an editor

2. **Open console chat:**
   - Click the console chat icon in the top bar
   - Wait for thread to load

3. **Send a test message that requires tools:**
   ```
   What are the 5 most recent references?
   ```
   
   Or:
   ```
   List recent references about machine learning
   ```

4. **What to expect:**
   - **Success:** The assistant responds with a list of references (takes 10-60 seconds)
   - **Failure:** Error message about JWT or "Could not resolve JWT signing secret"

### 4. Check CloudWatch Logs

```bash
export AWS_PROFILE=Ryan
export AWS_REGION=us-east-1

# Get the function name
FUNCTION_NAME=$(aws lambda list-functions \
  --query 'Functions[?contains(FunctionName, `ConsoleChatResponder`)].FunctionName' \
  --output text)

LOG_GROUP="/aws/lambda/$FUNCTION_NAME"

# Get recent log streams
aws logs describe-log-streams \
  --log-group-name "$LOG_GROUP" \
  --order-by LastEventTime \
  --descending \
  --max-items 3 \
  --query 'logStreams[*].{Name:logStreamName,LastEvent:lastEventTime}' \
  --output table

# Get latest stream name
LATEST_STREAM=$(aws logs describe-log-streams \
  --log-group-name "$LOG_GROUP" \
  --order-by LastEventTime \
  --descending \
  --max-items 1 \
  --query 'logStreams[0].logStreamName' \
  --output text)

# View recent logs
echo ""
echo "=== Recent logs from $LATEST_STREAM ==="
aws logs get-log-events \
  --log-group-name "$LOG_GROUP" \
  --log-stream-name "$LATEST_STREAM" \
  --limit 50 \
  --output json | jq -r '.events[].message'
```

**Look for:**
- ✅ Success: No "Could not resolve JWT signing secret" errors
- ✅ Success: Messages showing "COMPLETED" status
- ✅ Success: No AccessDeniedException errors
- ❌ Failure: Any JWT-related errors
- ❌ Failure: SSM permission denied errors

### 5. Check Recent Message Status in DynamoDB

```bash
export AWS_PROFILE=Ryan
export AWS_REGION=us-east-1

# Find the Message table
TABLE_NAME=$(aws dynamodb list-tables \
  --query 'TableNames[?contains(@, `Message`)]' \
  --output text | grep -v Thread | head -1)

echo "Message table: $TABLE_NAME"

# Get recent console chat messages
aws dynamodb scan \
  --table-name "$TABLE_NAME" \
  --filter-expression "messageKind = :kind AND begins_with(createdAt, :today)" \
  --expression-attribute-values '{
    ":kind": {"S": "console_chat_turn"},
    ":today": {"S": "'$(date -u +%Y-%m-%d)'"}}' \
  --max-items 10 \
  --query 'Items[*].{
    ID:id.S,
    CreatedAt:createdAt.S,
    Role:messageRole.S,
    ResponseStatus:responseStatus.S
  }' \
  --output table
```

**Expected:**
- User messages with `responseStatus: COMPLETED`
- Assistant messages with proper responses
- No messages stuck in `RUNNING` or `FAILED` state

## Success Criteria

✅ **Fix is deployed** if:
1. Commit 0c39cbb is on main branch in Amplify
2. Latest deployment succeeded (check Amplify console)
3. Lambda IAM role has both `ssm:GetParameter` and `ssm:GetParameters`

✅ **Fix is working** if:
1. Web console chat responds successfully to tool-using queries
2. CloudWatch logs show no JWT secret resolution errors
3. Messages reach COMPLETED status
4. No AccessDeniedException in logs

## Troubleshooting

### If verification shows IAM permissions are missing:

The CloudFormation stack may not have updated. Force a redeploy:

1. Check Amplify console deployment history
2. If commit 0c39cbb deployed but IAM didn't update:
   - Trigger a manual redeploy from Amplify console
   - Or push a trivial commit to force pipeline re-run

### If chat still fails after IAM is correct:

1. **Check AMPLIFY_SSM_ENV_CONFIG:**
   ```bash
   aws lambda get-function-configuration \
     --function-name <FUNCTION_NAME> \
     --query 'Environment.Variables.AMPLIFY_SSM_ENV_CONFIG'
   ```
   Should point to proper JWT secret path

2. **Check SSM parameter exists:**
   ```bash
   aws ssm get-parameters \
     --names "/amplify/papyrus/ryan-sandbox-adcd88a186/PAPYRUS_JWT_SECRET" \
     --with-decryption \
     --query 'Parameters[0].Value' \
     --output text
   ```
   Should return the JWT secret (will be long string)

3. **Check GraphQL endpoint:**
   ```bash
   aws lambda get-function-configuration \
     --function-name <FUNCTION_NAME> \
     --query 'Environment.Variables.PAPYRUS_GRAPHQL_ENDPOINT'
   ```
   Should be the production AppSync endpoint

### If messages stuck in RUNNING:

1. Check Lambda timeout - should be 2 minutes (120s)
2. Check Lambda memory - should be 1024 MB minimum
3. Check if Lambda is being throttled (CloudWatch metrics)

## Rollback Plan (if needed)

If the fix causes issues:

1. **Immediate rollback:** Revert to previous working commit:
   ```bash
   cd ~/Projects/Papyrus
   git revert 0c39cbb --no-commit
   git commit -m "Revert: console-chat-responder IAM fix"
   git push origin main
   ```

2. **Wait for Amplify to deploy the revert**

3. **Temporary workaround:** Set PAPYRUS_JWT_SECRET directly in Lambda environment:
   ```bash
   SECRET=$(aws ssm get-parameter \
     --name "/amplify/papyrus/ryan-sandbox-adcd88a186/PAPYRUS_JWT_SECRET" \
     --with-decryption \
     --query 'Parameter.Value' \
     --output text)
   
   aws lambda update-function-configuration \
     --function-name <FUNCTION_NAME> \
     --environment "Variables={PAPYRUS_JWT_SECRET=$SECRET,...}"
   ```

## Related Documentation

- Console Chat Runbook: `docs/console-chat-runbook.md`
- PR #23: https://github.com/AnthusAI/Papyrus/pull/23
- Slack Thread: Discussion from June 1-3, 2026
- AGENTS.md: GraphQL auth split section

## Contact

If verification fails or issues persist:
- Check #papyrus-tech Slack channel
- Review CloudWatch logs for detailed error messages
- Check Amplify deployment logs in console
