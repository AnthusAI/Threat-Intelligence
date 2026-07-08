import type { EditionPresentationFormat } from "./content-types";
import { threatIntelligenceBrand } from "../publications/threat_intelligence/brand";
import {
  PAPYRUS_AUTH_REDIRECT_URLS,
  resolveSiteBrandAuthId,
  type SiteBrandAuthId,
} from "./site-brand-auth";

export type SiteBrandId = SiteBrandAuthId;

export type MastheadTaglineLine = {
  emphasis: string;
  tail: string;
};

export type SiteBrand = {
  id: SiteBrandId;
  appTitle: string;
  appDescription: string;
  mastheadTitle: string;
  mastheadSubtitle: string;
  mastheadEyebrow?: string;
  mastheadTagline?: string;
  mastheadTaglineLines?: MastheadTaglineLine[];
  backToHomeLabel: string;
  articleTitleSuffix: string;
  placeholderByline: string;
  defaultPresentation: EditionPresentationFormat;
  forcedPresentation?: EditionPresentationFormat;
  textFont: string;
  footerTitle?: string;
  footerSubtitleOverride?: string;
  mastheadWordSplit: boolean;
  mastheadDateFormat: "raw" | "formatted";
  mastheadSource: "edition" | "brand";
  sectionLinkStrategy: "route" | "anchor";
  defaultVideoCredit?: string;
  /** Production / Amplify Hosting OAuth callback origins for this publication. */
  authRedirectUrls: readonly string[];
};

const SERIF_TEXT_FONT = 'Georgia, "Times New Roman", serif';

const SITE_BRANDS: Record<SiteBrandId, SiteBrand> = {
  papyrus: {
    id: "papyrus",
    appTitle: "Papyrus",
    appDescription: "A Pretext-powered responsive newspaper layout lab.",
    mastheadTitle: "PAPYRUS",
    mastheadSubtitle: "Inside Papyrus",
    backToHomeLabel: "Back to Papyrus",
    articleTitleSuffix: "Papyrus",
    placeholderByline: "Papyrus",
    defaultPresentation: "newspaper",
    textFont: SERIF_TEXT_FONT,
    mastheadWordSplit: false,
    mastheadDateFormat: "raw",
    mastheadSource: "edition",
    sectionLinkStrategy: "route",
    authRedirectUrls: PAPYRUS_AUTH_REDIRECT_URLS,
  },
  "threat-intelligence": threatIntelligenceBrand,
};

export const SITE_BRAND = SITE_BRANDS[resolveSiteBrandAuthId()];

export function enforcePresentation(presentation: EditionPresentationFormat): EditionPresentationFormat {
  return SITE_BRAND.forcedPresentation ?? presentation;
}

export function getPresentationChoices(): EditionPresentationFormat[] {
  return SITE_BRAND.forcedPresentation
    ? [SITE_BRAND.forcedPresentation]
    : ["newspaper", "blog", "magazine"];
}
