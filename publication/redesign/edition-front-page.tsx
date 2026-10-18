import Link from "next/link";
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

function EditionHero({ model }: { model: EditionFrontPageModel }) {
  const leadArticle = model.editionLeadArticle;
  const leadDesk = model.editionLeadDesk;
  if (!leadArticle || !leadDesk) return null;
  return (
    <section aria-labelledby="ti-edition-hero-headline" className="ti-edition-hero" id="edition-lead">
      <div className="ti-edition-hero__copy">
        <p className="ti-kicker">
          <span className="ti-kicker__signal">Edition · {model.longEditionDateLabel}</span>
          <span>
            {leadDesk.numberLabel} {leadDesk.name} · Lead article
          </span>
        </p>
        <h2 className="ti-edition-hero__headline" id="ti-edition-hero-headline">
          <Link href={leadArticle.href}>{leadArticle.headline}</Link>
        </h2>
        <p className="ti-edition-hero__dek">{leadArticle.deck}</p>
        <div className="ti-edition-hero__actions">
          <Link className="ti-primary-button" href={leadArticle.href}>
            Read the article
            <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 16 16" width="16">
              <path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          {model.editionHasVideo ? (
            <Link className="ti-secondary-button" href={`${leadArticle.href}#video-edition`}>
              <PlayIcon />
              Watch the video edition
            </Link>
          ) : null}
        </div>
      </div>
      <AnimatedPictogramFigure
        accessibleDescription={leadArticle.figure.alt}
        caption={leadArticle.figure.caption}
        className="ti-edition-hero__figure"
        fallbackImageSource={leadArticle.figure.src}
        figureNumberLabel={leadDesk.numberLabel}
        pictogramSlug={leadArticle.figure.pictogramSlug}
        priority
      />
    </section>
  );
}

