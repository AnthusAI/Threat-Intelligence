import { generateClient } from "aws-amplify/data";
import { getUrl } from "aws-amplify/storage/server";
import type { Schema } from "../amplify/data/resource";
import type { Article, ArticleImage, ArticleImageAsset, ArticleImageLayout } from "./articles";
import { getAmplifyServerRuntime } from "./amplify-server-runtime";
import type { ContentRepository, EditionContent } from "./content-types";
import { normalizeEditionLayoutPlan } from "./layout-plan";

const AUTH_MODE = "apiKey";
const DEFAULT_EDITION_SLUG = "current";
const STORAGE_URL_EXPIRES_IN_SECONDS = 60 * 60;
const ARTICLE_TYPE_STATUS = "article#published";

type DataClient = ReturnType<typeof generateClient<Schema>>;

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
  slug: string;
  title: string;
  status: string;
  editionDate: string;
  description?: string | null;
  layoutPlan?: unknown;
};

type GraphQLEditionItem = {
  id: string;
  editionId: string;
  itemId: string;
  sortKey: string;
};

type GraphQLItem = {
  id: string;
  type: string;
  status: string;
  slug: string;
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
  itemId: string;
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
  async loadEditionContent() {
    const edition = await loadActiveEdition();
    const editionItems = await listEditionItems(edition.id);
    const articles = await Promise.all(
      editionItems.map(async (editionItem) => {
        const item = await getItemById(editionItem.itemId);
        if (!item || item.type !== "article" || item.status !== "published") return null;
        return normalizeArticle(item, await listMediaAssets(item.id));
      }),
    );

    return {
      id: edition.id,
      source: "graphql",
      title: edition.title,
      editionDate: edition.editionDate,
      description: edition.description ?? "GraphQL content loaded from Amplify Data.",
      layoutPlan: normalizeEditionLayoutPlan(edition.layoutPlan, "Edition.layoutPlan"),
      articles: articles.filter((article): article is Article => article !== null),
    };
  },

  async getArticle(slug: string) {
    const item = await getItemBySlug(slug);
    if (!item || item.type !== "article" || item.status !== "published") return undefined;
    return normalizeArticle(item, await listMediaAssets(item.id));
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
    getClient().models.Edition.editionBySlug({ slug: configuredSlug }, options),
  );
  if (bySlug[0]) return bySlug[0];

  const published = await listAll<GraphQLEdition>((options) =>
    getClient().models.Edition.listEditionsByStatusAndEditionDate({ status: "published" }, options),
  );
  const [latest] = published.sort((left, right) => right.editionDate.localeCompare(left.editionDate));
  if (!latest) {
    throw new Error("No published GraphQL edition found. Seed the Amplify sandbox or set PAPYRUS_EDITION_SLUG.");
  }
  return latest;
}

async function listEditionItems(editionId: string): Promise<GraphQLEditionItem[]> {
  const items = await listAll<GraphQLEditionItem>((options) =>
    getClient().models.EditionItem.listEditionItemsByEditionAndSortKey({ editionId }, options),
  );
  return items.sort((left, right) => left.sortKey.localeCompare(right.sortKey));
}

async function listItemsByTypeStatus(typeStatus: string): Promise<GraphQLItem[]> {
  return listAll<GraphQLItem>((options) =>
    getClient().models.Item.listItemsByTypeStatusAndPublishedAt({ typeStatus }, options),
  );
}

async function getItemById(id: string): Promise<GraphQLItem | null> {
  const response = await getClient().models.Item.get({ id }, { authMode: AUTH_MODE });
  return readGetResponse<GraphQLItem>(response);
}

async function getItemBySlug(slug: string): Promise<GraphQLItem | null> {
  const items = await listAll<GraphQLItem>((options) => getClient().models.Item.itemBySlug({ slug }, options));
  return items[0] ?? null;
}

async function listMediaAssets(itemId: string): Promise<GraphQLMediaAsset[]> {
  const mediaAssets = await listAll<GraphQLMediaAsset>((options) =>
    getClient().models.MediaAsset.listMediaAssetsByItemAndSortKey({ itemId }, options),
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

function readGetResponse<T>(response: GraphQLGetResponse<T>): T | null {
  assertNoGraphQLErrors(response.errors);
  return response.data ?? null;
}

async function normalizeArticle(item: GraphQLItem, mediaAssets: GraphQLMediaAsset[]): Promise<Article> {
  const assets = (
    await Promise.all(mediaAssets.filter((asset) => asset.type === "image").map((asset) => normalizeImageAsset(item, asset)))
  ).filter((asset): asset is ArticleImageAsset => asset !== null);
  const primaryImage = assets.find((asset) => asset.roles?.includes("lead")) ?? assets[0] ?? getFallbackImage(item);

  return {
    slug: item.slug,
    section: item.section ?? "News",
    headline: item.headline ?? item.title ?? item.slug,
    deck: item.deck ?? "",
    byline: item.byline ?? "Papyrus Staff",
    dateline: item.dateline ?? "NEWSROOM",
    image: primaryImage,
    assets,
    pullQuotes: compactStrings(item.pullQuotes),
    body: compactStrings(item.body),
  };
}

async function normalizeImageAsset(item: GraphQLItem, asset: GraphQLMediaAsset): Promise<ArticleImageAsset | null> {
  const src = await getMediaUrl(asset);
  if (!src) return null;

  return {
    id: asset.id,
    type: "image",
    src,
    alt: asset.alt ?? `Image for ${item.headline ?? item.slug}`,
    credit: asset.credit ?? asset.caption ?? "Media asset",
    roles: parseImageRoles(asset.role),
    layout: getImageLayout(asset),
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

function getImageLayout(asset: GraphQLMediaAsset): ArticleImageLayout | undefined {
  const aspectRatio = asset.aspectRatio ?? (asset.width && asset.height ? asset.width / asset.height : null);
  if (!aspectRatio) return undefined;

  return {
    minHeight: asset.minHeight ?? 110,
    preferredHeight: asset.preferredHeight ?? Math.round(220 / aspectRatio),
    maxHeight: asset.maxHeight ?? 440,
    aspectRatio,
    crop: asset.crop === "contain" ? "contain" : "cover",
    wrapsText: asset.wrapsText ?? true,
    focalPoint:
      typeof asset.focalX === "number" && typeof asset.focalY === "number"
        ? {
            x: asset.focalX,
            y: asset.focalY,
          }
        : undefined,
  };
}

function getFallbackImage(item: GraphQLItem): ArticleImage {
  return {
    src: "https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=1200&q=80",
    alt: `Editorial image for ${item.headline ?? item.slug}`,
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

function assertNoGraphQLErrors(errors: unknown[] | null | undefined): void {
  if (!errors?.length) return;
  throw new Error(`GraphQL content request failed: ${JSON.stringify(errors)}`);
}
