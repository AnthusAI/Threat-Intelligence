import { generateClient } from "aws-amplify/data";
import { getUrl } from "aws-amplify/storage/server";
import type { Schema } from "../amplify/data/resource";
import type { Article, ArticleImage, ArticleImageAsset, ArticleImageLayout, ArticleImageThemeVariants } from "./articles";
import { getAmplifyServerRuntime } from "./amplify-server-runtime";
import type { ContentRepository, EditionContent, EditionRouteSummary, ListPublishedEditionsOptions, LoadEditionContentOptions } from "./content-types";
import { createEditionSectionPlan } from "./edition-sections";
import { normalizeEditionLayoutPlan, validateEditionLayoutPlanForItems, type EditionLayoutPlan } from "./layout-plan";
import {
  articleToPublicationItem,
  publicationItemToArticle,
  type NonArticlePublicationItem,
  type PublicationItem,
  type PublicationItemType,
} from "./publication-items";
import { SITE_BRAND } from "./site-brand";

const AUTH_MODE = "apiKey";
const DEFAULT_EDITION_SLUG = "current";
const PUBLISHED_STATUS = "published";
const STORAGE_URL_EXPIRES_IN_SECONDS = 60 * 60;
const ARTICLE_TYPE_STATUS = "article#published";

type DataClient = ReturnType<typeof generateClient<Schema>>;
type EditionPublishedAtIndexQuery = (
  input: { status: string },
  options: Record<string, unknown>,
) => Promise<GraphQLListResponse<GraphQLEdition>>;

type GraphQLListResponse<T> = {
  data?: T[] | null;
  nextToken?: string | null;
  errors?: unknown[] | null;
};

type GraphQLGetResponse<T> = {
  data?: T | null;
  errors?: unknown[] | null;
};

type GraphQLEdition = {
  id: string;
  sourceEditionId?: string | null;
  editionLineageId?: string | null;
  versionNumber?: number | null;
  slug: string;
  title: string;
  status: string;
  editionDate: string;
  publishedAt?: string | null;
  description?: string | null;
  layoutPlan?: unknown;
  metadata?: unknown;
};

type GraphQLEditionItem = {
  id: string;
  publishedEditionId: string;
  publishedItemId: string;
  sortKey: string;
};

type GraphQLItem = {
  id: string;
  sourceItemId?: string | null;
  itemLineageId?: string | null;
  versionNumber?: number | null;
  type: string;
  status: string;
  slug: string;
  shortSlug?: string | null;
  section?: string | null;
  title?: string | null;
  headline?: string | null;
  deck?: string | null;
  body?: Array<string | null> | null;
  byline?: string | null;
  dateline?: string | null;
  publishedAt?: string | null;
  pullQuotes?: Array<string | null> | null;
};

type GraphQLMediaAsset = {
  id: string;
  publishedItemId: string;
  sourceItemId?: string | null;
  itemLineageId?: string | null;
  type: string;
  role: string;
  sortKey: string;
  storagePath?: string | null;
  externalUrl?: string | null;
  alt?: string | null;
  caption?: string | null;
  credit?: string | null;
  width?: number | null;
  height?: number | null;
  aspectRatio?: number | null;
  focalX?: number | null;
  focalY?: number | null;
  minHeight?: number | null;
  preferredHeight?: number | null;
  maxHeight?: number | null;
  crop?: string | null;
  wrapsText?: boolean | null;
  metadata?: unknown;
};

const IMAGE_ROLES: NonNullable<ArticleImageAsset["roles"]> = [
  "lead",
  "continuation",
  "continuationInset",
  "feature",
  "thumbnail",
];

let cachedClient: DataClient | null = null;

