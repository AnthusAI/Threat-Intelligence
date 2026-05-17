#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const SVG_SIZE = 64;
const PREVIEW_LABEL_HEIGHT = 24;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");
const require = createRequire(import.meta.url);

const configPath = path.join(__dirname, "favicon.config.json");
const globalsCssPath = path.join(projectRoot, "app", "globals.css");
const publicDir = path.join(projectRoot, "public");

function formatNumber(value) {
  return Number.parseFloat(value.toFixed(3)).toString();
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseViewBox(svgSource) {
  const match = svgSource.match(/viewBox="([^"]+)"/);
  if (!match) throw new Error("Lucide SVG is missing a viewBox.");
  const numbers = match[1].trim().split(/\s+/).map((value) => Number(value));
  if (numbers.length !== 4 || numbers.some((value) => Number.isNaN(value))) {
    throw new Error(`Invalid viewBox: ${match[1]}`);
  }
  return numbers;
}

function extractSvgInner(svgSource) {
  return svgSource
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .trim();
}

function buildIconSvg({ iconInner, iconViewBox, colors, strokeWidth, padding, title }) {
  const [x, y, width, height] = iconViewBox;
  const paddedViewBox = [
    formatNumber(x - padding),
    formatNumber(y - padding),
    formatNumber(width + padding * 2),
    formatNumber(height + padding * 2),
  ].join(" ");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_SIZE} ${SVG_SIZE}" role="img" aria-label="${escapeHtml(title)}">`,
    `  <rect width="${SVG_SIZE}" height="${SVG_SIZE}" fill="${escapeHtml(colors.paper)}"/>`,
    `  <svg x="0" y="0" width="${SVG_SIZE}" height="${SVG_SIZE}" viewBox="${paddedViewBox}" fill="none" stroke="${escapeHtml(colors.ink)}" color="${escapeHtml(colors.ink)}" stroke-width="${formatNumber(strokeWidth)}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`,
    iconInner
      .split("\n")
      .map((line) => (line.trim().length === 0 ? line : `    ${line}`))
      .join("\n"),
    "  </svg>",
    "</svg>",
    "",
  ].join("\n");
}

async function loadThemeColors(browser, cssText, scheme) {
  const page = await browser.newPage({ viewport: { width: 240, height: 120 } });
  try {
    const safeCss = cssText.replace(/<\/style/gi, "<\\/style");
    await page.emulateMedia({ colorScheme: scheme });
    await page.setContent(
      `<!doctype html><html><head><style>${safeCss}</style></head><body><div id="probe"></div></body></html>`,
    );
    return await page.evaluate(() => {
      const probe = document.getElementById("probe");
      if (!probe) throw new Error("Theme probe not found.");
      probe.style.backgroundColor = "var(--paper)";
      probe.style.color = "var(--ink)";
      const computed = getComputedStyle(probe);
      const root = getComputedStyle(document.documentElement);
      return {
        paper: computed.backgroundColor,
        ink: computed.color,
        paperToken: root.getPropertyValue("--paper").trim(),
        inkToken: root.getPropertyValue("--ink").trim(),
      };
    });
  } finally {
    await page.close();
  }
}

async function renderSvgToPng(browser, svgMarkup, outputPath, outputSize) {
  const page = await browser.newPage({ viewport: { width: outputSize, height: outputSize } });
  try {
    await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; padding: 0; background: transparent; }
      #icon { width: ${outputSize}px; height: ${outputSize}px; }
      #icon > svg { display: block; width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <div id="icon">${svgMarkup}</div>
  </body>
</html>`);
    await page.locator("#icon").screenshot({ path: outputPath });
  } finally {
    await page.close();
  }
}

async function renderPreviewGrid(browser, { scheme, outputPath, candidates, strokeWidths, paddings, cellSize, gap }) {
  const columns = strokeWidths.length;
  const rows = paddings.length;
  const outerPadding = 16;
  const headerHeight = 36;
  const width = outerPadding * 2 + columns * cellSize + (columns - 1) * gap;
  const rowHeight = cellSize + PREVIEW_LABEL_HEIGHT;
  const height = outerPadding * 2 + headerHeight + rows * rowHeight + (rows - 1) * gap;

  const cardsMarkup = candidates
    .map(
      (candidate) => `<figure class="candidate">
  <div class="candidate__icon">${candidate.svg}</div>
  <figcaption>stroke ${formatNumber(candidate.strokeWidth)} | pad ${formatNumber(candidate.padding)}</figcaption>
</figure>`,
    )
    .join("\n");

  const page = await browser.newPage({ viewport: { width, height } });
  try {
    await page.setContent(`<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; padding: 0; }
      body {
        background: ${scheme === "dark" ? "#0f1113" : "#ececeb"};
        color: ${scheme === "dark" ? "#e6e7e8" : "#111214"};
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #preview {
        padding: ${outerPadding}px;
        width: ${width}px;
        height: ${height}px;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 14px;
        line-height: 24px;
        font-weight: 700;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(${columns}, ${cellSize}px);
        gap: ${gap}px;
      }
      .candidate {
        margin: 0;
      }
      .candidate__icon {
        width: ${cellSize}px;
        height: ${cellSize}px;
      }
      .candidate__icon > svg {
        display: block;
        width: 100%;
        height: 100%;
      }
      figcaption {
        margin-top: 2px;
        font-size: 11px;
        line-height: ${PREVIEW_LABEL_HEIGHT - 2}px;
        white-space: nowrap;
      }
    </style>
  </head>
  <body>
    <div id="preview">
      <h1>${escapeHtml(`Papyrus favicon preview (${scheme})`)}</h1>
      <div class="grid">
