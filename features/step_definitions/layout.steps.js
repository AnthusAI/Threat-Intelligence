const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { Given, Then, When } = require("@cucumber/cucumber");

Given("I open the {string} layout scenario at {int} by {int}", async function (scenarioId, width, height) {
  await this.openScenario(scenarioId, width, height);
});

Given("I open the front page at {int} by {int}", async function (width, height) {
  await this.openPath("/", width, height);
  await requirePage(this).waitForFunction(
    () => window.__PAPYRUS_LAYOUT__ && document.querySelector(".paper-page--active"),
    { timeout: 15_000 },
  );
});

Given("I open the archive page at {int} by {int}", async function (width, height) {
  await this.openPath("/archive", width, height);
  await requirePage(this).waitForSelector(".archive-grid-shell", { state: "visible", timeout: 15_000 });
});

Given("I open the edition path {string} at {int} by {int}", async function (routePath, width, height) {
  await this.openPath(routePath, width, height);
});

Given("I open article {string} at {int} by {int}", async function (slug, width, height) {
  await this.openPath(`/articles/${slug}`, width, height);
});

When("I scroll to page {int}", async function (targetPage) {
  const page = requirePage(this);
  await page.evaluate((target) => {
    window.__PAPYRUS_SCROLL_TO_PAGE__?.(target, { immediate: true });
  }, targetPage);
  await page.waitForFunction((expectedPage) => {
    const visible = window.__PAPYRUS_VISIBLE_PAGE__ ?? Number(document.querySelector(".site-shell")?.getAttribute("data-current-page") ?? 1);
    return visible === expectedPage;
  }, targetPage);
});

When("I follow the continuation jump for article {string}", async function (articleId) {
  const page = requirePage(this);
  const jump = page.locator(`.front-story[data-article-id="${articleId}"] .jump-line a`).first();
  await jump.waitFor({ state: "visible", timeout: 10_000 });
  await jump.click();
});

Then("the active page should be a {string} page", async function (expectedKind) {
  const report = await getActivePageReport(requirePage(this));
  assert.equal(report.kind, expectedKind);
});

Then("the active visible page should be {int}", async function (expectedPage) {
  const page = requirePage(this);
  await page.waitForFunction((targetPage) => {
    const visible = window.__PAPYRUS_VISIBLE_PAGE__ ?? Number(document.querySelector(".site-shell")?.getAttribute("data-current-page") ?? 1);
    return visible === targetPage;
  }, expectedPage);
  const visiblePage = await page.evaluate(() => (
    window.__PAPYRUS_VISIBLE_PAGE__ ?? Number(document.querySelector(".site-shell")?.getAttribute("data-current-page") ?? 1)
  ));
  assert.equal(visiblePage, expectedPage);
});

Then("page {int} should be materialized", async function (pageNumber) {
  const state = await requirePage(this).locator(`#page-${pageNumber}`).getAttribute("data-materialized");
  assert.equal(state, "true");
});

Then("page {int} should be a page placeholder", async function (pageNumber) {
  const state = await requirePage(this).locator(`#page-${pageNumber}`).getAttribute("data-materialized");
  assert.equal(state, "false");
  await requirePage(this).locator(`#page-${pageNumber} .paper-page-content--placeholder`).waitFor({ state: "visible", timeout: 10_000 });
});

Then("no flipbook UI classes should be rendered", async function () {
  const hasFlipbook = await requirePage(this).evaluate(() => (
    Boolean(
      document.querySelector(".flipbook-controls") ||
      document.querySelector(".flipbook-shell") ||
      document.querySelector(".paper-page--enter-next") ||
      document.querySelector(".paper-page--leave-next") ||
      document.querySelector(".paper-page--enter-previous") ||
      document.querySelector(".paper-page--leave-previous"),
    )
  ));
  assert.equal(hasFlipbook, false);
});

Then("the active content scenario should be {string}", async function (expectedScenarioId) {
  const scenarioId = await requirePage(this).evaluate(() => window.__PAPYRUS_SCENARIO__ ?? null);
  assert.equal(scenarioId, expectedScenarioId);
});

Then("the active content source should be {string}", async function (expectedSource) {
  const source = await requirePage(this).locator(".site-shell").getAttribute("data-content-source");
  assert.equal(source, expectedSource);
});

Then("the active edition should expose a composable layout plan", async function () {
  const templateId = await requirePage(this).locator(".site-shell").getAttribute("data-layout-plan-front-template");
  assert.equal(templateId, "front.mosaic");
});

Then("the active edition should include article {string}", async function (expectedSlug) {
  const articleSlugs = await requirePage(this).evaluate(() => {
    const layout = window.__PAPYRUS_LAYOUT__;
    const slugs = layout?.pages.flatMap((page) => (
      page.regions.flatMap((region) => (
        region.blocks.map((block) => block.article?.slug).filter(Boolean)
      ))
    )) ?? [];
    return Array.from(new Set(slugs));
  });

  assert.ok(
    articleSlugs.includes(expectedSlug),
    `Expected active edition to include ${expectedSlug}; found ${articleSlugs.join(", ")}`,
  );
});

Then("edition pages should sit on a neutral gray substrate with one rhythm row between pages", async function () {
  const report = await requirePage(this).evaluate(() => {
    const layout = window.__PAPYRUS_LAYOUT__;
    const shell = document.querySelector(".site-shell");
    const scrollEdition = document.querySelector(".scroll-edition");
    const pageContent = document.querySelector(".paper-page-content");
    if (!layout || !shell || !scrollEdition || !pageContent) return null;
    return {
      rhythm: layout.rhythm.rowHeight,
      shellBackground: getComputedStyle(shell).backgroundColor,
      editionBackground: getComputedStyle(scrollEdition).backgroundColor,
      pageGap: Number.parseFloat(getComputedStyle(scrollEdition).rowGap),
      pageShadow: getComputedStyle(pageContent).boxShadow,
    };
  });
  assert.ok(report, "Expected edition substrate report");
  assert.equal(report.shellBackground, "rgb(128, 128, 128)");
  assert.equal(report.editionBackground, "rgb(128, 128, 128)");
  assert.ok(Math.abs(report.pageGap - report.rhythm) <= 0.75, `Expected page gap ${report.pageGap} to equal rhythm ${report.rhythm}`);
  assert.notEqual(report.pageShadow, "none", "Expected paper pages to cast a downward shadow");
});

Then("the front page should label article {string} as continued on page {int}", async function (articleId, pageNumber) {
  const continuationPageNumber = await requirePage(this).evaluate((targetArticleId) => {
    const layout = window.__PAPYRUS_LAYOUT__;
    const frontPage = layout?.pages.find((page) => page.pageNumber === 1);
    return frontPage?.regions
      .flatMap((region) => region.blocks)
      .find((block) => block.article?.slug === targetArticleId)?.jumpTargetPage ?? null;
  }, articleId);

  assert.equal(continuationPageNumber, pageNumber);
});

Then("the article page should show headline {string}", async function (expectedHeadline) {
  const headlineLocator = requirePage(this).locator(".article-page h1");
  await headlineLocator.waitFor({ state: "visible", timeout: 10_000 });
  const headline = await headlineLocator.innerText();
  assert.equal(headline, expectedHeadline);
});

Then("the article page should show deck {string}", async function (expectedDeck) {
  await requirePage(this).locator(".article-deck").waitFor({ state: "visible", timeout: 10_000 });
  const deck = await requirePage(this).locator(".article-deck").innerText();
  assert.equal(deck, expectedDeck);
});

Then("the article back link should target {string}", async function (expectedTarget) {
  const href = await requirePage(this).locator(".article-nav a").first().getAttribute("href");
  assert.equal(href, expectedTarget);
});

Then("the browser path should be {string}", async function (expectedPath) {
  const actualPath = await requirePage(this).evaluate(() => window.location.pathname);
  assert.equal(actualPath, expectedPath);
});

Then("the browser hash should be {string}", async function (expectedHash) {
  await requirePage(this).waitForFunction((hash) => window.location.hash === hash, expectedHash, { timeout: 10_000 });
  const actualHash = await requirePage(this).evaluate(() => window.location.hash);
  assert.equal(actualHash, expectedHash);
});

Then("article {string} should have exactly one edition anchor", async function (articleId) {
  await requirePage(this).waitForFunction(
    (targetArticleId) => Array.from(document.querySelectorAll("[id]")).some((element) => element.id === targetArticleId),
    articleId,
    { timeout: 10_000 },
  );
  const anchorCount = await requirePage(this).evaluate((targetArticleId) => (
    Array.from(document.querySelectorAll("[id]")).filter((element) => element.id === targetArticleId).length
  ), articleId);
  assert.equal(anchorCount, 1);
});

Then("no measured line should be cropped", async function () {
  const report = await getActivePageReport(requirePage(this));
  assert.deepEqual(report.clippedLines, []);
});

Then("no solved furniture should overlap within a section", async function () {
  const report = await getActivePageReport(requirePage(this));
  assert.deepEqual(report.furnitureOverlaps, []);
});

Then("no measured line should overlap solved furniture", async function () {
  const report = await getActivePageReport(requirePage(this));
  assert.deepEqual(report.lineFurnitureOverlaps, []);
});

Then("no article chrome should overlap", async function () {
  const report = await getActivePageReport(requirePage(this));
  assert.deepEqual(report.chromeOverlaps, []);
});

Then("the active page should follow the vertical rhythm", async function () {
  const report = await getActiveRhythmReport(requirePage(this));
  assert.deepEqual(report.errors, []);
});

Then("no continuation column should be dead", async function () {
  const report = await getActivePageReport(requirePage(this));
  assert.deepEqual(report.deadColumns, []);
});

Then("the solved layout should use {int} columns", async function (expectedColumnCount) {
  const columnCount = await requirePage(this).evaluate(() => window.__PAPYRUS_LAYOUT__?.columnCount ?? null);
  assert.equal(columnCount, expectedColumnCount);
});

Then("the {string} section should show a responsive image inset", async function (articleId) {
  const solverSection = await getSolvedSection(requirePage(this), articleId);
  assert.ok(solverSection, `Expected solved section for ${articleId}`);
  assert.ok(solverSection.image, `Expected ${articleId} to have a solved image`);
  assert.ok(solverSection.image.columnSpan >= 1, `Expected ${articleId} image to occupy at least one column`);
  assert.ok(
    String(solverSection.image.templateId).startsWith("image-"),
    `Expected responsive image template id; found ${solverSection.image.templateId}`,
  );
});

Then("the {string} section image should span {int} columns", async function (articleId, expectedSpan) {
  const solverSection = await getSolvedSection(requirePage(this), articleId);
  assert.ok(solverSection, `Expected solved section for ${articleId}`);
  assert.equal(solverSection.image?.columnSpan, expectedSpan);
});

Then("the {string} section image should leave one rhythm row before copy", async function (articleId) {
  const report = await requirePage(this).evaluate((targetArticleId) => {
    const active = document.querySelector(".paper-page--active");
    const layout = window.__PAPYRUS_LAYOUT__;
    const section = Array.from(active?.querySelectorAll(".solved-block--articleFrame, .front-story") ?? [])
      .find((candidate) => candidate.getAttribute("data-article-id") === targetArticleId);
    const image = section?.querySelector(".continuation-photo, .lead-photo, .front-prelude-photo");
    if (!layout || !section || !image) return null;
    const imageRect = image.getBoundingClientRect();
    const followingLines = Array.from(section.querySelectorAll(".measured-line"))
      .map((line) => line.getBoundingClientRect())
      .filter((lineRect) => (
        lineRect.left < imageRect.right - 0.75 &&
        lineRect.right > imageRect.left + 0.75 &&
        lineRect.top >= imageRect.bottom - 0.75
      ))
      .sort((first, second) => first.top - second.top);
    const forbiddenLines = followingLines.filter((lineRect) => lineRect.top < imageRect.bottom + layout.rhythm.rowHeight - 0.75);
    return {
      gap: followingLines[0] ? followingLines[0].top - imageRect.bottom : null,
      forbiddenLines: forbiddenLines.map((lineRect) => ({ top: lineRect.top, bottom: lineRect.bottom })),
      imageBottom: imageRect.bottom,
      firstCopyTop: followingLines[0]?.top ?? null,
      rhythm: layout.rhythm.rowHeight,
    };
  }, articleId);

  assert.ok(report, `Expected rendered image/copy geometry for ${articleId}`);
  assert.deepEqual(report.forbiddenLines, [], `Expected the row after ${articleId} image caption to stay blank`);
  if (report.gap !== null) {
    assert.ok(
      report.gap >= report.rhythm - 0.75,
      `Expected one rhythm row between image and copy for ${articleId}; found ${report.gap}px with rhythm ${report.rhythm}px`,
    );
  }
});

