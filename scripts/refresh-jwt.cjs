#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHmac } = require("node:crypto");

function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = mintJwt(options);

  if (options.writeEnv) {
    upsertEnvToken(options.writeEnv, token);
  }

  if (options.format === "shell") {
    process.stdout.write(`export PAPYRUS_GRAPHQL_JWT='${token}'\n`);
    return;
  }
  if (options.writeEnv) {
    process.stdout.write(`Updated PAPYRUS_GRAPHQL_JWT in ${path.resolve(process.cwd(), options.writeEnv)}\n`);
    return;
  }
  process.stdout.write(`${token}\n`);
}

function mintJwt(options) {
  const secret = readSsmSecret(options);
  return mintJwtWithSecret(secret, options);
}

function mintJwtWithSecret(secret, options) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: options.issuer,
    sub: options.subject,
    aud: options.audience,
    iat: now,
    nbf: now - 30,
    exp: now + options.ttlSeconds,
    scope: options.scope,
    groups: options.groups,
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode(header)}.${encode(payload)}`;
  const signature = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

function readSsmSecret(options) {
  const directSecret = directSecretFromOptions(options);
  if (directSecret) {
    logDebug(options, "Using direct JWT secret from environment/flags.");
    return directSecret;
  }

  const tried = [];
  const candidates = [];
  if (options.ssmParam) candidates.push(options.ssmParam);
  if (options.discoverSsmParam) {
    for (const discovered of discoverSsmParams(options)) {
      if (!candidates.includes(discovered)) candidates.push(discovered);
    }
  }
  if (!candidates.length) {
    throw new Error("No SSM parameter candidate found. Set --ssm-param or PAPYRUS_JWT_SECRET_SSM_PARAM.");
  }
  logDebug(options, `SSM parameter candidates: ${candidates.join(", ")}`);
  const shouldProbe = shouldProbeEndpointCandidates(options, candidates);
  for (const parameterName of candidates) {
    tried.push(parameterName);
    try {
      const raw = awsExec(
        ["ssm", "get-parameter", "--name", parameterName, "--with-decryption", "--output", "json"],
        options,
      );
      const parsed = JSON.parse(raw);
      const secret = parsed?.Parameter?.Value;
      if (!secret) throw new Error(`SSM parameter ${parameterName} did not return a value.`);
      if (shouldProbe) {
        const probe = probeEndpointWithSecret(secret, options);
        logDebug(
          options,
          `Endpoint probe for ${parameterName}: ${probe.ok ? "ok" : probe.result} (${probe.detail || "no detail"})`,
        );
        if (!probe.ok && probe.result === "auth_failed") {
          continue;
        }
      }
      logDebug(options, `Using SSM parameter: ${parameterName}`);
      return secret;
    } catch (error) {
      const message = String(error?.stderr || error?.message || error);
      if (!message.includes("ParameterNotFound")) throw error;
    }
  }
  throw new Error(`Could not find PAPYRUS JWT secret in SSM. Tried: ${tried.join(", ")}`);
}

function shouldProbeEndpointCandidates(options, candidates) {
  if (!options.probeEndpoint) return false;
  if (candidates.length <= 1) return false;
  return Boolean(resolveGraphqlEndpoint(options));
}

function resolveGraphqlEndpoint(options) {
  return String(options.graphqlEndpoint || process.env.PAPYRUS_GRAPHQL_ENDPOINT || "").trim();
}

function probeEndpointWithSecret(secret, options) {
  const endpoint = resolveGraphqlEndpoint(options);
  if (!endpoint) return { ok: true, result: "skipped", detail: "no-endpoint" };
  const token = mintJwtWithSecret(secret, options);
  const payload = JSON.stringify({ query: "query AuthProbe { __typename }" });
  try {
    const raw = execFileSync(
      "curl",
      [
        "-sS",
        "-o",
        "-",
        "-w",
        "\n%{http_code}",
        "-X",
        "POST",
        endpoint,
        "-H",
        "Content-Type: application/json",
        "-H",
        `Authorization: PapyrusJwt ${token}`,
        "--data",
        payload,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const splitIndex = raw.lastIndexOf("\n");
    if (splitIndex <= 0) {
      return { ok: true, result: "indeterminate", detail: "missing-http-code" };
    }
    const body = raw.slice(0, splitIndex);
    const statusCode = Number.parseInt(raw.slice(splitIndex + 1).trim(), 10);
    if (statusCode === 401 || statusCode === 403) {
      return { ok: false, result: "auth_failed", detail: `http-${statusCode}` };
    }
    if (statusCode >= 400) {
      return { ok: true, result: "indeterminate", detail: `http-${statusCode}` };
    }
    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      return { ok: true, result: "indeterminate", detail: "non-json-response" };
    }
    const errors = Array.isArray(parsed?.errors) ? parsed.errors : [];
    if (errors.some((entry) => /unauthorized|forbidden|not authorized/i.test(String(entry?.message || entry || "")))) {
      return { ok: false, result: "auth_failed", detail: "graphql-unauthorized" };
    }
    return { ok: true, result: "ok", detail: "graphql-ok" };
  } catch (error) {
    return { ok: true, result: "indeterminate", detail: String(error?.message || error || "probe-failed") };
  }
}

function directSecretFromOptions(options) {
  if (options.secret) return options.secret;
  if (options.secretEnv) return process.env[options.secretEnv] || "";
  return process.env.PAPYRUS_SANDBOX_JWT_SECRET || process.env.PAPYRUS_JWT_SECRET || "";
}

function discoverSsmParams(options) {
  const candidates = [];
  for (const name of discoverSsmParamsFromAppSyncEndpoint(options)) {
    if (!candidates.includes(name)) candidates.push(name);
  }
  for (const name of discoverSsmParamsFromLambdaConfig(options)) {
    if (!candidates.includes(name)) candidates.push(name);
  }
  try {
    const raw = awsExec(
      [
        "ssm",
        "describe-parameters",
        "--parameter-filters",
        "Key=Name,Option=Contains,Values=PAPYRUS_JWT_SECRET",
        "--max-results",
        "20",
        "--output",
        "json",
      ],
      options,
    );
    const params = (JSON.parse(raw).Parameters || []).map((entry) => entry.Name).filter(Boolean);
    for (const name of params) {
      if (!candidates.includes(name)) candidates.push(name);
    }
  } catch {
    // Best-effort discovery only.
  }
  return candidates.length ? candidates : [];
}

function discoverSsmParamsFromLambdaConfig(options) {
  const params = [];
  for (const functionName of discoverJwtAuthorizerFunctionNames(options)) {
    try {
      const raw = awsExec(
        ["lambda", "get-function-configuration", "--function-name", functionName, "--output", "json"],
        options,
      );
      const parsed = JSON.parse(raw);
      const env = parsed?.Environment?.Variables || {};
      const direct = String(env.PAPYRUS_JWT_SECRET_SSM_PARAM || "").trim();
      if (direct && !params.includes(direct)) params.push(direct);
      for (const discovered of parseAmplifySsmEnvConfig(env.AMPLIFY_SSM_ENV_CONFIG)) {
        if (!params.includes(discovered)) params.push(discovered);
      }
    } catch {
      // Try the next candidate function.
    }
  }
  return params;
}

function discoverSsmParamsFromAppSyncEndpoint(options) {
  const endpoint = String(options.graphqlEndpoint || process.env.PAPYRUS_GRAPHQL_ENDPOINT || "").trim();
  const match = endpoint.match(/^https?:\/\/([a-z0-9]+)\.appsync-api\.[^.]+\.amazonaws\.com\/graphql\/?$/i);
  if (!match) return [];
  const apiId = match[1];
  try {
    const raw = awsExec(["appsync", "get-graphql-api", "--api-id", apiId, "--output", "json"], options);
    const payload = JSON.parse(raw);
    const graphqlApi = payload?.graphqlApi || {};
    const providers = [];
    if (graphqlApi.authenticationType === "AWS_LAMBDA" && graphqlApi.lambdaAuthorizerConfig) {
      providers.push(graphqlApi.lambdaAuthorizerConfig);
    }
    for (const provider of graphqlApi.additionalAuthenticationProviders || []) {
      if (provider?.authenticationType === "AWS_LAMBDA" && provider?.lambdaAuthorizerConfig) {
        providers.push(provider.lambdaAuthorizerConfig);
      }
    }
    const params = [];
    for (const provider of providers) {
      const functionName = parseLambdaFunctionNameFromAuthorizerUri(provider.authorizerUri);
      if (!functionName) continue;
      for (const discovered of discoverSsmParamsFromFunction(functionName, options)) {
        if (!params.includes(discovered)) params.push(discovered);
      }
    }
    return params;
  } catch {
    return [];
  }
}

function discoverSsmParamsFromFunction(functionName, options) {
  try {
    const raw = awsExec(
      ["lambda", "get-function-configuration", "--function-name", functionName, "--output", "json"],
      options,
    );
    const parsed = JSON.parse(raw);
    const env = parsed?.Environment?.Variables || {};
    const params = [];
    const direct = String(env.PAPYRUS_JWT_SECRET_SSM_PARAM || "").trim();
    if (direct) params.push(direct);
    for (const discovered of parseAmplifySsmEnvConfig(env.AMPLIFY_SSM_ENV_CONFIG)) {
      if (!params.includes(discovered)) params.push(discovered);
    }
    return params;
  } catch {
    return [];
  }
}

function parseLambdaFunctionNameFromAuthorizerUri(authorizerUri) {
  const uri = String(authorizerUri || "");
  const arnMatch = uri.match(/functions\/(arn:aws:lambda:[^/]+)\/invocations/i);
  if (arnMatch && arnMatch[1]) return arnMatch[1];
  const nameMatch = uri.match(/:function:([^:/]+)(?::[^/]+)?/i);
  return nameMatch?.[1] ? nameMatch[1] : "";
}

function discoverJwtAuthorizerFunctionNames(options) {
  const configured = String(options.lambdaFunctionName || "").trim();
  if (configured) return [configured];
  try {
    const raw = awsExec(["lambda", "list-functions", "--max-items", "200", "--output", "json"], options);
    const names = (JSON.parse(raw).Functions || [])
      .map((entry) => String(entry.FunctionName || "").trim())
      .filter(Boolean)
      .filter((name) => {
        const normalized = name.toLowerCase();
        return normalized.includes("graphql-jwt-authorizer")
          || (normalized.includes("papyrus") && normalized.includes("authorizer"));
      });
    return names.sort((a, b) => String(a).localeCompare(String(b)));
  } catch {
    return [];
  }
}

function parseAmplifySsmEnvConfig(rawConfig) {
  const text = String(rawConfig || "").trim();
  if (!text) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const paths = [];
  visitAmplifyConfig(parsed, "", paths);
  return paths.filter((entry) => entry.includes("/") && entry.includes("PAPYRUS_JWT_SECRET"));
}

function visitAmplifyConfig(value, key, paths) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      trimmed
      && (String(key || "").toUpperCase().includes("PAPYRUS_JWT_SECRET")
        || trimmed.includes("PAPYRUS_JWT_SECRET"))
      && !paths.includes(trimmed)
    ) {
      paths.push(trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => visitAmplifyConfig(entry, key, paths));
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      visitAmplifyConfig(childValue, childKey, paths);
    }
  }
}

function awsExec(baseArgs, options) {
  const args = [...baseArgs];
  if (options.region) args.push("--region", options.region);
  return execFileSync("aws", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: options.awsProfile ? { ...process.env, AWS_PROFILE: options.awsProfile } : process.env,
  });
}

function upsertEnvToken(envPathInput, token) {
  const envPath = path.resolve(process.cwd(), envPathInput);
  const key = "PAPYRUS_GRAPHQL_JWT";
  let lines = [];
  if (fs.existsSync(envPath)) {
    lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  }
  let replaced = false;
  const output = lines.map((line) => {
    if (line.trim().startsWith(`${key}=`)) {
      replaced = true;
      return `${key}=${token}`;
    }
    return line;
  });
  if (!replaced) output.push(`${key}=${token}`);
  fs.writeFileSync(envPath, `${output.filter((line, index, arr) => !(index === arr.length - 1 && line === "")).join("\n")}\n`);
}

function parseArgs(args) {
  const envFileEndpoint = readLocalEnvValue("PAPYRUS_GRAPHQL_ENDPOINT");
  const options = {
    ssmParam: process.env.PAPYRUS_JWT_SECRET_SSM_PARAM || "",
    secret: "",
    secretEnv: "",
    discoverSsmParam: true,
    awsProfile: process.env.AWS_PROFILE || "",
    issuer: process.env.PAPYRUS_JWT_ISSUER || "papyrus-cli",
    subject: process.env.PAPYRUS_JWT_SUBJECT || "local-production-authoring",
    audience: process.env.PAPYRUS_JWT_AUDIENCE || "papyrus-authoring",
    scope: process.env.PAPYRUS_JWT_SCOPE || "papyrus:write",
    groups: parseGroups(process.env.PAPYRUS_JWT_GROUPS || "editor"),
    ttlSeconds: parsePositiveInt(process.env.PAPYRUS_JWT_TTL_SECONDS || "21600", "--ttl-seconds"),
    region: process.env.AWS_REGION || "",
    lambdaFunctionName: process.env.PAPYRUS_JWT_SECRET_FUNCTION_NAME || "",
    graphqlEndpoint: process.env.PAPYRUS_GRAPHQL_ENDPOINT || envFileEndpoint || "",
    probeEndpoint: true,
    debug: false,
    writeEnv: "",
    format: "raw",
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--help" || token === "-h") {
      printHelp();
      process.exit(0);
    }
    if (token === "--ssm-param") {
      options.ssmParam = requiredValue(args, ++index, "--ssm-param");
      continue;
    }
    if (token === "--secret") {
      options.secret = requiredValue(args, ++index, "--secret");
      continue;
    }
    if (token === "--secret-env") {
      options.secretEnv = requiredValue(args, ++index, "--secret-env");
      continue;
    }
    if (token === "--discover-ssm-param") {
      options.discoverSsmParam = true;
      continue;
    }
    if (token === "--no-discover-ssm-param") {
      options.discoverSsmParam = false;
      continue;
    }
    if (token === "--aws-profile") {
      options.awsProfile = requiredValue(args, ++index, "--aws-profile");
      continue;
    }
    if (token === "--issuer") {
      options.issuer = requiredValue(args, ++index, "--issuer");
      continue;
    }
    if (token === "--subject") {
      options.subject = requiredValue(args, ++index, "--subject");
      continue;
    }
    if (token === "--audience") {
      options.audience = requiredValue(args, ++index, "--audience");
      continue;
    }
    if (token === "--scope") {
      options.scope = requiredValue(args, ++index, "--scope");
      continue;
    }
    if (token === "--groups") {
      options.groups = parseGroups(requiredValue(args, ++index, "--groups"));
      continue;
    }
    if (token === "--ttl-seconds") {
      options.ttlSeconds = parsePositiveInt(requiredValue(args, ++index, "--ttl-seconds"), "--ttl-seconds");
      continue;
    }
    if (token === "--region") {
      options.region = requiredValue(args, ++index, "--region");
      continue;
    }
    if (token === "--lambda-function") {
      options.lambdaFunctionName = requiredValue(args, ++index, "--lambda-function");
      continue;
    }
    if (token === "--graphql-endpoint") {
      options.graphqlEndpoint = requiredValue(args, ++index, "--graphql-endpoint");
      continue;
    }
    if (token === "--probe-endpoint") {
      options.probeEndpoint = true;
      continue;
    }
    if (token === "--no-probe-endpoint") {
      options.probeEndpoint = false;
      continue;
    }
    if (token === "--debug") {
      options.debug = true;
      continue;
    }
    if (token === "--write-env") {
      options.writeEnv = requiredValue(args, ++index, "--write-env");
      continue;
    }
    if (token === "--format") {
      const value = requiredValue(args, ++index, "--format");
      if (!["raw", "shell"].includes(value)) {
        throw new Error("--format must be raw or shell.");
      }
      options.format = value;
      continue;
    }
    throw new Error(`Unknown option ${token}.`);
  }
  return options;
}

function parsePositiveInt(value, optionName) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer.`);
  }
  return parsed;
}

