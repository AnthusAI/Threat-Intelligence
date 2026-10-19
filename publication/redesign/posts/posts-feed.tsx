import Link from "next/link";
import { AnimatedPictogramPlate } from "../figures/animated-pictogram-plate";
import { MastheadWithOriginalWeb } from "../masthead-with-original-web";
import type { FrontPagePost } from "./post-feed-model";

function PostMetaLine({ post }: { post: FrontPagePost }) {
  return (
    <p className="ti-post-meta">
      <span className="ti-post-meta__type">Post</span>
      {post.deskName ? <span>{post.deskName}</span> : null}
      <time dateTime={post.publishedAt}>{post.relativeTimeLabel}</time>
    </p>
  );
}

function ShowcasePostList({ posts }: { posts: FrontPagePost[] }) {
  return (
    <ul className="ti-showcase-posts">
      {posts.map((post) => (
        <li key={post.slug}>
          <Link className="ti-showcase-post" href={post.href}>
            <AnimatedPictogramPlate
              accessibleDescription={post.image?.alt ?? post.headline}
              fallbackImageSource={post.image?.src}
              pictogramSlug={post.image?.pictogramSlug}
              shape="post-image"
            />
            <PostMetaLine post={post} />
            <span className="ti-showcase-post__headline">{post.headline}</span>
            {post.summary ? <span className="ti-showcase-post__summary">{post.summary}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function DatedPostList({ posts }: { posts: FrontPagePost[] }) {
  return (
    <ul className="ti-dated-posts">
      {posts.map((post) => (
        <li key={post.slug}>
          <Link className="ti-dated-post" href={post.href}>
            <time className="ti-dated-post__date" dateTime={post.publishedAt}>
              {post.dateLabel}
            </time>
            <span className="ti-dated-post__copy">
              <span className="ti-dated-post__headline">{post.headline}</span>
              {post.deskName ? <span className="ti-dated-post__desk">{post.deskName}</span> : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function PostsFeed({ showcasePosts, earlierPosts }: { showcasePosts: FrontPagePost[]; earlierPosts: FrontPagePost[] }) {
  return (
    <>
      <MastheadWithOriginalWeb />
      {showcasePosts.length === 0 ? (
        <p className="ti-empty-state">No posts have been published yet.</p>
      ) : (
        <section aria-labelledby="ti-latest-posts" className="ti-hero-band">
          <h2 className="ti-hero-band__heading" id="ti-latest-posts">
            <span aria-hidden="true" className="ti-signal-dot" />
            <span className="ti-hero-band__name">Latest posts</span>
          </h2>
          <ShowcasePostList posts={showcasePosts} />
        </section>
      )}
      {earlierPosts.length > 0 ? (
        <section aria-labelledby="ti-earlier-posts" className="ti-hero-band ti-more-posts">
          <h2 className="ti-hero-band__heading" id="ti-earlier-posts">
            <span aria-hidden="true" className="ti-signal-dot" />
            <span className="ti-hero-band__name">Earlier posts</span>
          </h2>
          <DatedPostList posts={earlierPosts} />
        </section>
      ) : null}
    </>
  );
}