Then("the {string} section adjacent copy should flow beside the image", async function (articleId) {
  const report = await requirePage(this).evaluate((targetArticleId) => {
    const active = document.querySelector(".paper-page--active");
    const layout = window.__PAPYRUS_LAYOUT__;
    const section = Array.from(active?.querySelectorAll(".solved-block--articleFrame, .front-story") ?? [])
      .find((candidate) => candidate.getAttribute("data-article-id") === targetArticleId);
    const image = section?.querySelector(".continuation-photo, .lead-photo, .front-prelude-photo");
    if (!layout || !section || !image) return null;
    const imageRect = image.getBoundingClientRect();
    const adjacentLines = Array.from(section.querySelectorAll(".measured-line"))
      .map((line) => {
        const rect = line.getBoundingClientRect();
        return { text: line.textContent, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      })
      .filter((lineRect) => {
        const horizontallyOverlapsImage = lineRect.left < imageRect.right - 0.75 && lineRect.right > imageRect.left + 0.75;
        const verticallyBesideImage = lineRect.top >= imageRect.top - 0.75 && lineRect.top < imageRect.bottom - 0.75;
        return !horizontallyOverlapsImage && verticallyBesideImage;
      });
    return {
      adjacentLineCount: adjacentLines.length,
      sample: adjacentLines.slice(0, 3),
      imageRect: {
        left: imageRect.left,
        right: imageRect.right,
        top: imageRect.top,
        bottom: imageRect.bottom,
      },
      rhythm: layout.rhythm.rowHeight,
    };
  }, articleId);

  assert.ok(report, `Expected rendered image/copy geometry for ${articleId}`);
  assert.ok(
    report.adjacentLineCount > 0,
    `Expected adjacent columns to keep flowing beside ${articleId} image; found no adjacent copy in image band`,
  );
});

Then("the {string} section should not show a responsive image inset", async function (articleId) {
  const solverSection = await getSolvedSection(requirePage(this), articleId);
  assert.ok(solverSection, `Expected solved section for ${articleId}`);
  assert.equal(solverSection.image, null);
});

Then("the {string} section image should span between {int} and {int} columns", async function (articleId, minSpan, maxSpan) {
  const solverSection = await getSolvedSection(requirePage(this), articleId);
  assert.ok(solverSection, `Expected solved section for ${articleId}`);
  const actualSpan = solverSection.image?.columnSpan;
  assert.ok(
    actualSpan >= minSpan && actualSpan <= maxSpan,
    `Expected ${articleId} image span between ${minSpan} and ${maxSpan}; found ${actualSpan}`,
  );
});

Then("the {string} section image should be centered at the top", async function (articleId) {
  const solverSection = await getSolvedSection(requirePage(this), articleId);
  assert.ok(solverSection, `Expected solved section for ${articleId}`);
  assert.ok(solverSection.image, `Expected solved image for ${articleId}`);
  const expectedColumnStart = Math.floor((solverSection.columnCount - solverSection.image.columnSpan) / 2);
  assert.equal(
    solverSection.image.columnStart,
    expectedColumnStart,
    `Expected ${articleId} image to start at centered column ${expectedColumnStart}; found ${solverSection.image.columnStart}`,
  );
  assert.equal(solverSection.image.y, 0, `Expected ${articleId} image to start at the top of its body frame`);
});

Then("the {string} section image should be right aligned at the top", async function (articleId) {
  const solverSection = await getSolvedSection(requirePage(this), articleId);
  assert.ok(solverSection, `Expected solved section for ${articleId}`);
  assert.ok(solverSection.image, `Expected solved image for ${articleId}`);
  const expectedColumnStart = solverSection.columnCount - solverSection.image.columnSpan;
  assert.equal(
    solverSection.image.columnStart,
    expectedColumnStart,
    `Expected ${articleId} image to start at rightmost column ${expectedColumnStart}; found ${solverSection.image.columnStart}`,
  );
  assert.equal(solverSection.image.y, 0, `Expected ${articleId} image to start at the top of its body frame`);
});

Then("the {string} continuation should not repeat front-page images", async function (articleId) {
  const report = await requirePage(this).evaluate((targetArticleId) => {
    const layout = window.__PAPYRUS_LAYOUT__;
    const activePageNumber = window.__PAPYRUS_VISIBLE_PAGE__ ?? Number(document.querySelector(".site-shell")?.getAttribute("data-current-page") ?? 1);
    const frontBlock = layout?.pages.find((page) => page.pageNumber === 1)?.regions
      .flatMap((region) => region.blocks)
      .find((candidate) => candidate.article?.slug === targetArticleId);
    const activeBlock = layout?.pages.find((page) => page.pageNumber === activePageNumber)?.regions
      .flatMap((region) => region.blocks)
      .find((candidate) => candidate.article?.slug === targetArticleId);
    const imageAssetIds = (block) => (block?.furniture ?? [])
      .filter((item) => item.kind === "image")
      .map((item) => item.assetId);
    return {
      frontImageAssetIds: imageAssetIds(frontBlock),
      continuationImageAssetIds: imageAssetIds(activeBlock),
      continuationHasMore: activeBlock?.hasMore ?? null,
    };
  }, articleId);

  assert.ok(report.frontImageAssetIds.length > 0, `Expected ${articleId} to use an image on the front page`);
  const repeated = report.continuationImageAssetIds.filter((assetId) => report.frontImageAssetIds.includes(assetId));
  assert.deepEqual(repeated, [], `Expected ${articleId} continuation not to repeat front image assets`);
  assert.equal(report.continuationHasMore, false, `Expected ${articleId} continuation to exhaust the remaining article text`);
});

Then("the inside page header should center labels on the rhythm row", async function () {
  const report = await requirePage(this).evaluate(() => {
    const active = document.querySelector(".paper-page--active");
    const layout = window.__PAPYRUS_LAYOUT__;
    const rhythm = layout?.rhythm?.rowHeight ?? 19;
    const header = active?.querySelector(".inside-header");
    const headerRect = header?.getBoundingClientRect();
    const labelRects = Array.from(header?.querySelectorAll("span") ?? []).map((label) => {
      const rect = label.getBoundingClientRect();
      return {
        text: label.textContent,
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
      };
    });
    return {
      rhythm,
      header: headerRect && {
        top: headerRect.top,
        bottom: headerRect.bottom,
        height: headerRect.height,
      },
      labels: labelRects,
    };
  });

  assert.ok(report.header, "Expected inside page header geometry");
  assert.equal(report.labels.length, 3, "Expected inside header to render three labels");
  const expectedTop = report.header.top + report.rhythm;
  for (const label of report.labels) {
    assert.ok(
      Math.abs(label.top - expectedTop) <= 0.75,
      `Expected "${label.text}" to start on the centered rhythm row at ${expectedTop}; found ${label.top}`,
    );
    assert.ok(
      Math.abs(label.height - report.rhythm) <= 0.75,
      `Expected "${label.text}" to occupy one rhythm row; found ${label.height}`,
    );
  }
});

Then("continuation title chrome should be compact", async function () {
  const report = await requirePage(this).evaluate(() => {
    const active = document.querySelector(".paper-page--active");
    const layout = window.__PAPYRUS_LAYOUT__;
    const rhythm = layout?.rhythm?.rowHeight ?? 19;
    const title = active?.querySelector(".continued-title");
    const body = active?.querySelector(".continuation-body");
    const headline = title?.querySelector("h2");
    const firstLine = body?.querySelector(".measured-line");
    const titleStyle = title ? getComputedStyle(title) : null;
    const bodyStyle = body ? getComputedStyle(body) : null;
    const rect = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        top: box.top,
        bottom: box.bottom,
        height: box.height,
      };
    };

    return {
      rhythm,
      titleBorderBottomWidth: titleStyle ? Number.parseFloat(titleStyle.borderBottomWidth) : null,
      titlePaddingBottom: titleStyle ? Number.parseFloat(titleStyle.paddingBottom) : null,
      bodyBorderTopWidth: bodyStyle ? Number.parseFloat(bodyStyle.borderTopWidth) : null,
      headlineRect: rect(headline),
      firstLineRect: rect(firstLine),
    };
  });

  assert.equal(report.titleBorderBottomWidth, 0, "Expected continuation title to render without a bottom h-rule");
  assert.equal(report.titlePaddingBottom, 0, "Expected continuation title to render without bottom padding");
  assert.equal(report.bodyBorderTopWidth, 0, "Expected continuation body not to render a top h-rule");
  assert.ok(report.headlineRect, "Expected continuation headline geometry");
  assert.ok(report.firstLineRect, "Expected first continuation copy line geometry");
  const headlineToCopyGap = report.firstLineRect.top - report.headlineRect.bottom;
  assert.ok(
    headlineToCopyGap <= report.rhythm + 0.75,
    `Expected continuation headline-to-copy gap to be at most one rhythm row; found ${headlineToCopyGap}`,
  );
});

Then("the {string} section image frame should preserve its aspect ratio", async function (articleId) {
  const report = await requirePage(this).evaluate((targetArticleId) => {
    const active = document.querySelector(".paper-page--active");
    const pageNumber = window.__PAPYRUS_VISIBLE_PAGE__ ?? Number(document.querySelector(".site-shell")?.getAttribute("data-current-page") ?? 1);
    const layout = window.__PAPYRUS_LAYOUT__;
    const rhythm = layout?.rhythm?.rowHeight ?? 19;
    const solvedPage = layout?.pages.find((candidate) => candidate.pageNumber === pageNumber);
    const block = solvedPage?.regions
      .flatMap((region) => region.blocks)
      .find((candidate) => candidate.article?.slug === targetArticleId);
    const image = block?.furniture.find((item) => item.kind === "image") ?? null;
    const section = Array.from(active?.querySelectorAll(".solved-block--articleFrame") ?? [])
      .find((candidate) => candidate.getAttribute("data-article-id") === targetArticleId);
    const frame = section?.querySelector(".photo-frame") ?? null;
    const frameRect = frame?.getBoundingClientRect();
    return {
      rhythm,
      image: image && {
        width: image.width,
        imageHeight: image.imageHeight,
        aspectRatio: image.aspectRatio,
      },
      frame: frameRect && {
        width: frameRect.width,
        height: frameRect.height,
      },
    };
  }, articleId);

  assert.ok(report.image, `Expected solved image for ${articleId}`);
  assert.ok(report.frame, `Expected rendered image frame for ${articleId}`);
  const expectedHeight = report.image.width / report.image.aspectRatio;
  assert.ok(
    Math.abs(report.image.imageHeight - expectedHeight) <= report.rhythm + 0.75,
    `Expected ${articleId} solved image height to preserve aspect within one rhythm row; width=${report.image.width}, height=${report.image.imageHeight}, aspect=${report.image.aspectRatio}`,
  );
  assert.ok(
    Math.abs(report.frame.height - report.image.imageHeight) <= 0.75,
    `Expected ${articleId} rendered frame height ${report.frame.height} to match solved image height ${report.image.imageHeight}`,
  );
  assert.ok(
    Math.abs(report.frame.width - report.image.width) <= 0.75,
    `Expected ${articleId} rendered frame width ${report.frame.width} to match solved image width ${report.image.width}`,
  );
});

