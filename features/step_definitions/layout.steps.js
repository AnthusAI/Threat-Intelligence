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

Then("the active edition should expose layout plan version {int}", async function (expectedVersion) {
  const version = await requirePage(this).locator(".site-shell").getAttribute("data-layout-plan-version");
  assert.equal(Number(version), expectedVersion);
});

Then("the active edition should include article {string}", async function (expectedSlug) {
  const articleSlugs = await requirePage(this).evaluate(() => {
    const layout = window.__PAPYRUS_LAYOUT__;
    const frontSlugs = layout?.frontBlocks.map((block) => block.article.slug) ?? [];
    const continuationSlugs = layout?.continuationPages.flatMap((page) => (
      page.sections.map((section) => section.article.slug)
    )) ?? [];
    return Array.from(new Set([...frontSlugs, ...continuationSlugs]));
  });

  assert.ok(
    articleSlugs.includes(expectedSlug),
    `Expected active edition to include ${expectedSlug}; found ${articleSlugs.join(", ")}`,
  );
});

Then("the front page should label article {string} as continued on page {int}", async function (articleId, pageNumber) {
  const continuationPageNumber = await requirePage(this).evaluate((targetArticleId) => {
    const layout = window.__PAPYRUS_LAYOUT__;
    return layout?.frontBlocks.find((block) => block.article.slug === targetArticleId)?.pageNumber ?? null;
  }, articleId);

  assert.equal(continuationPageNumber, pageNumber);
});

Then("the article page should show headline {string}", async function (expectedHeadline) {
  await requirePage(this).locator("h1").waitFor({ state: "visible", timeout: 10_000 });
  const headline = await requirePage(this).locator("h1").innerText();
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

Then("no continuation column should be dead", async function () {
  const report = await getActivePageReport(requirePage(this));
  assert.deepEqual(report.deadColumns, []);
});

Then("the {string} section image should use the {string} template", async function (articleId, templateId) {
  const solverSection = await getSolvedSection(requirePage(this), articleId);
  assert.ok(solverSection, `Expected solved section for ${articleId}`);
  assert.equal(solverSection.image?.templateId, templateId);
});

Then(
  "the {string} section should show a pull quote using the {string} template",
  async function (articleId, templateId) {
    const solverSection = await getSolvedSection(requirePage(this), articleId);
    assert.ok(solverSection, `Expected solved section for ${articleId}`);
    assert.equal(solverSection.pullQuote?.templateId, templateId);
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
    const continuationPage = layout?.continuationPages.find((candidate) => candidate.pageNumber === pageNumber);
    return continuationPage?.sections.find((section) => section.article.slug === targetArticleId) ?? null;
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
      article: element.closest(".continuation-section")?.getAttribute("data-article-id") ?? "",
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

      const article = line.closest(".continuation-section")?.getAttribute("data-article-id") ?? "";
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
    for (const section of active.querySelectorAll(".continuation-section")) {
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
      furnitureOverlaps,
      lineFurnitureOverlaps,
      deadColumns,
    };
  });
}
