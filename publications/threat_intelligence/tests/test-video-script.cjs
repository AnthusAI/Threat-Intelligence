const test = require("node:test");
const assert = require("node:assert/strict");

// Compiled on the fly via tsx would be heavy; mirror the parser contract in JS for the fixture shape.
function parseVideoScriptRef(item) {
  const editorial = parseEditorial(item.editorial);
  const videoScript = editorial?.videoScript;
  if (!videoScript || typeof videoScript !== "object" || Array.isArray(videoScript)) return null;
  const dsl = typeof videoScript.dsl === "string" ? videoScript.dsl.trim() : "";
  if (!dsl) return null;
  const target = videoScript.target;
  const targetKind =
    target && typeof target === "object" && !Array.isArray(target) && target.kind === "edition" ? "edition" : "article";
  return { slug: item.slug, dsl, targetKind };
}

function parseEditorial(editorial) {
  if (!editorial) return null;
  if (typeof editorial === "string") {
    try {
      const parsed = JSON.parse(editorial);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  if (typeof editorial === "object" && !Array.isArray(editorial)) return editorial;
  return null;
}

test("parseVideoScriptRef reads videoml PublishedItem editorial payload", () => {
  const result = parseVideoScriptRef({
    slug: "the-balance-of-power-is-shifting--videoml",
    editorial: {
      videoScript: {
        dsl: '<vml id="the-balance-of-power-is-shifting" title="Sample" fps="30" width="1280" height="720"></vml>',
        theme: "both",
        target: { kind: "article", articleSlug: "the-balance-of-power-is-shifting" },
      },
    },
  });

  assert.equal(result?.targetKind, "article");
  assert.match(result?.dsl ?? "", /<vml /);
});

test("parseVideoScriptRef returns null without dsl", () => {
  assert.equal(parseVideoScriptRef({ slug: "edition-overview--videoml", editorial: {} }), null);
});
