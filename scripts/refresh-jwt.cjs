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
  if (directSecret) return directSecret;

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
      return secret;
    } catch (error) {
      const message = String(error?.stderr || error?.message || error);
      if (!message.includes("ParameterNotFound")) throw error;
    }
  }
  throw new Error(`Could not find PAPYRUS JWT secret in SSM. Tried: ${tried.join(", ")}`);
}

function directSecretFromOptions(options) {
  if (options.secret) return options.secret;
  if (options.secretEnv) return process.env[options.secretEnv] || "";
  return process.env.PAPYRUS_SANDBOX_JWT_SECRET || process.env.PAPYRUS_JWT_SECRET || "";
}

function discoverSsmParams(options) {
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
    return params.sort(compareSsmParamPriority);
  } catch {
    return [];
  }
}

function compareSsmParamPriority(a, b) {
  const score = (name) => {
    if (name.includes("/main-branch-")) return 0;
    if (name.includes("/main/")) return 1;
    if (name.includes("/shared/")) return 2;
    return 3;
  };
  const scoreA = score(a);
  const scoreB = score(b);
  if (scoreA !== scoreB) return scoreA - scoreB;
  return String(a).localeCompare(String(b));
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
      "  --write-env <path>      Upsert PAPYRUS_GRAPHQL_JWT in an env file (example: .env)",
      "  --format raw|shell      Output token or export statement (default: raw)",
    ].join("\n") + "\n",
  );
}

main();
