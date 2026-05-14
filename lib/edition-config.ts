import fs from "node:fs";
import path from "node:path";

export type LocalEditionConfig = {
  id: string;
  slug: string;
  title: string;
  description: string;
  displayDate: string;
  publishDate: string;
  publishedAt: string;
  articleOrder: string[];
};

const EDITION_CONFIG_PATH = path.join(process.cwd(), "content", "edition.json");

const DEFAULT_EDITION_CONFIG: LocalEditionConfig = {
  id: "edition-current",
  slug: "current",
  title: "Current Edition",
  description: "Development content loaded from Markdown files.",
  displayDate: "Wednesday, May 13, 2026",
  publishDate: "2026-05-13",
  publishedAt: "2026-05-13T12:00:00.000Z",
  articleOrder: [
    "harbor-grid",
    "schools-reading-lab",
    "market-hall",
    "river-court",
    "night-trains",
    "climate-ledger",
  ],
};

export function loadLocalEditionConfig(): LocalEditionConfig {
  if (!fs.existsSync(EDITION_CONFIG_PATH)) return DEFAULT_EDITION_CONFIG;

  const parsed = JSON.parse(fs.readFileSync(EDITION_CONFIG_PATH, "utf8")) as Partial<LocalEditionConfig>;
  return {
    ...DEFAULT_EDITION_CONFIG,
    ...parsed,
    articleOrder: Array.isArray(parsed.articleOrder) ? parsed.articleOrder : DEFAULT_EDITION_CONFIG.articleOrder,
  };
}

export function orderEditionSlugs<T extends { slug: string }>(items: T[], articleOrder = loadLocalEditionConfig().articleOrder): T[] {
  return [...items].sort((left, right) => {
    const leftIndex = articleOrder.indexOf(left.slug);
    const rightIndex = articleOrder.indexOf(right.slug);
    return getOrderValue(leftIndex) - getOrderValue(rightIndex) || left.slug.localeCompare(right.slug);
  });
}

function getOrderValue(index: number): number {
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}
