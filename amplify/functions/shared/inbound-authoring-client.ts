import { createHmac } from "node:crypto";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

const ssmClient = new SSMClient({});
let cachedJwtSecret: string | null = null;

export async function mintInboundAuthoringJwt(): Promise<string> {
  const secret = await resolveJwtSecret();
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const payload = encodeJson({
    iss: process.env.PAPYRUS_JWT_ISSUER ?? "papyrus-cli",
    sub: process.env.PAPYRUS_INBOUND_EMAIL_ACTOR_SUB ?? "papyrus-inbound-email",
    aud: process.env.PAPYRUS_JWT_AUDIENCE ?? "papyrus-authoring",
    scope: process.env.PAPYRUS_JWT_REQUIRED_SCOPE ?? "papyrus:write",
    groups: ["editor", "admin"],
    iat: now,
    nbf: now,
    exp: now + Number(process.env.PAPYRUS_JWT_TTL_SECONDS ?? "3600"),
  });
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

export async function graphqlWithInboundJwt<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const endpoint = (process.env.PAPYRUS_GRAPHQL_ENDPOINT ?? "").trim();
  if (!endpoint) throw new Error("PAPYRUS_GRAPHQL_ENDPOINT is not configured.");

  const token = await mintInboundAuthoringJwt();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `PapyrusJwt ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(`GraphQL request failed with HTTP ${response.status}.`);
  }

  const payload = await response.json() as GraphQLResponse<T>;
  if (payload.errors?.length) {
    const messages = payload.errors.map((entry) => entry.message ?? "unknown GraphQL error");
    throw new Error(messages.join("; "));
  }
  if (!payload.data) throw new Error("GraphQL response did not include data.");
  return payload.data;
}

async function resolveJwtSecret(): Promise<string> {
  if (cachedJwtSecret) return cachedJwtSecret;

  const directSecret = normalizeOptionalString(process.env.PAPYRUS_JWT_SECRET);
  if (directSecret && !directSecret.includes("<value will be resolved")) {
    cachedJwtSecret = directSecret;
    return directSecret;
  }

  const configRaw = process.env.AMPLIFY_SSM_ENV_CONFIG;
  if (configRaw) {
    try {
      const config = JSON.parse(configRaw) as Record<string, { path?: string }>;
      const entry = config.PAPYRUS_JWT_SECRET;
      if (entry?.path) {
        const response = await ssmClient.send(new GetParameterCommand({
          Name: entry.path,
          WithDecryption: true,
        }));
        const value = response.Parameter?.Value?.trim();
        if (value) {
          cachedJwtSecret = value;
          return value;
        }
      }
    } catch {
      // Fall through.
    }
  }

  throw new Error("PAPYRUS_JWT_SECRET is not configured for inbound email intake.");
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