Then("the front article {string} should use the requested slot composition", async function (articleId) {
  const block = await getSolvedSection(requirePage(this), articleId);
  assert.ok(block, `Expected solved front block for ${articleId}`);
  assert.equal(block.pageNumber, 1);
  assert.equal(block.columnCount, 4);

  const image = block.image;
  assert.ok(image, `Expected ${articleId} to have a front image`);
  assert.equal(image.columnStart, 2);
  assert.equal(image.columnSpan, 2);

  const headline = block.chromeBoxes?.find((box) => box.slot === "headline");
  const deck = block.chromeBoxes?.find((box) => box.slot === "deck");
  const byline = block.chromeBoxes?.find((box) => box.slot === "byline");
  assert.ok(headline, "Expected composed headline chrome box");
  assert.ok(deck, "Expected composed deck chrome box");
  assert.ok(byline, "Expected composed byline chrome box");
  assert.equal(headline.columnStart, 0);
  assert.equal(headline.columnSpan, 2);
  assert.equal(deck.columnStart, 0);
  assert.equal(deck.columnSpan, 2);
  assert.equal(byline.columnStart, 0);
  assert.equal(byline.columnSpan, 2);

  const imageFrameHeight = image.imageHeight ?? image.height;
  const naturalImageHeight = image.width / image.aspectRatio;
  const imageRhythm = image.captionLineHeight ?? image.captionHeight ?? 19;
  assert.ok(
    imageFrameHeight >= naturalImageHeight - 0.75,
    `Expected image frame height ${imageFrameHeight}px to allow full-width image height ${naturalImageHeight}px`,
  );
  assert.ok(
    imageFrameHeight < naturalImageHeight + imageRhythm + 0.75,
    `Expected image frame height ${imageFrameHeight}px to stay within one rhythm row of natural height ${naturalImageHeight}px`,
  );
  assert.ok(image.caption, `Expected ${articleId} front image to expose a caption`);

  const renderedImageTop = await requirePage(this).evaluate((targetArticleId) => {
    const story = document.querySelector(`.front-story[data-article-id="${targetArticleId}"]`);
    const imageElement = story?.querySelector(".lead-photo");
    if (!story || !imageElement) return null;
    const storyRect = story.getBoundingClientRect();
    const imageRect = imageElement.getBoundingClientRect();
    return imageRect.top - storyRect.top;
  }, articleId);
  assert.ok(renderedImageTop !== null, `Expected rendered front image for ${articleId}`);
  assert.ok(Math.abs(renderedImageTop) <= 0.75, `Expected rendered image to start at article top; found ${renderedImageTop}`);

  const imageCopyGap = await requirePage(this).evaluate((targetArticleId) => {
    const layout = window.__PAPYRUS_LAYOUT__;
    const story = document.querySelector(`.front-story[data-article-id="${targetArticleId}"]`);
    const imageElement = story?.querySelector(".lead-photo");
    if (!layout || !story || !imageElement) return null;
    const imageRect = imageElement.getBoundingClientRect();
    const overlappingLines = Array.from(story.querySelectorAll(".measured-line"))
      .map((line) => line.getBoundingClientRect())
      .filter((lineRect) => (
        lineRect.left < imageRect.right - 0.75 &&
        lineRect.right > imageRect.left + 0.75 &&
        lineRect.top >= imageRect.bottom - 0.75
      ))
      .sort((first, second) => first.top - second.top);
    return {
      gap: overlappingLines[0] ? overlappingLines[0].top - imageRect.bottom : null,
      rhythm: layout.rhythm.rowHeight,
    };
  }, articleId);
  assert.ok(imageCopyGap, `Expected rendered image/copy geometry for ${articleId}`);
  assert.ok(imageCopyGap.gap !== null, `Expected copy below the image inset for ${articleId}`);
  assert.ok(
    imageCopyGap.gap >= imageCopyGap.rhythm - 0.75,
    `Expected one rhythm row between image and copy; found ${imageCopyGap.gap}px with rhythm ${imageCopyGap.rhythm}px`,
  );

  const renderedCaption = await requirePage(this).evaluate((targetArticleId) => {
    const layout = window.__PAPYRUS_LAYOUT__;
    const story = document.querySelector(`.front-story[data-article-id="${targetArticleId}"]`);
    const pageNumber = Number(document.querySelector(".site-shell")?.getAttribute("data-current-page") ?? 1);
    const block = layout?.pages.find((candidate) => candidate.pageNumber === pageNumber)?.regions
      .flatMap((region) => region.blocks)
      .find((candidate) => candidate.article?.slug === targetArticleId);
    const image = block?.furniture.find((item) => item.kind === "image") ?? null;
    const caption = story?.querySelector(".lead-photo figcaption");
    if (!layout || !caption) return null;
    const rect = caption.getBoundingClientRect();
    const style = window.getComputedStyle(caption);
    return {
      text: caption.textContent,
      height: rect.height,
      solvedHeight: image?.captionHeight ?? null,
      fontSize: Number.parseFloat(style.fontSize),
      lineHeight: Number.parseFloat(style.lineHeight),
      fontStyle: style.fontStyle,
      rhythm: layout.rhythm.rowHeight,
    };
  }, articleId);
  assert.ok(renderedCaption, `Expected rendered caption for ${articleId}`);
  assert.equal(renderedCaption.text, image.caption);
  assert.equal(renderedCaption.height, renderedCaption.solvedHeight);
  assert.ok(renderedCaption.height >= renderedCaption.rhythm);
  assert.equal(renderedCaption.lineHeight, renderedCaption.rhythm);
  assert.equal(renderedCaption.fontStyle, "italic");
  assert.ok(
    renderedCaption.fontSize < block.columns[0][0].fontSize,
    `Expected caption font ${renderedCaption.fontSize}px to be smaller than body font ${block.columns[0][0].fontSize}px`,
  );
});

Then("the {string} section image caption should render completely", async function (articleId) {
  const report = await requirePage(this).evaluate((targetArticleId) => {
    const active = document.querySelector(".paper-page--active");
    const pageNumber = window.__PAPYRUS_VISIBLE_PAGE__ ?? Number(document.querySelector(".site-shell")?.getAttribute("data-current-page") ?? 1);
    const layout = window.__PAPYRUS_LAYOUT__;
    const solvedPage = layout?.pages.find((candidate) => candidate.pageNumber === pageNumber);
    const block = solvedPage?.regions
      .flatMap((region) => region.blocks)
      .find((candidate) => candidate.article?.slug === targetArticleId);
    const image = block?.furniture.find((item) => item.kind === "image") ?? null;
    const section = Array.from(active?.querySelectorAll(".solved-block--articleFrame") ?? [])
      .find((candidate) => candidate.getAttribute("data-article-id") === targetArticleId);
    const caption = section?.querySelector(".continuation-photo figcaption, .lead-photo figcaption") ?? null;
    if (!layout || !image || !caption) return null;
    const rect = caption.getBoundingClientRect();
    const style = window.getComputedStyle(caption);
    return {
      text: caption.textContent,
      solvedText: image.caption,
      height: rect.height,
      solvedHeight: image.captionHeight,
      lineHeight: Number.parseFloat(style.lineHeight),
      scrollHeight: caption.scrollHeight,
      clientHeight: caption.clientHeight,
      whiteSpace: style.whiteSpace,
      overflowY: style.overflowY,
      rhythm: layout.rhythm.rowHeight,
    };
  }, articleId);

  assert.ok(report, `Expected rendered caption geometry for ${articleId}`);
  assert.equal(report.text, report.solvedText);
  assert.equal(report.height, report.solvedHeight);
  assert.equal(report.lineHeight, report.rhythm);
  assert.ok(report.height > report.rhythm, `Expected long caption to reserve multiple rhythm rows; found ${report.height}`);
  assert.ok(
    report.scrollHeight <= report.clientHeight + 1,
    `Expected caption not to clip; scrollHeight=${report.scrollHeight}, clientHeight=${report.clientHeight}`,
  );
  assert.notEqual(report.whiteSpace, "nowrap");
  assert.notEqual(report.overflowY, "hidden");
});

Then("image captions should have no background", async function () {
  const report = await requirePage(this).evaluate(() => {
    const active = document.querySelector(".paper-page--active");
    return Array.from(active?.querySelectorAll(".lead-photo figcaption, .front-prelude-photo figcaption, .continuation-photo figcaption, .article-photo figcaption") ?? [])
      .map((caption) => {
        const style = window.getComputedStyle(caption);
        return {
          text: caption.textContent,
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
        };
      });
  });

  assert.ok(report.length > 0, "Expected at least one rendered image caption");
  for (const caption of report) {
    assert.match(
      caption.backgroundColor,
      /rgba?\(0,\s*0,\s*0(?:,\s*0)?\)|transparent/,
      `Expected image caption background to be transparent; found ${caption.backgroundColor} for "${caption.text}"`,
    );
    assert.equal(caption.backgroundImage, "none", `Expected image caption background image to be none for "${caption.text}"`);
  }
});

Then("the first three front stories should not reserve top rules", async function () {
  const frontChrome = await requirePage(this).evaluate(() => {
    const frontPage = window.__PAPYRUS_LAYOUT__?.pages.find((candidate) => candidate.pageNumber === 1);
    return frontPage?.regions
      .flatMap((region) => region.blocks)
      .filter((block) => block.type === "articleFrame")
      .slice(0, 3)
      .map((block) => ({
        articleId: block.article?.slug ?? block.id,
        borderTopHeight: block.front?.chrome?.borderTopHeight ?? null,
        paddingTop: block.front?.chrome?.paddingTop ?? null,
      })) ?? [];
  });
  assert.equal(frontChrome.length, 3, `Expected three front stories; found ${frontChrome.length}`);
  for (const story of frontChrome) {
    assert.equal(story.borderTopHeight, 0, `Expected ${story.articleId} not to reserve a top rule`);
    assert.equal(story.paddingTop, 0, `Expected ${story.articleId} not to reserve top padding`);
  }
});

Then("front jump labels should use upper-row rhythm without h-rules", async function () {
  const jumpReport = await requirePage(this).evaluate(() => {
    const layout = window.__PAPYRUS_LAYOUT__;
    const frontPage = layout?.pages.find((candidate) => candidate.pageNumber === 1);
    const rhythm = layout?.rhythm?.rowHeight ?? 19;
    const stories = frontPage?.regions
      .flatMap((region) => region.blocks)
      .filter((block) => block.type === "articleFrame" && block.jumpTargetPage)
      .map((block) => {
        const articleId = block.article?.slug ?? block.id;
        const jump = document.querySelector(`.front-story[data-article-id="${articleId}"] .jump-line`);
        const style = jump ? window.getComputedStyle(jump) : null;
        const rect = jump?.getBoundingClientRect();
        return {
          articleId,
          solvedBorderTopHeight: block.front?.chrome?.jumpBorderTopHeight ?? null,
          solvedPaddingTop: block.front?.chrome?.jumpPaddingTop ?? null,
          solvedPaddingBottom: block.front?.chrome?.jumpPaddingBottom ?? null,
          solvedReserveHeight: block.front?.jumpReserveHeight ?? null,
          renderedBorderTopWidth: style ? Number.parseFloat(style.borderTopWidth) : null,
          renderedPaddingTop: style ? Number.parseFloat(style.paddingTop) : null,
          renderedPaddingBottom: style ? Number.parseFloat(style.paddingBottom) : null,
          renderedHeight: rect?.height ?? null,
          rhythm,
        };
      }) ?? [];
    return { rhythm, stories };
  });
  assert.ok(jumpReport.stories.length > 0, "Expected front jump labels");
  for (const story of jumpReport.stories) {
    assert.equal(story.solvedBorderTopHeight, 0, `Expected ${story.articleId} jump label not to reserve an h-rule`);
    assert.equal(story.solvedPaddingTop, 0, `Expected ${story.articleId} jump label not to reserve top padding`);
    assert.equal(story.solvedPaddingBottom, jumpReport.rhythm, `Expected ${story.articleId} jump label to reserve one bottom rhythm row`);
    assert.equal(story.solvedReserveHeight, jumpReport.rhythm * 2, `Expected ${story.articleId} jump label reserve to stay two rhythm rows`);
    assert.equal(story.renderedBorderTopWidth, 0, `Expected ${story.articleId} jump label h-rule not to render`);
    assert.equal(story.renderedPaddingTop, 0, `Expected ${story.articleId} jump label rendered top padding to be zero`);
    assert.equal(story.renderedPaddingBottom, jumpReport.rhythm, `Expected ${story.articleId} jump label rendered bottom padding to be one rhythm row`);
    assert.ok(story.renderedHeight !== null, `Expected rendered jump label for ${story.articleId}`);
    assert.ok(
      Math.abs(story.renderedHeight - jumpReport.rhythm * 2) <= 0.75,
      `Expected ${story.articleId} jump label to render at two rhythm rows; found ${story.renderedHeight}`,
    );
  }
});

