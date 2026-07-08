/**
 * Publication-owned Cognito OAuth redirect origins.
 *
 * Kept separate from site-brand.ts so Amplify backend synth can resolve
 * PAPYRUS_SITE_BRAND without pulling Next.js font modules.
 */

export type SiteBrandAuthId = "papyrus" | "threat-intelligence";

/** Local Next.js ports shared by every publication clone. */
export const LOCAL_AUTH_REDIRECT_URLS = [
  "http://localhost:3000/",
  "http://localhost:3001/",
  "http://localhost:3003/",
] as const;

/** Papyrus hosted reader / Amplify preview origins. */
export const PAPYRUS_AUTH_REDIRECT_URLS = [
  "https://p.apyr.us/",
  "https://main.dbsyytcm9drqa.amplifyapp.com/",
  "https://codex-rehydration-api-split.dbsyytcm9drqa.amplifyapp.com/",
] as const;

/** Threat Intelligence hosted reader / Amplify preview origins. */
export const THREAT_INTELLIGENCE_AUTH_REDIRECT_URLS = [
  "https://threat-intelligence.anth.us/",
  "https://main.d3on1y5vlrxmam.amplifyapp.com/",
] as const;

const SITE_BRAND_AUTH_REDIRECT_URLS: Record<SiteBrandAuthId, readonly string[]> = {
  papyrus: PAPYRUS_AUTH_REDIRECT_URLS,
  "threat-intelligence": THREAT_INTELLIGENCE_AUTH_REDIRECT_URLS,
};

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
  return [
    ...LOCAL_AUTH_REDIRECT_URLS,
    ...SITE_BRAND_AUTH_REDIRECT_URLS[brandId],
  ];
}