export const graphqlContentRepository: ContentRepository = {
  async loadEditionContent(options?: LoadEditionContentOptions) {
    const edition = options?.editionDate
      ? await loadPublishedEditionForDate(options.editionDate, options.editionSlug)
      : await loadActiveEdition();
    return loadEditionContentFromEdition(edition);
  },

  async getLatestPublishedEdition() {
    try {
      return summarizeEditionRoute(await loadLatestPublishedEdition());
    } catch (error) {
      if (isMissingGraphQLEditionError(error)) return null;
      throw error;
    }
  },

  async getFirstPublishedEdition() {
    try {
      return summarizeEditionRoute(await loadFirstPublishedEdition());
    } catch (error) {
      if (isMissingGraphQLEditionError(error)) return null;
      throw error;
    }
  },

  async listPublishedEditions(options?: ListPublishedEditionsOptions) {
    const result = await listPublishedEditionSummaries(options);
    return {
      editions: result.editions.map(summarizeEditionRoute),
      nextToken: result.nextToken,
    };
  },

  async getArticle(slug: string) {
    const item = await getItemBySlug(slug);
    if (!item || item.type !== "article" || item.status !== "published") return undefined;
    return normalizeArticle(item, await listMediaAssets(item.id));
  },

  async getEditionArticle({ editionDate, articleSlug }) {
    const item = await loadEditionItem(editionDate, articleSlug);
    return item ? publicationItemToArticle(item) : undefined;
  },

  async getEditionItem({ editionDate, itemSlug }) {
    return loadEditionItem(editionDate, itemSlug);
  },

  async listArticleSlugs() {
    const items = await listItemsByTypeStatus(ARTICLE_TYPE_STATUS);
    return items
      .filter((item) => item.type === "article" && item.status === "published")
      .map((item) => item.slug)
      .sort();
  },
};

function getClient(): DataClient {
  if (cachedClient) return cachedClient;

  getAmplifyServerRuntime();
  cachedClient = generateClient<Schema>({ authMode: AUTH_MODE });
  return cachedClient;
}

async function loadActiveEdition(): Promise<GraphQLEdition> {
  const configuredSlug = process.env.PAPYRUS_EDITION_SLUG ?? DEFAULT_EDITION_SLUG;
  const bySlug = await listAll<GraphQLEdition>((options) =>
    getPublishedEditionModel().publishedEditionBySlug({ slug: configuredSlug }, options),
  );
  if (bySlug[0]) return bySlug[0];

  return loadLatestPublishedEdition();
}

async function loadLatestPublishedEdition(): Promise<GraphQLEdition> {
  const listByPublishedAt = getEditionPublishedAtIndexQuery();
  if (listByPublishedAt) {
    try {
      const [latestByPublishedAt] = await listFirst<GraphQLEdition>((options) =>
        listByPublishedAt({ status: PUBLISHED_STATUS }, options),
      );
      if (latestByPublishedAt) return latestByPublishedAt;
    } catch (error) {
      if (!isMissingPublishedAtIndexError(error)) throw error;
    }
  }

  const [latestByEditionDate] = await listFirst<GraphQLEdition>((options) =>
    getPublishedEditionModel().listPublishedEditionsByStatusAndEditionDate({ status: PUBLISHED_STATUS }, options),
  );
  if (latestByEditionDate) return latestByEditionDate;

  throw new Error("No published GraphQL edition found. Seed the Amplify sandbox or set PAPYRUS_EDITION_SLUG.");
}

async function loadFirstPublishedEdition(): Promise<GraphQLEdition> {
  const editions = await listAll<GraphQLEdition>((options) =>
    getPublishedEditionModel().listPublishedEditionsByStatusAndEditionDate({ status: PUBLISHED_STATUS }, options),
  );
  const [firstEdition] = editions.sort(compareEditionsByOldest);
  if (firstEdition) return firstEdition;
  throw new Error("No published GraphQL edition found. Seed the Amplify sandbox or set PAPYRUS_EDITION_SLUG.");
}

