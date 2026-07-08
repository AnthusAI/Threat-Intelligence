import redirectUrls from "../config/auth-redirect-urls.json";

export type SiteBrandAuthId = "papyrus" | "threat-intelligence";

type AuthRedirectConfig = {
  local: string[];
  papyrus: string[];
  "threat-intelligence": string[];
};

const config = redirectUrls as AuthRedirectConfig;

export const LOCAL_AUTH_REDIRECT_URLS = config.local;
export const PAPYRUS_AUTH_REDIRECT_URLS = config.papyrus;
export const THREAT_INTELLIGENCE_AUTH_REDIRECT_URLS = config["threat-intelligence"];

export function normalizeSiteBrandAuthId(value: string | undefined | null): SiteBrandAuthId | null {
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

export function resolveSiteBrandAuthId(): SiteBrandAuthId {
  const configured = normalizeSiteBrandAuthId(
    process.env.NEXT_PUBLIC_PAPYRUS_SITE_BRAND
      ?? process.env.PAPYRUS_SITE_BRAND,
  );
  return configured ?? "papyrus";
}

export function getAuthRedirectUrls(brandId: SiteBrandAuthId = resolveSiteBrandAuthId()): string[] {
  return [...LOCAL_AUTH_REDIRECT_URLS, ...config[brandId]];
}
