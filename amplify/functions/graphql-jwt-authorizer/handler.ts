import { createHmac, timingSafeEqual } from "node:crypto";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

type AppSyncAuthorizerEvent = {
  authorizationToken?: string;
};

type JwtHeader = {
  alg?: string;
  typ?: string;
};

type JwtClaims = {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  scope?: string;
  scp?: string | string[];
  groups?: string | string[];
  roles?: string | string[];
  [key: string]: unknown;
};

export const handler = async (event: AppSyncAuthorizerEvent) => {
  try {
    const token = normalizeAuthorizationToken(event.authorizationToken);
    const jwtSecret = await getJwtSecret();
    const claims = verifyHs256Jwt(token, jwtSecret);
    assertExpectedIssuer(claims);
    assertExpectedAudience(claims);
    assertRequiredScope(claims);

    return {
      isAuthorized: true,
      resolverContext: {
        sub: claims.sub ?? "unknown",
        iss: claims.iss ?? "unknown",
        scope: getClaimValues(claims.scope).join(" "),
      },
      ttlOverride: 300,
    };
  } catch (error) {
    console.warn(`JWT authorizer rejected request: ${(error as Error).message}`);
    return {
      isAuthorized: false,
      ttlOverride: 0,
    };
  }
};

function normalizeAuthorizationToken(value: string | undefined): string {
  const token = value
    ?.replace(/^PapyrusJwt\s+/i, "")
    .replace(/^papyrus-jwt:/i, "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) throw new Error("Missing Authorization token.");
  return token;
}

function verifyHs256Jwt(token: string, jwtSecret: string): JwtClaims {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error("JWT must have header, payload, and signature.");
  }

  const header = decodeJson<JwtHeader>(encodedHeader);
  if (header.alg !== "HS256") {
    throw new Error(`Unsupported JWT alg ${header.alg ?? "unknown"}.`);
  }

  const claims = decodeJson<JwtClaims>(encodedPayload);
  const expectedSignature = createHmac("sha256", jwtSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  if (!constantTimeEqual(encodedSignature, expectedSignature)) {
    throw new Error("JWT signature verification failed.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === "number" && claims.exp <= now) {
    throw new Error("JWT is expired.");
  }
  if (typeof claims.nbf === "number" && claims.nbf > now) {
    throw new Error("JWT is not yet valid.");
  }

  return claims;
}

function decodeJson<T>(encoded: string): T {
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
  } catch {
    throw new Error("JWT contains invalid base64url JSON.");
  }
}

let cachedJwtSecret: string | null = null;
let ssmClient: SSMClient | null = null;

async function getJwtSecret(): Promise<string> {
  if (cachedJwtSecret) return cachedJwtSecret;

  const directSecret = normalizeOptionalString(process.env.PAPYRUS_JWT_SECRET);
  if (directSecret && !isAmplifySecretPlaceholder(directSecret)) {
    cachedJwtSecret = directSecret;
    return directSecret;
  }

  const parameterName = resolveAmplifySsmSecretPath("PAPYRUS_JWT_SECRET");
  if (!parameterName) throw new Error("PAPYRUS_JWT_SECRET is not configured.");
  ssmClient ??= new SSMClient({});
  const response = await ssmClient.send(new GetParameterCommand({
    Name: parameterName,
    WithDecryption: true,
  }));
  const secret = normalizeOptionalString(response.Parameter?.Value);
  if (!secret) throw new Error(`SSM parameter ${parameterName} did not return a value.`);
  cachedJwtSecret = secret;
  return secret;
}

function isAmplifySecretPlaceholder(value: string): boolean {
  return /^<.*will be resolved.*>$/i.test(value);
}

function resolveAmplifySsmSecretPath(name: string): string | null {
  const rawConfig = normalizeOptionalString(process.env.AMPLIFY_SSM_ENV_CONFIG);
  if (!rawConfig) return null;
  try {
    const config = JSON.parse(rawConfig) as Record<string, { path?: string; sharedPath?: string } | undefined>;
    return normalizeOptionalString(config[name]?.path) ?? normalizeOptionalString(config[name]?.sharedPath);
  } catch {
    throw new Error("AMPLIFY_SSM_ENV_CONFIG contains invalid JSON.");
  }
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function assertExpectedIssuer(claims: JwtClaims): void {
  const expectedIssuer = process.env.PAPYRUS_JWT_ISSUER;
  if (expectedIssuer && claims.iss !== expectedIssuer) {
    throw new Error("JWT issuer is not authorized.");
  }
}

function assertExpectedAudience(claims: JwtClaims): void {
  const expectedAudience = process.env.PAPYRUS_JWT_AUDIENCE;
  if (!expectedAudience) return;

  const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!audiences.includes(expectedAudience)) {
    throw new Error("JWT audience is not authorized.");
  }
}

function assertRequiredScope(claims: JwtClaims): void {
  const requiredScope = process.env.PAPYRUS_JWT_REQUIRED_SCOPE;
  if (!requiredScope) return;

  const values = new Set([
    ...getClaimValues(claims.scope),
    ...getClaimValues(claims.scp),
    ...getClaimValues(claims.groups),
    ...getClaimValues(claims.roles),
  ]);

  if (!values.has(requiredScope)) {
    throw new Error("JWT does not include the required authoring scope.");
  }
}

function getClaimValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(getClaimValues);
  if (typeof value === "string") return value.split(/[,\s]+/).filter(Boolean);
  return [];
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