Then("the front article {string} should share one copy band below lead furniture", async function (articleId) {
  const block = await getSolvedSection(requirePage(this), articleId);
  assert.ok(block, `Expected solved front block for ${articleId}`);
  assert.ok(block.front?.composition, `Expected composed front block for ${articleId}`);
  assert.equal(block.hasMore, true, `Expected ${articleId} front teaser to continue`);
  assert.ok(block.image, `Expected ${articleId} to have a solved image`);

  const copyBandTops = block.front.composition.copyBandTops;
  assert.ok(Array.isArray(copyBandTops), `Expected ${articleId} to expose solved per-column copy bands`);
  const solvedFirstLineYs = block.columns.map((column) => column[0]?.y ?? null);
  assert.ok(solvedFirstLineYs.every((lineY) => lineY !== null), `Expected every ${articleId} column to contain copy`);
  assert.deepEqual(solvedFirstLineYs, copyBandTops);
  assert.ok(
    solvedFirstLineYs.every((lineY) => lineY === solvedFirstLineYs[0]),
    `Expected all composed columns to share one solved copy band; found ${solvedFirstLineYs.join(", ")}`,
  );
  const solvedLineCounts = block.columns.map((column) => column.length);
  assert.ok(
    solvedLineCounts.every((lineCount) => lineCount === solvedLineCounts[0]),
    `Expected all composed columns to have the same solved line count; found ${solvedLineCounts.join(", ")}`,
  );

  const renderedFirstLineTops = await requirePage(this).evaluate((targetArticleId) => {
    const story = document.querySelector(`.front-story[data-article-id="${targetArticleId}"]`);
    if (!story) return null;
    const image = story.querySelector(".lead-photo");
    const imageRect = image?.getBoundingClientRect();
    return Array.from(story.querySelectorAll(".story-composition-column")).map((column) => {
      const firstLine = column.querySelector(".measured-line");
      if (!firstLine) return null;
      const storyRect = story.getBoundingClientRect();
      const lineRect = firstLine.getBoundingClientRect();
      return {
        top: lineRect.top - storyRect.top,
        imageBottom: imageRect ? imageRect.bottom - storyRect.top : null,
      };
    });
  }, articleId);
  assert.ok(renderedFirstLineTops, `Expected rendered columns for ${articleId}`);
  assert.ok(renderedFirstLineTops.every((lineTop) => lineTop !== null), `Expected every rendered ${articleId} column to contain copy`);
  const renderedImageBottom = renderedFirstLineTops[0].imageBottom;
  assert.ok(renderedImageBottom !== null, `Expected rendered image for ${articleId}`);
  const renderedTops = renderedFirstLineTops.map((line) => line.top);
  assert.ok(
    renderedTops.every((lineTop) => Math.abs(lineTop - renderedTops[0]) <= 0.75),
    `Expected all rendered composed columns to share one copy band; found ${renderedTops.join(", ")}`,
  );
  assert.ok(
    renderedTops.every((lineTop) => lineTop >= renderedImageBottom - 0.75),
    `Expected rendered copy band to clear lead furniture; found ${renderedTops.join(", ")} with image bottom ${renderedImageBottom}`,
  );
});

Then("the front page should resolve headline scale {string} for article {string}", async function (expectedScale, articleId) {
  const block = await getFrontSolvedBlock(requirePage(this), articleId);
  assert.ok(block, `Expected solved front block for ${articleId}`);
  assert.equal(block.headlineScale, expectedScale);
});

Then("the front page should resolve editorial priority {string} for article {string}", async function (expectedPriority, articleId) {
  const block = await getFrontSolvedBlock(requirePage(this), articleId);
  assert.ok(block, `Expected solved front block for ${articleId}`);
  assert.equal(block.editorialPriority, expectedPriority);
});

Then("the first front story should be article {string}", async function (expectedArticleId) {
  const firstArticleId = await requirePage(this).evaluate(() => {
    const frontPage = window.__PAPYRUS_LAYOUT__?.pages.find((candidate) => candidate.pageNumber === 1);
    return frontPage?.regions
      .flatMap((region) => region.blocks)
      .find((block) => block.type === "articleFrame")?.article?.slug ?? null;
  });
  assert.equal(firstArticleId, expectedArticleId);
});

Then("front article {string} should occupy row {int} columns {int} through {int}", async function (articleId, rowStart, columnStart, columnEnd) {
  const block = await getFrontSolvedBlock(requirePage(this), articleId);
  assert.ok(block, `Expected solved front block for ${articleId}`);
  const placement = block.front?.gridPlacement;
  assert.ok(placement, `Expected ${articleId} to use solved front grid placement`);
  assert.equal(placement.rowStart + 1, rowStart);
  assert.equal(placement.columnStart + 1, columnStart);
  assert.equal(placement.columnStart + placement.columnSpan, columnEnd);

  const renderedPlacement = await requirePage(this).evaluate((targetArticleId) => {
    const story = document.querySelector(`.front-story[data-article-id="${targetArticleId}"]`);
    if (!story) return null;
    const style = getComputedStyle(story);
    return {
      gridColumnStart: style.gridColumnStart,
      gridColumnEnd: style.gridColumnEnd,
      gridRowStart: style.gridRowStart,
      gridRowEnd: style.gridRowEnd,
    };
  }, articleId);
  assert.ok(renderedPlacement, `Expected rendered front story for ${articleId}`);
  assert.equal(renderedPlacement.gridColumnStart, String(columnStart));
  assert.equal(renderedPlacement.gridColumnEnd, `span ${columnEnd - columnStart + 1}`);
  assert.equal(renderedPlacement.gridRowStart, String(rowStart));
  assert.equal(renderedPlacement.gridRowEnd, `span ${placement.rowSpan}`);
});

Then("the front page should render article {string}", async function (articleId) {
  const rendered = await requirePage(this).locator(`.front-story[data-article-id="${articleId}"]`).count();
  assert.ok(rendered > 0, `Expected rendered front story for ${articleId}`);
});

Then("the front page should render a newspaper footer", async function () {
  const report = await requirePage(this).evaluate(() => {
    const layout = window.__PAPYRUS_LAYOUT__;
    const frontPage = layout?.pages.find((page) => page.pageNumber === 1);
    const footer = document.querySelector("#page-1 .front-footer");
    if (!layout || !frontPage || !frontPage.frontFooter || !footer) return null;
    const footerRect = footer.getBoundingClientRect();
    const computed = getComputedStyle(footer);
    return {
      solvedHeight: frontPage.frontFooter.height,
      solvedMarginTop: frontPage.frontFooter.marginTop,
      renderedHeight: footerRect.height,
      renderedMarginTop: Number.parseFloat(computed.marginTop),
      rowHeight: frontPage.frontFooter.rowHeight,
      utilityCount: frontPage.frontFooter.utilityEntries.length,
    };
  });
  assert.ok(report, "Expected solved and rendered front footer");
  assert.ok(Math.abs(report.renderedHeight - report.solvedHeight) <= 0.75, `Expected rendered footer height ${report.renderedHeight} to match solved ${report.solvedHeight}`);
  assert.ok(Math.abs(report.renderedMarginTop - report.solvedMarginTop) <= 0.75, `Expected rendered footer margin ${report.renderedMarginTop} to match solved ${report.solvedMarginTop}`);
  assert.equal(report.utilityCount, 2);
  assert.ok(report.solvedHeight >= report.rowHeight * 2, `Expected footer to reserve at least two rhythm rows; found ${report.solvedHeight}`);
});

Then("the front page footer should list edition sections", async function () {
  const report = await requirePage(this).evaluate(() => {
    const layout = window.__PAPYRUS_LAYOUT__;
    const frontPage = layout?.pages.find((page) => page.pageNumber === 1);
    if (!frontPage?.frontFooter) return null;
    const expected = frontPage.frontFooter.entries.map((entry) => ({
      section: entry.section,
      articleSlug: entry.articleSlug,
      articleTitle: entry.articleTitle,
    }));
    const rendered = Array.from(document.querySelectorAll("#page-1 .front-footer__section-link")).map((link) => ({
      section: link.getAttribute("data-footer-section"),
      text: link.textContent?.replace(/\s+/g, " ").trim(),
      href: link.getAttribute("href"),
    }));
    return { expected, rendered };
  });
  assert.ok(report, "Expected solved front footer entries");
  assert.ok(report.expected.length > 0, "Expected at least one solved footer section");
  assert.equal(report.rendered.length, report.expected.length);
  for (const [index, expected] of report.expected.entries()) {
    const rendered = report.rendered[index];
    assert.equal(rendered.section, expected.section);
    assert.ok(rendered.text.includes(expected.section), `Expected rendered footer text to include section ${expected.section}`);
    assert.ok(rendered.text.includes(expected.articleTitle), `Expected rendered footer text to include title ${expected.articleTitle}`);
    assert.ok(rendered.href.endsWith(`#${expected.articleSlug}`), `Expected footer href ${rendered.href} to target #${expected.articleSlug}`);
  }
});

Then("the front page solved height should include footer rhythm space", async function () {
  const report = await requirePage(this).evaluate(() => {
    const layout = window.__PAPYRUS_LAYOUT__;
    const frontPage = layout?.pages.find((page) => page.pageNumber === 1);
    const region = frontPage?.regions[0];
    const footer = frontPage?.frontFooter;
    const footerElement = document.querySelector("#page-1 .front-footer");
    const gridElement = document.querySelector("#page-1 .front-grid");
    const contentElement = document.querySelector("#page-1 .paper-page-content");
    if (!layout || !frontPage || !region || !footer || !footerElement || !gridElement || !contentElement) return null;
    const rhythm = layout.rhythm.rowHeight;
    const solvedExpectedHeight =
      layout.pageChrome.pagePaddingTop +
      layout.pageChrome.mastheadHeight +
      layout.pageChrome.frontGridMarginTop +
      region.height +
      footer.marginTop +
      footer.height +
      layout.pageChrome.pagePaddingBottom;
    const gridRect = gridElement.getBoundingClientRect();
    const footerRect = footerElement.getBoundingClientRect();
    const contentRect = contentElement.getBoundingClientRect();
    return {
      rhythm,
      solvedPageHeight: frontPage.height,
      solvedExpectedHeight,
      renderedPageHeight: contentRect.height,
      renderedFooterGap: footerRect.top - gridRect.bottom,
      renderedFooterHeight: footerRect.height,
      solvedFooterMarginTop: footer.marginTop,
      solvedFooterHeight: footer.height,
    };
  });
  assert.ok(report, "Expected front footer height report");
  assert.ok(Math.abs(report.solvedPageHeight - report.solvedExpectedHeight) <= 0.75, `Expected solved page height ${report.solvedPageHeight} to include footer ${report.solvedExpectedHeight}`);
  assert.ok(Math.abs(report.renderedPageHeight - report.solvedPageHeight) <= 0.75, `Expected rendered page height ${report.renderedPageHeight} to match solved ${report.solvedPageHeight}`);
  assert.ok(Math.abs(report.renderedFooterGap - report.solvedFooterMarginTop) <= 0.75, `Expected footer gap ${report.renderedFooterGap} to match solved ${report.solvedFooterMarginTop}`);
  assert.ok(Math.abs(report.renderedFooterHeight - report.solvedFooterHeight) <= 0.75, `Expected footer height ${report.renderedFooterHeight} to match solved ${report.solvedFooterHeight}`);
  assert.equal(report.solvedPageHeight % report.rhythm, 0);
  assert.equal(report.solvedFooterMarginTop % report.rhythm, 0);
  assert.equal(report.solvedFooterHeight % report.rhythm, 0);
});

