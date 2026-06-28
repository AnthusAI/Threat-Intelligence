# Web Console Chat IAM Fix

## Issue

Production web console chat was failing for users with the error:

```
Could not resolve JWT signing secret
```

This prevented the console-chat-responder Lambda from minting GraphQL JWTs needed to call execute_tactus tools.

## Root Cause

The `console-chat-responder` Lambda IAM role had permission for `ssm:GetParameter` (singular) but the Python code uses boto3's `get_parameters` (plural) API. When the Lambda tried to read the JWT secret from AWS Systems Manager Parameter Store, it was denied access.

The relevant code path:
1. User sends message via /newsroom console chat
2. Message written to DynamoDB with `responseStatus: "PENDING"`
3. DynamoDB stream triggers `console-chat-responder` Lambda  
4. Responder calls `execute_tactus` subprocess
5. Subprocess tries to mint JWT using `boto3.client('ssm').get_parameters(...)`
6. IAM denies access because policy only allowed `GetParameter` (singular)
7. Error: "Could not resolve JWT signing secret"
8. User sees no response or timeout

## Fix

**PR #23** / **Commit `0c39cbb`**

Updated `amplify/functions/console-chat-responder/resource.ts` to grant both:
- `ssm:GetParameter` (singular, for compatibility)
- `ssm:GetParameters` (plural, required for boto3 call)

```typescript
this.responderFunction.addToRolePolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ["ssm:GetParameter", "ssm:GetParameters"],  // Both actions now
  resources: [
    `arn:aws:ssm:${stack.region}:${stack.account}:parameter/amplify/papyrus/*`,
    `arn:aws:ssm:${stack.region}:${stack.account}:parameter/amplify/shared/papyrus/*`,
    // ... additional paths
  ],
}));
```

## Deployment

The fix is merged to `main` and should deploy automatically via the Amplify pipeline for app `dbsyytcm9drqa`.

### Verify Deployment

Check that main has the fix commit:

```bash
cd ~/Projects/Papyrus
git log --oneline | grep "console-chat-responder SSM"
# Should show: 0c39cbb Fix console-chat-responder SSM permissions for execute_tactus JWT minting
```

### Check Amplify Deployment Status

Via AWS Console:
1. Open Amplify Console for app `dbsyytcm9drqa`
2. Go to main branch
3. Verify latest build includes commit `0c39cbb` or later
4. Check that both Backend and Hosting builds succeeded

Via GitHub:
1. Check [Papyrus repository](https://github.com/AnthusAI/Papyrus)
2. Verify Actions workflow for main branch shows green
3. Confirm Amplify deploy completed successfully

## Testing

### Automated Test

Run the production smoke test script:

```bash
cd ~/Projects/Papyrus-production  # or ~/Projects/Papyrus
export AWS_PROFILE=Ryan
export AWS_REGION=us-east-1
./scripts/test-console-chat-production.sh
```

The script will:
1. ✓ Check Lambda configuration
2. ✓ Verify IAM role has `ssm:GetParameters` permission
3. ✓ Show recent Lambda logs for errors
4. ✓ Query recent console_chat_turn messages and their status
5. ✓ Report if JWT errors are present

### Manual Test

1. Open https://p.apyr.us/newsroom (production) as an editor/admin user
2. Click the console chat icon (top right)
3. Send a test message, e.g., "list recent references"
4. Verify you receive a response within ~30-60 seconds
5. Check that the response includes actual data from execute_tactus tools

### Check CloudWatch Logs

```bash
export AWS_PROFILE=Ryan
export AWS_REGION=us-east-1
aws logs tail /aws/lambda/amplify-dbsyytcm9drqa-mai-ConsoleChatResponderFunc-PnFuItfGGO4D \
  --since 10m \
  --format short
```

Successful logs should show:
```
processing console chat message
console chat message completed
```

Failed logs (before fix) showed:
```
Could not resolve JWT signing secret
```

### Check Message Status in DynamoDB

Query recent console chat messages:

```bash
export AWS_PROFILE=Ryan
export AWS_REGION=us-east-1
aws dynamodb query \
  --table-name Message-s4sclnevjjbzpmj4vhallzvw3e-NONE \
  --index-name messagesByMessageKindAndCreatedAt \
  --key-condition-expression 'messageKind = :kind' \
  --expression-attribute-values '{"kind":{"S":"console_chat_turn"}}' \
  --no-scan-index-forward \
  --limit 5 \
  --query 'Items[*].[createdAt.S, role.S, responseStatus.S, responseError.S]' \
  --output table
```

Before fix: `responseStatus = FAILED` with `responseError` containing JWT error
After fix: `responseStatus = COMPLETED` with no `responseError`

## Related Issues

This same IAM pattern was also needed for:
- Slack agent delivery (similar SSM access for bot token)
- Email submission replies (JWT for GraphQL authoring)

All three have been fixed with the `ssm:GetParameters` permission on the relevant Lambda roles.

## Files Changed

- `amplify/functions/console-chat-responder/resource.ts` - Added GetParameters permission
- `amplify/functions/shared/slack-events.ts` - Aligned Slack prompt with console style
- `src/papyrus_newsroom/slack_agent.py` - Updated agent instructions
- `procedures/newsroom/tests/test_slack_agent.py` - Test coverage
- `docs/slack-agent.md` - Documentation

## Prevention

When adding new Lambdas that need to read Amplify secrets:
1. Always grant both `ssm:GetParameter` and `ssm:GetParameters`
2. Use resource ARNs that match the Amplify secret path structure
3. Test with actual boto3 calls, not just AWS CLI (they use different APIs)

## Rollback

If needed, the previous working state before Slack/console fixes was commit `eb3353f`.

However, rolling back would break Slack integration and reintroduce the console chat JWT bug. Instead, if there are issues with the fix itself:

1. Check the resource ARN patterns match the actual SSM parameter paths
2. Verify the Lambda role trust relationship allows Lambda service to assume it
3. Check that PAPYRUS_JWT_SECRET exists in SSM at the expected path

## Support

For issues:
1. Run `scripts/test-console-chat-production.sh` and share output
2. Check CloudWatch logs for the responder Lambda
3. Query recent Message records for responseError details
4. Verify Amplify deploy for main succeeded (backend phase)
