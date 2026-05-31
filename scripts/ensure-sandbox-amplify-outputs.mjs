#!/usr/bin/env node
/**
 * Keep ~/Projects/Papyrus local dev on the Ryan sandbox backend, not production.
 * Run before `next dev` so amplify_outputs.json targets sandbox AppSync/Cognito.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputsPath = path.join(repoRoot, "amplify_outputs.json");
const sandboxStack =
  process.env.PAPYRUS_SANDBOX_AMPLIFY_STACK?.trim() ||
  "amplify-papyrus-ryan-sandbox-adcd88a186";

const PRODUCTION_GRAPHQL_HOST = "64hviw";
const PRODUCTION_USER_POOL_ID = "us-east-1_40Uot7WSv";
const SANDBOX_GRAPHQL_HOST = "nkqutx";
const SANDBOX_USER_POOL_ID = "us-east-1_WD8fuTRVk";

function readOutputs() {
  if (!fs.existsSync(outputsPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(outputsPath, "utf8"));
  } catch (error) {
    console.warn(`[papyrus] Could not parse ${outputsPath}:`, error);
    return null;
  }
}

function classifyOutputs(outputs) {
  const graphqlUrl = String(outputs?.data?.url ?? "");
  const userPoolId = String(outputs?.auth?.user_pool_id ?? "");
  const isProduction =
    graphqlUrl.includes(PRODUCTION_GRAPHQL_HOST) || userPoolId === PRODUCTION_USER_POOL_ID;
  const isSandbox =
    graphqlUrl.includes(SANDBOX_GRAPHQL_HOST) || userPoolId === SANDBOX_USER_POOL_ID;
  return { graphqlUrl, userPoolId, isProduction, isSandbox };
}

function generateSandboxOutputs() {
  const env = {
    ...process.env,
    AWS_PROFILE: process.env.AWS_PROFILE || "Ryan",
    AWS_REGION: process.env.AWS_REGION || "us-east-1",
  };
  console.log(
    `[papyrus] Generating sandbox amplify_outputs.json from stack ${sandboxStack} (AWS_PROFILE=${env.AWS_PROFILE}).`,
  );
  const result = spawnSync(
    "npx",
    [
      "ampx",
      "generate",
      "outputs",
      "--stack",
      sandboxStack,
      "--format",
      "json",
      "--out-dir",
      repoRoot,
    ],
    { cwd: repoRoot, env, stdio: "inherit" },
  );
  if (result.status !== 0) {
    console.error(
      "[papyrus] Failed to generate sandbox amplify_outputs.json. Run `npm run sandbox` or check AWS credentials.",
    );
    process.exit(result.status ?? 1);
  }
  syncEnvGraphqlEndpoint();
}

function syncEnvGraphqlEndpoint() {
  const outputs = readOutputs();
  if (!outputs) return;
  const endpoint = String(outputs?.data?.url ?? "").trim();
  if (!endpoint) return;
  const envPath = path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  let replaced = false;
  const next = lines.map((line) => {
    if (!line.startsWith("PAPYRUS_GRAPHQL_ENDPOINT=")) return line;
    replaced = true;
    return `PAPYRUS_GRAPHQL_ENDPOINT=${endpoint}`;
  });
  if (!replaced) next.push(`PAPYRUS_GRAPHQL_ENDPOINT=${endpoint}`);
  fs.writeFileSync(envPath, `${next.join("\n").replace(/\n*$/, "")}\n`, "utf8");
  console.log(`[papyrus] Updated .env PAPYRUS_GRAPHQL_ENDPOINT for sandbox CLI commands.`);
}

function main() {
  const outputs = readOutputs();
  if (!outputs) {
    console.log("[papyrus] amplify_outputs.json is missing.");
    generateSandboxOutputs();
    return;
  }

  const { graphqlUrl, userPoolId, isProduction, isSandbox } = classifyOutputs(outputs);
  if (isSandbox && !isProduction) {
    console.log(
      `[papyrus] amplify_outputs.json already targets sandbox (${graphqlUrl || "no graphql url"}).`,
    );
    return;
  }

  if (isProduction) {
    console.warn(
      "[papyrus] amplify_outputs.json points at PRODUCTION (p.apyr.us / main Amplify branch).",
    );
    console.warn(
      `  graphql: ${graphqlUrl || "(missing)"}\n  user pool: ${userPoolId || "(missing)"}`,
    );
    console.warn(
      "[papyrus] Local dev in ~/Projects/Papyrus must use the Ryan sandbox. Regenerating sandbox outputs…",
    );
  } else {
    console.warn(
      "[papyrus] amplify_outputs.json is not recognized as sandbox or production; regenerating from sandbox stack.",
    );
  }
  generateSandboxOutputs();
}

main();