Then("the front page footer should link archive and disable login", async function () {
  const page = requirePage(this);
  const report = await page.evaluate(() => (
    Array.from(document.querySelectorAll("#page-1 [data-footer-utility]")).map((entry) => ({
      id: entry.getAttribute("data-footer-utility"),
      text: entry.textContent?.trim(),
      role: entry.getAttribute("role"),
      ariaDisabled: entry.getAttribute("aria-disabled"),
      href: entry.getAttribute("href"),
    }))
  ));
  assert.deepEqual(report, [
    { id: "archive", text: "Archive", role: null, ariaDisabled: null, href: "/archive" },
    { id: "login", text: "Log in", role: "link", ariaDisabled: "true", href: null },
  ]);

  const beforeUrl = page.url();
  const afterDispatchedClicksUrl = await page.evaluate(() => {
    document.querySelector('#page-1 [data-footer-utility="login"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return window.location.href;
  });
  assert.equal(afterDispatchedClicksUrl, beforeUrl);
});

Then("the archive masthead should say {string}", async function (expectedTitle) {
  const report = await requirePage(this).evaluate(() => ({
    title: document.querySelector(".archive-header h1")?.textContent?.trim() ?? "",
    hasFrontPagesText: document.querySelector(".archive-header")?.textContent?.includes("Front Pages") ?? false,
    hasSubtitleText: document.querySelector(".archive-header")?.textContent?.includes("Previous editions") ?? false,
  }));
  assert.equal(report.title, expectedTitle);
  assert.equal(report.hasFrontPagesText, false);
  assert.equal(report.hasSubtitleText, false);
});

Then("the archive masthead should use the normal newspaper nameplate height", async function () {
  const report = await requirePage(this).evaluate(() => {
    const header = document.querySelector(".archive-header");
    const title = document.querySelector(".archive-header h1");
    const meta = document.querySelector(".archive-header__meta");
    if (!header || !title || !meta) return null;
    const headerRect = header.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const metaRect = meta.getBoundingClientRect();
    const titleStyle = getComputedStyle(title);
    const rhythm = Number.parseFloat(getComputedStyle(header).getPropertyValue("--paper-rhythm"));
    return {
      rhythm,
      headerHeight: headerRect.height,
      titleTop: titleRect.top - headerRect.top,
      titleHeight: titleRect.height,
      titleMarginTop: Number.parseFloat(titleStyle.marginTop),
      titleMarginBottom: Number.parseFloat(titleStyle.marginBottom),
      fontSize: Number.parseFloat(titleStyle.fontSize),
      lineHeight: Number.parseFloat(titleStyle.lineHeight),
      metaTop: metaRect.top - headerRect.top,
      metaHeight: metaRect.height,
      metaGap: metaRect.top - headerRect.bottom,
    };
  });
  assert.ok(report, "Expected archive masthead title");
  const expectedLineHeight = report.rhythm * 4;
  const expectedFontSize = expectedLineHeight * 1.3586956522;
  const expectedHalfRow = report.rhythm / 2;
  assert.ok(Math.abs(report.headerHeight - report.rhythm * 5) <= 0.75, `Expected archive header height ${report.headerHeight} to be five rhythm rows ${report.rhythm * 5}`);
  assert.ok(Math.abs(report.titleTop - expectedHalfRow) <= 0.75, `Expected archive title top ${report.titleTop} to be one half-row ${expectedHalfRow}`);
  assert.ok(Math.abs(report.titleHeight - expectedLineHeight) <= 0.75, `Expected archive title height ${report.titleHeight} to be four rows ${expectedLineHeight}`);
  assert.ok(Math.abs(report.titleMarginTop - expectedHalfRow) <= 0.75, `Expected archive title top margin ${report.titleMarginTop} to be one half-row ${expectedHalfRow}`);
  assert.ok(Math.abs(report.titleMarginBottom - expectedHalfRow) <= 0.75, `Expected archive title bottom margin ${report.titleMarginBottom} to be one half-row ${expectedHalfRow}`);
  assert.ok(Math.abs(report.lineHeight - expectedLineHeight) <= 0.75, `Expected archive line height ${report.lineHeight} to match normal masthead ${expectedLineHeight}`);
  assert.ok(Math.abs(report.fontSize - expectedFontSize) <= 0.75, `Expected archive font size ${report.fontSize} to match normal masthead ${expectedFontSize}`);
  assert.ok(Math.abs(report.metaGap) <= 0.75, `Expected archive metadata strip to start immediately below masthead; gap=${report.metaGap}`);
  assert.ok(Math.abs(report.metaHeight - report.rhythm) <= 0.75, `Expected archive metadata row height ${report.metaHeight} to be one rhythm row ${report.rhythm}`);
});

Then("the archive header should describe previous editions", async function () {
  const report = await requirePage(this).evaluate(() => {
    const meta = document.querySelector(".archive-header__meta");
    if (!meta) return null;
    return {
      subtitle: meta.textContent ?? "",
    };
  });
  assert.ok(report, "Expected archive header report");
  const text = report.subtitle;
  assert.match(text ?? "", /previous editions/i);
  assert.doesNotMatch(text ?? "", /archive/i);
});

Then("the archive page should expose the shared rhythm overlay", async function () {
  const page = requirePage(this);
  const initialReport = await page.evaluate(() => {
    const shell = document.querySelector(".archive-rhythm-shell");
    if (!shell) return null;
    return {
      overlay: shell.getAttribute("data-rhythm-overlay"),
      rhythm: getComputedStyle(shell).getPropertyValue("--paper-rhythm").trim(),
    };
  });
  assert.ok(initialReport, "Expected archive rhythm shell");
  assert.equal(initialReport.overlay, "false");
  assert.equal(initialReport.rhythm, "19px");

  await page.keyboard.down("Control");
  await page.keyboard.press("=");
  await page.keyboard.up("Control");
  await page.waitForFunction(() => document.querySelector(".archive-rhythm-shell")?.getAttribute("data-rhythm-overlay") === "true");

  const overlayReport = await page.evaluate(() => {
    const shell = document.querySelector(".archive-rhythm-shell");
    if (!shell) return null;
    const pseudo = getComputedStyle(shell, "::before");
    return {
      overlay: shell.getAttribute("data-rhythm-overlay"),
      backgroundImage: pseudo.backgroundImage,
      position: pseudo.position,
    };
  });
  assert.ok(overlayReport, "Expected archive rhythm overlay report");
  assert.equal(overlayReport.overlay, "true");
  assert.equal(overlayReport.position, "absolute");
  assert.match(overlayReport.backgroundImage, /repeating-linear-gradient/);
});

Then("the archive layout should follow the archive rhythm", async function () {
  const report = await requirePage(this).evaluate(() => {
    const shell = document.querySelector(".archive-rhythm-shell");
    const header = document.querySelector(".archive-header");
    const gridShell = document.querySelector(".archive-grid-shell");
    const grid = document.querySelector(".archive-grid");
    const sentinel = document.querySelector(".archive-sentinel");
    if (!shell || !header || !gridShell || !grid || !sentinel) return null;
    const shellTop = shell.getBoundingClientRect().top;
    const rhythm = Number.parseFloat(getComputedStyle(shell).getPropertyValue("--paper-rhythm"));
    const rectFor = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top - shellTop,
        height: rect.height,
      };
    };
    return {
      rhythm,
      elements: [rectFor(header), rectFor(gridShell), rectFor(grid), rectFor(sentinel)],
    };
  });
  assert.ok(report, "Expected archive rhythm layout report");
  for (const element of report.elements) {
    assert.ok(isMultipleOfRhythm(element.top, report.rhythm), `Expected archive element top ${element.top} to align to ${report.rhythm}`);
    assert.ok(isMultipleOfRhythm(element.height, report.rhythm), `Expected archive element height ${element.height} to align to ${report.rhythm}`);
  }
});

Then("the archive should render front page preview cards", async function () {
  const page = requirePage(this);
  await page.waitForSelector(".archive-card", { state: "visible", timeout: 15_000 });
  const cardCount = await page.locator(".archive-card").count();
  assert.ok(cardCount > 0, "Expected at least one archive preview card");
});

Then("archive preview cards should be compact on the rhythm", async function () {
  const report = await requirePage(this).evaluate(() => {
    const shell = document.querySelector(".archive-rhythm-shell");
    const grid = document.querySelector(".archive-grid");
    const card = document.querySelector(".archive-card");
    const label = card?.querySelector(".archive-card__label");
    const preview = card?.querySelector(".archive-front-preview");
    if (!shell || !grid || !card || !label || !preview) return null;
    const rhythm = Number.parseFloat(getComputedStyle(shell).getPropertyValue("--paper-rhythm"));
    const cardStyle = getComputedStyle(card);
    const gridStyle = getComputedStyle(grid);
    const labelRect = label.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    return {
      rhythm,
      gridGap: Number.parseFloat(gridStyle.rowGap),
      cardGap: Number.parseFloat(cardStyle.rowGap),
      cardPaddingTop: Number.parseFloat(cardStyle.paddingTop),
      labelHeight: labelRect.height,
      previewTopGap: previewRect.top - labelRect.bottom,
      previewHeight: previewRect.height,
    };
  });
  assert.ok(report, "Expected archive compact card report");
  assert.ok(Math.abs(report.gridGap - report.rhythm) <= 0.75, `Expected desktop archive grid gap ${report.gridGap} to be one rhythm row ${report.rhythm}`);
  assert.equal(report.cardGap, 0);
  assert.equal(report.cardPaddingTop, 0);
  assert.ok(Math.abs(report.labelHeight - report.rhythm) <= 0.75, `Expected archive label height ${report.labelHeight} to equal rhythm ${report.rhythm}`);
  assert.ok(Math.abs(report.previewTopGap) <= 0.75, `Expected preview to start directly below label; found ${report.previewTopGap}`);
  assert.ok(isMultipleOfRhythm(report.previewHeight, report.rhythm), `Expected preview height ${report.previewHeight} to be rhythm-aligned`);
});

Then("archive preview cards should link to canonical edition routes", async function () {
  const links = await requirePage(this).evaluate(() => (
    Array.from(document.querySelectorAll(".archive-card__hit-area")).map((link) => ({
      href: link.getAttribute("href"),
      label: link.getAttribute("aria-label"),
    }))
  ));
  assert.ok(links.length > 0, "Expected archive preview links");
  for (const link of links) {
    assert.ok(link.href, "Expected archive card href");
    assert.match(link.href, /^\/\d{4}\/[a-z]+\/\d{1,2}(?:\/)?$/);
    assert.ok(link.label?.startsWith("Open "), "Expected archive card link to have an accessible label");
  }
});

Then("archive previews should include masthead, front grid, and footer", async function () {
  const report = await requirePage(this).evaluate(() => {
    const previews = Array.from(document.querySelectorAll(".archive-front-preview"));
    return previews.map((preview) => ({
      hasMasthead: Boolean(preview.querySelector(".masthead")),
      hasFrontGrid: Boolean(preview.querySelector(".front-grid")),
      hasFooter: Boolean(preview.querySelector(".front-footer")),
      linkCount: preview.querySelectorAll("a").length,
    }));
  });
  assert.ok(report.length > 0, "Expected archive previews");
  for (const preview of report) {
    assert.equal(preview.hasMasthead, true);
    assert.equal(preview.hasFrontGrid, true);
    assert.equal(preview.hasFooter, true);
    assert.equal(preview.linkCount, 0, "Expected preview internals to render without active links");
  }
});

Then("the archive should use a paper header over a neutral gray grid substrate", async function () {
  const report = await requirePage(this).evaluate(() => {
    const page = document.querySelector(".archive-page");
    const header = document.querySelector(".archive-header");
    const gridShell = document.querySelector(".archive-grid-shell");
    const grid = document.querySelector(".archive-grid");
    if (!page || !header || !gridShell || !grid) return null;
    const gridShellRect = gridShell.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();
    return {
      pageBackground: getComputedStyle(page).backgroundColor,
      gridBackground: getComputedStyle(gridShell).backgroundColor,
      headerBackgroundImage: getComputedStyle(header).backgroundImage,
      rhythm: Number.parseFloat(getComputedStyle(page).getPropertyValue("--paper-rhythm")),
      gridTopGap: gridRect.top - gridShellRect.top,
    };
  });
  assert.ok(report, "Expected archive substrate report");
  assert.equal(report.pageBackground, "rgb(128, 128, 128)");
  assert.equal(report.gridBackground, "rgb(128, 128, 128)");
  assert.notEqual(report.headerBackgroundImage, "none", "Expected archive masthead area to keep the paper texture");
  assert.ok(Math.abs(report.gridTopGap - report.rhythm) <= 0.75, `Expected one empty gray rhythm row before archive previews; found ${report.gridTopGap}px`);
});

Then("the archive should render a two-column front page grid", async function () {
  const columns = await requirePage(this).evaluate(() => {
    const grid = document.querySelector(".archive-grid");
    if (!grid) return 0;
    return getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length;
  });
  assert.equal(columns, 2);
});

