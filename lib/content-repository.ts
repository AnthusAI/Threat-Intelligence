import { type Article, articles, editionDate } from "./articles";
import type { ContentRepository, EditionContent } from "./content-types";
import { graphqlContentRepository } from "./graphql-content-repository";
import { createDefaultEditionLayoutPlan } from "./layout-plan";
import { DEFAULT_LAYOUT_SCENARIO_ID, getLayoutScenario } from "./layout-scenarios";
import { markdownContentRepository } from "./markdown-content-repository";
import { articleToPublicationItem, cloneArticle, publicationItemToArticle } from "./publication-items";

export const fixtureContentRepository: ContentRepository = {
  loadEditionContent({ scenarioId } = {}) {
    if (scenarioId) return getLayoutScenario(scenarioId);
    return getDefaultEditionContent();
  },
  getArticle(slug: string) {
    const item = getDefaultEditionContent().items.find((candidate) => candidate.slug === slug);
    return item ? publicationItemToArticle(item) : undefined;
  },
  listArticleSlugs() {
    return getDefaultEditionContent().items
      .map((item) => publicationItemToArticle(item))
      .filter((article): article is Article => article !== undefined)
      .map((article) => article.slug);
  },
};

export const contentRepository: ContentRepository = {
  loadEditionContent({ scenarioId } = {}) {
    if (scenarioId) return getLayoutScenario(scenarioId);
    return getDefaultContentRepository().loadEditionContent();
  },
  getArticle(slug: string) {
    return getDefaultContentRepository().getArticle(slug);
  },
  listArticleSlugs() {
    return getDefaultContentRepository().listArticleSlugs();
  },
};

export function getScenarioIdParam(scenario: string | string[] | null | undefined): string | null {
  if (Array.isArray(scenario)) return scenario[0] ?? null;
  return scenario ?? null;
}

export function isGraphQLContentSource(): boolean {
  return process.env.PAPYRUS_CONTENT_SOURCE === "graphql";
}

function getDefaultContentRepository(): ContentRepository {
  const source = process.env.PAPYRUS_CONTENT_SOURCE;
  if (source === "graphql") return graphqlContentRepository;
  if (source === "markdown") return markdownContentRepository;
  if (source === "fixture") return fixtureContentRepository;
  if (process.env.NODE_ENV === "development") return markdownContentRepository;
  return fixtureContentRepository;
}

function getDefaultEditionContent(): EditionContent {
  return {
    id: "default-edition",
    source: "fixture",
    title: "Current Edition",
    editionDate,
    scenarioId: DEFAULT_LAYOUT_SCENARIO_ID,
    description: "The default Papyrus fixture edition.",
    layoutPlan: createDefaultEditionLayoutPlan(articles.map((article) => article.slug)),
    items: cloneArticles(articles).map(articleToPublicationItem),
  };
}

function cloneArticles(source: Article[]): Article[] {
  return source.map(cloneArticle);
}
