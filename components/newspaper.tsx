"use client";

import Image from "next/image";
import Link from "next/link";
import type { CSSProperties, TouchEvent as ReactTouchEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditionContent } from "../lib/content-types";
import { shouldBypassImageOptimization } from "../lib/image-url";
import {
  buildNewspaperLayout,
  type NewspaperLayout,
  type SolvedBlock,
  type SolvedFurniture,
  type SolvedImageFurniture,
  type SolvedPage,
  type SolvedPullQuoteFurniture,
  type SolvedRegion,
  type TextLine,
} from "../lib/newspaper-layout";

type BookMetrics = {
  bookWidth: number;
  pageWidth: number;
  viewportHeight: number;
};

type PapyrusTestWindow = Window & typeof globalThis & {
  __PAPYRUS_LAYOUT__?: NewspaperLayout;
  __PAPYRUS_SCENARIO__?: string;
};

const STORY_MEASURE_CHROME = 9;
const SWIPE_MIN_DISTANCE = 48;

export function Newspaper({ content }: { content: EditionContent }) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const [metrics, setMetrics] = useState<BookMetrics | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [previousPage, setPreviousPage] = useState<number | null>(null);
  const [turnDirection, setTurnDirection] = useState<"next" | "previous">("next");

  useEffect(() => {
    const node = shellRef.current;
    if (!node) return;

    const updateMetrics = (width: number) => {
      const bookWidth = Math.max(320, Math.round(width));
      const pageWidth = bookWidth;
      const viewportHeight = window.innerHeight || 900;
      setMetrics((previous) => {
        if (
          previous?.bookWidth === bookWidth &&
          previous.pageWidth === pageWidth &&
          previous.viewportHeight === viewportHeight
        ) {
          return previous;
        }
        return { bookWidth, pageWidth, viewportHeight };
      });
    };
    const updateFromNode = () => updateMetrics(node.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      updateMetrics(entry.contentRect.width);
    });
    observer.observe(node);
    window.addEventListener("resize", updateFromNode);
    updateFromNode();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateFromNode);
    };
  }, []);

  const layout = useMemo(
    () => (metrics === null ? null : buildNewspaperLayout(content.items, metrics.pageWidth, metrics.viewportHeight, content.layoutPlan)),
    [metrics, content.items, content.layoutPlan],
  );
  const totalPages = layout ? layout.pages.length : 0;
  const visiblePage = totalPages > 0 ? Math.min(currentPage, totalPages) : currentPage;
  const activePageHeight = layout ? getSolvedPageHeight(layout, visiblePage) : 0;
  const previousPageHeight = layout && previousPage ? getSolvedPageHeight(layout, previousPage) : activePageHeight;
  const shellHeight = layout ? Math.max(activePageHeight, previousPageHeight) : 0;

  useEffect(() => {
    const papyrusWindow = window as PapyrusTestWindow;
    if (!layout) {
      delete papyrusWindow.__PAPYRUS_LAYOUT__;
      papyrusWindow.__PAPYRUS_SCENARIO__ = content.scenarioId;
      return;
    }

    papyrusWindow.__PAPYRUS_LAYOUT__ = layout;
    papyrusWindow.__PAPYRUS_SCENARIO__ = content.scenarioId;
    return () => {
      if (papyrusWindow.__PAPYRUS_LAYOUT__ === layout) delete papyrusWindow.__PAPYRUS_LAYOUT__;
    };
  }, [content.scenarioId, layout]);

  const turnToPage = useCallback(
    (pageNumber: number) => {
      if (pageNumber === visiblePage || pageNumber < 1 || pageNumber > totalPages) return;
      setTurnDirection(pageNumber > visiblePage ? "next" : "previous");
      setPreviousPage(visiblePage);
      setCurrentPage(pageNumber);
      window.setTimeout(() => setPreviousPage(null), 520);
    },
    [totalPages, visiblePage],
  );

  const turnRelative = useCallback((direction: -1 | 1) => turnToPage(visiblePage + direction), [turnToPage, visiblePage]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableEventTarget(event.target)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        turnRelative(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        turnRelative(1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [turnRelative]);

  const handleFlipbookTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) {
      swipeStartRef.current = null;
      return;
    }
    const touch = event.touches[0];
    if (!touch) return;
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY, id: touch.identifier };
  };

  const handleFlipbookTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    const swipeStart = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!swipeStart) return;
    const touch = Array.from(event.changedTouches).find((candidate) => candidate.identifier === swipeStart.id) ?? event.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - swipeStart.x;
    const deltaY = touch.clientY - swipeStart.y;
    if (Math.abs(deltaX) < SWIPE_MIN_DISTANCE || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    turnRelative(deltaX < 0 ? 1 : -1);
  };

  return (
    <main
      className="site-shell"
      data-content-source={content.source}
      data-scenario-id={content.scenarioId}
      data-layout-plan-front-template={content.layoutPlan.pages[0]?.presetId}
      ref={shellRef}
    >
      {!layout ? (
        <LoadingPage content={content} />
      ) : (
        <>
          <nav className="flipbook-controls" aria-label="Edition pages">
            <button type="button" onClick={() => turnRelative(-1)} disabled={visiblePage <= 1}>
              ◀ Previous
            </button>
            <span>
              Page {visiblePage} of {totalPages}
            </span>
            <button type="button" onClick={() => turnRelative(1)} disabled={visiblePage >= totalPages}>
              Next ▶
            </button>
          </nav>

          <div
            className={`flipbook-shell flipbook-shell--turning-${turnDirection}`}
            onTouchCancel={() => {
              swipeStartRef.current = null;
            }}
            onTouchEnd={handleFlipbookTouchEnd}
            onTouchStart={handleFlipbookTouchStart}
            style={getFlipbookStyle(layout, metrics, shellHeight)}
          >
            <div className="flipbook" key={`${metrics?.bookWidth}-${metrics?.viewportHeight}-${totalPages}`}>
              {layout.pages.map((page) => (
                <div
                  className={`${getSheetClassName(page.pageNumber, visiblePage, previousPage, turnDirection)} ${
                    page.kind === "front" ? "paper-page--front" : ""
                  }`}
                  data-page-kind={page.kind}
                  id={`page-${page.pageNumber}`}
                  key={page.id}
                >
                  <SolvedPageView content={content} layout={layout} page={page} turnToPage={turnToPage} />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function LoadingPage({ content }: { content: EditionContent }) {
  return (
    <section className="paper-page-content paper-page-content--front paper-page-content--loading" aria-label="Loading edition">
      <header className="masthead">
        <div className="masthead__rule" />
        <p className="masthead__kicker">Anthus AI Solutions</p>
        <h1>Papyrus</h1>
        <div className="masthead__meta">
          <span>{content.editionDate}</span>
          <span>Vol. 1, No. 1</span>
          <span>Measuring type</span>
        </div>
      </header>
    </section>
  );
}

function SolvedPageView({
  content,
  layout,
  page,
  turnToPage,
}: {
  content: EditionContent;
  layout: NewspaperLayout;
  page: SolvedPage;
  turnToPage: (pageNumber: number) => void;
}) {
  const front = page.kind === "front";
  return (
    <section
      className={`paper-page-content ${front ? "paper-page-content--front" : "paper-page-content--inside"}`}
      data-page-kind={page.kind}
      data-page-preset-id={page.presetId}
      aria-labelledby={front ? "edition-title" : undefined}
      style={getPageStyle(layout, page.pageNumber)}
    >
      {front ? (
        <header className="masthead">
          <div className="masthead__rule" />
          <p className="masthead__kicker">Anthus AI Solutions</p>
          <h1 id="edition-title">Papyrus</h1>
          <div className="masthead__meta">
            <span>{content.editionDate}</span>
            <span>Vol. 1, No. 1</span>
            <span>Cybernetic Edition</span>
          </div>
        </header>
      ) : (
        <header className="inside-header">
          <span>Page {page.pageNumber}</span>
          <span>{formatPageSections(page)}</span>
          <span>{formatPageKind(page)}</span>
        </header>
      )}

      {front ? (
        <div
          className="front-grid"
          style={
            {
              "--paper-columns": page.columnCount,
              "--paper-gap": `${layout.gap}px`,
            } as CSSProperties
          }
        >
          {page.regions.flatMap((region) => region.blocks).map((block, index) => (
            <FrontStoryBlock block={block} index={index} key={block.id} turnToPage={turnToPage} />
          ))}
        </div>
      ) : (
        <div className={`solved-regions solved-regions--${page.kind}`}>
          {page.regions.map((region) => (
            <SolvedRegionView key={region.id} layout={layout} region={region} />
          ))}
        </div>
      )}
    </section>
  );
}

function SolvedRegionView({ layout, region }: { layout: NewspaperLayout; region: SolvedRegion }) {
  return (
    <section
      className={`solved-region solved-region--${region.type} continuation-section`}
      data-region-id={region.id}
      data-region-role={region.role}
      style={{ height: region.height }}
    >
      {region.blocks.map((block) => (
        <SolvedBlockView block={block} key={block.id} layout={layout} />
      ))}
    </section>
  );
}

function FrontStoryBlock({ block, index, turnToPage }: { block: SolvedBlock; index: number; turnToPage: (pageNumber: number) => void }) {
  const article = block.article;
  if (!article || !block.front) return null;
  return (
    <article
      className={`front-story ${index === 0 ? "front-story--lead" : ""}`}
      data-article-id={article.slug}
      data-block-id={block.id}
      data-block-type={block.type}
      data-block-preset-id={block.presetId}
      style={getFrontStoryStyle(block)}
    >
      <div className="story-label">{article.section}</div>
      <h2>
        <Link href={`/articles/${article.slug}`}>{article.headline}</Link>
      </h2>
      <p className="story-deck">{article.deck}</p>
      <div className="story-byline">{`${article.byline} / ${article.dateline}`}</div>
      <div className="story-measure" style={{ height: block.front.bodySlotHeight + STORY_MEASURE_CHROME }}>
        {block.furniture.map((furniture) => (furniture.kind === "image" ? <LeadPhotoFigure furniture={furniture} key={furniture.id} /> : null))}
        <MeasuredLines lines={block.columns[0] ?? []} />
      </div>
      <div className="jump-line">
        {block.jumpTargetPage ? (
          <button type="button" onClick={() => turnToPage(block.jumpTargetPage ?? 1)}>
            {block.jumpLabel ?? `SEE MORE ON A${block.jumpTargetPage}`}
          </button>
        ) : (
          <Link href={`/articles/${article.slug}`}>Read the full article</Link>
        )}
      </div>
    </article>
  );
}

function SolvedBlockView({ block, layout }: { block: SolvedBlock; layout: NewspaperLayout }) {
  if (block.type === "articleFrame" && block.article) {
    return <ArticleFrameBlock block={block} layout={layout} />;
  }
  if (block.type === "adBlock") {
    return <AdBlock block={block} />;
  }
  return (
    <article className={`solved-block solved-block--${block.type}`} data-block-id={block.id} data-block-type={block.type} style={{ height: block.height }}>
      {block.title ? <h2>{block.title}</h2> : null}
    </article>
  );
}

function ArticleFrameBlock({ block, layout }: { block: SolvedBlock; layout: NewspaperLayout }) {
  const article = block.article;
  if (!article) return null;
  return (
    <article
      className={`solved-block solved-block--articleFrame continuation-section ${block.furniture.some((item) => item.kind === "image") ? "continuation-section--has-photo" : ""}`}
      data-article-id={article.slug}
      data-block-id={block.id}
      data-block-type={block.type}
      data-block-preset-id={block.presetId}
      style={getArticleBlockStyle(layout, block)}
    >
      <div className="continued-title">
        <p>{block.label ?? article.section}</p>
        <h2>
          <Link href={`/articles/${article.slug}`}>{article.headline}</Link>
        </h2>
      </div>
      <div className="continuation-body">
        <div
          className="continuation-grid"
          style={
            {
              "--paper-columns": block.columnCount,
              "--paper-gap": `${layout.gap}px`,
            } as CSSProperties
          }
        >
          {block.columns.map((column, columnIndex) => (
            <div className="continuation-column" key={columnIndex}>
              <MeasuredLines lines={column} />
            </div>
          ))}
        </div>
        {block.furniture.map((furniture) => (
          <SolvedFurnitureView furniture={furniture} key={furniture.id} />
        ))}
      </div>
    </article>
  );
}

function SolvedFurnitureView({ furniture }: { furniture: SolvedFurniture }) {
  if (furniture.kind === "image") return <ContinuationPhotoFigure furniture={furniture} />;
  if (furniture.kind === "pullQuote") return <ContinuationPullQuoteAside furniture={furniture} />;
  if (furniture.kind === "ad") {
    return (
      <figure className="solved-ad" style={{ left: furniture.x, top: furniture.y, width: furniture.width, height: furniture.height }}>
        {furniture.src ? <Image src={furniture.src} alt={furniture.label} fill sizes="100vw" unoptimized={shouldBypassImageOptimization(furniture.src)} /> : null}
        <figcaption>{furniture.label}</figcaption>
      </figure>
    );
  }
  return null;
}

function LeadPhotoFigure({ furniture }: { furniture: SolvedImageFurniture }) {
  return (
    <figure
      className="lead-photo"
      style={{ left: furniture.x, top: furniture.y, width: furniture.width, height: furniture.height }}
    >
      <Image
        src={furniture.src}
        alt={furniture.alt}
        fill
        sizes="(max-width: 719px) 100vw, 40vw"
        priority
        style={{ objectFit: furniture.objectFit, objectPosition: furniture.objectPosition }}
        unoptimized={shouldBypassImageOptimization(furniture.src)}
      />
      <figcaption>{furniture.credit}</figcaption>
    </figure>
  );
}

function ContinuationPhotoFigure({ furniture }: { furniture: SolvedImageFurniture }) {
  return (
    <figure className={`continuation-photo continuation-photo--${furniture.templateId}`} data-furniture-kind="image">
      <Image
        src={furniture.src}
        alt={furniture.alt}
        fill
        sizes={furniture.columnSpan > 1 ? "(max-width: 719px) 100vw, 48vw" : "(max-width: 1039px) 50vw, 24vw"}
        style={{ objectFit: furniture.objectFit, objectPosition: furniture.objectPosition }}
        unoptimized={shouldBypassImageOptimization(furniture.src)}
      />
      <figcaption>{furniture.credit}</figcaption>
    </figure>
  );
}

function ContinuationPullQuoteAside({ furniture }: { furniture: SolvedPullQuoteFurniture }) {
  return (
    <aside className={`continuation-pullquote continuation-pullquote--${furniture.templateId}`} data-furniture-kind="pullQuote">
      {furniture.text}
    </aside>
  );
}

function AdBlock({ block }: { block: SolvedBlock }) {
  return (
    <article className="solved-block solved-block--adBlock" data-block-id={block.id} data-block-type={block.type} style={{ height: block.height }}>
      {block.furniture.map((furniture) => <SolvedFurnitureView furniture={furniture} key={furniture.id} />)}
    </article>
  );
}

function MeasuredLines({ lines }: { lines: TextLine[] }) {
  const height = lines.length === 0 ? 0 : Math.max(...lines.map((line) => line.y + line.paintHeight));
  return (
    <div className="measured-lines" style={{ height }}>
      {lines.map((line, index) => (
        <span
          className="measured-line"
          key={`${index}-${line.text}`}
          style={{
            left: line.x,
            top: line.y,
            height: line.paintHeight,
            width: Math.ceil(line.width) + 4,
          }}
        >
          {line.text}
        </span>
      ))}
    </div>
  );
}

function getFlipbookStyle(layout: NewspaperLayout, metrics: BookMetrics | null, shellHeight: number): CSSProperties {
  const chrome = layout.pageChrome;
  return {
    "--book-width": `${metrics?.bookWidth ?? layout.contentWidth}px`,
    "--page-width": `${metrics?.pageWidth ?? layout.contentWidth}px`,
    "--shell-height": `${shellHeight}px`,
    "--page-padding-top": `${chrome.pagePaddingTop}px`,
    "--page-padding-x": `${chrome.pagePaddingX}px`,
    "--page-padding-bottom": `${chrome.pagePaddingBottom}px`,
    "--masthead-kicker-line-height": `${chrome.mastheadKickerLineHeight}px`,
    "--masthead-title-font-size": `${chrome.mastheadTitleFontSize}px`,
    "--masthead-title-line-height": `${chrome.mastheadTitleLineHeight}px`,
    "--masthead-meta-line-height": `${chrome.mastheadMetaLineHeight}px`,
    "--masthead-meta-gap": `${chrome.mastheadMetaGap}px`,
    "--continued-title-font-size": `${chrome.continuedTitleFontSize}px`,
    "--continued-title-line-height": `${chrome.continuedTitleLineHeight}px`,
  } as CSSProperties;
}

function getPageStyle(layout: NewspaperLayout, pageNumber: number): CSSProperties {
  return {
    "--page-height": `${getSolvedPageHeight(layout, pageNumber)}px`,
  } as CSSProperties;
}

function getSolvedPageHeight(layout: NewspaperLayout, pageNumber: number): number {
  return layout.pageHeights[pageNumber] ?? layout.pageHeight;
}

function getFrontStoryStyle(block: SolvedBlock): CSSProperties {
  const front = block.front;
  if (!front) return {};
  const chrome = front.chrome;
  return {
    gridColumn: `span ${block.span}`,
    "--story-row-height": `${front.rowHeight}px`,
    "--story-border-top": `${chrome.borderTopHeight}px`,
    "--story-padding-top": `${chrome.paddingTop}px`,
    "--story-label-line-height": `${chrome.labelLineHeight}px`,
    "--story-headline-font-size": `${chrome.headlineFontSize}px`,
    "--story-headline-line-height": `${chrome.headlineLineHeight}px`,
    "--story-headline-height": `${chrome.headlineHeight}px`,
    "--story-headline-margin-top": `${chrome.headlineMarginTop}px`,
    "--story-headline-margin-bottom": `${chrome.headlineMarginBottom}px`,
    "--story-deck-font-size": `${chrome.deckFontSize}px`,
    "--story-deck-line-height": `${chrome.deckLineHeight}px`,
    "--story-deck-height": `${chrome.deckHeight}px`,
    "--story-deck-margin-bottom": `${chrome.deckMarginBottom}px`,
    "--story-byline-font-size": `${chrome.bylineFontSize}px`,
    "--story-byline-line-height": `${chrome.bylineLineHeight}px`,
    "--story-byline-height": `${chrome.bylineHeight}px`,
    "--story-byline-margin-bottom": `${chrome.bylineMarginBottom}px`,
    "--story-jump-height": `${front.jumpReserveHeight}px`,
    "--story-jump-line-height": `${chrome.jumpLineHeight}px`,
    "--story-jump-padding-top": `${chrome.jumpPaddingTop}px`,
    "--story-jump-border-top": `${chrome.jumpBorderTopHeight}px`,
  } as CSSProperties;
}

function getArticleBlockStyle(layout: NewspaperLayout, block: SolvedBlock): CSSProperties {
  const image = block.furniture.find((item): item is SolvedImageFurniture => item.kind === "image");
  const pullQuote = block.furniture.find((item): item is SolvedPullQuoteFurniture => item.kind === "pullQuote");
  return {
    width: block.width,
    minHeight: block.height,
    "--continued-title-heading-height": `${block.titleHeight ?? 0}px`,
    "--continuation-column-height": `${block.bodyHeight ?? 0}px`,
    "--continuation-pullquote-height": `${pullQuote?.height ?? 0}px`,
    "--continuation-pullquote-x": `${pullQuote?.x ?? 0}px`,
    "--continuation-pullquote-y": `${pullQuote?.y ?? 0}px`,
    "--continuation-pullquote-width": `${pullQuote?.width ?? 0}px`,
    "--continuation-pullquote-font-size": `${pullQuote?.fontSize ?? 22}px`,
    "--continuation-pullquote-line-height": `${pullQuote?.lineHeight ?? 25}px`,
    "--continuation-photo-height": `${image?.height ?? 0}px`,
    "--continuation-photo-x": `${image?.x ?? 0}px`,
    "--continuation-photo-y": `${image?.y ?? 0}px`,
    "--continuation-photo-width": `${image?.width ?? layout.contentWidth}px`,
    "--continuation-photo-aspect-ratio": `${image?.aspectRatio ?? 1.5}`,
    "--paper-gap": `${layout.gap}px`,
  } as CSSProperties;
}

function formatPageSections(page: SolvedPage): string {
  const sections = page.regions.flatMap((region) => region.blocks.map((block) => block.section).filter(Boolean));
  return Array.from(new Set(sections)).join(" / ");
}

function formatPageKind(page: SolvedPage): string {
  if (page.kind === "regionStack") return "Stacked page";
  if (page.kind === "railMain") return "Rail page";
  return "Article page";
}

function isEditableEventTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") return true;
  return target.isContentEditable || target.closest("[contenteditable='true']") !== null;
}

function getSheetClassName(
  pageNumber: number,
  currentPage: number,
  previousPage: number | null,
  turnDirection: "next" | "previous",
): string {
  const classes = ["paper-sheet"];
  if (pageNumber === currentPage) classes.push("paper-page--active", `paper-page--enter-${turnDirection}`);
  if (pageNumber === previousPage) classes.push("paper-page--leaving", `paper-page--leave-${turnDirection}`);
  return classes.join(" ");
}
