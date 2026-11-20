import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadNewestPublishedPosts, loadPublishedPostBySlug } from "../posts/published-post-repository";
import { splitPostsForFeed, toFrontPagePost } from "../posts/post-feed-model";
import { PostsFeed } from "../posts/posts-feed";
import { AnimatedPictogramPlate } from "../figures/animated-pictogram-plate";
import { PUBLICATION_NAME, PUBLICATION_TAGLINE } from "../publication-identity";
import { ReaderSiteShell } from "../reader-site-shell";

const PRODUCTION_SITE_ORIGIN = "https://threat-intelligence.anth.us";
const POST_IMAGE_MASTER_WIDTH = 1200;
const POST_IMAGE_MASTER_HEIGHT = 630;

function resolveSiteOrigin(): URL {
  const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.PAPYRUS_SITE_URL?.trim();
  try {
    return new URL(configuredOrigin || PRODUCTION_SITE_ORIGIN);
  } catch {
    return new URL(PRODUCTION_SITE_ORIGIN);
  }
}

export const POSTS_FEED_METADATA: Metadata = {
  title: PUBLICATION_NAME,
  description: PUBLICATION_TAGLINE,
};

export async function PostsFeedRoute() {
  const posts = await loadNewestPublishedPosts(100);
  const { showcasePosts, earlierPosts } = splitPostsForFeed(posts, new Date());
  return (
    <ReaderSiteShell>
      <PostsFeed earlierPosts={earlierPosts} showcasePosts={showcasePosts} />
    </ReaderSiteShell>
  );
}

export async function generatePostMetadata(postSlug: string): Promise<Metadata> {
  const post = await loadPublishedPostBySlug(postSlug);
  if (!post) return {};
  const masterImage = post.image?.src
    ? [
        {
          url: post.image.src,
          width: post.image.width ?? POST_IMAGE_MASTER_WIDTH,
          height: post.image.height ?? POST_IMAGE_MASTER_HEIGHT,
          alt: post.image.alt,
        },
      ]
    : undefined;
  return {
    metadataBase: resolveSiteOrigin(),
    title: `${post.headline} | ${PUBLICATION_NAME}`,
    description: post.summary,
    openGraph: {
      type: "article",
      title: post.headline,
      description: post.summary,
      publishedTime: post.publishedAt,
      images: masterImage,
    },
    twitter: {
      card: masterImage ? "summary_large_image" : "summary",
      title: post.headline,
      description: post.summary,
      images: masterImage?.map((image) => image.url),
    },
  };
}

export async function PostDetailRoute({ postSlug }: { postSlug: string }) {
  const post = await loadPublishedPostBySlug(postSlug);
  if (!post) notFound();
  const frontPagePost = toFrontPagePost(post, new Date());
  return (
    <ReaderSiteShell>
      <article className="ti-article ti-post">
        <header className="ti-article__header">
          <p className="ti-kicker">
            <Link className="ti-kicker__signal" href="/">
              Post
            </Link>
            {post.deskName ? <span>{post.deskName}</span> : null}
            <time dateTime={post.publishedAt}>{frontPagePost.dateLabel}</time>
          </p>
          <h1 className="ti-article__headline ti-post__headline">{post.headline}</h1>
          {post.summary ? <p className="ti-article__dek">{post.summary}</p> : null}
        </header>
        {post.image ? (
          <div className="ti-article__figure ti-post__image">
            <AnimatedPictogramPlate
              accessibleDescription={post.image.alt}
              fallbackImageSource={post.image.src}
              pictogramSlug={post.image.pictogramSlug}
              priority
              shape="post-image"
            />
          </div>
        ) : null}
        <div className="ti-article__body">
          {post.body.map((paragraph, paragraphIndex) => (
            <p key={`${paragraphIndex}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
          ))}
        </div>
      </article>
      <p className="ti-article__back">
        <Link className="ti-secondary-button" href="/">
          Back to the feed
        </Link>
      </p>
    </ReaderSiteShell>
  );
}