async function listPublishedEditionSummaries({
  limit = 12,
  nextToken,
}: ListPublishedEditionsOptions = {}): Promise<{ editions: GraphQLEdition[]; nextToken?: string | null }> {
  const safeLimit = clampEditionPageLimit(limit);
  const listByPublishedAt = getEditionPublishedAtIndexQuery();
  if (listByPublishedAt) {
    try {
      return await listPage<GraphQLEdition>(
        (options) => listByPublishedAt({ status: PUBLISHED_STATUS }, options),
        safeLimit,
        nextToken,
      );
    } catch (error) {
      if (!isMissingPublishedAtIndexError(error)) throw error;
    }
  }

  return listPage<GraphQLEdition>(
    (options) => getPublishedEditionModel().listPublishedEditionsByStatusAndEditionDate({ status: PUBLISHED_STATUS }, options),
    safeLimit,
    nextToken,
  );
}

async function loadPublishedEditionForDate(editionDate: string, editionSlug?: string | null): Promise<GraphQLEdition> {
  const editions = await listPublishedEditionsForDate(editionDate);
  const selectedEdition = editionSlug ? editions.find((edition) => edition.slug === editionSlug) : editions[0];
  if (!selectedEdition) {
    const slugDetail = editionSlug ? ` and slug ${editionSlug}` : "";
    throw new Error(`No published GraphQL edition found for date ${editionDate}${slugDetail}.`);
  }
  return selectedEdition;
}

async function listPublishedEditionsForDate(editionDate: string): Promise<GraphQLEdition[]> {
  const editions = await listAll<GraphQLEdition>((options) =>
    getPublishedEditionModel().listPublishedEditionsByStatusAndEditionDate(
      { status: PUBLISHED_STATUS, editionDate: { eq: editionDate } },
      options,
    ),
  );
  return editions.sort(compareEditionsByFreshness);
}

async function loadEditionContentFromEdition(edition: GraphQLEdition): Promise<EditionContent> {
  const layoutPlan = normalizeEditionLayoutPlan(edition.layoutPlan, "Edition.layoutPlan");
  const editionItems = await listEditionItems(edition.id);
  const editionMetadata = parseObjectMetadata(edition.metadata);
  const itemsBySlug = new Map<string, PublicationItem>();
  const normalizedEditionItems = (
    await Promise.all(
      editionItems.map(async (editionItem) => {
        const item = await getItemById(editionItem.publishedItemId);
        if (!item || item.status !== PUBLISHED_STATUS) return null;
        return normalizePublicationItem(item, await listMediaAssets(item.id));
      }),
    )
  ).filter((item): item is PublicationItem => item !== null);
  for (const item of normalizedEditionItems) itemsBySlug.set(item.slug, item);

  const missingLayoutItems = [...collectLayoutPlanItemIds(layoutPlan)].filter((itemId) => !itemsBySlug.has(itemId));
  if (missingLayoutItems.length > 0) {
    const recoveredItems = (
      await Promise.all(
        missingLayoutItems.map(async (itemId) => {
          const item = await getItemBySlug(itemId);
          if (!item || item.status !== PUBLISHED_STATUS) return null;
          return normalizePublicationItem(item, await listMediaAssets(item.id));
        }),
      )
    ).filter((item): item is PublicationItem => item !== null);
    for (const item of recoveredItems) itemsBySlug.set(item.slug, item);
  }

  const items = [...itemsBySlug.values()];
  const availableItemSlugs = new Set(items.map((item) => item.slug));
  const sanitizedLayoutPlan = pruneLayoutPlanUnavailableItems(layoutPlan, availableItemSlugs, edition.id);
  validateEditionLayoutPlanForItems(sanitizedLayoutPlan, items, `PublishedEdition(${edition.id}).layoutPlan`);

  return {
    id: edition.id,
    source: "graphql",
    title: edition.title,
    editionDate: edition.editionDate,
    description: edition.description ?? "GraphQL content loaded from Amplify Data.",
    layoutPlan: sanitizedLayoutPlan,
    items,
    sections: createEditionSectionPlan(items, edition.metadata),
    suppressNewsDeskAppendix: editionMetadata?.suppressNewsDeskAppendix === true,
  };
}

