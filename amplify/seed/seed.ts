import fs from "node:fs";
import path from "node:path";
import { addToUserGroup, createAndSignUpUser, signInUser } from "@aws-amplify/seed";
import { generateClient } from "aws-amplify/data";
import { signOut } from "aws-amplify/auth";
import { uploadData } from "aws-amplify/storage";
import type { Schema } from "../data/resource";
import { getArticleImageAssets, type Article, type ArticleImageAsset } from "../../lib/articles";
import { getAmplifyServerRuntime } from "../../lib/amplify-server-runtime";
import { loadMarkdownArticles } from "../../lib/markdown-content-repository";

const EDITION_ID = "edition-current";
const EDITION_SLUG = "current";
const EDITION_DATE = "2026-05-13";
const PUBLISHED_AT = "2026-05-13T12:00:00.000Z";
const EDITOR_GROUP = "editor";
const EDITION_ORDER = [
  "harbor-grid",
  "schools-reading-lab",
  "market-hall",
  "river-court",
  "night-trains",
  "climate-ledger",
];

const client = generateClient<Schema>({ authMode: "userPool" });

async function main() {
  getAmplifyServerRuntime();
  await signInSeedEditor();

  try {
    const articles = orderArticles(loadMarkdownArticles());
    await upsert("Edition", {
      id: EDITION_ID,
      slug: EDITION_SLUG,
      title: "Current Edition",
      status: "published",
      editionDate: EDITION_DATE,
      description: "Seeded Papyrus cloud edition from content/articles Markdown.",
      metadata: {
        source: "markdown-seed",
      },
    });

    for (const [index, article] of articles.entries()) {
      await seedArticle(article, index);
    }

    console.log(`Seeded ${articles.length} articles into Amplify Data and Storage.`);
  } finally {
    await signOut();
  }
}

async function signInSeedEditor() {
  const username = process.env.PAPYRUS_SEED_USERNAME ?? "papyrus-seed-editor";
  const password = process.env.PAPYRUS_SEED_PASSWORD ?? "PapyrusSeed1!";
  const email = process.env.PAPYRUS_SEED_EMAIL ?? "papyrus-seed-editor@example.com";

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

async function seedArticle(article: Article, index: number) {
  const itemId = `item-${article.slug}`;
  const sectionSlug = slugify(article.section);
  const tagId = `tag-${sectionSlug}`;
  const sortKey = `${String(index + 1).padStart(3, "0")}#${article.slug}`;

  await upsert("Item", {
    id: itemId,
    type: "article",
    status: "published",
    typeStatus: "article#published",
    slug: article.slug,
    section: article.section,
    sectionStatus: `${sectionSlug}#published`,
    title: article.headline,
    headline: article.headline,
    deck: article.deck,
    body: article.body,
    byline: article.byline,
    dateline: article.dateline,
    publishedAt: PUBLISHED_AT,
    editionDate: EDITION_DATE,
    sortTitle: article.headline,
    pullQuotes: article.pullQuotes ?? [],
    layout: {
      source: "markdown",
    },
    editorial: {},
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
    publishedAt: PUBLISHED_AT,
  });

  await upsert("EditionItem", {
    id: `edition-current-${article.slug}`,
    editionId: EDITION_ID,
    itemId,
    placementKey: `front:${index + 1}`,
    sortKey,
    pageNumber: 1,
    priority: index + 1,
    metadata: {},
  });

  const imageAssets = getArticleImageAssets(article);
  for (const [assetIndex, asset] of imageAssets.entries()) {
    const uploaded = await uploadSeedImage(article, asset, assetIndex);
    await upsert("MediaAsset", {
      id: `media-${article.slug}-${assetIndex}`,
      itemId,
      type: "image",
      role: (asset.roles ?? ["lead", "continuation", "continuationInset"]).join(","),
      sortKey: `${String(assetIndex + 1).padStart(3, "0")}#${asset.id}`,
      storagePath: uploaded.storagePath,
      externalUrl: asset.src,
      alt: asset.alt,
      caption: asset.credit,
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
      metadata: {
        sourceUrl: asset.src,
      },
    });
  }
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

  const filepath = path.isAbsolute(src) ? src : path.join(process.cwd(), src);
  return {
    data: fs.readFileSync(filepath),
    contentType: getContentTypeFromFilename(filepath),
  };
}

async function upsert(modelName: keyof typeof client.models, record: Record<string, unknown>) {
  const model = (client.models as Record<string, unknown>)[String(modelName)] as {
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

function orderArticles(articles: Article[]): Article[] {
  return [...articles].sort((left, right) => {
    const leftIndex = EDITION_ORDER.indexOf(left.slug);
    const rightIndex = EDITION_ORDER.indexOf(right.slug);
    return getOrderValue(leftIndex) - getOrderValue(rightIndex) || left.slug.localeCompare(right.slug);
  });
}

function getOrderValue(index: number): number {
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function getImageExtension(contentType: string, src: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";

  const match = new URL(src, "file:///").pathname.match(/\.([a-z0-9]+)$/i);
  return match?.[1] ?? "jpg";
}

function getContentTypeFromFilename(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".png") return "image/png";
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

await main();
