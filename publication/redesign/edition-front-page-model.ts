export type FrontPageSourceArticle = {
  type: "article";
  slug: string;
  section: string;
  headline: string;
  deck: string;
  image?: { alt: string; caption?: string; src?: string };
  video?: { src?: string } | null;
};

export type FrontPageSourceItem = FrontPageSourceArticle | { type: Exclude<string, "article">; slug: string };

export type FrontPageSourceSection = {
  key: string;
  label: string;
  itemIds: string[];
};

export type FrontPageSourceEdition = {
  editionDate: string;
  items: FrontPageSourceItem[];
  sections: FrontPageSourceSection[];
  editionVideo?: { src?: string } | null;
};

export type PublishedPostImage = {
  src?: string;
  alt: string;
  pictogramSlug?: string;
  width?: number;
  height?: number;
};

export type PublishedPostSummary = {
  slug: string;
  headline: string;
  summary?: string;
  deskName?: string;
  publishedAt: string;
  image?: PublishedPostImage;
};

export type FrontPageArticle = {
  slug: string;
  headline: string;
  deck: string;
  deskName: string;
  numberLabel: string;
  isDeskLead: boolean;
  href: string;
  figure: { pictogramSlug: string; alt: string; caption?: string; src?: string };
  hasVideo: boolean;
};

export type FrontPageDesk = {
  key: string;
  anchorId: string;
  number: number;
  numberLabel: string;
  name: string;
  articles: FrontPageArticle[];
  leadArticle: FrontPageArticle;
  articlesAfterLead: FrontPageArticle[];
  containsEditionLead: boolean;
  articleCountLabel: string;
};

export type FrontPagePost = PublishedPostSummary & {
  href: string;
  relativeTimeLabel: string;
  dateLabel: string;
};

export type FrontPagePostInset = {
  featuredPost: FrontPagePost;
  thumbnailPosts: FrontPagePost[];
};

export type FrontPageDeskBlock =
  | { kind: "desk"; desk: FrontPageDesk }
  | { kind: "post-inset"; key: string; inset: FrontPagePostInset };

export type EditionFrontPageModel = {
  editionDate: string;
  editionBasePath: string;
  longEditionDateLabel: string;
  compactEditionDateLabel: string;
  editionLeadArticle: FrontPageArticle | null;
  editionLeadDesk: FrontPageDesk | null;
  editionHasVideo: boolean;
  desks: FrontPageDesk[];
  deskBlocks: FrontPageDeskBlock[];
  editionSummaryLabel: string;
  latestStripPosts: FrontPagePost[];
  latestBandPosts: FrontPagePost[];
  morePosts: FrontPagePost[];
};

export const LATEST_STRIP_POST_COUNT = 4;
export const LATEST_BAND_POST_COUNT = 4;
export const POST_INSET_THUMBNAIL_COUNT = 3;
export const DESKS_BETWEEN_POST_INSETS = 3;
export const MORE_POSTS_COUNT = 6;

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];

export function describeCountInWords(count: number, singularNoun: string, pluralNoun: string): string {
  const countWord = NUMBER_WORDS[count] ?? String(count);
  return `${countWord} ${count === 1 ? singularNoun : pluralNoun}`;
}