function pruneLayoutPlanUnavailableItems(
  layoutPlan: EditionLayoutPlan,
  availableItemSlugs: Set<string>,
  editionId: string,
): EditionLayoutPlan {
  let removedBlocks = 0;
  const pages = layoutPlan.pages.map((page) => ({
    ...page,
    regions: page.regions.map((region) => ({
      ...region,
      blocks: region.blocks.filter((block) => {
        if ("itemId" in block && typeof block.itemId === "string" && block.itemId.trim()) {
          if (!availableItemSlugs.has(block.itemId)) {
            removedBlocks += 1;
            return false;
          }
        }
        if ("itemIds" in block && Array.isArray(block.itemIds)) {
          for (const itemId of block.itemIds) {
            if (typeof itemId === "string" && itemId.trim() && !availableItemSlugs.has(itemId)) {
              removedBlocks += 1;
              return false;
            }
          }
        }
        return true;
      }),
    })),
  }));
  if (removedBlocks > 0) {
    console.warn(
      `[graphql-content-repository] Pruned ${removedBlocks} layout block(s) that referenced unavailable published items in edition ${editionId}.`,
    );
  }
  return { ...layoutPlan, pages };
}

function collectLayoutPlanItemIds(layoutPlan: EditionLayoutPlan): Set<string> {
  const ids = new Set<string>();
  for (const page of layoutPlan.pages) {
    for (const region of page.regions) {
      for (const block of region.blocks) {
        if ("itemId" in block && typeof block.itemId === "string" && block.itemId.trim()) ids.add(block.itemId);
        if ("itemIds" in block && Array.isArray(block.itemIds)) {
          for (const itemId of block.itemIds) {
            if (typeof itemId === "string" && itemId.trim()) ids.add(itemId);
          }
        }
      }
    }
  }
  return ids;
}

async function loadEditionItem(editionDate: string, itemSlug: string): Promise<PublicationItem | undefined> {
  const edition = await loadPublishedEditionForDate(editionDate);
  const editionItems = await listEditionItems(edition.id);
  for (const editionItem of editionItems) {
    const item = await getItemById(editionItem.publishedItemId);
    if (!item || item.slug !== itemSlug || item.status !== PUBLISHED_STATUS) continue;
    return (await normalizePublicationItem(item, await listMediaAssets(item.id))) ?? undefined;
  }
  return undefined;
}

function summarizeEditionRoute(edition: GraphQLEdition): EditionRouteSummary {
  return {
    id: edition.id,
    slug: edition.slug,
    title: edition.title,
    editionDate: edition.editionDate,
    publishedAt: edition.publishedAt,
    description: edition.description ?? null,
  };
}

function compareEditionsByFreshness(left: GraphQLEdition, right: GraphQLEdition): number {
  const leftPublishedAt = left.publishedAt ?? `${left.editionDate}T00:00:00.000Z`;
  const rightPublishedAt = right.publishedAt ?? `${right.editionDate}T00:00:00.000Z`;
  return rightPublishedAt.localeCompare(leftPublishedAt) || right.id.localeCompare(left.id);
}

function compareEditionsByOldest(left: GraphQLEdition, right: GraphQLEdition): number {
  const leftPublishedAt = left.publishedAt ?? `${left.editionDate}T00:00:00.000Z`;
  const rightPublishedAt = right.publishedAt ?? `${right.editionDate}T00:00:00.000Z`;
  return left.editionDate.localeCompare(right.editionDate)
    || leftPublishedAt.localeCompare(rightPublishedAt)
    || left.id.localeCompare(right.id);
}

function isMissingGraphQLEditionError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("No published GraphQL edition found");
}