Then("the archive API should cap requested batches at {int}", async function (expectedLimit) {
  const report = await requirePage(this).evaluate(async () => {
    const response = await fetch("/api/archive/editions?limit=500");
    const payload = await response.json();
    return {
      ok: response.ok,
      previewCount: Array.isArray(payload.previews) ? payload.previews.length : -1,
    };
  });
  assert.equal(report.ok, true);
  assert.ok(report.previewCount <= expectedLimit, `Expected capped archive batch to be <= ${expectedLimit}; found ${report.previewCount}`);
});

Then("the archive sentinel should load another batch when more editions exist", async function () {
  const page = requirePage(this);
  const sentinel = page.locator("[data-archive-sentinel]").first();
  const hasNextCursor = await sentinel.getAttribute("data-has-next-cursor");
  if (hasNextCursor !== "true") {
    assert.match((await sentinel.textContent()) ?? "", /End of archive/i);
    return;
  }

  const initialCount = await page.locator(".archive-card").count();
  await sentinel.scrollIntoViewIfNeeded();
  await page.waitForFunction(
    (count) => document.querySelectorAll(".archive-card").length > count,
    initialCount,
    { timeout: 15_000 },
  );
  const ids = await page.evaluate(() => Array.from(document.querySelectorAll(".archive-card")).map((card) => card.getAttribute("data-archive-edition-id")));
  assert.equal(new Set(ids).size, ids.length, "Expected archive lazy loading to avoid duplicate edition cards");
});

Then("the active page should not render a front page footer", async function () {
  const footerCount = await requirePage(this).locator(".paper-page--active .front-footer").count();
  assert.equal(footerCount, 0);
});

Then("the front article {string} should inset its image in the top right half", async function (articleId) {
  const block = await getFrontSolvedBlock(requirePage(this), articleId);
  assert.ok(block, `Expected solved front block for ${articleId}`);
  const image = block.furniture.find((item) => item.kind === "image");
  assert.ok(image, `Expected ${articleId} to have solved image furniture`);
  assert.equal(image.columnStart + image.columnSpan, block.columnCount);
  assert.ok(
    image.columnStart >= Math.floor(block.columnCount / 2),
    `Expected image to start in right half for ${block.columnCount} columns; found column ${image.columnStart + 1}`,
  );
  assert.ok(
    image.columnSpan <= Math.ceil(block.columnCount / 2),
    `Expected image to stay within right half for ${block.columnCount} columns; found span ${image.columnSpan}`,
  );
  assert.equal(image.y, 0);

  const rendered = await requirePage(this).evaluate((targetArticleId) => {
    const story = document.querySelector(`.front-story[data-article-id="${targetArticleId}"]`);
    const imageElement = story?.querySelector(".lead-photo");
    if (!story || !imageElement) return null;
    const storyRect = story.getBoundingClientRect();
    const imageRect = imageElement.getBoundingClientRect();
    return {
      left: imageRect.left - storyRect.left,
      top: imageRect.top - storyRect.top,
      width: imageRect.width,
      storyWidth: storyRect.width,
    };
  }, articleId);
  assert.ok(rendered, `Expected rendered image for ${articleId}`);
  assert.ok(rendered.top <= 0.75, `Expected rendered image top to align with article top; found ${rendered.top}`);
  assert.ok(
    rendered.left + rendered.width / 2 >= rendered.storyWidth / 2 - 1,
    `Expected rendered image center in right half; found left ${rendered.left} width ${rendered.width}`,
  );
  assert.ok(
    Math.abs(rendered.left + rendered.width - rendered.storyWidth) <= 1,
    `Expected rendered image to align with the article right edge; found right ${rendered.left + rendered.width} of ${rendered.storyWidth}`,
  );
});

Then("the front article {string} should stack its headline above the three-column media inset", async function (articleId) {
  const block = await getFrontSolvedBlock(requirePage(this), articleId);
  assert.ok(block, `Expected solved front block for ${articleId}`);
  assert.equal(block.columnCount, 3);
  assert.equal(block.front?.composition?.mode, "titleStackedMedia");
  const image = block.furniture.find((item) => item.kind === "image");
  assert.ok(image, `Expected ${articleId} to have solved image furniture`);
  assert.equal(image.columnStart, 1);
  assert.equal(image.columnSpan, 2);
  const titleBoxes = (block.chromeBoxes ?? []).filter((box) => box.slot === "label" || box.slot === "headline");
  const headline = titleBoxes.find((box) => box.slot === "headline");
  const deck = (block.chromeBoxes ?? []).find((box) => box.slot === "deck");
  assert.ok(headline, `Expected ${articleId} to have a solved headline box`);
  assert.ok(deck, `Expected ${articleId} to have a solved deck box`);
  const titleBottom = Math.max(...titleBoxes.map((box) => box.y + box.height));
  assert.equal(headline.columnStart, 0);
  assert.equal(headline.columnSpan, 3);
  assert.ok(image.y >= titleBottom, `Expected image y ${image.y} to clear title bottom ${titleBottom}`);
  assert.equal(deck.columnStart, 0);
  assert.ok(deck.columnSpan <= image.columnStart, `Expected deck span ${deck.columnSpan} to stay left of image start ${image.columnStart}`);
  assert.ok(deck.y >= image.y - 0.75, `Expected deck y ${deck.y} to align with image top ${image.y}`);
  assert.ok(deck.y < image.y + image.height, `Expected deck y ${deck.y} to float beside image ending at ${image.y + image.height}`);

  const rendered = await requirePage(this).evaluate((targetArticleId) => {
    const story = document.querySelector(`.front-story[data-article-id="${targetArticleId}"]`);
    const headlineElement = story?.querySelector('[data-chrome-slot="headline"]');
    const deckElement = story?.querySelector('[data-chrome-slot="deck"]');
    const imageElement = story?.querySelector(".lead-photo");
    if (!story || !headlineElement || !deckElement || !imageElement) return null;
    const storyRect = story.getBoundingClientRect();
    const toRelativeRect = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left - storyRect.left,
        right: rect.right - storyRect.left,
        top: rect.top - storyRect.top,
        bottom: rect.bottom - storyRect.top,
        width: rect.width,
      };
    };
    return {
      storyWidth: storyRect.width,
      headline: toRelativeRect(headlineElement),
      deck: toRelativeRect(deckElement),
      image: toRelativeRect(imageElement),
    };
  }, articleId);
  assert.ok(rendered, `Expected rendered title-stacked media geometry for ${articleId}`);
  assert.ok(rendered.headline.left <= 1, `Expected headline to start at article left; found ${rendered.headline.left}`);
  assert.ok(rendered.headline.right >= rendered.storyWidth - 1, `Expected headline to span article width; found ${rendered.headline.right} of ${rendered.storyWidth}`);
  assert.ok(rendered.image.top >= rendered.headline.bottom - 0.75, `Expected image to clear headline; found image top ${rendered.image.top}, headline bottom ${rendered.headline.bottom}`);
  assert.ok(rendered.deck.right <= rendered.image.left + 1, `Expected deck to stay left of image; found deck right ${rendered.deck.right}, image left ${rendered.image.left}`);
  assert.ok(rendered.deck.top >= rendered.image.top - 0.75, `Expected deck top to align with image top`);
  assert.ok(rendered.deck.top < rendered.image.bottom, `Expected deck to float beside image`);
});

Then("the front article {string} should flow copy around the inset image", async function (articleId) {
  const block = await getFrontSolvedBlock(requirePage(this), articleId);
  assert.ok(block, `Expected solved front block for ${articleId}`);
  const image = block.furniture.find((item) => item.kind === "image");
  assert.ok(image, `Expected ${articleId} to have solved image furniture`);
  const firstLineTops = block.columns.map((column) => column[0]?.y ?? null);
  assert.ok(firstLineTops.every((top) => top !== null), `Expected every ${articleId} column to contain copy`);
  const sideLineTops = firstLineTops.slice(0, image.columnStart);
  const imageColumnLineTops = firstLineTops.slice(image.columnStart, image.columnStart + image.columnSpan);
  assert.ok(sideLineTops.length > 0, `Expected ${articleId} to have text columns beside the inset image`);
  assert.ok(imageColumnLineTops.length > 0, `Expected ${articleId} to have image-cleared text columns`);
  assert.ok(
    sideLineTops.every((top) => top >= 0),
    `Expected side copy to remain inside the article frame; found ${firstLineTops.join(", ")}`,
  );
  assert.ok(
    imageColumnLineTops.every((top) => top >= image.y + image.height),
    `Expected right copy to clear image furniture; found ${firstLineTops.join(", ")}`,
  );
});

Then("the front article {string} should stack its image below title chrome", async function (articleId) {
  const block = await getFrontSolvedBlock(requirePage(this), articleId);
  assert.ok(block, `Expected solved front block for ${articleId}`);
  assert.equal(block.columnCount, 1);
  assert.equal(block.front?.composition?.mode, "stackedMedia");
  const image = block.furniture.find((item) => item.kind === "image");
  assert.ok(image, `Expected ${articleId} to have solved image furniture`);
  assert.equal(image.columnStart, 0);
  assert.equal(image.columnSpan, 1);
  const chromeBottom = Math.max(...(block.chromeBoxes ?? []).map((box) => box.y + box.height), 0);
  assert.ok(image.y >= chromeBottom, `Expected image y ${image.y} to clear chrome bottom ${chromeBottom}`);
  const firstLineY = block.columns[0]?.[0]?.y ?? null;
  assert.ok(firstLineY !== null, `Expected ${articleId} to render body copy below stacked image`);
  assert.ok(
    firstLineY >= image.y + image.height + block.front.chrome.jumpPaddingBottom,
    `Expected first line y ${firstLineY} to leave one rhythm row below image bottom ${image.y + image.height}`,
  );
  assert.ok(
    block.front.rowHeight >= firstLineY + block.columns[0][0].paintHeight + block.front.jumpReserveHeight,
    `Expected row height ${block.front.rowHeight} to contain stacked copy and jump label`,
  );

  const rendered = await requirePage(this).evaluate((targetArticleId) => {
    const story = document.querySelector(`.front-story[data-article-id="${targetArticleId}"]`);
    const imageElement = story?.querySelector(".lead-photo");
    const firstLine = story?.querySelector(".measured-line");
    const jump = story?.querySelector(".jump-line");
    const chromeBoxes = Array.from(story?.querySelectorAll(".front-chrome-box") ?? []);
    if (!story || !imageElement || !firstLine || !jump || chromeBoxes.length === 0) return null;
    const storyRect = story.getBoundingClientRect();
    const toRelativeRect = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top - storyRect.top,
        bottom: rect.bottom - storyRect.top,
        height: rect.height,
      };
    };
    return {
      chromeBottom: Math.max(...chromeBoxes.map((element) => toRelativeRect(element).bottom)),
      image: toRelativeRect(imageElement),
      firstLine: toRelativeRect(firstLine),
      jump: toRelativeRect(jump),
    };
  }, articleId);
  assert.ok(rendered, `Expected rendered stacked media geometry for ${articleId}`);
  assert.ok(rendered.image.top >= rendered.chromeBottom - 0.75, `Expected rendered image to clear chrome; found image top ${rendered.image.top}, chrome bottom ${rendered.chromeBottom}`);
  assert.ok(rendered.firstLine.top >= rendered.image.bottom + block.front.chrome.jumpPaddingBottom - 0.75, `Expected rendered body copy to leave one rhythm row below image`);
  assert.ok(rendered.jump.top >= rendered.firstLine.bottom - 0.75, `Expected rendered jump label to clear body copy`);
  assert.ok(rendered.jump.top >= rendered.image.bottom - 0.75, `Expected rendered jump label to clear stacked image`);
});

