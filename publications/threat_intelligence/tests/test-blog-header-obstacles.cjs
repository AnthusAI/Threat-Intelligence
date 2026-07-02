#!/usr/bin/env node

const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const targetUrl = process.env.PAPYRUS_BLOG_HEADER_URL ?? "http://127.0.0.1:3001/2026/july/04";

async function waitForObstacles(page) {
  await page.waitForSelector(".blog-page-background[data-blog-page-background-obstacles]", { timeout: 15000 });
  await page.waitForFunction(() => {
    const element = document.querySelector(".blog-page-background[data-blog-page-background-obstacles]");
    if (!element) return false;
    try {
      return JSON.parse(element.getAttribute("data-blog-page-background-obstacles") ?? "[]").length > 0;
    } catch {
      return false;
    }
  }, null, { timeout: 15000 });
}

async function evaluateWithNavigationRetry(page, callback, attempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await waitForObstacles(page);
      return await page.evaluate(callback);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/Execution context was destroyed|Cannot find context|navigation|Timeout/i.test(message)) {
        throw error;
      }
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      await page.waitForTimeout(250);
    }
  }
  throw lastError;
}

async function assertDesktopBlankRegion(browser) {
  const page = await browser.newPage({ viewport: { width: 1254, height: 716 } });
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    const result = await evaluateWithNavigationRetry(page, () => {
      function textRect(element) {
        const textNode = Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
        if (!textNode || !textNode.textContent?.trim()) {
          throw new Error(`Missing text node for ${element.textContent}`);
        }
        const leadingWhitespace = textNode.textContent.search(/\S/);
        const range = document.createRange();
        range.setStart(textNode, Math.max(0, leadingWhitespace));
        range.setEnd(textNode, textNode.textContent.trimEnd().length);
        const rect = range.getBoundingClientRect();
        range.detach();
        return {
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          top: rect.top,
        };
      }

      const background = document.querySelector(".blog-page-background[data-blog-page-background-obstacles]");
      if (!background) throw new Error("Missing blog background");
      const containerRect = background.getBoundingClientRect();
      const threat = document.querySelector('.presentation-header__word-text');
      if (!threat || threat.textContent?.trim() !== "THREAT") throw new Error("Missing THREAT masthead span");

      const spanRect = threat.closest(".presentation-header__word")?.getBoundingClientRect();
      if (!spanRect) throw new Error("Missing THREAT masthead word box");
      const renderedTextRect = textRect(threat);
      const obstacles = JSON.parse(background.getAttribute("data-blog-page-background-obstacles") ?? "[]");
      const blankWidth = spanRect.right - renderedTextRect.right;
      const threatWordRight = spanRect.right - containerRect.left;
      const threatLineObstacles = obstacles.filter((obstacle) => (
        ((spanRect.top + spanRect.bottom) / 2) - containerRect.top >= obstacle.y
        && ((spanRect.top + spanRect.bottom) / 2) - containerRect.top <= obstacle.y + obstacle.height
        && obstacle.x <= threatWordRight
      ));
      const maxThreatObstacleRight = threatLineObstacles.reduce((max, obstacle) => (
        Math.max(max, obstacle.x + obstacle.width)
      ), -Infinity);
      const header = document.querySelector(".presentation-header");
      const headerRect = header?.getBoundingClientRect();
      const core = document.querySelector('[data-blog-node-id="core"]');
      const capEmRatio = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--ti-masthead-cap-em-ratio"),
      ) || 0.70459;
      const fontSize = Number.parseFloat(getComputedStyle(threat).fontSize);
      const expectedCapHeight = fontSize * capEmRatio;
      // Read the row height from the blog rhythm shell (the inline style set
      // from BLOG_RHYTHM), not from :root, so the test tracks the actually
      // rendered rhythm rather than the static CSS fallback on :root.
      const rhythmShell = document.querySelector(".blog-rhythm-shell");
      const rowHeight = Number.parseFloat(
        getComputedStyle(rhythmShell ?? document.documentElement).getPropertyValue("--ti-row-height"),
      ) || 28;
      const obstaclePadding = rowHeight;

      return {
        blankWidth,
        coreCx: core ? Number(core.getAttribute("cx")) : null,
        coreR: core ? Number(core.getAttribute("r")) : null,
        expectedCapHeight,
        expectedCapRows: expectedCapHeight / rowHeight,
        fontSize,
        headerClearance: headerRect ? headerRect.right - renderedTextRect.right : 0,
        obstaclePadding,
        maxThreatObstacleRight,
        obstacleCount: obstacles.length,
        spanRight: spanRect.right - containerRect.left,
        spanHeight: spanRect.height,
        threatWordRight,
        wordBoxRows: spanRect.height / rowHeight,
      };
    });

    assert.ok(result.obstacleCount > 0, "expected the rendered page to expose header text obstacles");
    assert.ok(
      Math.abs(result.expectedCapRows - 4) < 0.05,
      `expected cap-compensated THREAT caps to fill four rows, got ${result.expectedCapRows}`,
    );
    assert.ok(
      Math.abs(result.wordBoxRows - 4) < 0.05,
      `expected THREAT word box to stay four rows tall, got ${result.wordBoxRows}`,
    );
    assert.ok(
      result.headerClearance > 80,
      `expected header space to the right of THREAT for the pictogram, got ${result.headerClearance}`,
    );
    assert.ok(
      result.coreCx !== null && result.coreR !== null,
      "expected the defense pictogram core to render on desktop",
    );
    assert.ok(
      result.maxThreatObstacleRight <= result.threatWordRight + result.obstaclePadding * 2 + 1,
      `THREAT obstacle should hug the word box with one row of pictogram padding, got obstacle right ${result.maxThreatObstacleRight} vs word right ${result.threatWordRight}`,
    );
  } finally {
    await page.close();
  }
}

