import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { addToUserGroup, createAndSignUpUser, signInUser } from "@aws-amplify/seed";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { signOut } from "aws-amplify/auth";
import { uploadData } from "aws-amplify/storage";
import YAML from "yaml";
import type { Schema } from "../data/resource";
import * as articlesModule from "../../lib/articles";
import type { Article, ArticleImageAsset } from "../../lib/articles";
import * as amplifyServerRuntimeModule from "../../lib/amplify-server-runtime";

const articlesRuntime = getRuntimeModule(articlesModule);
const amplifyServerRuntime = getRuntimeModule(amplifyServerRuntimeModule);
const { articles, editionDate, getArticleImageAssets } = articlesRuntime as typeof import("../../lib/articles");
const { getAmplifyServerRuntime } = amplifyServerRuntime as typeof import("../../lib/amplify-server-runtime");

const EDITOR_GROUP = "editor";
const NEWSROOM_SECTIONS_CONFIG_PATH = path.join(process.cwd(), "corpora", "papyrus-newsroom-sections.yml");
const NEWSROOM_SECTION_TYPES = new Set(["canonical", "floating", "rotating"]);

type DataClient = ReturnType<typeof generateClient<Schema>>;
type NewsroomSectionSeed = {
  id: string;
  title: string;
  type: "canonical" | "floating" | "rotating";
  editorialMission: string;
  editorialPolicy: string;
  enabled: boolean;
  sortOrder: number;
  shortDescription: string | null;
  defaultArticleTypes: string[];
  defaultPageBudget: number | null;
  assignmentGuidance: string | null;
  killCriteria: string | null;
  visualGuidance: string | null;
};

let cachedClient: DataClient | null = null;

function getRuntimeModule<T extends object>(module: T): T {
  return "default" in module && typeof module.default === "object" && module.default !== null ? (module.default as T) : module;
}

function getSeedClient(): DataClient {
  if (!cachedClient) cachedClient = generateClient<Schema>({ authMode: "userPool" });
  return cachedClient;
}

async function main() {
  const runtime = getAmplifyServerRuntime();
  Amplify.configure(runtime.config);
  await signInSeedEditor();
  const editionConfig = getSeedEditionConfig();

  try {
    const orderedArticles = orderArticles(articles, editionConfig.articleOrder);
    const editionRecord = withVersionFields({
      id: editionConfig.id,
      slug: editionConfig.slug,
      title: editionConfig.title,
      status: "published",
      editionDate: editionConfig.publishDate,
      publishedAt: editionConfig.publishedAt,
      description: editionConfig.description,
      layoutPlan: toAwsJson(editionConfig.layoutPlan),
      metadata: toAwsJson({ source: "fixture-seed" }),
    }, {
      lineageId: editionConfig.id,
      versionCreatedAt: editionConfig.publishedAt,
      versionCreatedBy: "amplify-seed",
      changeReason: "fixture seed",
    });
    await upsert("Edition", editionRecord);
    await upsert("PublishedEdition", {
      id: publishedEditionId(editionConfig.id),
      sourceEditionId: editionRecord.id,
      editionLineageId: editionRecord.lineageId,
      versionNumber: editionRecord.versionNumber,
      slug: editionConfig.slug,
      title: editionConfig.title,
      status: "published",
      editionDate: editionConfig.publishDate,
      publishedAt: editionConfig.publishedAt,
      description: editionConfig.description,
      layoutPlan: toAwsJson(editionConfig.layoutPlan),
      metadata: toAwsJson({ source: "fixture-seed" }),
    });
    await seedNewsroomSections(editionConfig.publishedAt);

    for (const [index, article] of orderedArticles.entries()) {
      await seedArticle(article, index, editionConfig);
    }

    console.log(`Seeded ${orderedArticles.length} articles into Amplify Data and Storage.`);
  } finally {
    await signOut();
  }
}

async function signInSeedEditor() {
  const password = process.env.PAPYRUS_SEED_PASSWORD ?? "PapyrusSeed1!";
  const email = process.env.PAPYRUS_SEED_EMAIL ?? "papyrus-seed-editor@example.com";
  const username = process.env.PAPYRUS_SEED_USERNAME ?? email;

  try {
    await createAndSignUpUser({
      signInAfterCreation: false,
      username,
      password,
      signInFlow: "Password",
      userAttributes: {
        email,
      },
    });
  } catch (error) {
    if (!isExpectedExistingUserError(error)) throw error;
  }

  await addToUserGroup({ username }, EDITOR_GROUP);
  const signedIn = await signInUser({
    username,
    password,
    signInFlow: "Password",
  });

  if (!signedIn) {
    throw new Error(`Could not sign in seed editor ${username}. Check PAPYRUS_SEED_PASSWORD.`);
  }
}

