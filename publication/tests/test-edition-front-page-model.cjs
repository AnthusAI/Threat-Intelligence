const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const typescript = require("typescript");

function loadTypeScriptModule(relativePath) {
  const sourcePath = path.join(__dirname, "..", relativePath);
  const compiled = typescript.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 },
  });
  const loadedModule = { exports: {} };
  new Function("module", "exports", "require", compiled.outputText)(loadedModule, loadedModule.exports, require);
  return loadedModule.exports;
}

const frontPageModel = loadTypeScriptModule("redesign/edition-front-page-model.ts");

function createSeedEdition(deskCount) {
  const items = [];
  const sections = [];
  for (let deskIndex = 0; deskIndex < deskCount; deskIndex += 1) {
    const itemIds = [];
    for (let articleIndex = 0; articleIndex < 3; articleIndex += 1) {
      const slug = `desk-${deskIndex}-article-${articleIndex}`;
      itemIds.push(slug);
      items.push({ type: "article", slug, section: `desk-${deskIndex}`, headline: slug, deck: "Deck", body: ["", `Opening of ${slug}.`, "Second."] });
    }
    sections.push({ key: `desk-${deskIndex}`, label: `Desk ${deskIndex}`, itemIds });
  }
  return { editionDate: "2026-07-04", items, sections };
}

function createPosts(postCount) {
  return Array.from({ length: postCount }, (_, postIndex) => ({
    slug: `post-${postIndex}`,
    headline: `Post ${postIndex}`,
    publishedAt: new Date(Date.UTC(2026, 9, 18, 12) - postIndex * 3_600_000).toISOString(),
  }));
}

function buildModel({ deskCount, postCount }) {
  return frontPageModel.buildEditionFrontPageModel({
    edition: createSeedEdition(deskCount),
    editionBasePath: "/2026/07/04",
    posts: createPosts(postCount),
    now: new Date(Date.UTC(2026, 9, 18, 12)),
  });
}

test("articles are numbered within their desk", () => {
  const model = buildModel({ deskCount: 2, postCount: 0 });
  assert.deepEqual(
    model.desks[1].articles.map((article) => article.numberLabel),
    ["2.1", "2.2", "2.3"],
  );
  assert.equal(model.editionLeadArticle.slug, "desk-0-article-0");
  assert.equal(model.editionSummaryLabel, "two desks · six articles");
});

test("a post inset follows every third desk but never the last desk", () => {
  const model = buildModel({ deskCount: 6, postCount: 20 });
  const blockKinds = model.deskBlocks.map((block) => block.kind);
  assert.deepEqual(blockKinds, ["desk", "desk", "desk", "post-inset", "desk", "desk", "desk"]);
});

test("posts placed in insets and more posts are never repeated", () => {
  const model = buildModel({ deskCount: 6, postCount: 20 });
  const insetSlugs = model.deskBlocks
    .filter((block) => block.kind === "post-inset")
    .flatMap((block) => [block.inset.featuredPost, ...block.inset.thumbnailPosts])
    .map((post) => post.slug);
  const bandSlugs = model.latestBandPosts.map((post) => post.slug);
  const moreSlugs = model.morePosts.map((post) => post.slug);
  const placedSlugs = [...bandSlugs, ...insetSlugs, ...moreSlugs];
  assert.equal(new Set(placedSlugs).size, placedSlugs.length);
  assert.deepEqual(bandSlugs, ["post-0", "post-1", "post-2", "post-3"]);
});

test("every post placement is empty when there are no posts", () => {
  const model = buildModel({ deskCount: 6, postCount: 0 });
  assert.equal(model.latestStripPosts.length, 0);
  assert.equal(model.latestBandPosts.length, 0);
  assert.equal(model.morePosts.length, 0);
  assert.ok(model.deskBlocks.every((block) => block.kind === "desk"));
});

test("post relative times read like a ticker", () => {
  const now = new Date(Date.UTC(2026, 9, 18, 12));
  assert.equal(frontPageModel.formatPostRelativeTimeLabel(new Date(Date.UTC(2026, 9, 18, 9)).toISOString(), now), "3h ago");
});

test("each article carries its first non-empty paragraph as the front-page opening", () => {
  const model = buildModel({ deskCount: 1, postCount: 0 });
  assert.equal(model.editionLeadArticle.openingParagraph, "Opening of desk-0-article-0.");
  assert.equal(frontPageModel.selectOpeningParagraph({ excerpt: " Excerpt only. " }), "Excerpt only.");
  assert.equal(frontPageModel.selectOpeningParagraph({}), undefined);
});
