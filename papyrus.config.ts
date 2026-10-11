import { defineSite } from "@anthusai/papyrus/define-site";
import { threatIntelligenceBrand } from "./publication/brand";

const legacyCognitoDomainPrefix = "papyrus-threat-intelligence";
const legacyRedirectUrls = [
  "https://main.dzefa11i80jyq.amplifyapp.com/newsroom",
  "https://main.dzefa11i80jyq.amplifyapp.com/",
  "http://localhost:3001/",
  "https://threat-intelligence.anth.us/",
  "https://threat-intelligence-staging.anth.us/",
];

function readNonEmptyEnvironmentValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

const cognitoDomainPrefixFromEnvironment = readNonEmptyEnvironmentValue("PAPYRUS_COGNITO_DOMAIN_PREFIX");
const applyCognitoDomainPrefixFromEnvironment = readNonEmptyEnvironmentValue("PAPYRUS_APPLY_COGNITO_DOMAIN_PREFIX");
const redirectUrlsFromEnvironment = readNonEmptyEnvironmentValue("PAPYRUS_OAUTH_REDIRECT_URLS");

export const resolvedAuthConfiguration = {
  cognitoDomainPrefix: cognitoDomainPrefixFromEnvironment ?? legacyCognitoDomainPrefix,
  applyCognitoDomainPrefix:
    applyCognitoDomainPrefixFromEnvironment === undefined
      ? true
      : applyCognitoDomainPrefixFromEnvironment === "true",
  redirectUrls: redirectUrlsFromEnvironment
    ? redirectUrlsFromEnvironment.split(",").map((url) => url.trim()).filter((url) => url.length > 0)
    : legacyRedirectUrls,
};

export default defineSite({
  brands: [threatIntelligenceBrand],
  defaultBrand: "threat-intelligence",
  backend: {
    brandId: "threat-intelligence",
    auth: resolvedAuthConfiguration,
    features: {
      consoleResponder: false,
      inboundEmail: false,
      slack: false,
      storageBackups: false,
    },
  },
});
