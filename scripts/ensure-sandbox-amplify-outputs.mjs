#!/usr/bin/env node
/**
 * Keep ~/Projects/Papyrus local dev on the Ryan sandbox backend, not production.
 * Run before `next dev` so amplify_outputs.json targets sandbox AppSync/Cognito.
 *
 * ~/Projects/Papyrus-production (or PAPYRUS_USE_PRODUCTION_AMPLIFY=1) keeps production
 * outputs so local Next.js can debug against the live GraphQL API.
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
const THREAT_INTELLIGENCE_GRAPHQL_HOST = "ur2anu";
const THREAT_INTELLIGENCE_AMPLIFY_APP_ID = "d3on1y5vlrxmam";
const THREAT_INTELLIGENCE_AMPLIFY_BRANCH = "main";

function loadEnvFile() {
  const envPath = path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function readSiteBrandId() {
  const configured =
    process.env.NEXT_PUBLIC_PAPYRUS_SITE_BRAND?.trim().toLowerCase()
    || process.env.PAPYRUS_SITE_BRAND?.trim().toLowerCase()
    || "";
  if (configured === "threat-intelligence" || configured === "threat_intelligence" || configured === "anthus") {
    return "threat-intelligence";
  }
  return configured === "papyrus" ? "papyrus" : null;
}

function shouldKeepThreatIntelligenceAmplifyOutputs() {
  const target = process.env.PAPYRUS_AMPLIFY_TARGET?.trim().toLowerCase();
  if (target === "threat-intelligence" || target === "threat_intelligence" || target === "ti") {
    return true;
  }
  return readSiteBrandId() === "threat-intelligence";
}

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
  const isThreatIntelligence = graphqlUrl.includes(THREAT_INTELLIGENCE_GRAPHQL_HOST);
  return { graphqlUrl, userPoolId, isProduction, isSandbox, isThreatIntelligence };
}

function shouldKeepProductionAmplifyOutputs() {
  const flag = process.env.PAPYRUS_USE_PRODUCTION_AMPLIFY?.trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") return true;
  const target = process.env.PAPYRUS_AMPLIFY_TARGET?.trim().toLowerCase();
  if (target === "production" || target === "prod") return true;
  const repoName = path.basename(repoRoot).toLowerCase();
  if (repoName === "papyrus-production") return true;
  if (fs.existsSync(path.join(repoRoot, ".papyrus-production-workspace"))) return true;
  return false;
}

function generateThreatIntelligenceOutputs() {
  const env = {
    ...process.env,
    AWS_PROFILE: process.env.AWS_PROFILE || "default",
    AWS_REGION: process.env.AWS_REGION || "us-east-1",
  };
  console.log(
    `[papyrus] Generating Threat Intelligence amplify_outputs.json from app ${THREAT_INTELLIGENCE_AMPLIFY_APP_ID} (${env.AWS_PROFILE}).`,
  );
  const result = spawnSync(
    "npx",
    [
      "ampx",
      "generate",
      "outputs",
      "--app-id",
      THREAT_INTELLIGENCE_AMPLIFY_APP_ID,
      "--branch",
      THREAT_INTELLIGENCE_AMPLIFY_BRANCH,
      "--format",
      "json",
      "--out-dir",
      repoRoot,
    ],
    { cwd: repoRoot, env, stdio: "inherit" },
  );
  if (result.status !== 0) {
    console.error(
      "[papyrus] Failed to generate Threat Intelligence amplify_outputs.json. Check AWS credentials for the TI Amplify app.",
    );
    process.exit(result.status ?? 1);
  }
  syncEnvGraphqlEndpoint();
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
  console.log(`[papyrus] Updated .env PAPYRUS_GRAPHQL_ENDPOINT.`);
}

function main() {
  loadEnvFile();
  const outputs = readOutputs();
  if (!outputs) {
    if (shouldKeepThreatIntelligenceAmplifyOutputs()) {
      console.log("[papyrus] amplify_outputs.json is missing; generating Threat Intelligence outputs.");
      generateThreatIntelligenceOutputs();
      return;
    }
    if (shouldKeepProductionAmplifyOutputs()) {
      console.error(
        "[papyrus] amplify_outputs.json is missing but production local dev was requested.",
      );
      console.error(
        "  Copy production outputs into this repo or run: npm run outputs:production",
      );
      process.exit(1);
    }
    console.log("[papyrus] amplify_outputs.json is missing.");
    generateSandboxOutputs();
    return;
  }

  const { graphqlUrl, userPoolId, isProduction, isSandbox, isThreatIntelligence } = classifyOutputs(outputs);

  if (isThreatIntelligence && shouldKeepThreatIntelligenceAmplifyOutputs()) {
    console.log(
      `[papyrus] Keeping Threat Intelligence amplify_outputs.json (${graphqlUrl || "no graphql url"}).`,
    );
    syncEnvGraphqlEndpoint();
    return;
  }

  if (isProduction && shouldKeepProductionAmplifyOutputs()) {
    console.log("[papyrus] Keeping production amplify_outputs.json for local dev.");
    console.log(
      `  graphql: ${graphqlUrl || "(missing)"}\n  user pool: ${userPoolId || "(missing)"}`,
    );
    syncEnvGraphqlEndpoint();
    return;
  }

  if (isSandbox && !isProduction) {
    if (shouldKeepThreatIntelligenceAmplifyOutputs()) {
      console.warn(
        "[papyrus] amplify_outputs.json targets the Papyrus sandbox but this checkout is configured for Threat Intelligence.",
      );
      console.warn("[papyrus] Regenerating Threat Intelligence outputs…");
      generateThreatIntelligenceOutputs();
      return;
    }
    console.log(
      `[papyrus] amplify_outputs.json already targets sandbox (${graphqlUrl || "no graphql url"}).`,
    );
    return;
  }

  if (shouldKeepThreatIntelligenceAmplifyOutputs()) {
    console.warn(
      "[papyrus] amplify_outputs.json is not the Threat Intelligence backend; regenerating TI outputs…",
    );
    generateThreatIntelligenceOutputs();
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