type SeedEditionConfig = ReturnType<typeof getSeedEditionConfig>;

async function seedArticle(article: Article, index: number, editionConfig: SeedEditionConfig) {
  const itemId = `item-${article.slug}`;
  const sectionSlug = slugify(article.section);
  const tagId = `tag-${sectionSlug}`;
  const sortKey = `${String(index + 1).padStart(3, "0")}#${article.slug}`;

  const itemRecord = withVersionFields({
    id: itemId,
    type: "article",
    status: "published",
    typeStatus: "article#published",
    slug: article.slug,
    shortSlug: article.shortSlug,
    section: article.section,
    sectionStatus: `${sectionSlug}#published`,
    title: article.headline,
    headline: article.headline,
    deck: article.deck,
    body: article.body,
    byline: article.byline,
    dateline: article.dateline,
    publishedAt: editionConfig.publishedAt,
    editionDate: editionConfig.publishDate,
    sortTitle: article.headline,
    pullQuotes: article.pullQuotes ?? [],
    layout: toAwsJson({ source: "fixture" }),
    editorial: toAwsJson({}),
  }, {
    lineageId: itemId,
    versionCreatedAt: editionConfig.publishedAt,
    versionCreatedBy: "amplify-seed",
    changeReason: "fixture seed",
  });
  await upsert("Item", itemRecord);
  await upsert("PublishedItem", {
    id: publishedItemId(itemId),
    sourceItemId: itemRecord.id,
    itemLineageId: itemRecord.lineageId,
    versionNumber: itemRecord.versionNumber,
    type: "article",
    status: "published",
    typeStatus: "article#published",
    slug: article.slug,
    shortSlug: article.shortSlug,
    section: article.section,
    sectionStatus: `${sectionSlug}#published`,
    title: article.headline,
    headline: article.headline,
    deck: article.deck,
    body: article.body,
    byline: article.byline,
    dateline: article.dateline,
    publishedAt: editionConfig.publishedAt,
    editionDate: editionConfig.publishDate,
    sortTitle: article.headline,
    pullQuotes: article.pullQuotes ?? [],
    layout: toAwsJson({ source: "fixture" }),
    editorial: toAwsJson({}),
  });

  await upsert("Tag", {
    id: tagId,
    slug: sectionSlug,
    label: article.section,
    type: "section",
  });

  await upsert("ItemTag", {
    id: `item-tag-${article.slug}-${sectionSlug}`,
    itemId,
    tagId,
    itemType: "article",
    itemStatus: "published",
    tagSlug: sectionSlug,
    publishedAt: editionConfig.publishedAt,
  });

  await upsert("EditionItem", {
    id: `${editionConfig.id}-${article.slug}`,
    editionId: editionConfig.id,
    editionLineageId: editionConfig.id,
    itemId,
    itemLineageId: itemId,
    placementKey: `front:${index + 1}`,
    sortKey,
    pageNumber: 1,
    priority: index + 1,
    metadata: toAwsJson({}),
  });
  await upsert("PublishedEditionItem", {
    id: `${publishedEditionId(editionConfig.id)}-${article.slug}`,
    publishedEditionId: publishedEditionId(editionConfig.id),
    publishedItemId: publishedItemId(itemId),
    sourceEditionItemId: `${editionConfig.id}-${article.slug}`,
    sourceEditionId: editionConfig.id,
    sourceItemId: itemId,
    editionLineageId: editionConfig.id,
    itemLineageId: itemId,
    placementKey: `front:${index + 1}`,
    sortKey,
    pageNumber: 1,
    priority: index + 1,
    metadata: toAwsJson({}),
  });

  const imageAssets = getArticleImageAssets(article);
  for (const [assetIndex, asset] of imageAssets.entries()) {
    const uploaded = await uploadSeedImage(article, asset, assetIndex);
    const mediaId = `media-${article.slug}-${assetIndex}`;
    const mediaSortKey = `${String(assetIndex + 1).padStart(3, "0")}#${asset.id}`;
    await upsert("MediaAsset", {
      id: mediaId,
      itemId,
      type: "image",
      role: (asset.roles ?? ["lead", "continuation", "continuationInset"]).join(","),
      sortKey: mediaSortKey,
      storagePath: uploaded.storagePath,
      externalUrl: asset.src,
      alt: asset.alt,
      caption: asset.caption ?? asset.credit,
      credit: asset.credit,
      width: uploaded.width,
      height: uploaded.height,
      aspectRatio: asset.layout?.aspectRatio,
      focalX: asset.layout?.focalPoint?.x,
      focalY: asset.layout?.focalPoint?.y,
      minHeight: asset.layout?.minHeight,
      preferredHeight: asset.layout?.preferredHeight,
      maxHeight: asset.layout?.maxHeight,
      crop: asset.layout?.crop,
      wrapsText: asset.layout?.wrapsText,
      metadata: toAwsJson({ sourceUrl: asset.src }),
    });
    await upsert("PublishedMediaAsset", {
      id: `published-${mediaId}`,
      sourceMediaAssetId: mediaId,
      publishedItemId: publishedItemId(itemId),
      sourceItemId: itemId,
      itemLineageId: itemId,
      type: "image",
      role: (asset.roles ?? ["lead", "continuation", "continuationInset"]).join(","),
      sortKey: mediaSortKey,
      storagePath: uploaded.storagePath,
      externalUrl: asset.src,
      alt: asset.alt,
      caption: asset.caption ?? asset.credit,
      credit: asset.credit,
      width: uploaded.width,
      height: uploaded.height,
      aspectRatio: asset.layout?.aspectRatio,
      focalX: asset.layout?.focalPoint?.x,
      focalY: asset.layout?.focalPoint?.y,
      minHeight: asset.layout?.minHeight,
      preferredHeight: asset.layout?.preferredHeight,
      maxHeight: asset.layout?.maxHeight,
      crop: asset.layout?.crop,
      wrapsText: asset.layout?.wrapsText,
      metadata: toAwsJson({ sourceUrl: asset.src }),
    });
  }
}

