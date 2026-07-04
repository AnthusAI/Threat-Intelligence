"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Article, ArticleImage, ArticleVideoAsset } from "../lib/articles";
import { solveFeaturedFloatGeometry } from "../lib/blog-feature-solver";
import { createThreatIntelligenceRhythm } from "../lib/blog-rhythm";
import type { PresentationFooterEntry } from "../lib/presentation-footer";
import type { PublicationItem } from "../lib/publication-items";
import { getPublicationItemVideoAsset } from "../lib/publication-items";
import { SITE_BRAND } from "../lib/site-brand";
import type { VideoScriptRef } from "../lib/video-script";
import { ArticleVideoFigure } from "./article-video";
import { PictogramFigure } from "../publications/threat_intelligence/pictograms/figure";
import { PresentationFooter } from "./presentation-footer";

export type ArticlePageEditionFooter = {
  editionBasePath: string;
  entries: PresentationFooterEntry[];
  subtitle: string;
  title?: string;
};

type ArticlePageViewProps = {
  article: Article;
  backHref: string;
  backLabel?: string;
  editionFooter?: ArticlePageEditionFooter;
  editionDate?: string;
  videoScript?: VideoScriptRef | null;
};

const BLOG_RHYTHM = createThreatIntelligenceRhythm();

export function ArticlePageView({
  article,
  backHref,
  backLabel = SITE_BRAND.backToHomeLabel,
  editionFooter,
  editionDate,
  videoScript = null,
}: ArticlePageViewProps) {
  const articleDate = editionDate ? formatArticleDate(editionDate) : null;
  const image = article.image ?? null;

  return (
    <ArticlePageShell
      backHref={backHref}
      backLabel={backLabel}
      body={article.body}
      deck={article.deck}
      editionFooter={editionFooter}
      headline={article.headline}
      image={image}
      section={article.section}
      slug={article.slug}
      video={article.video ?? null}
      videoScript={videoScript}
      byline={
        <>
          <span>{article.byline}</span>
          <span>{article.dateline}</span>
          {articleDate ? <time dateTime={editionDate}>{articleDate}</time> : null}
        </>
      }
    />
  );
}

type ItemPageViewProps = {
  item: PublicationItem;
  backHref: string;
  backLabel?: string;
  editionFooter?: ArticlePageEditionFooter;
  editionDate?: string;
  videoScript?: VideoScriptRef | null;
};

export function ItemPageView({
  item,
  backHref,
  backLabel = "Back to edition",
  editionFooter,
  editionDate,
  videoScript = null,
}: ItemPageViewProps) {
  if (item.type === "article") {
    return (
      <ArticlePageView
        article={item}
        backHref={backHref}
        backLabel={backLabel}
        editionFooter={editionFooter}
        editionDate={editionDate}
        videoScript={videoScript}
      />
    );
  }

  const itemDate = editionDate ? formatArticleDate(editionDate) : null;
  const itemVideo = getPublicationItemVideoAsset(item);
  const image = item.image ?? null;

  return (
    <ArticlePageShell
      backHref={backHref}
      backLabel={backLabel}
      body={item.body ?? []}
      deck={item.deck}
      editionFooter={editionFooter}
      headline={item.title}
      image={image}
      itemType={item.type}
      section={item.section ?? item.type}
      slug={item.slug}
      video={itemVideo ?? null}
      videoScript={videoScript}
      byline={itemDate ? <time dateTime={editionDate}>{itemDate}</time> : null}
    />
  );
}

type ArticlePageShellProps = {
  backHref: string;
  backLabel: string;
  body: string[];
  byline: ReactNode;
  deck?: string;
  editionFooter?: ArticlePageEditionFooter;
  headline: string;
  image: ArticleImage | null;
  itemType?: string;
  section: string;
  slug: string;
  video: ArticleVideoAsset | null;
  videoScript: VideoScriptRef | null;
};

function ArticlePageShell({
  backHref,
  backLabel,
  body,
  byline,
  deck,
  editionFooter,
  headline,
  image,
  itemType,
  section,
  slug,
  video,
  videoScript,
}: ArticlePageShellProps) {
  const articleRef = useRef<HTMLElement | null>(null);
  const containerWidth = useMeasuredWidth(articleRef);
  const viewportWidth = useViewportWidth();
  const floatGeometry = useMemo(() => {
    if (!image || !containerWidth) return null;
    return solveFeaturedFloatGeometry({
      containerWidth,
      viewportWidth,
      rhythm: BLOG_RHYTHM,
      imageAsset: image,
      itemIndex: 0,
    });
  }, [containerWidth, image, viewportWidth]);

  const hasImage = Boolean(image);
  const articleClassName = hasImage ? "article-page article-float-grid" : "article-page";
  const articleStyle = floatGeometry
    ? ({
        "--feature-copy-width": `${floatGeometry.copyWidth}px`,
        "--feature-image-width": `${floatGeometry.imageWidth}px`,
        "--feature-image-height": `${floatGeometry.imageHeight}px`,
        "--feature-layout-gap": `${floatGeometry.gap}px`,
      } as CSSProperties)
    : undefined;

  return (
    <main className={getArticleShellClassName(editionFooter)}>
      <nav className="article-nav">
        <Link href={backHref}>{backLabel}</Link>
        <span>{section}</span>
      </nav>
      <article
        className={articleClassName}
        data-feature-layout={hasImage ? (floatGeometry?.mode ?? "float") : undefined}
        data-has-image={hasImage ? "true" : "false"}
        data-item-type={itemType}
        ref={articleRef}
        style={articleStyle}
      >
        {video ? (
          <div className="article-page__hero-video">
            <ArticleVideoFigure slug={slug} video={video} videoScript={videoScript} />
          </div>
        ) : null}
        <header className={hasImage ? "article-float-grid__header" : undefined}>
          <p className="story-label">{section}</p>
          <h1>{headline}</h1>
          {deck ? <p className="article-deck">{deck}</p> : null}
          {byline ? <div className="story-byline">{byline}</div> : null}
        </header>
        <div className={hasImage ? "article-body article-float-grid__body" : "article-body"}>
          {body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        {image ? (
          <div className="presentation-item__media article-float-grid__media">
            <PictogramFigure
              alt={image.alt}
              caption={image.caption}
              credit={image.credit}
              figureClassName="presentation-item__image"
              frameHeight={floatGeometry?.imageHeight}
              frameWidth={floatGeometry?.imageWidth}
              layout={image.layout}
              priority
              sizes="(max-width: 900px) 100vw, 760px"
              slug={slug}
              src={image.src}
              themeVariants={image.themeVariants}
            />
          </div>
        ) : null}
      </article>
      {editionFooter ? <ArticleEditionFooter footer={editionFooter} /> : null}
    </main>
  );
}

function ArticleEditionFooter({ footer }: { footer: ArticlePageEditionFooter }) {
  return (
    <PresentationFooter
      editionBasePath={footer.editionBasePath}
      entries={footer.entries}
      resolveSectionHref={(entry) => `${footer.editionBasePath}#section-${entry.sectionKey}`}
      subtitle={footer.subtitle}
      title={footer.title}
    />
  );
}

function getArticleShellClassName(editionFooter: ArticlePageEditionFooter | undefined): string {
  return editionFooter ? "article-shell article-shell--edition" : "article-shell";
}

function formatArticleDate(value: string): string {
  const normalized = value.trim();
  if (!normalized) return value;

  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function useMeasuredWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setWidth(Math.max(1, Math.floor(node.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [ref]);
  return width;
}

function useViewportWidth(): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const update = () => setWidth(Math.max(1, Math.floor(window.innerWidth)));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return width;
}
