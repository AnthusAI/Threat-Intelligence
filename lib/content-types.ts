import type { Article } from "./articles";
import type { EditionLayoutPlan } from "./layout-plan";
import type { PublicationItem } from "./publication-items";

export type ContentSource = "scenario" | "graphql";

export type NewsDeskTaxonomyNode = {
  id: string;
  taxonomyId: string;
  topicUid: string;
  parentTopicUid?: string | null;
  displayName: string;
  subtitle?: string | null;
  description?: string | null;
  status: string;
  seedItemIds?: Array<string | null> | null;
  holdoutItemIds?: Array<string | null> | null;
  rank?: number | null;
  depth?: number | null;
};

export type NewsDeskAppendix = {
  taxonomyId: string;
  corpusId: string;
  topicSetId: string;
  displayName: string;
  description?: string | null;
  generatedAt?: string | null;
  nodes: NewsDeskTaxonomyNode[];
};

export type EditionContent = {
  id: string;
  source: ContentSource;
  title: string;
  editionDate: string;
  items: PublicationItem[];
  layoutPlan: EditionLayoutPlan;
  newsDeskAppendix?: NewsDeskAppendix | null;
  scenarioId?: string;
  description?: string;
};

export type EditionRouteSummary = {
  id: string;
  slug: string;
  title: string;
  editionDate: string;
  publishedAt?: string | null;
};

export type ListPublishedEditionsOptions = {
  limit?: number;
  nextToken?: string | null;
};

export type PublishedEditionConnection = {
  editions: EditionRouteSummary[];
  nextToken?: string | null;
};

export type LoadEditionContentOptions = {
  scenarioId?: string | null;
  editionDate?: string | null;
  editionSlug?: string | null;
};

export type GetEditionArticleOptions = {
  editionDate: string;
  articleSlug: string;
};

export type ContentRepository = {
  loadEditionContent(options?: LoadEditionContentOptions): EditionContent | Promise<EditionContent>;
  getLatestPublishedEdition(): EditionRouteSummary | null | Promise<EditionRouteSummary | null>;
  listPublishedEditions(options?: ListPublishedEditionsOptions): PublishedEditionConnection | Promise<PublishedEditionConnection>;
  getArticle(slug: string): Article | undefined | Promise<Article | undefined>;
  getEditionArticle(options: GetEditionArticleOptions): Article | undefined | Promise<Article | undefined>;
  listArticleSlugs(): string[] | Promise<string[]>;
};