async function seedNewsroomSections(importedAt: string) {
  const sections = loadNewsroomSectionSeeds();
  for (const section of sections) {
    await upsert("NewsroomSection", {
      id: section.id,
      title: section.title,
      type: section.type,
      editorialMission: section.editorialMission,
      editorialPolicy: section.editorialPolicy,
      enabled: section.enabled,
      enabledStatus: section.enabled ? "enabled" : "disabled",
      sortOrder: section.sortOrder,
      shortDescription: section.shortDescription,
      defaultArticleTypes: section.defaultArticleTypes,
      defaultPageBudget: section.defaultPageBudget,
      assignmentGuidance: section.assignmentGuidance,
      killCriteria: section.killCriteria,
      visualGuidance: section.visualGuidance,
      createdAt: importedAt,
      updatedAt: importedAt,
    });
  }
}

function loadNewsroomSectionSeeds(configPath = NEWSROOM_SECTIONS_CONFIG_PATH): NewsroomSectionSeed[] {
  const parsed = YAML.parse(fs.readFileSync(configPath, "utf8")) as {
    schemaVersion?: number;
    sections?: Array<Record<string, unknown>>;
  };
  if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.sections)) {
    throw new Error(`Invalid newsroom section seed file: ${configPath}`);
  }
  return parsed.sections.map((entry, index) => normalizeNewsroomSectionSeed(entry, index, configPath));
}

function normalizeNewsroomSectionSeed(entry: Record<string, unknown>, index: number, configPath: string): NewsroomSectionSeed {
  const id = String(entry.id ?? "").trim();
  if (!id) throw new Error(`Newsroom section at index ${index} in ${configPath} is missing id.`);
  const title = requiredText(entry.title, `title for section ${id}`);
  const rawTypeValue = String(entry.type ?? "").trim().toLowerCase();
  if (!NEWSROOM_SECTION_TYPES.has(rawTypeValue)) {
    throw new Error(`Newsroom section ${id} in ${configPath} has unsupported type '${String(entry.type ?? "")}'.`);
  }
  const typeValue = rawTypeValue === "rotating" ? "floating" : rawTypeValue;
  return {
    id,
    title,
    type: typeValue as NewsroomSectionSeed["type"],
    editorialMission: requiredText(entry.editorialMission, `editorialMission for section ${id}`),
    editorialPolicy: requiredText(entry.editorialPolicy, `editorialPolicy for section ${id}`),
    enabled: typeof entry.enabled === "boolean" ? entry.enabled : true,
    sortOrder: positiveInteger(entry.sortOrder, index + 1),
    shortDescription: optionalText(entry.shortDescription),
    defaultArticleTypes: normalizeStringList(entry.defaultArticleTypes),
    defaultPageBudget: optionalInteger(entry.defaultPageBudget),
    assignmentGuidance: optionalText(entry.assignmentGuidance),
    killCriteria: optionalText(entry.killCriteria),
    visualGuidance: optionalText(entry.visualGuidance),
  };
}

