#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

const args = process.argv.slice(2);
let xmlPath = "";
let outputPath = "";
let timeSec = 1.0;
let theme = "dark";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--xml-path") xmlPath = args[++i];
  else if (args[i] === "--output") outputPath = args[++i];
  else if (args[i] === "--time") timeSec = parseFloat(args[++i]);
  else if (args[i] === "--theme") theme = args[++i];
}

if (!xmlPath || !outputPath) {
  console.error("Usage: node capture-scene-preview.mjs --xml-path <path> --output <path> [--time <sec>] [--theme <theme>]");
  process.exit(1);
}

const xmlContent = fs.readFileSync(xmlPath, "utf-8");
const previewUrl = `file://${path.join(projectRoot, "public/videoml/ti-preview.html")}`;

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  
  // 1920x1080 for 1080p video frames
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  
  // Forward console messages for debugging
  page.on('console', msg => {
    if (msg.type() === 'error') console.error(`[Browser Error] ${msg.text()}`);
    else if (msg.type() === 'warning') console.warn(`[Browser Warning] ${msg.text()}`);
  });
  page.on('pageerror', error => console.error(`[Page Error] ${error.message}`));

  await page.goto(previewUrl, { waitUntil: 'networkidle0' });

  // Inject XML into the player
  await page.evaluate(({ xmlContent, theme }) => {
    window.postMessage({ kind: 'ti-preview', xml: xmlContent, theme }, '*');
  }, { xmlContent, theme });

  // Wait for the player to mount
  await new Promise(r => setTimeout(r, 500));

  // Seek to the given time
  await page.evaluate((timeSec) => {
    window.postMessage({ kind: 'ti-preview-seek', time: timeSec }, '*');
  }, timeSec);

  // Wait for React rendering/animations to settle after seeking
  await new Promise(r => setTimeout(r, 800));

  await page.screenshot({ path: outputPath, type: "png" });

  await browser.close();
  console.log(`Preview captured: ${outputPath}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
