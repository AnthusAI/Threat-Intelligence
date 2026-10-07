import { defineSite } from "@anthusai/papyrus/define-site";
import { threatIntelligenceBrand } from "./publication/brand";

export default defineSite({
  brands: [threatIntelligenceBrand],
  defaultBrand: "threat-intelligence",
  backend: {
    brandId: "threat-intelligence",
    auth: {
      cognitoDomainPrefix: "papyrus-threat-intelligence",
      applyCognitoDomainPrefix: true,
      redirectUrls: [
        "http://localhost:3001/",
        "https://threat-intelligence.anth.us/",
        "https://threat-intelligence-staging.anth.us/",
      ],
    },
    features: {
      consoleResponder: false,
      inboundEmail: false,
      slack: false,
      storageBackups: false,
    },
  },
});