function requiredText(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`Missing ${label} in ${path.basename(NEWSROOM_SECTIONS_CONFIG_PATH)}.`);
  return normalized;
}

function optionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => optionalText(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function optionalInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function uploadSeedImage(article: Article, asset: ArticleImageAsset, index: number) {
  const payload = await loadImagePayload(asset.src);
  const extension = getImageExtension(payload.contentType, asset.src);
  const storagePath = `media/articles/${article.slug}/${String(index + 1).padStart(2, "0")}-${asset.id}.${extension}`;

  await uploadData({
    path: storagePath,
    data: payload.data,
    options: {
      contentType: payload.contentType,
      cacheControl: "public, max-age=31536000, immutable",
    },
  }).result;

  return {
    storagePath,
    width: asset.layout ? Math.round(asset.layout.aspectRatio * asset.layout.preferredHeight) : undefined,
    height: asset.layout?.preferredHeight,
  };
}

async function loadImagePayload(src: string): Promise<{ data: Uint8Array; contentType: string }> {
  if (/^https?:\/\//.test(src)) {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`Could not fetch image ${src}: ${response.status} ${response.statusText}`);
    return {
      data: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "image/jpeg",
    };
  }

  const filepath =
    path.isAbsolute(src) && fs.existsSync(src)
      ? src
      : path.join(process.cwd(), src.startsWith("/") ? path.join("public", src.slice(1)) : src);
  return {
    data: fs.readFileSync(filepath),
    contentType: getContentTypeFromFilename(filepath),
  };
}

async function upsert(modelName: keyof DataClient["models"], record: Record<string, unknown>) {
  const model = (getSeedClient().models as Record<string, unknown>)[String(modelName)] as {
    get(input: { id: string }, options: { authMode: "userPool" }): Promise<{ data?: unknown; errors?: unknown[] }>;
    create(input: Record<string, unknown>, options: { authMode: "userPool" }): Promise<{ errors?: unknown[] }>;
    update(input: Record<string, unknown>, options: { authMode: "userPool" }): Promise<{ errors?: unknown[] }>;
  };
  const current = await model.get({ id: String(record.id) }, { authMode: "userPool" });
  assertNoGraphQLErrors(current.errors);

  const response = current.data
    ? await model.update(record, { authMode: "userPool" })
    : await model.create(record, { authMode: "userPool" });
  assertNoGraphQLErrors(response.errors);
}

function orderArticles(source: Article[], articleOrder: string[]): Article[] {
  return [...source].sort((left, right) => {
    const leftIndex = articleOrder.indexOf(left.slug);
    const rightIndex = articleOrder.indexOf(right.slug);
    const leftRank = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const rightRank = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
    return leftRank - rightRank || left.slug.localeCompare(right.slug);
  });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function getImageExtension(contentType: string, src: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("svg")) return "svg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";

  const match = new URL(src, "file:///").pathname.match(/\.([a-z0-9]+)$/i);
  return match?.[1] ?? "jpg";
}

function getContentTypeFromFilename(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/jpeg";
}

function isExpectedExistingUserError(error: unknown): boolean {
  const text = `${(error as { name?: string }).name ?? ""} ${(error as { message?: string }).message ?? ""}`;
  return text.includes("UsernameExists") || text.includes("already exists");
}

function assertNoGraphQLErrors(errors: unknown[] | null | undefined): void {
  if (!errors?.length) return;
  throw new Error(`Amplify seed GraphQL request failed: ${JSON.stringify(errors)}`);
}

function toAwsJson(value: unknown): string {
  return JSON.stringify(value);
}

function withVersionFields<T extends Record<string, unknown>>(
  record: T,
  options: {
    lineageId: string;
    versionCreatedAt: string;
    versionCreatedBy: string;
    changeReason: string;
  },
): T & {
  lineageId: string;
  versionNumber: number;
  previousVersionId: null;
  versionState: string;
  versionCreatedAt: string;
  versionCreatedBy: string;
  changeReason: string;
  contentHash: string;
} {
  const versioned = {
    ...record,
    lineageId: options.lineageId,
    versionNumber: 1,
    previousVersionId: null,
    versionState: "current",
    versionCreatedAt: options.versionCreatedAt,
    versionCreatedBy: options.versionCreatedBy,
    changeReason: options.changeReason,
  };
  return {
    ...versioned,
    contentHash: contentHashFor(versioned),
  };
}

function contentHashFor(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

function publishedEditionId(editionId: string): string {
  return `published-${editionId}`;
}

function publishedItemId(itemId: string): string {
  return `published-${itemId}`;
}

function getSeedEditionConfig() {
  const publishDate = "2026-05-13";
  return {
    id: "edition-current",
    slug: "current",
    title: "Current Edition",
    description: "Seeded Papyrus fixture content.",
    displayDate: editionDate,
    publishDate,
    publishedAt: `${publishDate}T12:00:00.000Z`,
    articleOrder: articles.map((article) => article.slug),
    layoutPlan: createSeedEditionLayoutPlan(articles.map((article) => article.slug)),
  };
}

function createSeedEditionLayoutPlan(itemIds: string[]) {
  const frontItemIds = itemIds.length < 3 ? itemIds : [itemIds[1], itemIds[0], itemIds[2], ...itemIds.slice(3)];
  return {
    pages: [
      {
        id: "page-1",
        pageNumber: 1,
        presetId: "front.mosaic",
        grid: { columns: { min: 1, preferred: 6, max: 6 } },
        regions: [
          {
            id: "front-page-news",
            type: "fullPage",
            localGrid: { columns: { min: 1, preferred: 6, max: 6 } },
            responsiveLayouts: getSeedFrontResponsiveLayouts(),
            blocks: frontItemIds.map((itemId, index) => ({
              id: `front-${itemId}`,
              type: "articleFrame",
              presetId: "front.teaser",
              itemId,
              flowKey: itemId,
              startCursor: "beginning",
              role: index === 1 ? "feature" : index === 0 || index === 2 ? "rail" : "standard",
              editorialPriority: index === 1 ? "primary" : index === 0 || index === 2 ? "secondary" : "tertiary",
              typography: { headlineScale: index === 1 ? "feature" : index === 0 || index === 2 ? "rail" : "standard" },
              span: { min: 1, preferred: [1, 4, 1, 2, 2, 2][index] ?? 1, max: [1, 4, 1, 2, 2, 2][index] ?? 1 },
              localGrid: index === 1 ? { columns: { min: 1, preferred: 4, max: 4 } } : undefined,
              media: index === 1
                ? [
                    {
                      required: true,
                      assetRole: "lead",
                      placement: {
                        anchor: "right",
                        span: { min: 1, preferred: 2, max: 2 },
                        vertical: "top",
                        collapse: "inline",
                        crop: "preserve",
                        wrapsText: true,
                      },
                    },
                  ]
                : [],
              composition: index === 1
                ? {
                    title: [
                      {
                        slot: "label",
                        placement: {
                          columnStart: 1,
                          span: { min: 1, preferred: 2, max: 2 },
                          vertical: "top",
                          collapse: "inline",
                          crop: "preserve",
                          wrapsText: false,
                        },
                      },
                      {
                        slot: "headline",
                        placement: {
                          columnStart: 1,
                          span: { min: 1, preferred: 2, max: 2 },
                          vertical: "top",
                          collapse: "inline",
                          crop: "preserve",
                          wrapsText: false,
                        },
                      },
                    ],
                    lead: [
                      {
                        slot: "deck",
                        placement: {
                          columnStart: 1,
                          span: { min: 1, preferred: 2, max: 2 },
                          vertical: "top",
                          collapse: "inline",
                          crop: "preserve",
                          wrapsText: true,
                        },
                      },
                      {
                        slot: "byline",
                        placement: {
                          columnStart: 1,
                          span: { min: 1, preferred: 2, max: 2 },
                          vertical: "top",
                          collapse: "inline",
                          crop: "preserve",
                          wrapsText: true,
                        },
                      },
                      {
                        slot: "media",
                        mediaIndex: 0,
                        placement: {
                          anchor: "right",
                          span: { min: 1, preferred: 2, max: 2 },
                          vertical: "top",
                          collapse: "inline",
                          crop: "preserve",
                          wrapsText: true,
                        },
                      },
                    ],
                  }
                : undefined,
              cutPolicy: getSeedCutPolicy(itemId),
            })),
          },
        ],
      },
      {
        id: "page-2",
        pageNumber: 2,
        presetId: "page.regionStack",
        grid: { columns: { min: 1, preferred: 6, max: 6 } },
        regions: [
          {
            id: "agent-procedure-patterns-continuation",
            type: "fullPage",
            size: { shrinkToContent: true },
            blocks: [
              createSeedContinuationBlock("agent-procedure-patterns", 2, {
                required: true,
                anchor: "center",
                span: { min: 1, preferred: 2, max: 3 },
                vertical: "upperThird",
              }),
            ],
          },
        ],
      },
      {
        id: "page-3",
        pageNumber: 3,
        presetId: "page.regionStack",
        grid: { columns: { min: 1, preferred: 6, max: 6 } },
        regions: [
          {
            id: "schools-reading-lab-tail",
            type: "stack",
            role: "top",
            size: { ratio: 0.5 },
            blocks: [
              createSeedContinuationBlock("schools-reading-lab", 3, {
                required: false,
                anchor: "right",
                span: { min: 1, preferred: 2, max: 2 },
                vertical: "top",
              }),
            ],
          },
          {
            id: "market-hall-tail",
            type: "stack",
            role: "bottom",
            size: { ratio: 0.5 },
            blocks: [
              createSeedContinuationBlock("market-hall", 3, {
                required: false,
                anchor: "center",
                span: { min: 2, preferred: 2, max: 2 },
                vertical: "top",
              }),
            ],
          },
        ],
      },
    ],
  };
}

function getSeedFrontResponsiveLayouts() {
  return [
    {
      minColumns: 4,
      maxColumns: 4,
      order: "editorialPriority",
      slots: [
        {
          editorialPriority: "primary",
          priorityOccurrence: 1,
          columnStart: 1,
          columnSpan: 4,
          rowStart: 1,
          rowSpan: 1,
        },
        {
          editorialPriority: "secondary",
          priorityOccurrence: 1,
          columnStart: 1,
          columnSpan: 2,
          rowStart: 2,
          rowSpan: 1,
        },
        {
          editorialPriority: "secondary",
          priorityOccurrence: 2,
          columnStart: 3,
          columnSpan: 2,
          rowStart: 2,
          rowSpan: 1,
        },
      ],
      overflow: { columnSpan: 2, rowSpan: 1 },
    },
    {
      minColumns: 1,
      maxColumns: 3,
      order: "editorialPriority",
      slots: [],
      overflow: { columnSpan: "full", rowSpan: 1 },
    },
  ];
}

function createSeedContinuationBlock(
  itemId: string,
  pageNumber: number,
  media: {
    required: boolean;
    anchor: string;
    span: { min: number; preferred: number; max: number };
    vertical: string;
  },
) {
  return {
    id: `${itemId}-page-${pageNumber}`,
    type: "articleFrame",
    presetId: "article.mediaInset",
    itemId,
    flowKey: itemId,
    startCursor: "current",
    role: "primary",
    localGrid: { columns: { min: 2, preferred: 6, max: 6 } },
    media: [
      {
        required: media.required,
        assetRole: "continuationInset",
        placement: {
          anchor: media.anchor,
          span: media.span,
          vertical: media.vertical,
          collapse: "inline",
          crop: "preserve",
          wrapsText: true,
        },
      },
    ],
    pullQuote: {
      required: false,
      placements: [
        {
          anchor: media.anchor === "left" ? "right" : "left",
          span: { min: 1, preferred: 1, max: 2 },
          vertical: "middle",
          collapse: "omit",
          crop: "preserve",
          wrapsText: true,
        },
      ],
    },
  };
}

function getSeedCutPolicy(itemId: string) {
  if (itemId === "agent-procedure-patterns") return { maxBodyLines: 22, jumpTargetPage: 2 };
  if (itemId === "schools-reading-lab") return { maxBodyLines: 16, jumpTargetPage: 3 };
  if (itemId === "market-hall") return { maxBodyLines: 14, jumpTargetPage: 3 };
  return undefined;
}

await main();
