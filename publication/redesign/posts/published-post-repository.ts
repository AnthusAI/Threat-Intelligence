import { unstable_cache } from "next/cache";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "@anthusai/papyrus/amplify/data/resource";
import { hasAmplifyOutputs, runWithGuestAmplifyContext, getAmplifyServerRuntime } from "@anthusai/papyrus/lib/amplify-server-runtime";
import { isDemoAmplifyOutputs } from "@anthusai/papyrus/lib/demo-amplify-outputs";
import { projectBodyIr } from "@anthusai/papyrus/lib/markus-body";
import { resolveReaderStorageUrl } from "@anthusai/papyrus/lib/reader-storage-url";
import { withRateLimitRetry } from "@anthusai/papyrus/lib/rate-limit-retry";
import { tenantIdFromEnvironment, tenantScopedValue } from "@anthusai/papyrus/lib/tenant-keys";
import type { PublishedPostImage, PublishedPostSummary } from "./post-feed-model";

export const POST_ITEM_TYPE = "post";
export const POSTS_CACHE_TAG = "posts";
const PUBLISHED_STATUS = "published";
const POSTS_REVALIDATE_SECONDS = 60;
const POST_IMAGE_PREFERRED_ROLES = ["og", "social", "lead", "feature", "card"];

export type PublishedPost = PublishedPostSummary & {
  body: string[];
};

type PublishedItemRow = {
  id: string;
  slug: string;
  type: string;
  status: string;
  title?: string | null;
  headline?: string | null;
  deck?: string | null;
  section?: string | null;
  publishedAt?: string | null;
  metadata?: unknown;
  bodyIr?: unknown;
};

type PublishedMediaAssetRow = {
  type: string;
  role: string;
  sortKey: string;
  storagePath?: string | null;
  externalUrl?: string | null;
  alt: string;
  width?: number | null;
  height?: number | null;
  metadata?: unknown;
};

type ListResponse<Row> = Promise<{ data?: Array<Row | null> | null; nextToken?: string | null; errors?: unknown[] | null }>;

type PostReadingModels = {
  PublishedItem: {
    listPublishedItemsByTypeStatusAndPublishedAt: (
      input: { typeStatus: string },
      options: Record<string, unknown>,
    ) => ListResponse<PublishedItemRow>;
    publishedItemBySlug: (input: { slug: string }, options: Record<string, unknown>) => ListResponse<PublishedItemRow>;
  };
  PublishedMediaAsset: {
    listPublishedMediaAssetsByItemAndSortKey: (
      input: { publishedItemId: string },
      options: Record<string, unknown>,
    ) => ListResponse<PublishedMediaAssetRow>;
  };
};

function readerCanQueryPublishedContent(): boolean {
  return hasAmplifyOutputs() && !isDemoAmplifyOutputs();
}

function parseMetadataRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function withGuestPostModels<Result>(operation: (models: PostReadingModels) => Promise<Result>): Promise<Result> {
  getAmplifyServerRuntime();
  return withRateLimitRetry(() =>
    runWithGuestAmplifyContext(async () => {
      const client = generateClient<Schema>({ authMode: "identityPool" });
      return operation(client.models as unknown as PostReadingModels);
    }),
  );
}

function choosePostImageAsset(mediaAssets: PublishedMediaAssetRow[]): PublishedMediaAssetRow | undefined {
  const imageAssets = mediaAssets.filter((asset) => asset.type === "image").sort((left, right) => left.sortKey.localeCompare(right.sortKey));
  for (const preferredRole of POST_IMAGE_PREFERRED_ROLES) {
    const match = imageAssets.find((asset) => asset.role.split(/[,\s]+/).includes(preferredRole));
    if (match) return match;
  }
  return imageAssets[0];
}

async function resolvePostImage(item: PublishedItemRow, mediaAssets: PublishedMediaAssetRow[]): Promise<PublishedPostImage | undefined> {
  const itemMetadata = parseMetadataRecord(item.metadata);
  const imageAsset = choosePostImageAsset(mediaAssets);
  const assetMetadata = parseMetadataRecord(imageAsset?.metadata);
  const pictogramSlug = readNonEmptyString(assetMetadata.pictogramSlug) ?? readNonEmptyString(itemMetadata.pictogramSlug);
  let imageSource: string | undefined;
  if (imageAsset?.storagePath) {
    imageSource = await resolveReaderStorageUrl(imageAsset.storagePath).catch(() => undefined);
  } else if (imageAsset?.externalUrl) {
    imageSource = imageAsset.externalUrl;
  }
  if (!imageSource && !pictogramSlug) return undefined;
  return {
    src: imageSource,
    alt: imageAsset?.alt ?? item.headline ?? item.title ?? item.slug,
    pictogramSlug,
    width: imageAsset?.width ?? undefined,
    height: imageAsset?.height ?? undefined,
  };
}

