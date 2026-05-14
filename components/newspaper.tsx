"use client";

import Image from "next/image";
import Link from "next/link";
import type { CSSProperties, TouchEvent as ReactTouchEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditionContent } from "../lib/content-types";
import { shouldBypassImageOptimization } from "../lib/image-url";
import {
  buildNewspaperLayout,
  type ContinuationPage,
  type ContinuationSection,
  type FrontBlock,
  type NewspaperLayout,
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
    () => (metrics === null ? null : buildNewspaperLayout(content.articles, metrics.pageWidth, metrics.viewportHeight)),
    [metrics, content.articles],
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
      if (papyrusWindow.__PAPYRUS_LAYOUT__ === layout) {
        delete papyrusWindow.__PAPYRUS_LAYOUT__;
      }
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

  const turnRelative = useCallback(
    (direction: -1 | 1) => {
      turnToPage(visiblePage + direction);
    },
    [turnToPage, visiblePage],
  );

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

    swipeStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      id: touch.identifier,
    };
  };

  const handleFlipbookTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    const swipeStart = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!swipeStart) return;

    const changedTouches = Array.from(event.changedTouches);
    const touch = changedTouches.find((candidate) => candidate.identifier === swipeStart.id) ?? changedTouches[0];
    if (!touch) return;

    const deltaX = touch.clientX - swipeStart.x;
    const deltaY = touch.clientY - swipeStart.y;
    const absDeltaX = Math.abs(deltaX);
    const absDeltaY = Math.abs(deltaY);

    if (absDeltaX < SWIPE_MIN_DISTANCE || absDeltaX <= absDeltaY) return;
    turnRelative(deltaX < 0 ? 1 : -1);
  };

  const handleFlipbookTouchCancel = () => {
    swipeStartRef.current = null;
  };

  return (
    <main className="site-shell" data-content-source={content.source} data-scenario-id={content.scenarioId} ref={shellRef}>
      {!layout ? (
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
            onTouchCancel={handleFlipbookTouchCancel}
            onTouchEnd={handleFlipbookTouchEnd}
            onTouchStart={handleFlipbookTouchStart}
            style={getFlipbookStyle(layout, metrics, shellHeight)}
          >
            <div className="flipbook" key={`${metrics?.bookWidth}-${metrics?.viewportHeight}-${totalPages}`}>
              <div
                className={`${getSheetClassName(1, visiblePage, previousPage, turnDirection)} paper-page--front`}
                data-page-kind="front"
                id="page-1"
              >
                <section
                  className="paper-page-content paper-page-content--front"
                  aria-labelledby="edition-title"
                  style={getPageStyle(layout, 1)}
                >
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

                  <div
                    className="front-grid"
                    style={
                      {
                        "--paper-columns": layout.columnCount,
                        "--paper-gap": `${layout.gap}px`,
                      } as CSSProperties
                    }
                  >
                    {layout.frontBlocks.map((block, index) => (
                      <article
                        className={`front-story ${index === 0 ? "front-story--lead" : ""}`}
                        data-article-id={block.article.slug}
                        data-block-id={block.blockId}
                        key={block.article.slug}
                        style={getFrontStoryStyle(block)}
                      >
                        <div className="story-label">{block.article.section}</div>
                        <h2>
                          <Link href={`/articles/${block.article.slug}`}>{block.article.headline}</Link>
                        </h2>
                        <p className="story-deck">{block.article.deck}</p>
                        <div className="story-byline">{formatStoryByline(block)}</div>
                        <div className="story-measure" style={{ height: block.bodySlotHeight + STORY_MEASURE_CHROME }}>
                          {block.imageWrap ? (
                            <figure
                              className="lead-photo"
                              style={{
                                left: block.imageWrap.x,
                                top: block.imageWrap.y,
                                width: block.imageWrap.width,
                                height: block.imageWrap.height,
                              }}
                            >
                              <Image
                                src={block.article.image.src}
                                alt={block.article.image.alt}
                                fill
                                sizes="(max-width: 719px) 100vw, 40vw"
                                priority
                                unoptimized={shouldBypassImageOptimization(block.article.image.src)}
                              />
                              <figcaption>{block.article.image.credit}</figcaption>
                            </figure>
                          ) : null}
                          <MeasuredLines lines={block.lines} />
                        </div>
                        <div className="jump-line">
                          {block.pageNumber ? (
                            <button type="button" onClick={() => turnToPage(block.pageNumber ?? 1)}>
                              Continued on page {block.pageNumber}
                            </button>
                          ) : (
                            <Link href={`/articles/${block.article.slug}`}>Read the full article</Link>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              </div>

              {layout.continuationPages.map((page) => (
                <div
                  className={getSheetClassName(page.pageNumber, visiblePage, previousPage, turnDirection)}
                  data-page-kind={page.kind}
                  id={`page-${page.pageNumber}`}
                  key={page.id}
                >
                  <section
                    className="paper-page-content paper-page-content--inside"
                    data-page-kind={page.kind}
                    data-recipe-id={page.recipeId}
                    style={getPageStyle(layout, page.pageNumber)}
                  >
                    <header className="inside-header">
                      <span>Page {page.pageNumber}</span>
                      <span>{formatContinuationSections(page)}</span>
                      <span>{formatContinuationPageKind(page)}</span>
                    </header>
                    <div className={`continuation-sections continuation-sections--${page.kind}`}>
                      {page.sections.map((section) => (
                        <article
                          className={`continuation-section ${section.image ? "continuation-section--has-photo" : ""}`}
                          data-article-id={section.article.slug}
                          data-block-id={section.blockId}
                          key={section.id}
                          style={getContinuationSectionStyle(layout, section)}
                        >
                          <div className="continued-title">
                            <p>Continued from Page One</p>
                            <h2>
                              <Link href={`/articles/${section.article.slug}`}>{section.article.headline}</Link>
                            </h2>
                          </div>
                          <div className="continuation-body">
                            <div
                              className="continuation-grid"
                              style={
                                {
                                  "--paper-columns": section.columns.length,
                                  "--paper-gap": `${layout.gap}px`,
                                } as CSSProperties
                              }
                            >
                              {section.columns.map((column, columnIndex) => (
                                <div className="continuation-column" key={columnIndex}>
                                  <MeasuredLines lines={column} />
                                </div>
                              ))}
                            </div>
                            {section.image ? <ContinuationPhotoFigure section={section} /> : null}
                            {section.pullQuote ? <ContinuationPullQuoteAside section={section} /> : null}
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </main>
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

function getFrontStoryStyle(block: FrontBlock): CSSProperties {
  const chrome = block.chrome;
  return {
    gridColumn: `span ${block.span}`,
    "--story-row-height": `${block.rowHeight}px`,
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
    "--story-jump-height": `${block.jumpReserveHeight}px`,
    "--story-jump-line-height": `${chrome.jumpLineHeight}px`,
    "--story-jump-padding-top": `${chrome.jumpPaddingTop}px`,
    "--story-jump-border-top": `${chrome.jumpBorderTopHeight}px`,
  } as CSSProperties;
}

function getContinuationSectionStyle(layout: NewspaperLayout, section: ContinuationSection): CSSProperties {
  const image = section.image;
  const pullQuote = section.pullQuote;
  return {
    "--continued-title-heading-height": `${section.titleHeight}px`,
    "--continuation-column-height": `${section.textHeight}px`,
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

function formatContinuationSections(page: ContinuationPage): string {
  return page.sections.map((section) => section.article.section).join(" / ");
}

function formatContinuationPageKind(page: ContinuationPage): string {
  if (page.kind === "dualContinuation") return "Shared jump page";
  if (page.kind === "photoContinuation") return "Photo continuation";
  return "Continuation";
}

function formatStoryByline(block: FrontBlock): string {
  return `${block.article.byline} / ${block.article.dateline}`;
}

function ContinuationPhotoFigure({ section }: { section: ContinuationSection }) {
  const image = section.image;
  if (!image) return null;

  return (
    <figure className={`continuation-photo continuation-photo--${image.templateId}`}>
      <Image
        src={image.src}
        alt={image.alt}
        fill
        sizes={image.columnSpan > 1 ? "(max-width: 719px) 100vw, 48vw" : "(max-width: 1039px) 50vw, 24vw"}
        style={{ objectFit: image.objectFit, objectPosition: image.objectPosition }}
        unoptimized={shouldBypassImageOptimization(image.src)}
      />
      <figcaption>{image.credit}</figcaption>
    </figure>
  );
}

function ContinuationPullQuoteAside({ section }: { section: ContinuationSection }) {
  const pullQuote = section.pullQuote;
  if (!pullQuote) return null;

  return (
    <aside className={`continuation-pullquote continuation-pullquote--${pullQuote.templateId}`}>
      {pullQuote.text}
    </aside>
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
