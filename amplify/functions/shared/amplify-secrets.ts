import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

const secretCache = new Map<string, string>();
let ssmClient: SSMClient | null = null;

export function isAmplifySecretPlaceholder(value: string): boolean {
  return /^<.*will be resolved.*>$/i.test(value.trim());
}

export async function resolveAmplifySecret(name: string): Promise<string> {
  const cached = secretCache.get(name);
  if (cached) return cached;

  const direct = normalizeOptionalString(process.env[name]);
  if (direct && !isAmplifySecretPlaceholder(direct)) {
    secretCache.set(name, direct);
    return direct;
  }

  const parameterName = resolveAmplifySsmSecretPath(name);
  if (!parameterName) {
    throw new Error(`${name} is not configured. Set it with "npx ampx secret set ${name}" for this branch.`);
  }

  ssmClient ??= new SSMClient({});
  const response = await ssmClient.send(new GetParameterCommand({
    Name: parameterName,
    WithDecryption: true,
  }));
  const resolved = normalizeOptionalString(response.Parameter?.Value);
  if (!resolved) {
    throw new Error(`SSM parameter ${parameterName} did not return a value for ${name}.`);
  }
  secretCache.set(name, resolved);
  return resolved;
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