function getEditionPublishedAtIndexQuery(): EditionPublishedAtIndexQuery | null {
  const editionModel = getPublishedEditionModel() as unknown as {
    listPublishedEditionsByStatusAndPublishedAt?: EditionPublishedAtIndexQuery;
  };
  return typeof editionModel.listPublishedEditionsByStatusAndPublishedAt === "function"
    ? editionModel.listPublishedEditionsByStatusAndPublishedAt
    : null;
}

function getPublishedEditionModel() {
  const model = getClient().models.PublishedEdition;
  if (!model) throw missingProjectionModelError("PublishedEdition");
  return model;
}

function getPublishedEditionItemModel() {
  const model = getClient().models.PublishedEditionItem;
  if (!model) throw missingProjectionModelError("PublishedEditionItem");
  return model;
}

function getPublishedItemModel() {
  const model = getClient().models.PublishedItem;
  if (!model) throw missingProjectionModelError("PublishedItem");
  return model;
}

function getPublishedMediaAssetModel() {
  const model = getClient().models.PublishedMediaAsset;
  if (!model) throw missingProjectionModelError("PublishedMediaAsset");
  return model;
}

function missingProjectionModelError(modelName: string): Error {
  return new Error(
    `Amplify output is missing projection model ${modelName}. Refresh amplify_outputs.json from the latest deployed backend or regenerate it from the current sandbox schema.`,
  );
}

function isMissingPublishedAtIndexError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("listPublishedEditionsByStatusAndPublishedAt");
}

async function listEditionItems(editionId: string): Promise<GraphQLEditionItem[]> {
  const items = await listAll<GraphQLEditionItem>((options) =>
    getPublishedEditionItemModel().listPublishedEditionItemsByEditionAndSortKey({ publishedEditionId: editionId }, options),
  );
  return items.sort((left, right) => left.sortKey.localeCompare(right.sortKey));
}

async function listItemsByTypeStatus(typeStatus: string): Promise<GraphQLItem[]> {
  return listAll<GraphQLItem>((options) =>
    getPublishedItemModel().listPublishedItemsByTypeStatusAndPublishedAt({ typeStatus }, options),
  );
}

async function getItemById(id: string): Promise<GraphQLItem | null> {
  const response = await getPublishedItemModel().get({ id }, { authMode: AUTH_MODE });
  return readGetResponse<GraphQLItem>(response);
}

async function getItemBySlug(slug: string): Promise<GraphQLItem | null> {
  const items = await listAll<GraphQLItem>((options) => getPublishedItemModel().publishedItemBySlug({ slug }, options));
  return items[0] ?? null;
}

async function listMediaAssets(itemId: string): Promise<GraphQLMediaAsset[]> {
  const mediaAssets = await listAll<GraphQLMediaAsset>((options) =>
    getPublishedMediaAssetModel().listPublishedMediaAssetsByItemAndSortKey({ publishedItemId: itemId }, options),
  );
  return mediaAssets.sort((left, right) => left.sortKey.localeCompare(right.sortKey));
}

async function listAll<T>(operation: (options: Record<string, unknown>) => Promise<GraphQLListResponse<T>>): Promise<T[]> {
  const items: T[] = [];
  let nextToken: string | null | undefined;

  do {
    const response = await operation({
      authMode: AUTH_MODE,
      limit: 100,
      nextToken,
    });
    assertNoGraphQLErrors(response.errors);
    items.push(...((response.data ?? []).filter(Boolean) as T[]));
    nextToken = response.nextToken;
  } while (nextToken);

  return items;
}

async function listFirst<T>(operation: (options: Record<string, unknown>) => Promise<GraphQLListResponse<T>>): Promise<T[]> {
  const response = await operation({
    authMode: AUTH_MODE,
    limit: 1,
    sortDirection: "DESC",
  });
  assertNoGraphQLErrors(response.errors);
  return (response.data ?? []).filter(Boolean) as T[];
}