Then(
  "the front headline for article {string} should be larger than articles {string} and {string}",
  async function (featureArticleId, firstRailArticleId, secondRailArticleId) {
    const featureBlock = await getFrontSolvedBlock(requirePage(this), featureArticleId);
    const firstRailBlock = await getFrontSolvedBlock(requirePage(this), firstRailArticleId);
    const secondRailBlock = await getFrontSolvedBlock(requirePage(this), secondRailArticleId);
    assert.ok(featureBlock, `Expected solved front block for ${featureArticleId}`);
    assert.ok(firstRailBlock, `Expected solved front block for ${firstRailArticleId}`);
    assert.ok(secondRailBlock, `Expected solved front block for ${secondRailArticleId}`);

    const featureSize = getSolvedHeadlineFontSize(featureBlock);
    const firstRailSize = getSolvedHeadlineFontSize(firstRailBlock);
    const secondRailSize = getSolvedHeadlineFontSize(secondRailBlock);
    assert.ok(featureSize > firstRailSize, `Expected ${featureArticleId} headline ${featureSize} > ${firstRailArticleId} ${firstRailSize}`);
    assert.ok(featureSize > secondRailSize, `Expected ${featureArticleId} headline ${featureSize} > ${secondRailArticleId} ${secondRailSize}`);
  },
);

Then("layout plan validation should accept headline scale {string}", function (headlineScale) {
  const { normalizeEditionLayoutPlan } = loadLayoutPlanModule();
  assert.doesNotThrow(() => normalizeEditionLayoutPlan(createHeadlineScalePlan(headlineScale), "test layoutPlan"));
});

Then("layout plan validation should reject headline scale {string}", function (headlineScale) {
  const { normalizeEditionLayoutPlan } = loadLayoutPlanModule();
  assert.throws(
    () => normalizeEditionLayoutPlan(createHeadlineScalePlan(headlineScale), "test layoutPlan"),
    /headlineScale|Invalid enum value/,
  );
});

Then("layout plan validation should accept editorial priority {string}", function (editorialPriority) {
  const { normalizeEditionLayoutPlan } = loadLayoutPlanModule();
  assert.doesNotThrow(() => normalizeEditionLayoutPlan(createEditorialPriorityPlan(editorialPriority), "test layoutPlan"));
});

Then("layout plan validation should reject editorial priority {string}", function (editorialPriority) {
  const { normalizeEditionLayoutPlan } = loadLayoutPlanModule();
  assert.throws(
    () => normalizeEditionLayoutPlan(createEditorialPriorityPlan(editorialPriority), "test layoutPlan"),
    /editorialPriority|Invalid enum value/,
  );
});

Then(
  "the {string} section should show a responsive pull quote",
  async function (articleId) {
    const solverSection = await getSolvedSection(requirePage(this), articleId);
    assert.ok(solverSection, `Expected solved section for ${articleId}`);
    assert.ok(solverSection.pullQuote, `Expected ${articleId} to have a solved pull quote`);
    assert.ok(
      String(solverSection.pullQuote.templateId).startsWith("pullquote-"),
      `Expected responsive pull quote template id; found ${solverSection.pullQuote.templateId}`,
    );
  },
);

Then("the {string} section should not show a pull quote", async function (articleId) {
  const solverSection = await getSolvedSection(requirePage(this), articleId);
  assert.ok(solverSection, `Expected solved section for ${articleId}`);
  assert.equal(solverSection.pullQuote, null);
});

Then("responsive pull quotes should have no background", async function () {
  const report = await requirePage(this).evaluate(() => {
    const active = document.querySelector(".paper-page--active");
    return Array.from(active?.querySelectorAll(".continuation-pullquote") ?? []).map((element) => {
      const style = window.getComputedStyle(element);
      return {
        article: element.closest(".solved-block--articleFrame")?.getAttribute("data-article-id") ?? "",
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
      };
    });
  });

  assert.ok(report.length > 0, "Expected at least one rendered pull quote");
  for (const quote of report) {
    assert.match(
      quote.backgroundColor,
      /rgba?\(0,\s*0,\s*0(?:,\s*0)?\)|transparent/,
      `Expected ${quote.article} pull quote background to be transparent; found ${quote.backgroundColor}`,
    );
    assert.equal(quote.backgroundImage, "none", `Expected ${quote.article} pull quote background image to be none`);
  }
});

Then("responsive pull quotes should fit their quote text without excess rows", async function () {
  const report = await requirePage(this).evaluate(() => {
    const active = document.querySelector(".paper-page--active");
    const layout = window.__PAPYRUS_LAYOUT__;
    if (!layout || !active) return null;
    return Array.from(active.querySelectorAll(".continuation-pullquote")).map((element) => {
      const text = element.querySelector(".continuation-pullquote__text");
      const rect = element.getBoundingClientRect();
      const textRect = text?.getBoundingClientRect();
      return {
        article: element.closest(".solved-block--articleFrame")?.getAttribute("data-article-id") ?? "",
        height: rect.height,
        textHeight: textRect?.height ?? 0,
        excessHeight: rect.height - (textRect?.height ?? 0),
        rhythm: layout.rhythm.rowHeight,
      };
    });
  });

  assert.ok(report, "Expected pull quote geometry report");
  assert.ok(report.length > 0, "Expected at least one rendered pull quote");
  for (const quote of report) {
    assert.ok(quote.textHeight > 0, `Expected ${quote.article} pull quote text to render`);
    assert.ok(
      quote.excessHeight <= quote.rhythm * 2 + 4,
      `Expected ${quote.article} pull quote height to follow text; height=${quote.height}, textHeight=${quote.textHeight}, rhythm=${quote.rhythm}`,
    );
  }
});

Then("responsive pull quotes should leave one rhythm row before copy", async function () {
  const report = await requirePage(this).evaluate(() => {
    const active = document.querySelector(".paper-page--active");
    const layout = window.__PAPYRUS_LAYOUT__;
    if (!layout || !active) return null;
    return Array.from(active.querySelectorAll(".continuation-pullquote")).map((quote) => {
      const quoteRect = quote.getBoundingClientRect();
      const section = quote.closest(".solved-block--articleFrame");
      const followingLines = Array.from(section?.querySelectorAll(".measured-line") ?? [])
        .map((line) => line.getBoundingClientRect())
        .filter((lineRect) => (
          lineRect.left < quoteRect.right - 0.75 &&
          lineRect.right > quoteRect.left + 0.75 &&
          lineRect.top >= quoteRect.bottom - 0.75
        ))
        .sort((first, second) => first.top - second.top);
      const forbiddenLines = followingLines.filter((lineRect) => (
        lineRect.top < quoteRect.bottom + layout.rhythm.rowHeight - 0.75
      ));
      return {
        article: section?.getAttribute("data-article-id") ?? "",
        gap: followingLines[0] ? followingLines[0].top - quoteRect.bottom : null,
        forbiddenLines: forbiddenLines.map((lineRect) => ({ top: lineRect.top, bottom: lineRect.bottom })),
        rhythm: layout.rhythm.rowHeight,
      };
    });
  });

  assert.ok(report, "Expected pull quote clearance report");
  assert.ok(report.length > 0, "Expected at least one rendered pull quote");
  for (const quote of report) {
    assert.deepEqual(quote.forbiddenLines, [], `Expected the row after ${quote.article} pull quote to stay blank`);
    if (quote.gap !== null) {
      assert.ok(
        quote.gap >= quote.rhythm - 0.75,
        `Expected one rhythm row after ${quote.article} pull quote; found ${quote.gap}px with rhythm ${quote.rhythm}px`,
      );
    }
  }
});

Then("the {string} section should exhaust the remaining article text", async function (articleId) {
  const solverSection = await getSolvedSection(requirePage(this), articleId);
  assert.ok(solverSection, `Expected solved section for ${articleId}`);
  assert.equal(solverSection.hasMore, false, `Expected ${articleId} continuation to exhaust remaining text`);
});

Then("the active continuation region should shrink to its solved blocks", async function () {
  const report = await getActiveContinuationRegionHeightReport(requirePage(this));
  assert.ok(report, "Expected active continuation region geometry");
  assert.ok(
    Math.abs(report.regionHeight - report.blockBottom) <= 0.75,
    `Expected region height ${report.regionHeight}px to match solved block bottom ${report.blockBottom}px`,
  );
});

Then("the active continuation region should preserve allocated fill height", async function () {
  const report = await getActiveContinuationRegionHeightReport(requirePage(this));
  assert.ok(report, "Expected active continuation region geometry");
  assert.ok(
    report.slackRows >= 8,
    `Expected default fill region to keep visible allocation slack; found ${report.slackRows} rows`,
  );
});

Then("the {string} section should hold exactly {int} default rows", async function (articleId, expectedRows) {
  const report = await getSolvedSectionRowReport(requirePage(this), articleId);
  assert.ok(report, `Expected solved section row report for ${articleId}`);
  assert.ok(
    Math.abs(report.height - expectedRows * report.rhythm) <= 0.75,
    `Expected ${articleId} section to hold ${expectedRows} rows; found ${report.rows} rows`,
  );
});

Then("the {string} section should grow beyond {int} default rows", async function (articleId, defaultRows) {
  const report = await getSolvedSectionRowReport(requirePage(this), articleId);
  assert.ok(report, `Expected solved section row report for ${articleId}`);
  assert.ok(
    report.rows > defaultRows + 0.5,
    `Expected ${articleId} section to grow beyond ${defaultRows} rows; found ${report.rows} rows`,
  );
});

Then("the {string} section should shrink below {int} default rows", async function (articleId, defaultRows) {
  const report = await getSolvedSectionRowReport(requirePage(this), articleId);
  assert.ok(report, `Expected solved section row report for ${articleId}`);
  assert.ok(
    report.rows < defaultRows - 0.5,
    `Expected ${articleId} section to shrink below ${defaultRows} rows; found ${report.rows} rows`,
  );
});

Then("no browser console errors should occur", async function () {
  assert.deepEqual(this.consoleErrors, []);
});

function requirePage(world) {
  assert.ok(world.page, "Expected an open Playwright page");
  return world.page;
}

function isMultipleOfRhythm(value, rhythm, tolerance = 0.75) {
  const remainder = Math.abs(value % rhythm);
  return remainder <= tolerance || Math.abs(remainder - rhythm) <= tolerance;
}

async function getSolvedSection(page, articleId) {
  return page.evaluate((targetArticleId) => {
    const pageNumber = window.__PAPYRUS_VISIBLE_PAGE__ ?? Number(document.querySelector(".site-shell")?.getAttribute("data-current-page") ?? 1);
    const layout = window.__PAPYRUS_LAYOUT__;
    const solvedPage = layout?.pages.find((candidate) => candidate.pageNumber === pageNumber);
    const block = solvedPage?.regions
      .flatMap((region) => region.blocks)
      .find((candidate) => candidate.article?.slug === targetArticleId);
    if (!block) return null;
    const image = block.furniture.find((item) => item.kind === "image") ?? null;
    const pullQuote = block.furniture.find((item) => item.kind === "pullQuote") ?? null;
    return { ...block, image, pullQuote };
  }, articleId);
}

async function getSolvedSectionRowReport(page, articleId) {
  return page.evaluate((targetArticleId) => {
    const pageNumber = window.__PAPYRUS_VISIBLE_PAGE__ ?? Number(document.querySelector(".site-shell")?.getAttribute("data-current-page") ?? 1);
    const layout = window.__PAPYRUS_LAYOUT__;
    const solvedPage = layout?.pages.find((candidate) => candidate.pageNumber === pageNumber);
    const block = solvedPage?.regions
      .flatMap((region) => region.blocks)
      .find((candidate) => candidate.article?.slug === targetArticleId);
    if (!layout || !block) return null;
    return {
      height: block.height,
      rows: block.height / layout.rhythm.rowHeight,
      rhythm: layout.rhythm.rowHeight,
    };
  }, articleId);
}

async function getActiveContinuationRegionHeightReport(page) {
  return page.evaluate(() => {
    const pageNumber = window.__PAPYRUS_VISIBLE_PAGE__ ?? Number(document.querySelector(".site-shell")?.getAttribute("data-current-page") ?? 1);
    const layout = window.__PAPYRUS_LAYOUT__;
    const solvedPage = layout?.pages.find((candidate) => candidate.pageNumber === pageNumber);
    const region = solvedPage?.regions[0];
    if (!layout || !region) return null;
    const blockBottom = Math.max(...region.blocks.map((block) => block.y + block.height), 0);
    return {
      regionHeight: region.height,
      blockBottom,
      slackRows: (region.height - blockBottom) / layout.rhythm.rowHeight,
      rhythm: layout.rhythm.rowHeight,
    };
  });
}