function parseGroups(value) {
  const groups = String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!groups.length) return ["editor"];
  return groups;
}

function requiredValue(args, index, optionName) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${optionName} requires a value.`);
  return value;
}

function printHelp() {
  process.stdout.write(
    [
      "Mint a PAPYRUS_GRAPHQL_JWT from an AWS SSM secret.",
      "",
      "Usage:",
      "  npm run auth:refresh-jwt -- [options]",
      "",
      "Options:",
      "  --ssm-param <name>      SSM parameter path for PAPYRUS_JWT_SECRET",
      "  --secret <value>        Use a direct JWT secret instead of SSM",
      "  --secret-env <name>     Read direct JWT secret from an environment variable",
      "  --discover-ssm-param    Discover matching SSM params (default: enabled)",
      "  --no-discover-ssm-param Disable SSM parameter discovery",
      "  --aws-profile <name>    AWS profile for aws cli calls (default: AWS_PROFILE)",
      "  --ttl-seconds <int>     Token lifetime in seconds (default: 21600)",
      "  --issuer <value>        JWT iss claim (default: papyrus-cli)",
      "  --subject <value>       JWT sub claim (default: local-production-authoring)",
      "  --audience <value>      JWT aud claim (default: papyrus-authoring)",
      "  --scope <value>         JWT scope claim (default: papyrus:write)",
      "  --groups <csv>          JWT groups claim (default: editor)",
      "  --region <aws-region>   Override AWS region",
      "  --lambda-function <name> Lambda function name to inspect for AMPLIFY_SSM_ENV_CONFIG fallback",
      "  --graphql-endpoint <url> AppSync endpoint to resolve lambda authorizer secret path",
      "  --probe-endpoint        Probe GraphQL endpoint when multiple candidate secrets are found (default: enabled)",
      "  --no-probe-endpoint     Disable endpoint probing and use first resolved candidate",
      "  --debug                 Print discovery diagnostics to stderr",
      "  --write-env <path>      Upsert PAPYRUS_GRAPHQL_JWT in an env file (example: .env)",
      "  --format raw|shell      Output token or export statement (default: raw)",
    ].join("\n") + "\n",
  );
}

function logDebug(options, message) {
  if (!options?.debug) return;
  process.stderr.write(`[refresh-jwt] ${message}\n`);
}

function readLocalEnvValue(key) {
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) return "";
    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator <= 0) continue;
      const currentKey = trimmed.slice(0, separator).trim();
      if (currentKey !== key) continue;
      return trimmed.slice(separator + 1).trim();
    }
    return "";
  } catch {
    return "";
  }
}

main();
