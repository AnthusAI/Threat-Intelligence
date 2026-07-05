import type { SiteBrand } from "../../lib/site-brand";
import { TI_BODY_FONT_FAMILY } from "../../lib/ti-body-fonts";

export const threatIntelligenceBrand: SiteBrand = {
  id: "threat-intelligence",
  appTitle: "Threat Intelligence",
  appDescription: "ANTHUS THREAT INTELLIGENCE from Anthus AI Solutions.",
  mastheadTitle: "THREAT INTELLIGENCE",
  mastheadSubtitle: "from Anthus AI Solutions",
  mastheadEyebrow: "Anthus AI Solutions",
  mastheadTagline: "Practical advice for staying secure as the threat landscape shifts.",
  mastheadTaglineLines: [
    { emphasis: "Practical advice", tail: " for" },
    { emphasis: "staying secure", tail: " as the" },
    { emphasis: "threat landscape", tail: " shifts" },
  ],
  backToHomeLabel: "Back to Threat Intelligence",
  articleTitleSuffix: "Threat Intelligence",
  placeholderByline: "Anthus AI Solutions",
  defaultPresentation: "blog",
  forcedPresentation: "blog",
  textFont: TI_BODY_FONT_FAMILY,
  footerTitle: "ANTHUS THREAT INTELLIGENCE",
  footerSubtitleOverride: "",
  mastheadWordSplit: true,
  mastheadDateFormat: "formatted",
  mastheadSource: "brand",
  sectionLinkStrategy: "anchor",
  defaultVideoCredit: "Anthus Threat Intelligence video",
};