${cardsMarkup
  .split("\n")
  .map((line) => `        ${line}`)
  .join("\n")}
      </div>
    </div>
  </body>
</html>`);
    await page.locator("#preview").screenshot({ path: outputPath });
  } finally {
    await page.close();
  }
}

async function readConfig() {
  const configRaw = await fs.readFile(configPath, "utf8");
  const config = JSON.parse(configRaw);
  if (!config?.iconName) throw new Error("favicon.config.json is missing iconName.");
  if (!config?.final?.strokeWidth) throw new Error("favicon.config.json is missing final.strokeWidth.");
  if (typeof config?.final?.padding !== "number") throw new Error("favicon.config.json is missing final.padding.");
  return config;
}

async function main() {
  const config = await readConfig();
  const cssText = await fs.readFile(globalsCssPath, "utf8");
  const lucideSvgPath = require.resolve(`lucide-static/icons/${config.iconName}.svg`);
  const lucideSvg = await fs.readFile(lucideSvgPath, "utf8");
  const iconViewBox = parseViewBox(lucideSvg);
  const iconInner = extractSvgInner(lucideSvg);

  await fs.mkdir(publicDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    const lightColors = await loadThemeColors(browser, cssText, "light");
    const darkColors = await loadThemeColors(browser, cssText, "dark");

    const lightSvg = buildIconSvg({
      iconInner,
      iconViewBox,
      colors: lightColors,
      strokeWidth: config.final.strokeWidth,
      padding: config.final.padding,
      title: "Papyrus",
    });
    const darkSvg = buildIconSvg({
      iconInner,
      iconViewBox,
      colors: darkColors,
      strokeWidth: config.final.strokeWidth,
      padding: config.final.padding,
      title: "Papyrus",
    });

    await fs.writeFile(path.join(publicDir, "icon-light.svg"), lightSvg, "utf8");
    await fs.writeFile(path.join(publicDir, "icon-dark.svg"), darkSvg, "utf8");
    await renderSvgToPng(browser, lightSvg, path.join(publicDir, "icon.png"), config.outputSize);

    const previewDir = path.join(projectRoot, config.preview.outputDir);
    await fs.mkdir(previewDir, { recursive: true });
    const previewCombos = [];
    for (const padding of config.preview.paddings) {
      for (const strokeWidth of config.preview.strokeWidths) {
        previewCombos.push({ padding, strokeWidth });
      }
    }

    const lightCandidates = previewCombos.map(({ padding, strokeWidth }) => ({
      padding,
      strokeWidth,
      svg: buildIconSvg({
        iconInner,
        iconViewBox,
        colors: lightColors,
        strokeWidth,
        padding,
        title: "Papyrus favicon preview",
      }),
    }));
    const darkCandidates = previewCombos.map(({ padding, strokeWidth }) => ({
      padding,
      strokeWidth,
      svg: buildIconSvg({
        iconInner,
        iconViewBox,
        colors: darkColors,
        strokeWidth,
        padding,
        title: "Papyrus favicon preview",
      }),
    }));

    await renderPreviewGrid(browser, {
      scheme: "light",
      outputPath: path.join(previewDir, "icon-preview-light.png"),
      candidates: lightCandidates,
      strokeWidths: config.preview.strokeWidths,
      paddings: config.preview.paddings,
      cellSize: config.preview.cellSize,
      gap: config.preview.gap,
    });
    await renderPreviewGrid(browser, {
      scheme: "dark",
      outputPath: path.join(previewDir, "icon-preview-dark.png"),
      candidates: darkCandidates,
      strokeWidths: config.preview.strokeWidths,
      paddings: config.preview.paddings,
      cellSize: config.preview.cellSize,
      gap: config.preview.gap,
    });

    console.log("Generated favicon assets:");
    console.log(" - public/icon-light.svg");
    console.log(" - public/icon-dark.svg");
    console.log(" - public/icon.png");
    console.log(` - ${path.relative(projectRoot, path.join(previewDir, "icon-preview-light.png"))}`);
    console.log(` - ${path.relative(projectRoot, path.join(previewDir, "icon-preview-dark.png"))}`);
    console.log("Theme colors resolved from app/globals.css:");
    console.log(` - light paper=${lightColors.paper} ink=${lightColors.ink}`);
    console.log(` - dark  paper=${darkColors.paper} ink=${darkColors.ink}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("favicon generation failed");
  console.error(error);
  process.exitCode = 1;
});