async function getFrontSolvedBlock(page, articleId) {
  return page.evaluate((targetArticleId) => {
    const frontPage = window.__PAPYRUS_LAYOUT__?.pages.find((candidate) => candidate.pageNumber === 1);
    return frontPage?.regions
      .flatMap((region) => region.blocks)
      .find((candidate) => candidate.article?.slug === targetArticleId) ?? null;
  }, articleId);
}

function getSolvedHeadlineFontSize(block) {
  const composedHeadline = block.chromeBoxes?.find((box) => box.slot === "headline");
  return composedHeadline?.fontSize ?? block.front?.chrome?.headlineFontSize ?? 0;
}

function loadLayoutPlanModule() {
  registerTypeScriptRequire();
  return require(path.resolve(__dirname, "../../lib/layout-plan.ts"));
}

function registerTypeScriptRequire() {
  if (require.extensions[".ts"]) return;
  require.extensions[".ts"] = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: filename,
    });
    module._compile(output.outputText, filename);
  };
}

function createHeadlineScalePlan(headlineScale) {
  return {
    pages: [
      {
        pageNumber: 1,
        presetId: "page.full",
        regions: [
          {
            id: "main",
            type: "fullPage",
            blocks: [
              {
                id: "headline-scale-check",
                type: "articleFrame",
                presetId: "article.standard",
                itemId: "example",
                startCursor: "beginning",
                typography: { headlineScale },
              },
            ],
          },
        ],
      },
    ],
  };
}

function createEditorialPriorityPlan(editorialPriority) {
  const plan = createHeadlineScalePlan("standard");
  plan.pages[0].regions[0].blocks[0].editorialPriority = editorialPriority;
  return plan;
}

async function getActivePageReport(page) {
  return page.evaluate(() => {
    const active = document.querySelector(".paper-page--active");
    if (!active) throw new Error("No active newspaper page");

    const toRect = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const overlap = (a, b, gutter = 0) => (
      a.left < b.right + gutter &&
      a.right + gutter > b.left &&
      a.top < b.bottom + gutter &&
      a.bottom + gutter > b.top
    );
    const intersectionHeight = (a, b) => Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

    const furniture = Array.from(active.querySelectorAll(".continuation-photo, .continuation-pullquote, .front-story .lead-photo")).map((element) => ({
      article: element.closest(".solved-block--articleFrame, .front-story")?.getAttribute("data-article-id") ?? "",
      className: String(element.className),
      rect: toRect(element),
    }));
    const furnitureOverlaps = [];
    for (let firstIndex = 0; firstIndex < furniture.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < furniture.length; secondIndex += 1) {
        const first = furniture[firstIndex];
        const second = furniture[secondIndex];
        if (first.article === second.article && overlap(first.rect, second.rect)) furnitureOverlaps.push({ first, second });
      }
    }

    const chromeOverlaps = [];
    for (const story of active.querySelectorAll(".front-story")) {
      const article = story.getAttribute("data-article-id") ?? "";
      const pairs = [
        [story.querySelector("h2"), story.querySelector(".story-deck"), "headline/deck"],
        [story.querySelector(".story-deck"), story.querySelector(".story-byline"), "deck/byline"],
        [story.querySelector(".story-byline"), story.querySelector(".story-measure"), "byline/body"],
        [story.querySelector(".story-measure"), story.querySelector(".jump-line"), "body/jump"],
      ];
      for (const [previous, next, label] of pairs) {
        if (!previous || !next) continue;
        const previousRect = toRect(previous);
        const nextRect = toRect(next);
        if (previousRect.bottom > nextRect.top + 0.75) chromeOverlaps.push({ article, label, previousRect, nextRect });
      }
    }
    for (const story of active.querySelectorAll(".front-story")) {
      const article = story.getAttribute("data-article-id") ?? "";
      const storyChrome = Array.from(story.querySelectorAll(".front-chrome-box")).map((element) => ({
        slot: element.getAttribute("data-chrome-slot") ?? "",
        rect: toRect(element),
      }));
      const storyFurniture = furniture.filter((item) => item.article === article);
      for (const line of story.querySelectorAll(".measured-line")) {
        const lineRect = toRect(line);
        for (const box of storyChrome) {
          if (overlap(lineRect, box.rect)) chromeOverlaps.push({ article, label: `line/${box.slot}`, previousRect: lineRect, nextRect: box.rect });
        }
        for (const item of storyFurniture) {
          if (overlap(lineRect, item.rect)) chromeOverlaps.push({ article, label: "line/front-furniture", previousRect: lineRect, nextRect: item.rect });
        }
      }
    }

    for (const section of active.querySelectorAll(".solved-block--articleFrame")) {
      const article = section.getAttribute("data-article-id") ?? "";
      const title = section.querySelector(".continued-title");
      const body = section.querySelector(".continuation-body");
      if (!title || !body) continue;
      const titleRect = toRect(title);
      const bodyRect = toRect(body);
      if (titleRect.bottom > bodyRect.top + 0.75) chromeOverlaps.push({ article, label: "continued-title/body", previousRect: titleRect, nextRect: bodyRect });
      const kicker = title.querySelector("p");
      const headline = title.querySelector("h2");
      if (kicker && headline) {
        const kickerRect = toRect(kicker);
        const headlineRect = toRect(headline);
        if (kickerRect.bottom > headlineRect.top + 0.75) chromeOverlaps.push({ article, label: "continued-kicker/headline", previousRect: kickerRect, nextRect: headlineRect });
      }
    }

    const clippedLines = [];
    const lineFurnitureOverlaps = [];
    for (const line of active.querySelectorAll(".measured-line")) {
      const container = line.closest(".story-measure, .continuation-column");
      if (!container) continue;
      const lineRect = toRect(line);
      const containerRect = toRect(container);
      if (lineRect.bottom > containerRect.bottom + 0.75 || line.scrollHeight > line.clientHeight + 1) {
        clippedLines.push({
          text: line.textContent,
          lineRect,
          containerRect,
        });
      }

      const article = line.closest(".solved-block--articleFrame, .front-story")?.getAttribute("data-article-id") ?? "";
      for (const item of furniture) {
        if (item.article === article && overlap(lineRect, item.rect)) {
          lineFurnitureOverlaps.push({
            article,
            line: line.textContent,
            furniture: item.className,
            lineRect,
            furnitureRect: item.rect,
          });
        }
      }
    }

    const deadColumns = [];
    for (const section of active.querySelectorAll(".solved-block--articleFrame")) {
      const article = section.getAttribute("data-article-id") ?? "";
      const sectionFurniture = furniture.filter((item) => item.article === article);
      const columns = Array.from(section.querySelectorAll(".continuation-column"));
      columns.forEach((column, columnIndex) => {
        const lineCount = column.querySelectorAll(".measured-line").length;
        if (lineCount > 0) return;

        const columnRect = toRect(column);
        const hasMeaningfulFurniture = sectionFurniture.some((item) => (
          overlap(columnRect, item.rect) &&
          intersectionHeight(columnRect, item.rect) >= Math.min(96, columnRect.height * 0.18)
        ));
        if (!hasMeaningfulFurniture) {
          deadColumns.push({
            article,
            columnIndex,
            columnRect,
          });
        }
      });
    }

    return {
      kind: active.getAttribute("data-page-kind") ?? (active.classList.contains("paper-page--front") ? "front" : null),
      clippedLines,
      chromeOverlaps,
      furnitureOverlaps,
      lineFurnitureOverlaps,
      deadColumns,
    };
  });
}

async function getActiveRhythmReport(page) {
  return page.evaluate(() => {
    const layout = window.__PAPYRUS_LAYOUT__;
    const active = document.querySelector(".paper-page--active");
    if (!layout) throw new Error("No solved newspaper layout");
    if (!active) throw new Error("No active newspaper page");

    const rhythm = layout.rhythm?.rowHeight ?? layout.pages?.[0]?.regions?.[0]?.blocks?.[0]?.columns?.[0]?.[0]?.lineHeight ?? 19;
    const tolerance = 0.75;
    const errors = [];
    const pageNumber = Number(active.id?.replace("page-", "") ?? 0);
    const solvedPage = layout.pages.find((candidate) => candidate.pageNumber === pageNumber);
    const pageRect = active.getBoundingClientRect();
    const pageContent = active.querySelector(".paper-page-content");

    const isOnRhythm = (value) => {
      const remainder = ((value % rhythm) + rhythm) % rhythm;
      return remainder <= tolerance || Math.abs(remainder - rhythm) <= tolerance;
    };
    const requireRhythm = (label, value) => {
      if (!Number.isFinite(value)) {
        errors.push({ label, value, reason: "not finite" });
        return;
      }
      if (!isOnRhythm(value)) errors.push({ label, value: Number(value.toFixed(3)), rhythm });
    };
    const requireClose = (label, value, expected) => {
      if (!Number.isFinite(value)) {
        errors.push({ label, value, expected, reason: "not finite" });
        return;
      }
      if (Math.abs(value - expected) > tolerance) {
        errors.push({ label, value: Number(value.toFixed(3)), expected: Number(expected.toFixed(3)), rhythm });
      }
    };
    const relativeRect = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top - pageRect.top,
        bottom: rect.bottom - pageRect.top,
        height: rect.height,
      };
    };

    if (solvedPage) {
      requireRhythm("solved page height", solvedPage.height);
      for (const region of solvedPage.regions) {
        requireRhythm(`solved region ${region.id} y`, region.y);
        requireRhythm(`solved region ${region.id} height`, region.height);
        for (const block of region.blocks) {
          requireRhythm(`solved block ${block.id} y`, block.y);
          requireRhythm(`solved block ${block.id} height`, block.height);
          if (block.front?.composition) {
            requireRhythm(`solved block ${block.id} body top`, block.front.composition.bodyTop);
            requireRhythm(`solved block ${block.id} body height`, block.front.composition.bodyHeight);
          }
          if (block.bodyHeight) requireRhythm(`solved block ${block.id} body height`, block.bodyHeight);
          for (const furniture of (block.furniture ?? [])) {
            requireRhythm(`solved furniture ${furniture.id} y`, furniture.y);
            requireRhythm(`solved furniture ${furniture.id} height`, furniture.height);
            requireRhythm(`solved furniture ${furniture.id} bottom`, furniture.y + furniture.height);
          }
        }
      }
    }

    if (pageContent) {
      const contentRect = relativeRect(pageContent);
      requireRhythm("rendered page height", contentRect.height);
    }
    const masthead = active.querySelector(".masthead");
    const mastheadMeta = active.querySelector(".masthead__meta");
    const frontGrid = active.querySelector(".front-grid");
    if (masthead) {
      const rect = relativeRect(masthead);
      requireRhythm("rendered masthead top", rect.top);
      requireRhythm("rendered masthead height", rect.height);
    }
    if (mastheadMeta) {
      const rect = relativeRect(mastheadMeta);
      requireRhythm("rendered masthead metadata top", rect.top);
      requireRhythm("rendered masthead metadata height", rect.height);
    }
    if (masthead && frontGrid) {
      const mastheadRect = relativeRect(masthead);
      const gridRect = relativeRect(frontGrid);
      requireRhythm("rendered front grid top", gridRect.top);
      requireClose("rendered masthead/front grid gap", gridRect.top - mastheadRect.bottom, rhythm);
    }
    for (const element of active.querySelectorAll(".front-story, .solved-region, .solved-block, .story-measure, .continuation-body")) {
      const rect = relativeRect(element);
      const label = element.getAttribute("data-block-id") ?? element.getAttribute("data-region-id") ?? String(element.className);
      requireRhythm(`rendered ${label} top`, rect.top);
      requireRhythm(`rendered ${label} height`, rect.height);
    }
    for (const line of active.querySelectorAll(".measured-line")) {
      const rect = relativeRect(line);
      requireRhythm(`rendered line ${line.textContent?.slice(0, 24) ?? ""} top`, rect.top);
    }
    for (const furniture of active.querySelectorAll(".continuation-photo, .continuation-pullquote, .front-story .lead-photo, .front-prelude-photo, .solved-ad")) {
      const rect = relativeRect(furniture);
      const label = furniture.closest("[data-block-id]")?.getAttribute("data-block-id") ?? String(furniture.className);
      requireRhythm(`rendered furniture ${label} top`, rect.top);
      requireRhythm(`rendered furniture ${label} height`, rect.height);
      requireRhythm(`rendered furniture ${label} bottom`, rect.bottom);
    }

    return { rhythm, errors };
  });
}
