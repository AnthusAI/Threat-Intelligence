import Link from "next/link";
import type { ReactNode } from "react";
import type {
  EditionFrontPageModel,
  FrontPageArticle,
  FrontPageDesk,
  FrontPagePost,
  FrontPagePostInset,
} from "./edition-front-page-model";
import { capitalizeFirstLetter } from "./edition-front-page-model";
import { AnimatedPictogramFigure, AnimatedPictogramPlate } from "./figures/animated-pictogram-plate";
import { MastheadWithOriginalWeb } from "./masthead-with-original-web";

export function ArrowIcon() {
  return (
    <svg aria-hidden="true" className="ti-arrow-icon s-signal" fill="none" height="14" strokeWidth="1.75" viewBox="0 0 16 16" width="14">
      <path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg aria-hidden="true" className="f-signal" height="14" viewBox="0 0 16 16" width="14">
      <path d="M4.5 3.2v9.6L12.5 8z" />
    </svg>
  );
}

function LatestPostsStrip({ posts }: { posts: FrontPagePost[] }) {
  if (posts.length === 0) return null;
  return (
    <section aria-label="Latest posts" className="ti-latest-strip">
      <p className="ti-latest-strip__label">
        <span aria-hidden="true" className="ti-signal-dot" />
        Latest
      </p>
      <ol className="ti-latest-strip__items">
        {posts.map((post) => (
          <li className="ti-latest-strip__item" key={post.slug}>
            <Link className="ti-latest-strip__link" href={post.href}>
              <time className="ti-latest-strip__time" dateTime={post.publishedAt}>
                {post.relativeTimeLabel}
              </time>
              <span className="ti-latest-strip__headline">{post.headline}</span>
            </Link>
          </li>
        ))}
        <li className="ti-latest-strip__item ti-latest-strip__item--all">
          <Link className="ti-latest-strip__link ti-latest-strip__all" href="/posts">
            All posts <ArrowIcon />
          </Link>
        </li>
      </ol>
    </section>
  );
}

function PostMetaLine({ post, compact = false }: { post: FrontPagePost; compact?: boolean }) {
  return (
    <p className="ti-post-meta">
      <span className={compact ? undefined : "ti-post-meta__type"}>Post</span>
      {!compact && post.deskName ? <span>{post.deskName}</span> : null}
      {compact ? <span aria-hidden="true">·</span> : null}
      <time dateTime={post.publishedAt}>{post.relativeTimeLabel}</time>
    </p>
  );
}

function PostImage({ post, shape }: { post: FrontPagePost; shape: "post-image" | "thumbnail" }) {
  return (
    <AnimatedPictogramPlate
      accessibleDescription={post.image?.alt ?? post.headline}
      fallbackImageSource={post.image?.src}
      pictogramSlug={post.image?.pictogramSlug}
      shape={shape}
    />
  );
}

