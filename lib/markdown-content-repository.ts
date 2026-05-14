import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { Article, ArticleAsset, ArticleImage } from "./articles";
import type { ContentRepository, EditionContent } from "./content-types";
import { loadLocalEditionConfig, orderEditionSlugs } from "./edition-config";
import { articleToPublicationItem } from "./publication-items";

const MARKDOWN_ARTICLES_DIR = path.join(process.cwd(), "content", "articles");

type MarkdownArticleFrontmatter = {
  slug?: string;
  shortSlug?: string;
  section?: string;
  byline?: string;
  dateline?: string;
  image?: ArticleImage;
  assets?: ArticleAsset[];
  pullQuotes?: string[];
};

export const markdownContentRepository: ContentRepository = {
  loadEditionContent() {
    const editionConfig = loadLocalEditionConfig();
    return {
      id: editionConfig.id,
      source: "markdown",
      title: editionConfig.title,
      editionDate: editionConfig.displayDate,
      description: editionConfig.description,
      layoutPlan: editionConfig.layoutPlan,
      items: loadMarkdownArticles().map(articleToPublicationItem),
    };
  },
  getArticle(slug: string) {
    return loadMarkdownArticles().find((article) => article.slug === slug);
  },
  listArticleSlugs() {
    return loadMarkdownArticles().map((article) => article.slug);
  },
};

export function loadMarkdownArticles(): Article[] {
  if (!fs.existsSync(MARKDOWN_ARTICLES_DIR)) return [];

  return orderEditionSlugs(
    fs
    .readdirSync(MARKDOWN_ARTICLES_DIR)
    .filter((filename) => filename.endsWith(".md"))
    .sort()
    .map((filename) => {
      const filepath = path.join(MARKDOWN_ARTICLES_DIR, filename);
      const markdown = fs.readFileSync(filepath, "utf8");
      return parseMarkdownArticle(markdown, filename);
    }),
  );
}

export function parseMarkdownArticle(markdown: string, filename = "article.md"): Article {
  const parsed = matter(markdown);
  const frontmatter = parsed.data as MarkdownArticleFrontmatter;
  const slug = frontmatter.slug ?? filename.replace(/\.md$/, "");
  const { headline, deck, body } = parseMarkdownArticleBody(parsed.content, filename);
  const image = frontmatter.image ?? getFallbackImage(slug);

  return {
    slug,
    shortSlug: normalizeShortSlug(frontmatter.shortSlug),
    section: frontmatter.section ?? "News",
    headline,
    deck,
    byline: frontmatter.byline ?? "Papyrus Staff",
    dateline: frontmatter.dateline ?? "NEWSROOM",
    image,
    assets: frontmatter.assets,
    pullQuotes: frontmatter.pullQuotes,
    body,
  };
}

function normalizeShortSlug(value: string | undefined): string | undefined {
  const shortSlug = value?.trim().toUpperCase();
  return shortSlug || undefined;
}

function parseMarkdownArticleBody(markdown: string, filename: string): { headline: string; deck: string; body: string[] } {
  const lines = markdown.split(/\r?\n/);
  let headline = "";
  let deck = "";
  const bodyLines: string[] = [];

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
    throw new Error(`Markdown article ${filename} must include a # headline`);
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

function getFallbackImage(slug: string): ArticleImage {
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
