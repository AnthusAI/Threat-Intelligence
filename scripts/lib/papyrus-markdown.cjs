const fs = require("node:fs");
const path = require("node:path");
const matter = require("gray-matter");

const CONTENT_DIR = path.join(process.cwd(), "content");
const ARTICLES_DIR = path.join(CONTENT_DIR, "articles");
const EDITION_PATH = path.join(CONTENT_DIR, "edition.json");

function loadEditionConfig() {
  const config = JSON.parse(fs.readFileSync(EDITION_PATH, "utf8"));
  return {
    ...config,
    layoutPlan: config.layoutPlan || createDefaultLayoutPlan(config.articleOrder || []),
  };
}

function loadMarkdownArticles() {
  const editionConfig = loadEditionConfig();
  const articles = fs
    .readdirSync(ARTICLES_DIR)
    .filter((filename) => filename.endsWith(".md"))
    .sort()
    .map((filename) => parseMarkdownArticle(fs.readFileSync(path.join(ARTICLES_DIR, filename), "utf8"), filename));

  return orderArticles(articles, editionConfig.articleOrder);
}

function getMarkdownArticle(slug) {
  return loadMarkdownArticles().find((article) => article.slug === slug);
}

function parseMarkdownArticle(markdown, filename) {
  const parsed = matter(markdown);
  const frontmatter = parsed.data || {};
  const slug = frontmatter.slug || filename.replace(/\.md$/, "");
  const { headline, deck, body } = parseMarkdownArticleBody(parsed.content, filename);
  const image = frontmatter.image || getFallbackImage(slug);

  return {
    slug,
    section: frontmatter.section || "News",
    headline,
    deck,
    byline: frontmatter.byline || "Papyrus Staff",
    dateline: frontmatter.dateline || "NEWSROOM",
    image,
    assets: Array.isArray(frontmatter.assets) ? frontmatter.assets : undefined,
    pullQuotes: Array.isArray(frontmatter.pullQuotes) ? frontmatter.pullQuotes : undefined,
    body,
  };
}

function parseMarkdownArticleBody(markdown, filename) {
  const lines = markdown.split(/\r?\n/);
  let headline = "";
  let deck = "";
  const bodyLines = [];

  for (const line of lines) {
    if (!headline && line.startsWith("# ")) {
      headline = line.replace(/^#\s+/, "").trim();
      continue;
    }
    if (!deck && line.startsWith("## ")) {
      deck = line.replace(/^##\s+/, "").trim();
      continue;
    }
    bodyLines.push(line);
  }

  if (!headline) {
    throw new Error(`Markdown article ${filename} must include a # headline.`);
  }

  return {
    headline,
    deck,
    body: bodyLines
      .join("\n")
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
      .filter(Boolean),
  };
}

function getFallbackImage(slug) {
  return {
    src: "https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=1200&q=80",
    alt: `Editorial image for ${slug}`,
    credit: "Development image",
    layout: {
      minHeight: 120,
      preferredHeight: 220,
      maxHeight: 420,
      aspectRatio: 1.5,
      crop: "cover",
      wrapsText: true,
    },
  };
}

function getArticleImageAssets(article) {
  const assets = Array.isArray(article.assets)
    ? article.assets.filter((asset) => asset && asset.type === "image")
    : [];
  if (assets.length > 0) return assets;

  return [
    {
      ...article.image,
      id: `${article.slug}-primary-image`,
      type: "image",
      roles: ["lead", "continuation", "continuationInset"],
    },
  ];
}

function orderArticles(articles, articleOrder) {
  return [...articles].sort((left, right) => {
    const leftIndex = articleOrder.indexOf(left.slug);
    const rightIndex = articleOrder.indexOf(right.slug);
    const leftRank = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const rightRank = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
    return leftRank - rightRank || left.slug.localeCompare(right.slug);
  });
}

function createDefaultLayoutPlan(articleIds) {
  const availableArticleIds = new Set(articleIds);
  return {
    version: 1,
    frontPage: {
      pageNumber: 1,
      recipeId: "front-page",
      templateId: "front.teaserGrid",
      articleIds,
      cutPolicies: [
        { articleId: "harbor-grid", maxBodyLines: 22, continuationPageNumber: 2 },
        { articleId: "schools-reading-lab", maxBodyLines: 16, continuationPageNumber: 3 },
        { articleId: "market-hall", maxBodyLines: 14, continuationPageNumber: 3 },
      ].filter((policy) => availableArticleIds.has(policy.articleId)),
    },
    pages: [
      {
        pageNumber: 2,
        recipeId: "photo-harbor-grid",
        kind: "photoContinuation",
        sections: [
          {
            articleId: "harbor-grid",
            role: "primary",
            mediaTemplateIds: ["centerTwoColumnInset", "rightColumnInset", "leftColumnInset", "wideTopBand"],
            pullQuoteTemplateIds: ["centerTwoColumnBreak", "rightRailMid", "leftRailMid"],
          },
        ],
      },
      {
        pageNumber: 3,
        recipeId: "shared-schools-reading-market-hall",
        kind: "dualContinuation",
        sections: [
          {
            articleId: "schools-reading-lab",
            role: "top",
            mediaTemplateIds: ["rightTwoColumnInset", "rightColumnInset", "leftColumnInset", "centerTwoColumnInset"],
            pullQuoteTemplateIds: ["leftRailMid", "rightRailMid", "centerTwoColumnBreak"],
          },
          {
            articleId: "market-hall",
            role: "bottom",
            mediaTemplateIds: ["leftColumnInset", "rightColumnInset", "centerTwoColumnInset"],
            pullQuoteTemplateIds: ["rightRailMid", "leftRailMid", "centerTwoColumnBreak"],
          },
        ],
        splitVariants: [0.5, 0.55, 0.45],
      },
    ].filter((page) => page.sections.every((section) => availableArticleIds.has(section.articleId))),
  };
}

module.exports = {
  getArticleImageAssets,
  getMarkdownArticle,
  loadEditionConfig,
  loadMarkdownArticles,
};