async function assertNarrowCoreGap(browser) {
  const page = await browser.newPage({ viewport: { width: 558, height: 716 } });
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    const result = await evaluateWithNavigationRetry(page, () => {
      const background = document.querySelector(".blog-page-background[data-blog-page-background-obstacles]");
      if (!background) throw new Error("Missing blog background");
      const containerRect = background.getBoundingClientRect();
      const core = document.querySelector('[data-blog-node-id="core"]');
      const threat = Array.from(document.querySelectorAll(".presentation-header__word-text"))
        .find((span) => span.textContent?.trim() === "THREAT");
      const intelligence = Array.from(document.querySelectorAll(".presentation-header__word-text"))
        .find((span) => span.textContent?.trim() === "INTELLIGENCE");
      if (!threat || !intelligence) throw new Error("Missing masthead words");

      const threatRect = threat.closest(".presentation-header__word")?.getBoundingClientRect();
      const intelligenceRect = intelligence.closest(".presentation-header__word")?.getBoundingClientRect();
      if (!threatRect || !intelligenceRect) throw new Error("Missing masthead word boxes");
      const coreRect = core
        ? {
            cx: Number(core.getAttribute("cx")),
            cy: Number(core.getAttribute("cy")),
            r: Number(core.getAttribute("r")),
          }
        : null;
      const obstacles = JSON.parse(background.getAttribute("data-blog-page-background-obstacles") ?? "[]");
      const threatMidY = ((threatRect.top + threatRect.bottom) / 2) - containerRect.top;
      const threatObstacle = obstacles
        .filter((obstacle) => obstacle.y <= threatMidY && obstacle.y + obstacle.height >= threatMidY)
        .sort((left, right) => (right.x + right.width) - (left.x + left.width))[0];
      // When the pictogram background does not horizontally overlap the THREAT
      // word (which can happen at small rhythm scales on narrow viewports), no
      // THREAT obstacle is generated. In that case fall back to the THREAT word
      // box's right edge (relative to the background) as the clearance bound.
      const threatWordRight = threatRect.right - containerRect.left;

      return {
        core: coreRect,
        intelligenceTop: intelligenceRect.top - containerRect.top,
        obstacleCount: obstacles.length,
        threatBottom: threatRect.bottom - containerRect.top,
        threatObstacleRight: threatObstacle ? threatObstacle.x + threatObstacle.width : threatWordRight,
        threatWordRight,
      };
    });

    assert.ok(result.obstacleCount > 0, "expected narrow header text obstacles");
    assert.ok(result.core, "core node should remain visible at 558px");
    assert.ok(
      result.threatObstacleRight !== null && result.core.cx > result.threatObstacleRight + result.core.r,
      `core should sit to the right of the THREAT text, got core ${JSON.stringify(result.core)} and text/obstacle right ${result.threatObstacleRight}`,
    );
    assert.ok(
      result.core.cy < result.intelligenceTop,
      `core should sit above INTELLIGENCE, got core y ${result.core.cy} and intelligence top ${result.intelligenceTop}`,
    );
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await chromium.launch();
  try {
    await assertDesktopBlankRegion(browser);
    await assertNarrowCoreGap(browser);
  } finally {
    await browser.close();
  }
}

main()
  .then(() => {
    console.log("blog header obstacle measurement test passed");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