async function listPage<T>(
  operation: (options: Record<string, unknown>) => Promise<GraphQLListResponse<T>>,
  limit: number,
  nextToken?: string | null,
): Promise<{ editions: T[]; nextToken?: string | null }> {
  const response = await operation({
    authMode: AUTH_MODE,
    limit,
    nextToken,
    sortDirection: "DESC",
  });
  assertNoGraphQLErrors(response.errors);
  return {
    editions: (response.data ?? []).filter(Boolean) as T[],
    nextToken: response.nextToken,
  };
}

function clampEditionPageLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 12;
  return Math.max(1, Math.min(12, Math.floor(limit)));
}

function readGetResponse<T>(response: GraphQLGetResponse<T>): T | null {
  assertNoGraphQLErrors(response.errors);
  return response.data ?? null;
}

async function normalizeArticle(item: GraphQLItem, mediaAssets: GraphQLMediaAsset[]): Promise<Article> {
  const assets = (
    await Promise.all(mediaAssets.filter((asset) => asset.type === "image").map((asset) => normalizeImageAsset(item, asset)))
  ).filter((asset): asset is ArticleImageAsset => asset !== null);
  const primaryImage = assets.find((asset) => asset.roles?.includes("lead")) ?? assets[0];

  return {
    slug: item.slug,
    shortSlug: normalizeShortSlug(item.shortSlug),
    section: item.section ?? "News",
    headline: item.headline ?? item.title ?? item.slug,
    deck: item.deck ?? "",
    byline: item.byline ?? SITE_BRAND.placeholderByline,
    dateline: item.dateline ?? "NEWSROOM",
    image: primaryImage,
    assets,
    pullQuotes: compactStrings(item.pullQuotes),
    body: compactStrings(item.body),
  };
}

async function normalizePublicationItem(item: GraphQLItem, mediaAssets: GraphQLMediaAsset[]): Promise<PublicationItem | null> {
  if (item.type === "article") return articleToPublicationItem(await normalizeArticle(item, mediaAssets));
  const type = normalizePublicationItemType(item.type);
  if (!type) return null;
  const assets = (
    await Promise.all(mediaAssets.filter((asset) => asset.type === "image").map((asset) => normalizeImageAsset(item, asset)))
  ).filter((asset): asset is ArticleImageAsset => asset !== null);
  const image = assets[0] ?? undefined;
  const publicationItem: NonArticlePublicationItem = {
    type,
    slug: item.slug,
    section: item.section ?? "News",
    title: item.headline ?? item.title ?? item.slug,
    deck: item.deck ?? undefined,
    body: compactStrings(item.body),
    image,
    assets,
  };
  return publicationItem;
}

function normalizePublicationItemType(value: string): Exclude<PublicationItemType, "article"> | null {
  if (value === "brief" || value === "correction" || value === "promo" || value === "ad" || value === "sectionHeader") return value;
  return null;
}

async function normalizeImageAsset(item: GraphQLItem, asset: GraphQLMediaAsset): Promise<ArticleImageAsset | null> {
  const src = await getMediaUrl(asset);
  if (!src) return null;
  const metadata = parseObjectMetadata(asset.metadata);
  const themeVariants = await parseThemeVariantsMetadata(metadata?.themeVariants);

  return {
    id: asset.id,
    type: "image",
    src,
    alt: asset.alt ?? `Image for ${item.headline ?? item.slug}`,
    caption: asset.caption ?? undefined,
    credit: asset.credit ?? asset.caption ?? "Media asset",
    roles: parseImageRoles(asset.role),
    layout: getImageLayout(asset, metadata),
    themeVariants,
  };
}

async function getMediaUrl(asset: GraphQLMediaAsset): Promise<string | null> {
  if (asset.storagePath) return getSignedStorageUrl(asset.storagePath);
  return asset.externalUrl ?? null;
}

async function getSignedStorageUrl(storagePath: string): Promise<string> {
  const { runWithAmplifyServerContext } = getAmplifyServerRuntime();
  const result = await runWithAmplifyServerContext({
    nextServerContext: null,
    operation: (contextSpec) =>
      getUrl(contextSpec, {
        path: storagePath,
        options: {
          expiresIn: STORAGE_URL_EXPIRES_IN_SECONDS,
        },
      }),
  });
  return result.url.toString();
}

