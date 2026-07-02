import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../..");

const xml = execSync(
  `PYTHONPATH=${projectRoot}/src poetry run python -c "from publications.threat_intelligence.videoml.videos_dsl import generate_edition_videoml_dsl; print(generate_edition_videoml_dsl())"`,
  { cwd: projectRoot, encoding: "utf8" },
);

const TI_SCENE_STYLES_DARK = {
  background: "#191918",
  color: "#eeeeec",
  vars: {
    "--color-bg": "#191918",
    "--color-bg-subtle": "#111110",
    "--color-surface": "#21201c",
    "--color-surface-strong": "#2a2926",
    "--color-text": "#eeeeec",
    "--color-text-muted": "#b5b3ad",
    "--color-primary": "#eeeeec",
    "--color-accent": "#e54d2e",
    "--color-secondary": "#7f7e77",
    "--ti-section-rule": "#e54d2e",
    "--ti-alarm-red": "#e54d2e",
    "--ti-headline-color": "#eeeeec",
    "--ti-body-color": "#b5b3ad",
    "--ti-cta-red": "#e54d2e",
    "--background": "#191918",
    "--foreground": "#b5b3ad",
    "--foreground-strong": "#eeeeec",
    "--ti-pictogram-edge": "#363a3f",
    "--ti-pictogram-node": "#2e3135",
    "--ti-pictogram-muted": "#43484e",
    "--ti-pictogram-throb": "#ac4d39",
    "--ti-pictogram-compromised": "#e54d2e",
    "--ti-pictogram-accent-glow": "rgba(251, 146, 60, 0.2)",
    "--grass-8": "#30a46c",
    "--amber-8": "#f59e0b",
    "--sand-8": "#9090a0",
    "--font-headline": "Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif",
    "--font-subhead": "Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif",
    "--font-eyebrow": "Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif",
  },
};

const TI_SCENE_STYLES_LIGHT = {
  background: "#f9f9f8",
  color: "#44403c",
  vars: {
    "--color-bg": "#f9f9f8",
    "--color-bg-subtle": "#fcfcfc",
    "--color-surface": "#fcfcfc",
    "--color-surface-strong": "#f2f2f0",
    "--color-text": "#44403c",
    "--color-text-muted": "#696964",
    "--color-primary": "#44403c",
    "--color-accent": "#c54028",
    "--color-secondary": "#8a8a83",
    "--ti-section-rule": "#c54028",
    "--ti-alarm-red": "#c54028",
    "--ti-headline-color": "#44403c",
    "--ti-body-color": "#696964",
    "--ti-cta-red": "#c54028",
    "--background": "#f9f9f8",
    "--foreground": "#696964",
    "--foreground-strong": "#44403c",
    "--ti-pictogram-edge": "#889096",
    "--ti-pictogram-node": "#889096",
    "--ti-pictogram-muted": "#a8adb4",
    "--ti-pictogram-throb": "#d9542e",
    "--ti-pictogram-compromised": "#c54028",
    "--ti-pictogram-accent-glow": "rgba(234, 88, 12, 0.18)",
    "--grass-8": "#30a46c",
    "--amber-8": "#f59e0b",
    "--sand-8": "#9090a0",
    "--font-headline": "Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif",
    "--font-subhead": "Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif",
    "--font-eyebrow": "Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif",
  },
};

const TI_BACKGROUND_PROPS_DARK = { variant: "solid", color: "#191918" };
const TI_BACKGROUND_PROPS_LIGHT = { variant: "solid", color: "#f9f9f8" };

function propsAttr(value) {
  const raw = JSON.stringify(value);
  return raw.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;");
}

function rethemeDslXml(dslXml, theme) {
  if (theme === "dark") return dslXml;
  let updated = dslXml
    .replaceAll(propsAttr(TI_SCENE_STYLES_DARK), propsAttr(TI_SCENE_STYLES_LIGHT))
    .replaceAll(propsAttr(TI_BACKGROUND_PROPS_DARK), propsAttr(TI_BACKGROUND_PROPS_LIGHT));
  if (updated.includes("#191918") || updated.includes("#111110") || updated.includes("#21201c")) {
    for (const [darkToken, lightToken] of [
      ["rgba(251, 146, 60, 0.2)", "rgba(234, 88, 12, 0.18)"],
      ["#191918", "#f9f9f8"],
      ["#111110", "#fcfcfc"],
      ["#21201c", "#fcfcfc"],
      ["#2a2926", "#f2f2f0"],
      ["#eeeeec", "#44403c"],
      ["#b5b3ad", "#696964"],
      ["#e54d2e", "#c54028"],
      ["#7f7e77", "#8a8a83"],
      ["#363a3f", "#889096"],
      ["#2e3135", "#889096"],
      ["#43484e", "#a8adb4"],
      ["#ac4d39", "#d9542e"],
    ]) {
      updated = updated.replaceAll(darkToken, lightToken);
    }
  }
  return updated;
}

const darkCount = (xml.match(/#191918/g) ?? []).length;
const lightThemed = rethemeDslXml(xml, "light");
const darkAfter = (lightThemed.match(/#191918/g) ?? []).length;

const legacyStyles = propsAttr(TI_SCENE_STYLES_DARK).replaceAll(
  "Inter, Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif",
  "Helvetica Neue, Segoe UI, Helvetica, Arial, sans-serif",
);
const legacyXml = xml.replaceAll(propsAttr(TI_SCENE_STYLES_DARK), legacyStyles);
const legacyThemed = rethemeDslXml(legacyXml, "light");
const legacyDarkAfter = (legacyThemed.match(/#191918/g) ?? []).length;

console.log({ darkCount, darkAfter, legacyDarkAfter });

if (darkAfter !== 0 || legacyDarkAfter !== 0) {
  throw new Error(`expected no dark palette tokens after light retheme (${darkAfter}, ${legacyDarkAfter})`);
}
