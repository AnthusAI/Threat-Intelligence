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

export type FrontPagePost = PublishedPostSummary & {
  href: string;
  relativeTimeLabel: string;
  dateLabel: string;
};

export const SHOWCASE_POST_COUNT = 6;

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

export function sortPostsNewestFirst<Post extends { publishedAt: string }>(posts: Post[]): Post[] {
  return [...posts].sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
}

export function toFrontPagePost(post: PublishedPostSummary, now: Date): FrontPagePost {
  return {
    ...post,
    href: createPostHref(post.slug),
    relativeTimeLabel: formatPostRelativeTimeLabel(post.publishedAt, now),
    dateLabel: formatPostDateLabel(post.publishedAt),
  };
}

export function splitPostsForFeed(posts: PublishedPostSummary[], now: Date): { showcasePosts: FrontPagePost[]; earlierPosts: FrontPagePost[] } {
  const newestFirstPosts = sortPostsNewestFirst(posts).map((post) => toFrontPagePost(post, now));
  return {
    showcasePosts: newestFirstPosts.slice(0, SHOWCASE_POST_COUNT),
    earlierPosts: newestFirstPosts.slice(SHOWCASE_POST_COUNT),
  };
}
