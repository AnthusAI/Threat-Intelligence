"use client";

import type { CSSProperties, RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Article, ArticleImage, ArticleVideoAsset } from "../lib/articles";
import { solveFeaturedFloatGeometry } from "../lib/blog-feature-solver";
import { createThreatIntelligenceRhythm } from "../lib/blog-rhythm";
import type { PresentationFooterEntry } from "../lib/presentation-footer";
import type { PublicationItem } from "../lib/publication-items";
import { getPublicationItemVideoAsset } from "../lib/publication-items";
import type { VideoScriptRef } from "../lib/video-script";
import { ArticleVideoFigure } from "./article-video";
import { PictogramFigure } from "../publications/threat_intelligence/pictograms/figure";
import { PresentationFooter } from "./presentation-footer";
import { PresentationHeader, type PresentationHeaderSection } from "./presentation-header";

export type ArticlePageEditionFooter = {
  editionBasePath: string;
  entries: PresentationFooterEntry[];
  sections: PresentationHeaderSection[];
  subtitle: string;
  title?: string;
};

type ArticlePageViewProps = {
  article: Article;
  editionFooter?: ArticlePageEditionFooter;
  editionDate?: string;
  videoScript?: VideoScriptRef | null;
};

const BLOG_RHYTHM = createThreatIntelligenceRhythm();

export function ArticlePageView({
  article,
  editionFooter,
  editionDate,
  videoScript = null,
}: ArticlePageViewProps) {
  const image = article.image ?? null;

  return (
    <ArticlePageShell
      body={article.body}
      deck={article.deck}
      editionDate={editionDate}
      editionFooter={editionFooter}
      headline={article.headline}
      image={image}
      section={article.section}
      slug={article.slug}
      video={article.video ?? null}
      videoScript={videoScript}
    />
  );
}

type ItemPageViewProps = {
  item: PublicationItem;
  editionFooter?: ArticlePageEditionFooter;
  editionDate?: string;
  videoScript?: VideoScriptRef | null;
};

export function ItemPageView({
  item,
  editionFooter,
  editionDate,
  videoScript = null,
}: ItemPageViewProps) {
  if (item.type === "article") {
    return (
      <ArticlePageView
        article={item}
        editionFooter={editionFooter}
        editionDate={editionDate}
        videoScript={videoScript}
      />
    );
  }

  const itemVideo = getPublicationItemVideoAsset(item);
  const image = item.image ?? null;

  return (
    <ArticlePageShell
      body={item.body ?? []}
      deck={item.deck}
      editionDate={editionDate}
      editionFooter={editionFooter}
      headline={item.title}
      image={image}
      itemType={item.type}
      section={item.section ?? item.type}
      slug={item.slug}
      video={itemVideo ?? null}
      videoScript={videoScript}
    />
  );
}

type ArticlePageShellProps = {
  body: string[];
  deck?: string;
  editionDate?: string;
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
  body,
  deck,
  editionDate,
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
      <PresentationHeader
        editionBasePath={editionFooter?.editionBasePath}
        editionDate={editionDate}
        sections={editionFooter?.sections}
      />
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
        </header>
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
        <div className={hasImage ? "article-body article-float-grid__body" : "article-body"}>
          {body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
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
