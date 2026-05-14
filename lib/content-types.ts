import type { Article } from "./articles";

export type ContentSource = "fixture" | "scenario" | "markdown" | "graphql";

export type EditionContent = {
  id: string;
  source: ContentSource;
  title: string;
  editionDate: string;
  articles: Article[];
  scenarioId?: string;
  description?: string;
};

export type ContentRepository = {
  loadEditionContent(options?: { scenarioId?: string | null }): EditionContent | Promise<EditionContent>;
  getArticle(slug: string): Article | undefined | Promise<Article | undefined>;
  listArticleSlugs(): string[] | Promise<string[]>;
};
