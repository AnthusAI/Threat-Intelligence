import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createPostHref, formatPostDateLabel, formatPostRelativeTimeLabel, type FrontPagePost } from "../edition-front-page-model";
import { DatedPostList } from "../edition-front-page";
import { loadLatestEditionNavigation } from "../edition-navigation";
import { AnimatedPictogramPlate } from "../figures/animated-pictogram-plate";
import { loadNewestPublishedPosts, loadPublishedPostBySlug, type PublishedPost } from "../posts/published-post-repository";
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

function toFrontPagePost(post: PublishedPost, now: Date): FrontPagePost {
  return {
    ...post,
    href: createPostHref(post.slug),
    relativeTimeLabel: formatPostRelativeTimeLabel(post.publishedAt, now),
    dateLabel: formatPostDateLabel(post.publishedAt),
  };
}

export const POSTS_INDEX_METADATA: Metadata = {
  title: `Posts | ${PUBLICATION_NAME}`,
  description: `Short, frequent notes between editions. ${PUBLICATION_TAGLINE}`,
};

export async function PostsIndexRoute() {
  const [navigation, posts] = await Promise.all([loadLatestEditionNavigation(), loadNewestPublishedPosts(100)]);
  const now = new Date();
  const frontPagePosts = posts.map((post) => toFrontPagePost(post, now));
  return (
    <ReaderSiteShell deskLinks={navigation?.deskLinks ?? []}>
      <section aria-labelledby="ti-posts-title" className="ti-page-intro">
        <p className="ti-kicker">
          <span className="ti-kicker__signal">Posts</span>
          <span>Between editions</span>
        </p>
        <h1 className="ti-page-intro__title" id="ti-posts-title">
          Posts
        </h1>
        <p className="ti-page-intro__dek">Short, frequent notes from the desks, published between editions.</p>
      </section>
      {frontPagePosts.length === 0 ? (
        <p className="ti-empty-state">No posts have been published yet. The latest edition is on the front page.</p>
      ) : (
        <section aria-label="All posts" className="ti-posts-index">
          <DatedPostList posts={frontPagePosts} />
        </section>
      )}
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
  const [navigation, post] = await Promise.all([loadLatestEditionNavigation(), loadPublishedPostBySlug(postSlug)]);
  if (!post) notFound();
  const frontPagePost = toFrontPagePost(post, new Date());
  return (
    <ReaderSiteShell deskLinks={navigation?.deskLinks ?? []}>
      <article className="ti-article ti-post">
        <header className="ti-article__header">
          <p className="ti-kicker">
            <Link className="ti-kicker__signal" href="/posts">
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
        <Link className="ti-secondary-button" href="/posts">
          All posts
        </Link>
      </p>
    </ReaderSiteShell>
  );
}
