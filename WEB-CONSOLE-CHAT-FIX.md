# Web Console Chat Fix - Testing and Verification

## Quick Status Check

To quickly verify if the production web console chat fix is deployed:

```bash
cd ~/Projects/Papyrus-production
git log --oneline -1
# Should show commit 0c39cbb or later

# Run automated test
export AWS_PROFILE=Ryan AWS_REGION=us-east-1
./scripts/test-console-chat-production.sh
```

## What Was Fixed

**Problem**: Production web console chat failing with "Could not resolve JWT signing secret"

**Root Cause**: `console-chat-responder` Lambda IAM role had `ssm:GetParameter` (singular) but Python code uses boto3's `get_parameters` (plural) API.

**Fix**: Added `ssm:GetParameters` permission in `amplify/functions/console-chat-responder/resource.ts`

**Merged**: PR #23, commit `0c39cbb`

## Manual Verification Steps

### 1. Verify Code Fix Is Deployed

```bash
cd ~/Projects/Papyrus-production
git fetch origin main
git log origin/main --oneline | head -10
# Should include: "0c39cbb Fix console-chat-responder SSM permissions for execute_tactus JWT minting"
```

### 2. Check Amplify Deployment

**Via AWS Console:**
- Open Amplify Console → App `dbsyytcm9drqa` → main branch
- Verify latest successful build includes commit `0c39cbb` or later
- Confirm both Backend and Hosting phases succeeded

### 3. Run Automated Test

```bash
./scripts/test-console-chat-production.sh
```

The test will:
- ✓ Check Lambda IAM permissions for `ssm:GetParameters`
- ✓ Show recent Lambda logs
- ✓ Query recent message statuses
- ✓ Report if JWT errors are present

Expected output for a working system:
```
✓ Lambda has ssm:GetParameters permission (fix is deployed)
✓ Recent messages completed successfully
✓ Web console chat appears to be working
```

### 4. Manual User Test

1. Go to https://p.apyr.us/newsroom
2. Sign in as editor/admin
3. Open console chat (icon in top right)
4. Send: "list recent references"
5. Should receive response in ~30-60 seconds

## Troubleshooting

If tests show errors:

### "Lambda missing ssm:GetParameters permission"
- Code fix not deployed yet
- Check Amplify main branch deployment status
- May need to trigger a redeploy

### "Recent messages failed"
- Check CloudWatch logs for specific error:
  ```bash
  export AWS_PROFILE=Ryan AWS_REGION=us-east-1
  aws logs tail /aws/lambda/amplify-dbsyytcm9drqa-mai-ConsoleChatResponderFunc-PnFuItfGGO4D \
    --since 30m --format short
  ```

### No recent activity
- No one has used console chat recently
- Try manual user test (step 4 above)
- Logs will only appear after first usage post-deploy

## Files Created/Modified

**Testing:**
- `scripts/test-console-chat-production.sh` - Automated production verification
- `docs/web-console-chat-iam-fix.md` - Detailed issue documentation
- `docs/console-chat-runbook.md` - Updated with JWT fix troubleshooting

**Original Fix (already merged):**
- `amplify/functions/console-chat-responder/resource.ts` - IAM permission fix

## Additional Documentation

- Full issue details: `docs/web-console-chat-iam-fix.md`
- Console chat operations: `docs/console-chat-runbook.md`
- Related Slack agent fixes: `docs/slack-agent.md`

## Support

For issues:
1. Run `scripts/test-console-chat-production.sh` and share full output
2. Include recent CloudWatch logs (see troubleshooting above)  
3. Check DynamoDB Message table for responseError details
4. Verify Amplify deploy completed (main branch, latest commit)