function ShowcasePostList({ posts }: { posts: FrontPagePost[] }) {
  return (
    <ul className="ti-showcase-posts">
      {posts.map((post) => (
        <li key={post.slug}>
          <Link className="ti-showcase-post" href={post.href}>
            <PostImage post={post} shape="post-image" />
            <PostMetaLine post={post} />
            <span className="ti-showcase-post__headline">{post.headline}</span>
            {post.summary ? <span className="ti-showcase-post__summary">{post.summary}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function LatestPostsShowcase({ posts }: { posts: FrontPagePost[] }) {
  if (posts.length === 0) return null;
  return (
    <section aria-labelledby="ti-latest-posts" className="ti-hero-band">
      <h2 className="ti-hero-band__heading" id="ti-latest-posts">
        <span aria-hidden="true" className="ti-signal-dot" />
        <span className="ti-hero-band__name">Latest posts</span>
        <Link className="ti-hero-band__link" href="/posts">
          All posts <ArrowIcon />
        </Link>
      </h2>
      <ShowcasePostList posts={posts} />
    </section>
  );
}

function HeroStory({
  article,
  kicker,
  headingLevel,
  headlineIdentifier,
  figureNumberLabel,
  isEditionLead,
  readLinkLabel,
  videoHref,
}: {
  article: FrontPageArticle;
  kicker: ReactNode;
  headingLevel: "h2" | "h3";
  headlineIdentifier?: string;
  figureNumberLabel: string;
  isEditionLead: boolean;
  readLinkLabel: string;
  videoHref?: string;
}) {
  const HeadlineElement = headingLevel;
  return (
    <article
      aria-labelledby={headlineIdentifier}
      className={isEditionLead ? "ti-hero-story ti-hero-story--edition-lead" : "ti-hero-story"}
      id={isEditionLead ? "edition-lead" : undefined}
    >
      <div className="ti-hero-story__heading">
        <p className="ti-kicker">{kicker}</p>
        <HeadlineElement className="ti-hero-story__headline" id={headlineIdentifier}>
          <Link href={article.href}>{article.headline}</Link>
        </HeadlineElement>
        <p className="ti-hero-story__dek">{article.deck}</p>
      </div>
      <AnimatedPictogramFigure
        accessibleDescription={article.figure.alt}
        caption={article.figure.caption}
        className="ti-hero-story__figure"
        fallbackImageSource={article.figure.src}
        figureNumberLabel={figureNumberLabel}
        pictogramSlug={article.figure.pictogramSlug}
        priority={isEditionLead}
      />
      <div className="ti-hero-story__reading">
        {article.openingParagraph ? <p className="ti-hero-story__opening">{article.openingParagraph}</p> : null}
        <p className="ti-hero-story__actions">
          <Link className="ti-hero-story__read" href={article.href}>
            {readLinkLabel} <ArrowIcon />
          </Link>
          {videoHref ? (
            <Link className="ti-hero-story__secondary" href={videoHref}>
              <PlayIcon />
              Watch the video edition
            </Link>
          ) : null}
        </p>
      </div>
    </article>
  );
}

function EditionLeadHero({ model }: { model: EditionFrontPageModel }) {
  const leadArticle = model.editionLeadArticle;
  const leadDesk = model.editionLeadDesk;
  if (!leadArticle || !leadDesk) return null;
  return (
    <HeroStory
      article={leadArticle}
      figureNumberLabel={leadDesk.numberLabel}
      headingLevel="h2"
      headlineIdentifier="ti-edition-lead-headline"
      isEditionLead
      kicker={
        <>
          <span className="ti-kicker__signal">Edition · {model.longEditionDateLabel}</span>
          <span>
            {leadDesk.numberLabel} {leadDesk.name} · Lead article
          </span>
        </>
      }
      readLinkLabel="Read the article"
      videoHref={model.editionHasVideo ? `${leadArticle.href}#video-edition` : undefined}
    />
  );
}

function DeskFollowingStory({ article }: { article: FrontPageArticle }) {
  return (
    <li>
      <article className="ti-following-story">
        <p className="ti-following-story__number">{article.numberLabel}</p>
        <h4 className="ti-following-story__headline">
          <Link href={article.href}>{article.headline}</Link>
        </h4>
        <p className="ti-following-story__dek">{article.deck}</p>
        <Link aria-label={`Read article: ${article.headline}`} className="ti-hero-story__read" href={article.href}>
          Read article <ArrowIcon />
        </Link>
      </article>
    </li>
  );
}

function DeskHeroBand({ desk }: { desk: FrontPageDesk }) {
  const showsLeadArticle = !desk.containsEditionLead;
  const followingArticles = desk.articlesAfterLead;
  if (!showsLeadArticle && followingArticles.length === 0) return null;
  return (
    <section aria-labelledby={`${desk.anchorId}-title`} className="ti-hero-band" id={desk.anchorId}>
      <h2 className="ti-hero-band__heading" id={`${desk.anchorId}-title`}>
        <span className="ti-hero-band__number">{desk.numberLabel}</span>
        <span className="ti-hero-band__name">{desk.name}</span>
        <span className="ti-hero-band__count">{desk.containsEditionLead ? "Also from this desk" : desk.articleCountLabel}</span>
      </h2>
      {showsLeadArticle ? (
        <HeroStory
          article={desk.leadArticle}
          figureNumberLabel={desk.numberLabel}
          headingLevel="h3"
          isEditionLead={false}
          kicker={<span>{desk.leadArticle.numberLabel} · Lead article</span>}
          readLinkLabel="Read article"
        />
      ) : null}
      {followingArticles.length > 0 ? (
        <ul className="ti-following-stories">
          {followingArticles.map((article) => (
            <DeskFollowingStory article={article} key={article.slug} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function PostHeroBand({ inset }: { inset: FrontPagePostInset }) {
  return (
    <aside aria-label="Posts" className="ti-hero-band">
      <p className="ti-hero-band__heading">
        <span aria-hidden="true" className="ti-signal-dot" />
        <span className="ti-hero-band__name">Posts</span>
        <span className="ti-hero-band__count">Between editions</span>
      </p>
      <ShowcasePostList posts={[inset.featuredPost, ...inset.thumbnailPosts]} />
    </aside>
  );
}

export function DatedPostList({ posts }: { posts: FrontPagePost[] }) {
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

function MorePosts({ posts }: { posts: FrontPagePost[] }) {
  if (posts.length === 0) return null;
  return (
    <section aria-labelledby="ti-more-posts" className="ti-hero-band ti-more-posts">
      <h2 className="ti-hero-band__heading" id="ti-more-posts">
        <span aria-hidden="true" className="ti-signal-dot" />
        <span className="ti-hero-band__name">More posts</span>
        <span className="ti-hero-band__count">Between editions</span>
      </h2>
      <DatedPostList posts={posts} />
    </section>
  );
}

export function EditionFrontPage({ model }: { model: EditionFrontPageModel }) {
  return (
    <>
      <MastheadWithOriginalWeb />
      <LatestPostsStrip posts={model.latestStripPosts} />
      <EditionLeadHero model={model} />
      <LatestPostsShowcase posts={model.latestBandPosts} />
      {model.deskBlocks.map((block) =>
        block.kind === "desk" ? (
          <DeskHeroBand desk={block.desk} key={block.desk.key} />
        ) : (
          <PostHeroBand inset={block.inset} key={block.key} />
        ),
      )}
      <MorePosts posts={model.morePosts} />
    </>
  );
}

export function describeEditionFooterLine(model: EditionFrontPageModel): { left: string; right: string } {
  return {
    left: `Edition ${model.compactEditionDateLabel}`,
    right: capitalizeFirstLetter(model.editionSummaryLabel),
  };
}