function InThisEdition({ model }: { model: EditionFrontPageModel }) {
  if (model.desks.length === 0) return null;
  return (
    <section aria-labelledby="ti-in-this-edition" className="ti-in-this-edition">
      <h2 className="ti-section-label" id="ti-in-this-edition">
        In this edition · {model.editionSummaryLabel}
      </h2>
      <ul className="ti-desk-tiles">
        {model.desks.map((desk) => (
          <li key={desk.key}>
            <Link
              className="ti-desk-tile"
              href={desk.containsEditionLead && desk.articlesAfterLead.length === 0 ? "#edition-lead" : `#${desk.anchorId}`}
            >
              <span className="ti-desk-tile__meta">
                <span className="ti-desk-tile__number">{desk.numberLabel}</span>
                <span className="ti-desk-tile__name">{desk.name}</span>
              </span>
              <span className="ti-desk-tile__headline">{desk.leadArticle.headline}</span>
            </Link>
          </li>
        ))}
      </ul>
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

function LatestPostsBand({ posts }: { posts: FrontPagePost[] }) {
  if (posts.length === 0) return null;
  return (
    <section aria-labelledby="ti-latest-posts" className="ti-latest-posts">
      <div className="ti-band-heading">
        <h2 className="ti-band-heading__title" id="ti-latest-posts">
          <span aria-hidden="true" className="ti-signal-dot" />
          Latest posts
        </h2>
        <Link className="ti-text-link" href="/posts">
          All posts <ArrowIcon />
        </Link>
      </div>
      <ul className="ti-post-cards">
        {posts.map((post) => (
          <li key={post.slug}>
            <Link className="ti-post-card" href={post.href}>
              <PostImage post={post} shape="post-image" />
              <span className="ti-post-card__body">
                <PostMetaLine post={post} />
                <span className="ti-post-card__headline">{post.headline}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ArticleCard({ article }: { article: FrontPageArticle }) {
  return (
    <li>
      <article className="ti-article-card">
        <p className="ti-article-card__number">{article.numberLabel} · Article</p>
        <h4 className="ti-article-card__headline">
          <Link href={article.href}>{article.headline}</Link>
        </h4>
        <p className="ti-article-card__dek">{article.deck}</p>
        <Link aria-label={`Read article: ${article.headline}`} className="ti-text-link ti-article-card__read" href={article.href}>
          Read article <ArrowIcon />
        </Link>
      </article>
    </li>
  );
}

function DeskSection({ desk }: { desk: FrontPageDesk }) {
  const showsLeadArticle = !desk.containsEditionLead;
  const cardArticles = desk.articlesAfterLead;
  if (!showsLeadArticle && cardArticles.length === 0) return null;
  return (
    <section aria-labelledby={`${desk.anchorId}-title`} className="ti-desk-section" id={desk.anchorId}>
      <div className="ti-desk-section__label">
        <p className="ti-desk-section__number">{desk.numberLabel}</p>
        <h3 className="ti-desk-section__name" id={`${desk.anchorId}-title`}>
          {desk.name}
        </h3>
        <p className="ti-desk-section__count">{desk.containsEditionLead ? "Also from this desk" : desk.articleCountLabel}</p>
      </div>
      <div className="ti-desk-section__content">
        {showsLeadArticle ? (
          <div className="ti-desk-lead">
            <AnimatedPictogramFigure
              accessibleDescription={desk.leadArticle.figure.alt}
              caption={desk.leadArticle.figure.caption}
              className="ti-desk-lead__figure"
              fallbackImageSource={desk.leadArticle.figure.src}
              figureNumberLabel={desk.numberLabel}
              pictogramSlug={desk.leadArticle.figure.pictogramSlug}
            />
            <div className="ti-desk-lead__copy">
              <p className="ti-article-card__number">{desk.leadArticle.numberLabel} · Lead article</p>
              <h4 className="ti-desk-lead__headline">
                <Link href={desk.leadArticle.href}>{desk.leadArticle.headline}</Link>
              </h4>
              <p className="ti-desk-lead__dek">{desk.leadArticle.deck}</p>
              <Link aria-label={`Read article: ${desk.leadArticle.headline}`} className="ti-text-link" href={desk.leadArticle.href}>
                Read article <ArrowIcon />
              </Link>
            </div>
          </div>
        ) : null}
        {cardArticles.length > 0 ? (
          <ul className="ti-article-cards">
            {cardArticles.map((article) => (
              <ArticleCard article={article} key={article.slug} />
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function PostInset({ inset }: { inset: FrontPagePostInset }) {
  const featuredPost = inset.featuredPost;
  return (
    <aside aria-label="Posts between desks" className="ti-post-inset">
      <Link className="ti-post-inset__featured" href={featuredPost.href}>
        <PostImage post={featuredPost} shape="post-image" />
        <span className="ti-post-inset__featured-copy">
          <PostMetaLine post={featuredPost} />
          <span className="ti-post-inset__headline">{featuredPost.headline}</span>
          {featuredPost.summary ? <span className="ti-post-inset__summary">{featuredPost.summary}</span> : null}
          <span className="ti-text-link">
            Read post <ArrowIcon />
          </span>
        </span>
      </Link>
      {inset.thumbnailPosts.length > 0 ? (
        <ul className="ti-post-inset__thumbnails">
          {inset.thumbnailPosts.map((post) => (
            <li key={post.slug}>
              <Link className="ti-post-thumbnail-row" href={post.href}>
                <PostImage post={post} shape="thumbnail" />
                <span className="ti-post-thumbnail-row__copy">
                  <PostMetaLine compact post={post} />
                  <span className="ti-post-thumbnail-row__headline">{post.headline}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
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
    <section aria-labelledby="ti-more-posts" className="ti-desk-section ti-more-posts">
      <div className="ti-desk-section__label">
        <span aria-hidden="true" className="ti-signal-dot" />
        <h2 className="ti-desk-section__name" id="ti-more-posts">
          More posts
        </h2>
        <p className="ti-desk-section__count">Between editions</p>
      </div>
      <div className="ti-desk-section__content">
        <DatedPostList posts={posts} />
      </div>
    </section>
  );
}

export function EditionFrontPage({ model }: { model: EditionFrontPageModel }) {
  return (
    <>
      <MastheadWithOriginalWeb />
      <LatestPostsStrip posts={model.latestStripPosts} />
      <EditionHero model={model} />
      <InThisEdition model={model} />
      <LatestPostsBand posts={model.latestBandPosts} />
      {model.deskBlocks.map((block) =>
        block.kind === "desk" ? (
          <DeskSection desk={block.desk} key={block.desk.key} />
        ) : (
          <PostInset inset={block.inset} key={block.key} />
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
