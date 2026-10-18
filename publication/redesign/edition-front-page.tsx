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

function LatestPostsRail({ posts }: { posts: FrontPagePost[] }) {
  if (posts.length === 0) return null;
  return (
    <section aria-labelledby="ti-latest-posts" className="ti-front-lead__rail">
      <h2 className="ti-column-heading" id="ti-latest-posts">
        <span aria-hidden="true" className="ti-signal-dot" />
        <span className="ti-column-heading__name">Latest posts</span>
        <Link className="ti-column-heading__link" href="/posts">
          All posts <ArrowIcon />
        </Link>
      </h2>
      <ul className="ti-rail-posts">
        {posts.map((post) => (
          <li key={post.slug}>
            <Link className="ti-rail-post" href={post.href}>
              <PostImage post={post} shape="thumbnail" />
              <span className="ti-rail-post__copy">
                <PostMetaLine post={post} />
                <span className="ti-rail-post__headline">{post.headline}</span>
                {post.summary ? <span className="ti-rail-post__summary">{post.summary}</span> : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EditionFrontLead({ model }: { model: EditionFrontPageModel }) {
  const leadArticle = model.editionLeadArticle;
  const leadDesk = model.editionLeadDesk;
  if (!leadArticle || !leadDesk) return <LatestPostsRail posts={model.latestBandPosts} />;
  return (
    <div className={model.latestBandPosts.length > 0 ? "ti-front-lead ti-front-lead--with-rail" : "ti-front-lead"}>
      <article aria-labelledby="ti-edition-lead-headline" className="ti-front-lead__story" id="edition-lead">
        <p className="ti-kicker">
          <span className="ti-kicker__signal">Edition · {model.longEditionDateLabel}</span>
          <span>
            {leadDesk.numberLabel} {leadDesk.name} · Lead article
          </span>
        </p>
        <h2 className="ti-front-lead__headline" id="ti-edition-lead-headline">
          <Link href={leadArticle.href}>{leadArticle.headline}</Link>
        </h2>
        <p className="ti-front-lead__dek">{leadArticle.deck}</p>
        {leadArticle.openingParagraph ? <p className="ti-front-lead__opening">{leadArticle.openingParagraph}</p> : null}
        <p className="ti-front-lead__actions">
          <Link className="ti-text-link ti-text-link--strong" href={leadArticle.href}>
            Read the article <ArrowIcon />
          </Link>
          {model.editionHasVideo ? (
            <Link className="ti-text-link" href={`${leadArticle.href}#video-edition`}>
              <PlayIcon />
              Watch the video edition
            </Link>
          ) : null}
        </p>
      </article>
      <AnimatedPictogramFigure
        accessibleDescription={leadArticle.figure.alt}
        caption={leadArticle.figure.caption}
        className="ti-front-lead__figure"
        fallbackImageSource={leadArticle.figure.src}
        figureNumberLabel={leadDesk.numberLabel}
        pictogramSlug={leadArticle.figure.pictogramSlug}
        priority
      />
      <LatestPostsRail posts={model.latestBandPosts} />
    </div>
  );
}

function DeskStoryListItem({ article }: { article: FrontPageArticle }) {
  return (
    <li>
      <article className="ti-desk-story">
        <p className="ti-desk-story__number">{article.numberLabel}</p>
        <h4 className="ti-desk-story__headline">
          <Link href={article.href}>{article.headline}</Link>
        </h4>
        <p className="ti-desk-story__dek">{article.deck}</p>
      </article>
    </li>
  );
}

function DeskColumn({ desk }: { desk: FrontPageDesk }) {
  const showsLeadArticle = !desk.containsEditionLead;
  const listedArticles = desk.articlesAfterLead;
  if (!showsLeadArticle && listedArticles.length === 0) return null;
  return (
    <section aria-labelledby={`${desk.anchorId}-title`} className="ti-desk-column" id={desk.anchorId}>
      <h3 className="ti-column-heading" id={`${desk.anchorId}-title`}>
        <span className="ti-column-heading__number">{desk.numberLabel}</span>
        <span className="ti-column-heading__name">{desk.name}</span>
        <span className="ti-column-heading__count">{desk.containsEditionLead ? "Also from this desk" : desk.articleCountLabel}</span>
      </h3>
      {showsLeadArticle ? (
        <article className="ti-desk-column__lead">
          <AnimatedPictogramFigure
            accessibleDescription={desk.leadArticle.figure.alt}
            className="ti-desk-column__figure"
            fallbackImageSource={desk.leadArticle.figure.src}
            pictogramSlug={desk.leadArticle.figure.pictogramSlug}
          />
          <h4 className="ti-desk-column__headline">
            <Link href={desk.leadArticle.href}>{desk.leadArticle.headline}</Link>
          </h4>
          <p className="ti-desk-column__dek">{desk.leadArticle.deck}</p>
          {desk.leadArticle.openingParagraph ? <p className="ti-desk-column__opening">{desk.leadArticle.openingParagraph}</p> : null}
        </article>
      ) : null}
      {listedArticles.length > 0 ? (
        <ul className="ti-desk-column__stories">
          {listedArticles.map((article) => (
            <DeskStoryListItem article={article} key={article.slug} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function PostColumn({ inset }: { inset: FrontPagePostInset }) {
  const featuredPost = inset.featuredPost;
  return (
    <aside aria-label="Posts" className="ti-desk-column ti-post-column">
      <p className="ti-column-heading">
        <span aria-hidden="true" className="ti-signal-dot" />
        <span className="ti-column-heading__name">Posts</span>
        <span className="ti-column-heading__count">Between editions</span>
      </p>
      <Link className="ti-post-column__featured" href={featuredPost.href}>
        <PostImage post={featuredPost} shape="post-image" />
        <PostMetaLine post={featuredPost} />
        <span className="ti-desk-column__headline">{featuredPost.headline}</span>
        {featuredPost.summary ? <span className="ti-desk-column__dek">{featuredPost.summary}</span> : null}
      </Link>
      {inset.thumbnailPosts.length > 0 ? (
        <ul className="ti-rail-posts">
          {inset.thumbnailPosts.map((post) => (
            <li key={post.slug}>
              <Link className="ti-rail-post" href={post.href}>
                <PostImage post={post} shape="thumbnail" />
                <span className="ti-rail-post__copy">
                  <PostMetaLine compact post={post} />
                  <span className="ti-rail-post__headline">{post.headline}</span>
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
    <section aria-labelledby="ti-more-posts" className="ti-more-posts">
      <h2 className="ti-column-heading" id="ti-more-posts">
        <span aria-hidden="true" className="ti-signal-dot" />
        <span className="ti-column-heading__name">More posts</span>
        <span className="ti-column-heading__count">Between editions</span>
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
      <EditionFrontLead model={model} />
      <div className="ti-desk-columns">
        {model.deskBlocks.map((block) =>
          block.kind === "desk" ? (
            <DeskColumn desk={block.desk} key={block.desk.key} />
          ) : (
            <PostColumn inset={block.inset} key={block.key} />
          ),
        )}
      </div>
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