function projectPostBody(item: PublishedItemRow): string[] {
  if (item.bodyIr === null || item.bodyIr === undefined || item.bodyIr === "") return [];
  try {
    return projectBodyIr(item.bodyIr).body;
  } catch {
    return [];
  }
}

async function normalizePublishedPost(item: PublishedItemRow, models: PostReadingModels): Promise<PublishedPost | null> {
  if (item.type !== POST_ITEM_TYPE || item.status !== PUBLISHED_STATUS || !item.publishedAt) return null;
  const mediaResponse = await models.PublishedMediaAsset.listPublishedMediaAssetsByItemAndSortKey(
    { publishedItemId: item.id },
    { authMode: "identityPool", limit: 20 },
  );
  const mediaAssets = (mediaResponse.data ?? []).filter((asset): asset is PublishedMediaAssetRow => Boolean(asset));
  const itemMetadata = parseMetadataRecord(item.metadata);
  return {
    slug: item.slug,
    headline: item.headline ?? item.title ?? item.slug,
    summary: readNonEmptyString(item.deck) ?? readNonEmptyString(itemMetadata.summary),
    deskName: readNonEmptyString(item.section) ?? readNonEmptyString(itemMetadata.desk),
    publishedAt: item.publishedAt,
    image: await resolvePostImage(item, mediaAssets),
    body: projectPostBody(item),
  };
}

async function queryNewestPublishedPosts(maximumPostCount: number): Promise<PublishedPost[]> {
  if (!readerCanQueryPublishedContent()) return [];
  const tenantId = tenantIdFromEnvironment();
  return withGuestPostModels(async (models) => {
    const response = await models.PublishedItem.listPublishedItemsByTypeStatusAndPublishedAt(
      { typeStatus: tenantScopedValue(tenantId, `${POST_ITEM_TYPE}#${PUBLISHED_STATUS}`) },
      { authMode: "identityPool", limit: maximumPostCount, sortDirection: "DESC" },
    );
    const rows = (response.data ?? []).filter((row): row is PublishedItemRow => Boolean(row));
    const posts = await Promise.all(rows.map((row) => normalizePublishedPost(row, models)));
    return posts.filter((post): post is PublishedPost => post !== null);
  });
}

async function queryPublishedPostBySlug(postSlug: string): Promise<PublishedPost | null> {
  if (!readerCanQueryPublishedContent()) return null;
  return withGuestPostModels(async (models) => {
    const response = await models.PublishedItem.publishedItemBySlug({ slug: postSlug }, { authMode: "identityPool", limit: 5 });
    const row = (response.data ?? []).find((candidate): candidate is PublishedItemRow => Boolean(candidate) && candidate?.type === POST_ITEM_TYPE);
    return row ? normalizePublishedPost(row, models) : null;
  });
}

export async function loadNewestPublishedPosts(maximumPostCount = 40): Promise<PublishedPost[]> {
  try {
    return await unstable_cache(() => queryNewestPublishedPosts(maximumPostCount), ["threat-intelligence-newest-posts", String(maximumPostCount)], {
      tags: [POSTS_CACHE_TAG],
      revalidate: POSTS_REVALIDATE_SECONDS,
    })();
  } catch (error) {
    console.warn("Published posts are unavailable; post placements stay hidden.", error);
    return [];
  }
}

export async function loadPublishedPostBySlug(postSlug: string): Promise<PublishedPost | null> {
  try {
    return await unstable_cache(() => queryPublishedPostBySlug(postSlug), ["threat-intelligence-post", postSlug], {
      tags: [POSTS_CACHE_TAG, `post:${postSlug}`],
      revalidate: POSTS_REVALIDATE_SECONDS,
    })();
  } catch (error) {
    console.warn(`Published post ${postSlug} is unavailable.`, error);
    return null;
  }
}
