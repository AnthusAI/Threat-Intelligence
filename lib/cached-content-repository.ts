import { unstable_cache } from "next/cache";
import type { Article } from "./articles";
import type {
  EditionContent,
  EditionRouteSummary,
  GetEditionItemOptions,
  ListPublishedEditionsOptions,
  LoadEditionContentOptions,
  PublishedEditionConnection,
} from "./content-types";
import { graphqlContentRepository } from "./graphql-content-repository";
import { READER_REVALIDATE_SECONDS } from "./reader-route-config";

export const EDITIONS_CACHE_TAG = "editions";
export const ARCHIVE_CACHE_TAG = "archive";
export const ARTICLES_CACHE_TAG = "articles";

export function editionContentCacheTag(editionDate: string): string {
  return `edition:${editionDate}`;
}

export function articleCacheTag(slug: string): string {
  return `article:${slug}`;
}

export function editionItemCacheTag(editionDate: string, itemSlug: string): string {
  return `edition-item:${editionDate}:${itemSlug}`;
}

export function loadCachedEditionContent(options: LoadEditionContentOptions = {}): Promise<EditionContent> {
  const editionDate = options.editionDate ?? "active";
  const editionSlug = options.editionSlug ?? "";
  return unstable_cache(
    async () => graphqlContentRepository.loadEditionContent(options),
    ["reader-edition-content", editionDate, editionSlug],
    {
      tags: editionDate === "active" ? [EDITIONS_CACHE_TAG] : [editionContentCacheTag(editionDate), EDITIONS_CACHE_TAG],
      revalidate: READER_REVALIDATE_SECONDS,
    },
  )();
}

export function getCachedArticle(slug: string): Promise<Article | undefined> {
  return unstable_cache(
    async () => graphqlContentRepository.getArticle(slug),
    ["reader-article", slug],
    {
      tags: [articleCacheTag(slug), ARTICLES_CACHE_TAG],
      revalidate: READER_REVALIDATE_SECONDS,
    },
  )();
}

export function getCachedEditionItem(options: GetEditionItemOptions): Promise<import("./publication-items").PublicationItem | undefined> {
  const { editionDate, itemSlug } = options;
  return unstable_cache(
    async () => graphqlContentRepository.getEditionItem(options),
    ["reader-edition-item", editionDate, itemSlug],
    {
      tags: [editionItemCacheTag(editionDate, itemSlug), editionContentCacheTag(editionDate), EDITIONS_CACHE_TAG],
      revalidate: READER_REVALIDATE_SECONDS,
    },
  )();
}

export function listCachedPublishedEditions(
  options: ListPublishedEditionsOptions = {},
): Promise<PublishedEditionConnection> {
  const limit = options.limit ?? 0;
  const nextToken = options.nextToken ?? "";
  return unstable_cache(
    async () => graphqlContentRepository.listPublishedEditions(options),
    ["reader-published-editions", String(limit), nextToken],
    {
      tags: [ARCHIVE_CACHE_TAG, EDITIONS_CACHE_TAG],
      revalidate: READER_REVALIDATE_SECONDS,
    },
  )();
}

export function getCachedLatestPublishedEdition(): Promise<EditionRouteSummary | null> {
  return unstable_cache(
    async () => graphqlContentRepository.getLatestPublishedEdition(),
    ["reader-latest-published-edition"],
    {
      tags: [EDITIONS_CACHE_TAG, ARCHIVE_CACHE_TAG],
      revalidate: READER_REVALIDATE_SECONDS,
    },
  )();
}
