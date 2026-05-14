const assert = require("node:assert/strict");
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

Given("I open article {string} at {int} by {int}", async function (slug, width, height) {
  await this.openPath(`/articles/${slug}`, width, height);
});

When("I flip to page {int}", async function (targetPage) {
  const page = requirePage(this);
  const controls = page.locator(".flipbook-controls");
  await controls.waitFor({ state: "visible", timeout: 10_000 });

  for (let guard = 0; guard < 8; guard += 1) {
    const currentPage = await getCurrentPageNumber(page);
    if (currentPage === targetPage) return;

    const directionName = targetPage > currentPage ? /Next/ : /Previous/;
    await controls.getByRole("button", { name: directionName }).click();
    await page.waitForTimeout(650);
  }

  assert.equal(await getCurrentPageNumber(page), targetPage, `Expected to reach page ${targetPage}`);
});

Then("the active page should be a {string} page", async function (expectedKind) {
  const report = await getActivePageReport(requirePage(this));
  assert.equal(report.kind, expectedKind);
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

Then("the {string} section image should span between {int} and {int} columns", async function (articleId, minSpan, maxSpan) {
  const solverSection = await getSolvedSection(requirePage(this), articleId);
  assert.ok(solverSection, `Expected solved section for ${articleId}`);
  const actualSpan = solverSection.image?.columnSpan;
  assert.ok(
    actualSpan >= minSpan && actualSpan <= maxSpan,
    `Expected ${articleId} image span between ${minSpan} and ${maxSpan}; found ${actualSpan}`,
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

Then("no browser console errors should occur", async function () {
  assert.deepEqual(this.consoleErrors, []);
});

function requirePage(world) {
  assert.ok(world.page, "Expected an open Playwright page");
  return world.page;
}

async function getCurrentPageNumber(page) {
  const label = await page.locator(".flipbook-controls span").innerText();
  const match = label.match(/page\s+(\d+)\s+of/i);
  assert.ok(match, `Could not read current page from "${label}"`);
  return Number(match[1]);
}

async function getSolvedSection(page, articleId) {
  return page.evaluate((targetArticleId) => {
    const active = document.querySelector(".paper-page--active");
    const pageNumber = active?.id ? Number(active.id.replace("page-", "")) : 1;
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

    const furniture = Array.from(active.querySelectorAll(".continuation-photo, .continuation-pullquote")).map((element) => ({
      article: element.closest(".solved-block--articleFrame")?.getAttribute("data-article-id") ?? "",
      className: String(element.className),
      rect: toRect(element),
    }));
    const furnitureOverlaps = [];
    for (let firstIndex = 0; firstIndex < furniture.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < furniture.length; secondIndex += 1) {
        const first = furniture[firstIndex];
        const second = furniture[secondIndex];
        if (first.article === second.article && overlap(first.rect, second.rect)) {
          furnitureOverlaps.push({ first, second });
        }
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
        if (previousRect.bottom > nextRect.top + 0.75) {
          chromeOverlaps.push({ article, label, previousRect, nextRect });
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
      if (titleRect.bottom > bodyRect.top + 0.75) {
        chromeOverlaps.push({ article, label: "continued-title/body", previousRect: titleRect, nextRect: bodyRect });
      }
      const kicker = title.querySelector("p");
      const headline = title.querySelector("h2");
      if (kicker && headline) {
        const kickerRect = toRect(kicker);
        const headlineRect = toRect(headline);
        if (kickerRect.bottom > headlineRect.top + 0.75) {
          chromeOverlaps.push({ article, label: "continued-kicker/headline", previousRect: kickerRect, nextRect: headlineRect });
        }
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

      const article = line.closest(".solved-block--articleFrame")?.getAttribute("data-article-id") ?? "";
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
