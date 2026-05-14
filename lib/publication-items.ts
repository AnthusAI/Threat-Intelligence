import {
  type Article,
  type ArticleAsset,
  type ArticleImage,
  type ArticleImageAsset,
  getArticleImageAssets,
  getArticleText,
} from "./articles";

export type PublicationItemType = "article" | "brief" | "correction" | "promo" | "ad" | "sectionHeader";

export type ArticlePublicationItem = Article & {
  type: "article";
};

export type NonArticlePublicationItem = {
  type: Exclude<PublicationItemType, "article">;
  slug: string;
  section?: string;
  title: string;
  deck?: string;
  body?: string[];
  image?: ArticleImage;
  assets?: ArticleAsset[];
  href?: string;
  metadata?: Record<string, unknown>;
};

export type PublicationItem = ArticlePublicationItem | NonArticlePublicationItem;

export function articleToPublicationItem(article: Article): ArticlePublicationItem {
  return {
    ...cloneArticle(article),
    type: "article",
  };
}

export function publicationItemToArticle(item: PublicationItem): Article | undefined {
  if (item.type !== "article") return undefined;
  const { type: _type, ...article } = item;
  return cloneArticle(article);
}

export function getArticlePublicationItems(items: PublicationItem[]): ArticlePublicationItem[] {
  return items.filter((item): item is ArticlePublicationItem => item.type === "article");
}

export function getPublicationItemText(item: PublicationItem): string {
  if (item.type === "article") return getArticleText(item);
  return [item.title, item.deck, ...(item.body ?? [])].filter(Boolean).join("\n\n");
}

export function getPublicationItemImageAssets(item: PublicationItem): ArticleImageAsset[] {
  if (item.type === "article") return getArticleImageAssets(item);
  const explicitAssets = item.assets?.filter((asset): asset is ArticleImageAsset => asset.type === "image") ?? [];
  if (explicitAssets.length > 0) return explicitAssets;
  if (!item.image) return [];
  return [
    {
      ...item.image,
      id: `${item.slug}-primary-image`,
      type: "image",
      roles: ["feature"],
    },
  ];
}

export function clonePublicationItems(items: PublicationItem[]): PublicationItem[] {
  return items.map((item) => (item.type === "article" ? articleToPublicationItem(item) : cloneNonArticleItem(item)));
}

export function cloneArticle(article: Article): Article {
  return {
    ...article,
    image: {
      ...article.image,
      layout: article.image.layout ? { ...article.image.layout } : undefined,
    },
    assets: article.assets?.map((asset) => ({
      ...asset,
      layout: asset.layout ? { ...asset.layout } : undefined,
      roles: asset.roles ? [...asset.roles] : undefined,
    })),
    pullQuotes: article.pullQuotes ? [...article.pullQuotes] : undefined,
    body: [...article.body],
  };
}

function cloneNonArticleItem(item: NonArticlePublicationItem): NonArticlePublicationItem {
  return {
    ...item,
    image: item.image
      ? {
          ...item.image,
          layout: item.image.layout ? { ...item.image.layout } : undefined,
        }
      : undefined,
    assets: item.assets?.map((asset) => ({
      ...asset,
      layout: asset.layout ? { ...asset.layout } : undefined,
      roles: asset.roles ? [...asset.roles] : undefined,
    })),
    body: item.body ? [...item.body] : undefined,
    metadata: item.metadata ? { ...item.metadata } : undefined,
  };
}
