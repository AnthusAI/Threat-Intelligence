const PRODUCTION_GRAPHQL_HOST = "64hviw";
const PRODUCTION_USER_POOL_ID = "us-east-1_40Uot7WSv";

export function isProductionAmplifyOutputs(outputs: Record<string, unknown> | null): boolean {
  if (!outputs) return false;
  const graphqlUrl = String((outputs.data as { url?: string } | undefined)?.url ?? "");
  const userPoolId = String((outputs.auth as { user_pool_id?: string } | undefined)?.user_pool_id ?? "");
  return graphqlUrl.includes(PRODUCTION_GRAPHQL_HOST) || userPoolId === PRODUCTION_USER_POOL_ID;
}

export function assertSandboxAmplifyOutputsForDev(outputs: Record<string, unknown>): void {
  if (process.env.NODE_ENV === "production") return;
  if (!isProductionAmplifyOutputs(outputs)) return;
  const graphqlUrl = String((outputs.data as { url?: string } | undefined)?.url ?? "");
  throw new Error(
    [
      "Papyrus dev is configured for production Amplify (amplify_outputs.json → " +
        (graphqlUrl || "production AppSync") +
        ").",
      "Run `npm run outputs:sandbox` or restart with `npm run dev` (runs ensure-sandbox-amplify-outputs first).",
      "Use ~/Projects/Papyrus-production for production deploys only.",
    ].join(" "),
  );
}
