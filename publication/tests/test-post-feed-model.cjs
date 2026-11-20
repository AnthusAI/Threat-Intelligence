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

const postFeedModel = loadTypeScriptModule("redesign/posts/post-feed-model.ts");
const NOW = new Date(Date.UTC(2026, 9, 18, 12));

function createPosts(postCount) {
  return Array.from({ length: postCount }, (_, postIndex) => ({
    slug: `post-${postIndex}`,
    headline: `Post ${postIndex}`,
    publishedAt: new Date(Date.UTC(2026, 9, 18, 12) - postIndex * 3_600_000).toISOString(),
  }));
}

test("the feed shows the newest posts first as showcase and the rest as earlier posts", () => {
  const shuffledPosts = createPosts(9).reverse();
  const { showcasePosts, earlierPosts } = postFeedModel.splitPostsForFeed(shuffledPosts, NOW);
  assert.deepEqual(showcasePosts.map((post) => post.slug), ["post-0", "post-1", "post-2", "post-3", "post-4", "post-5"]);
  assert.deepEqual(earlierPosts.map((post) => post.slug), ["post-6", "post-7", "post-8"]);
});

test("no post appears twice in the feed", () => {
  const { showcasePosts, earlierPosts } = postFeedModel.splitPostsForFeed(createPosts(20), NOW);
  const slugs = [...showcasePosts, ...earlierPosts].map((post) => post.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});

test("an empty feed has no showcase and no earlier posts", () => {
  const { showcasePosts, earlierPosts } = postFeedModel.splitPostsForFeed([], NOW);
  assert.equal(showcasePosts.length, 0);
  assert.equal(earlierPosts.length, 0);
});

test("post links point at the post page and encode the slug", () => {
  assert.equal(postFeedModel.createPostHref("a b"), "/posts/a%20b");
});

test("relative time labels step from minutes to hours to days to a date", () => {
  const labelFor = (millisecondsAgo) => postFeedModel.formatPostRelativeTimeLabel(new Date(NOW.getTime() - millisecondsAgo).toISOString(), NOW);
  assert.equal(labelFor(10_000), "Just now");
  assert.equal(labelFor(5 * 60_000), "5m ago");
  assert.equal(labelFor(3 * 3_600_000), "3h ago");
  assert.equal(labelFor(2 * 86_400_000), "2d ago");
  assert.equal(labelFor(30 * 86_400_000), "Sep 18");
});