function getImageLayout(asset: GraphQLMediaAsset, metadata?: Record<string, unknown>): ArticleImageLayout | undefined {
  const aspectRatio = asset.aspectRatio ?? (asset.width && asset.height ? asset.width / asset.height : null);
  if (!aspectRatio) return undefined;

  return {
    minHeight: asset.minHeight ?? 110,
    preferredHeight: asset.preferredHeight ?? Math.round(220 / aspectRatio),
    maxHeight: asset.maxHeight ?? 440,
    aspectRatio,
    crop: asset.crop === "contain" ? "contain" : "cover",
    wrapsText: asset.wrapsText ?? true,
    inlineFloat: parseInlineFloatMetadata(metadata?.inlineFloat),
    focalPoint:
      typeof asset.focalX === "number" && typeof asset.focalY === "number"
        ? {
            x: asset.focalX,
            y: asset.focalY,
          }
        : undefined,
  };
}

async function parseThemeVariantsMetadata(value: unknown): Promise<ArticleImageThemeVariants | undefined> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const variants = value as Record<string, unknown>;
  const dark = await resolveThemeVariantSource(variants.dark);
  if (!dark) return undefined;
  return { dark: { src: dark } };
}

async function resolveThemeVariantSource(value: unknown): Promise<string | undefined> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entry = value as Record<string, unknown>;
  const storagePath = typeof entry.storagePath === "string" && entry.storagePath.trim() ? entry.storagePath.trim() : null;
  if (storagePath) return getSignedStorageUrl(storagePath);
  const sourceUrl = typeof entry.sourceUrl === "string" && entry.sourceUrl.trim() ? entry.sourceUrl.trim() : null;
  if (sourceUrl) return sourceUrl;
  const src = typeof entry.src === "string" && entry.src.trim() ? entry.src.trim() : null;
  return src ?? undefined;
}

function parseObjectMetadata(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function parseInlineFloatMetadata(value: unknown): ArticleImageLayout["inlineFloat"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return {
    minColumnCount: optionalPositiveNumber(record.minColumnCount),
    columnSpan: optionalPositiveNumber(record.columnSpan),
    widthRatio: optionalPositiveNumber(record.widthRatio),
    narrowWidthRatio: optionalPositiveNumber(record.narrowWidthRatio),
    maxWidthRatio: optionalPositiveNumber(record.maxWidthRatio),
    minWidth: optionalPositiveNumber(record.minWidth),
  };
}

function optionalPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function getFallbackImage(item: GraphQLItem): ArticleImage {
  return {
    src: "https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=1200&q=80",
    alt: `Editorial image for ${item.headline ?? item.slug}`,
    caption: "Fallback editorial image.",
    credit: "Fallback image",
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

function parseImageRoles(role: string | null | undefined): ArticleImageAsset["roles"] {
  const roles = (role ?? "")
    .split(/[,\s]+/)
    .map((candidate) => candidate.trim())
    .filter((candidate): candidate is NonNullable<ArticleImageAsset["roles"]>[number] =>
      IMAGE_ROLES.includes(candidate as NonNullable<ArticleImageAsset["roles"]>[number]),
    );
  return roles.length > 0 ? roles : ["lead", "continuation", "continuationInset"];
}

function compactStrings(values: Array<string | null> | null | undefined): string[] {
  return (values ?? []).filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function normalizeShortSlug(value: string | null | undefined): string | undefined {
  const shortSlug = value?.trim().toUpperCase();
  return shortSlug || undefined;
}

function assertNoGraphQLErrors(errors: unknown[] | null | undefined): void {
  if (!errors?.length) return;
  throw new Error(`GraphQL content request failed: ${JSON.stringify(errors)}`);
}
