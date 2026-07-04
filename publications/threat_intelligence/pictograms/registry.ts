export const PICTOGRAM_CYCLE_MS = 20_000;
export const PICTOGRAM_NODE_RADIUS = 4.75;
export const PICTOGRAM_EDGE_WIDTH = 2.5;

export const THREAT_INTELLIGENCE_PICTOGRAM_PHASE_OFFSETS = {
  hero: 1_400,
  "the-balance-of-power-is-shifting": 0,
  "how-our-newsroom-learns": 2_600,
  "audit-aws-exposure-before-attackers-do": 5_000,
  "audit-azure-blast-radius-before-attackers-do": 7_500,
  "treat-openai-accounts-like-production-infrastructure": 10_000,
  "how-to-play-games-securely": 12_500,
  "the-new-sensitive-data-estate": 13_400,
  "from-lessons-learned-to-defenses-checked": 14_700,
  "the-knowledge-base-beneath-the-newsroom": 16_000,
  "from-signals-to-practical-advice": 17_300,
  "build-the-aws-exposure-control-stack": 18_600,
  "find-pii-risk-in-s3-buckets": 900,
  "make-azure-privilege-temporary": 3_400,
  "find-sensitive-data-paths-in-azure": 6_100,
  "shrink-openai-api-key-blast-radius": 8_800,
  "control-chatgpt-workspace-access-and-connected-data": 11_300,
  "separate-game-accounts-from-real-life": 15_200,
  "treat-mods-and-launchers-like-untrusted-code": 19_400,
} as const;

export type ThreatIntelligencePictogramSlug = Exclude<
  keyof typeof THREAT_INTELLIGENCE_PICTOGRAM_PHASE_OFFSETS,
  "hero"
>;

export const THREAT_INTELLIGENCE_PICTOGRAM_SLUGS = Object.keys(THREAT_INTELLIGENCE_PICTOGRAM_PHASE_OFFSETS).filter(
  (key): key is ThreatIntelligencePictogramSlug => key !== "hero",
);

export function isThreatIntelligencePictogramSlug(slug: string): slug is ThreatIntelligencePictogramSlug {
  return THREAT_INTELLIGENCE_PICTOGRAM_SLUGS.includes(slug as ThreatIntelligencePictogramSlug);
}

export function getThreatIntelligencePictogramPhaseOffset(slug: ThreatIntelligencePictogramSlug): number {
  return THREAT_INTELLIGENCE_PICTOGRAM_PHASE_OFFSETS[slug];
}
