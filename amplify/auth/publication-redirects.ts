/**
 * Amplify backend synth entry for publication OAuth redirects.
 * Kept under amplify/auth so CDK assembly resolves ESM named exports reliably.
 * Source of truth: config/auth-redirect-urls.json
 */
import redirectUrls from "../../config/auth-redirect-urls.json";

type SiteBrandAuthId = "papyrus" | "threat-intelligence";

type AuthRedirectConfig = {
  local: string[];
  papyrus: string[];
  "threat-intelligence": string[];
};

const config = redirectUrls as AuthRedirectConfig;

function normalizeSiteBrandAuthId(value: string | undefined | null): SiteBrandAuthId | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "papyrus") return "papyrus";
  if (
    normalized === "threat-intelligence"
    || normalized === "threat_intelligence"
    || normalized === "anthus"
  ) {
    return "threat-intelligence";
  }
  return null;
}

function resolveSiteBrandAuthId(): SiteBrandAuthId {
  const configured = normalizeSiteBrandAuthId(
    process.env.NEXT_PUBLIC_PAPYRUS_SITE_BRAND
      ?? process.env.PAPYRUS_SITE_BRAND,
  );
  return configured ?? "papyrus";
}

export function getAuthRedirectUrls(): string[] {
  const brandId = resolveSiteBrandAuthId();
  return [...config.local, ...config[brandId]];
}