export function capitalizeFirstLetter(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

export function createDeskAnchorId(deskKey: string): string {
  return `desk-${deskKey}`;
}

export function formatLongEditionDate(editionDate: string): string {
  const parsedDate = new Date(`${editionDate}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime())) return editionDate;
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parsedDate);
}

export function formatCompactEditionDate(editionDate: string): string {
  return editionDate.replace(/-/g, ".");
}

export function formatPostDateLabel(publishedAt: string): string {
  const parsedDate = new Date(publishedAt);
  if (Number.isNaN(parsedDate.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(parsedDate);
}

export function formatPostRelativeTimeLabel(publishedAt: string, now: Date): string {
  const parsedDate = new Date(publishedAt);
  if (Number.isNaN(parsedDate.getTime())) return "";
  const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - parsedDate.getTime()) / 60_000));
  if (elapsedMinutes < 1) return "Just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays}d ago`;
  return formatPostDateLabel(publishedAt);
}

export function createPostHref(postSlug: string): string {
  return `/posts/${encodeURIComponent(postSlug)}`;
}

function isFrontPageSourceArticle(item: FrontPageSourceItem): item is FrontPageSourceArticle {
  return item.type === "article";
}

function createFrontPageArticle(
  article: FrontPageSourceArticle,
  deskName: string,
  deskNumber: number,
  positionWithinDesk: number,
  editionBasePath: string,
): FrontPageArticle {
  return {
    slug: article.slug,
    headline: article.headline,
    deck: article.deck,
    deskName,
    numberLabel: `${deskNumber}.${positionWithinDesk + 1}`,
    isDeskLead: positionWithinDesk === 0,
    href: `${editionBasePath}/${encodeURIComponent(article.slug)}`,
    figure: {
      pictogramSlug: article.slug,
      alt: article.image?.alt ?? article.headline,
      caption: article.image?.caption,
      src: article.image?.src,
    },
    hasVideo: Boolean(article.video?.src),
  };
}

function createFrontPagePost(post: PublishedPostSummary, now: Date): FrontPagePost {
  return {
    ...post,
    href: createPostHref(post.slug),
    relativeTimeLabel: formatPostRelativeTimeLabel(post.publishedAt, now),
    dateLabel: formatPostDateLabel(post.publishedAt),
  };
}

export function sortPostsNewestFirst<Post extends { publishedAt: string }>(posts: Post[]): Post[] {
  return [...posts].sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
}

export function buildEditionDesks(edition: FrontPageSourceEdition, editionBasePath: string): FrontPageDesk[] {
  const articlesBySlug = new Map(
    edition.items.filter(isFrontPageSourceArticle).map((article) => [article.slug, article]),
  );
  const desks: FrontPageDesk[] = [];
  for (const section of edition.sections) {
    const sectionArticles = section.itemIds
      .map((itemId) => articlesBySlug.get(itemId))
      .filter((article): article is FrontPageSourceArticle => Boolean(article));
    if (sectionArticles.length === 0) continue;
    const deskNumber = desks.length + 1;
    const articles = sectionArticles.map((article, positionWithinDesk) =>
      createFrontPageArticle(article, section.label, deskNumber, positionWithinDesk, editionBasePath),
    );
    desks.push({
      key: section.key,
      anchorId: createDeskAnchorId(section.key),
      number: deskNumber,
      numberLabel: String(deskNumber).padStart(2, "0"),
      name: section.label,
      articles,
      leadArticle: articles[0],
      articlesAfterLead: articles.slice(1),
      containsEditionLead: deskNumber === 1,
      articleCountLabel: describeCountInWords(articles.length, "article", "articles"),
    });
  }
  return desks;
}

export function arrangeDeskBlocksWithPostInsets(
  desks: FrontPageDesk[],
  postsAvailableForInsets: FrontPagePost[],
): { deskBlocks: FrontPageDeskBlock[]; postsLeftAfterInsets: FrontPagePost[] } {
  const remainingPosts = [...postsAvailableForInsets];
  const deskBlocks: FrontPageDeskBlock[] = [];
  desks.forEach((desk, deskIndex) => {
    deskBlocks.push({ kind: "desk", desk });
    const deskPosition = deskIndex + 1;
    const isInsetPosition = deskPosition % DESKS_BETWEEN_POST_INSETS === 0;
    const isLastDesk = deskPosition === desks.length;
    if (!isInsetPosition || isLastDesk || remainingPosts.length === 0) return;
    const insetPosts = remainingPosts.splice(0, 1 + POST_INSET_THUMBNAIL_COUNT);
    deskBlocks.push({
      kind: "post-inset",
      key: `post-inset-after-${desk.key}`,
      inset: { featuredPost: insetPosts[0], thumbnailPosts: insetPosts.slice(1) },
    });
  });
  return { deskBlocks, postsLeftAfterInsets: remainingPosts };
}

export function buildEditionFrontPageModel({
  edition,
  editionBasePath,
  posts,
  now,
}: {
  edition: FrontPageSourceEdition;
  editionBasePath: string;
  posts: PublishedPostSummary[];
  now: Date;
}): EditionFrontPageModel {
  const desks = buildEditionDesks(edition, editionBasePath);
  const editionLeadDesk = desks[0] ?? null;
  const editionLeadArticle = editionLeadDesk?.leadArticle ?? null;
  const articleCount = desks.reduce((total, desk) => total + desk.articles.length, 0);

  const newestFirstPosts = sortPostsNewestFirst(posts).map((post) => createFrontPagePost(post, now));
  const latestStripPosts = newestFirstPosts.slice(0, LATEST_STRIP_POST_COUNT);
  const latestBandPosts = newestFirstPosts.slice(0, LATEST_BAND_POST_COUNT);
  const postsNotYetPlaced = newestFirstPosts.slice(LATEST_BAND_POST_COUNT);
  const { deskBlocks, postsLeftAfterInsets } = arrangeDeskBlocksWithPostInsets(desks, postsNotYetPlaced);

  return {
    editionDate: edition.editionDate,
    editionBasePath,
    longEditionDateLabel: formatLongEditionDate(edition.editionDate),
    compactEditionDateLabel: formatCompactEditionDate(edition.editionDate),
    editionLeadArticle,
    editionLeadDesk,
    editionHasVideo: Boolean(editionLeadArticle?.hasVideo || edition.editionVideo?.src),
    desks,
    deskBlocks,
    editionSummaryLabel: `${describeCountInWords(desks.length, "desk", "desks")} · ${describeCountInWords(articleCount, "article", "articles")}`,
    latestStripPosts,
    latestBandPosts,
    morePosts: postsLeftAfterInsets.slice(0, MORE_POSTS_COUNT),
  };
}
