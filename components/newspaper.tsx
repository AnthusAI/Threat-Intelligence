"use client";

import { gsap } from "gsap";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import Image from "next/image";
import Link from "next/link";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ARCHIVE_PREVIEW_HEIGHT, ARCHIVE_PREVIEW_WIDTH } from "../lib/archive-types";
import type { EditionContent } from "../lib/content-types";
import { shouldBypassImageOptimization } from "../lib/image-url";
import {
  buildNewspaperLayout,
  type NewspaperLayout,
  type SolvedBlock,
  type SolvedChromeBox,
  type SolvedFrontFooter,
  type SolvedFurniture,
  type SolvedImageFurniture,
  type SolvedPage,
  type SolvedPullQuoteFurniture,
  type SolvedRegion,
  type TextLine,
} from "../lib/newspaper-layout";

gsap.registerPlugin(ScrollToPlugin);

type BookMetrics = {
  pageWidth: number;
  viewportHeight: number;
};

type ScrollToPageOptions = {
  immediate?: boolean;
  history?: "push" | "replace" | "none";
};

type PapyrusTestWindow = Window & typeof globalThis & {
  __PAPYRUS_LAYOUT__?: NewspaperLayout;
  __PAPYRUS_SCENARIO__?: string;
  __PAPYRUS_VISIBLE_PAGE__?: number;
  __PAPYRUS_SCROLL_TO_PAGE__?: (pageNumber: number, options?: ScrollToPageOptions) => void;
};

type NewspaperProps = {
  content: EditionContent;
  editionBasePath?: string;
  initialPageNumber?: number;
};

const PAGE_LOOKAROUND = 1;

export function Newspaper({ content, editionBasePath, initialPageNumber = 1 }: NewspaperProps) {
  const normalizedInitialPage = Math.max(1, Math.floor(initialPageNumber));
  const shellRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLElement | null>(null);
  const pageRefs = useRef<Map<number, HTMLElement>>(new Map());
  const hasInitializedLocationRef = useRef(false);
  const pendingProgrammaticPageRef = useRef<number | null>(null);
  const preservedItemHashPageRef = useRef<number | null>(null);
  const [metrics, setMetrics] = useState<BookMetrics | null>(null);
  const [fontRevision, setFontRevision] = useState(0);
  const [visiblePage, setVisiblePage] = useState(normalizedInitialPage);
  const [priorityPages, setPriorityPages] = useState<Set<number>>(new Set([normalizedInitialPage]));
  const [showRhythmOverlay, setShowRhythmOverlay] = useState(false);

  useEffect(() => {
    const node = shellRef.current;
    if (!node) return;

    const updateMetrics = (width: number) => {
      const pageWidth = Math.max(320, Math.round(width));
      const viewportHeight = window.innerHeight || 900;
      setMetrics((previous) => {
        if (previous?.pageWidth === pageWidth && previous.viewportHeight === viewportHeight) return previous;
        return { pageWidth, viewportHeight };
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

  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    let cancelled = false;
    const refreshAfterFontLoad = () => {
      if (!cancelled) setFontRevision((revision) => revision + 1);
    };
    fonts.ready.then(refreshAfterFontLoad).catch(() => undefined);
    fonts.addEventListener("loadingdone", refreshAfterFontLoad);
    fonts.addEventListener("loadingerror", refreshAfterFontLoad);
    return () => {
      cancelled = true;
      fonts.removeEventListener("loadingdone", refreshAfterFontLoad);
      fonts.removeEventListener("loadingerror", refreshAfterFontLoad);
    };
  }, []);

  const layout = useMemo(() => {
    void fontRevision;
    return metrics === null ? null : buildNewspaperLayout(content.items, metrics.pageWidth, metrics.viewportHeight, content.layoutPlan);
  }, [metrics, content.items, content.layoutPlan, fontRevision]);

  const totalPages = layout?.pages.length ?? 0;

  useEffect(() => {
    if (!layout) return;
    setVisiblePage((current) => clampPageNumber(current, layout.pages.length));
    setPriorityPages((current) => {
      const next = new Set<number>();
      next.add(clampPageNumber(visiblePage, layout.pages.length));
      for (const page of current) next.add(clampPageNumber(page, layout.pages.length));
      return next;
    });
  }, [layout, visiblePage]);

  const materializedPages = useMemo(() => {
    if (!layout) return new Set<number>();
    return computeMaterializedPages(visiblePage, priorityPages, totalPages);
  }, [layout, priorityPages, totalPages, visiblePage]);

  const articleAnchors = useMemo(() => computeArticleAnchors(layout), [layout]);

  const scrollToTarget = useCallback(
    (target: HTMLElement, options?: ScrollToPageOptions) => {
      const offsetY = progressRef.current?.getBoundingClientRect().height ?? 0;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const targetY = window.scrollY + target.getBoundingClientRect().top - offsetY;
      if (options?.immediate || reducedMotion) {
        window.scrollTo(0, targetY);
        return;
      }

      const distance = Math.abs(targetY - window.scrollY);
      const duration = clamp(distance / 1200, 0.45, 1.1);
      gsap.killTweensOf(window);
      gsap.to(window, {
        duration,
        ease: "power3.inOut",
        scrollTo: {
          y: targetY,
          autoKill: true,
        },
      });
    },
    [],
  );

  const scrollToPage = useCallback(
    (rawPageNumber: number, options?: ScrollToPageOptions) => {
      if (!layout) return;
      const pageNumber = clampPageNumber(rawPageNumber, layout.pages.length);
      pendingProgrammaticPageRef.current = pageNumber;
      preservedItemHashPageRef.current = null;
      writePageLocation(pageNumber, options?.history ?? "push", editionBasePath);
      setPriorityPages((current) => {
        const next = new Set(current);
        next.add(pageNumber);
        return next;
      });

      requestAnimationFrame(() => {
        const target = pageRefs.current.get(pageNumber) ?? document.getElementById(getPageAnchorId(pageNumber));
        if (!target) return;
        scrollToTarget(target, options);
      });
    },
    [editionBasePath, layout, scrollToTarget],
  );

  const scrollToItemAnchor = useCallback(
    (articleSlug: string, options?: ScrollToPageOptions) => {
      if (!layout) return false;
      const pageNumber = articleAnchors.pages.get(articleSlug);
      if (!pageNumber) return false;

      pendingProgrammaticPageRef.current = pageNumber;
      preservedItemHashPageRef.current = pageNumber;
      setPriorityPages((current) => {
        const next = new Set(current);
        next.add(pageNumber);
        return next;
      });

      const tryScroll = (attempt: number) => {
        requestAnimationFrame(() => {
          const target = document.getElementById(articleSlug);
          if (!target && attempt < 8) {
            tryScroll(attempt + 1);
            return;
          }

          const fallbackTarget = pageRefs.current.get(pageNumber) ?? document.getElementById(getPageAnchorId(pageNumber));
          const scrollTarget = target ?? fallbackTarget;
          if (scrollTarget) scrollToTarget(scrollTarget, options);
        });
      };

      tryScroll(0);
      return true;
    },
    [articleAnchors.pages, layout, scrollToTarget],
  );

  const turnRelative = useCallback(
    (delta: -1 | 1) => {
      if (!layout) return;
      const targetPage = visiblePage + delta;
      if (targetPage < 1 || targetPage > totalPages) return;
      scrollToPage(targetPage);
    },
    [layout, scrollToPage, totalPages, visiblePage],
  );

  useVisiblePageObserver(layout, setVisiblePage, pageRefs);

  useEffect(() => {
    if (!layout) return;
    if (hasInitializedLocationRef.current) return;
    hasInitializedLocationRef.current = true;

    const itemHash = parseItemAnchorHash(window.location.hash);
    if (itemHash && scrollToItemAnchor(itemHash, { immediate: true, history: "none" })) return;

    const locationPage = editionBasePath
      ? parsePageNumberFromPath(window.location.pathname, editionBasePath)
      : parseHashPageNumber(window.location.hash);
    if (!locationPage) {
      scrollToPage(normalizedInitialPage, { immediate: true, history: "replace" });
      return;
    }
    scrollToPage(locationPage, { immediate: true, history: "replace" });
  }, [editionBasePath, layout, normalizedInitialPage, scrollToItemAnchor, scrollToPage]);

  useEffect(() => {
    if (!layout) return;
    const pendingPage = pendingProgrammaticPageRef.current;
    if (pendingPage !== null && pendingPage !== visiblePage) return;
    pendingProgrammaticPageRef.current = null;

    const preservedItemHashPage = preservedItemHashPageRef.current;
    if (preservedItemHashPage !== null && parseItemAnchorHash(window.location.hash)) {
      if (preservedItemHashPage === visiblePage) return;
      preservedItemHashPageRef.current = null;
    }

    writePageLocation(visiblePage, "replace", editionBasePath);
  }, [editionBasePath, layout, visiblePage]);

  useEffect(() => {
    if (!layout) return;
    const handleLocationNavigation = () => {
      const itemHash = parseItemAnchorHash(window.location.hash);
      if (itemHash && scrollToItemAnchor(itemHash, { history: "none" })) return;

      const pageNumber = editionBasePath
        ? parsePageNumberFromPath(window.location.pathname, editionBasePath)
        : parseHashPageNumber(window.location.hash);
      if (!pageNumber) return;
      scrollToPage(pageNumber, { history: "none" });
    };

    window.addEventListener("hashchange", handleLocationNavigation);
    window.addEventListener("popstate", handleLocationNavigation);
    return () => {
      window.removeEventListener("hashchange", handleLocationNavigation);
      window.removeEventListener("popstate", handleLocationNavigation);
    };
  }, [editionBasePath, layout, scrollToItemAnchor, scrollToPage]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableEventTarget(event.target)) return;

      if ((event.key === "=" || event.code === "Equal") && event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        setShowRhythmOverlay((current) => !current);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const papyrusWindow = window as PapyrusTestWindow;
    if (!layout) {
      delete papyrusWindow.__PAPYRUS_LAYOUT__;
      delete papyrusWindow.__PAPYRUS_VISIBLE_PAGE__;
      delete papyrusWindow.__PAPYRUS_SCROLL_TO_PAGE__;
      papyrusWindow.__PAPYRUS_SCENARIO__ = content.scenarioId;
      return;
    }

    papyrusWindow.__PAPYRUS_LAYOUT__ = layout;
    papyrusWindow.__PAPYRUS_SCENARIO__ = content.scenarioId;
    papyrusWindow.__PAPYRUS_VISIBLE_PAGE__ = visiblePage;
    papyrusWindow.__PAPYRUS_SCROLL_TO_PAGE__ = scrollToPage;
    return () => {
      if (papyrusWindow.__PAPYRUS_LAYOUT__ === layout) delete papyrusWindow.__PAPYRUS_LAYOUT__;
      if (papyrusWindow.__PAPYRUS_VISIBLE_PAGE__ === visiblePage) delete papyrusWindow.__PAPYRUS_VISIBLE_PAGE__;
      if (papyrusWindow.__PAPYRUS_SCROLL_TO_PAGE__ === scrollToPage) delete papyrusWindow.__PAPYRUS_SCROLL_TO_PAGE__;
    };
  }, [content.scenarioId, layout, scrollToPage, visiblePage]);

  return (
    <main
      className="site-shell"
      data-content-source={content.source}
      data-current-page={layout ? visiblePage : undefined}
      data-layout-plan-front-template={content.layoutPlan.pages[0]?.presetId}
      data-rhythm-overlay={showRhythmOverlay ? "true" : "false"}
      data-scenario-id={content.scenarioId}
      ref={shellRef}
      style={
        layout
          ? ({
              "--paper-rhythm": `${layout.rhythm.rowHeight}px`,
            } as CSSProperties)
          : undefined
      }
    >
      <EditionProgress
        currentPage={layout ? visiblePage : null}
        onNext={layout && visiblePage < totalPages ? () => turnRelative(1) : undefined}
        onPrevious={layout && visiblePage > 1 ? () => turnRelative(-1) : undefined}
        progressRef={progressRef}
        totalPages={layout ? totalPages : null}
      />
      {!layout ? (
        <LoadingPage content={content} />
      ) : (
        <section className="scroll-edition">
          {layout.pages.map((page) => {
            const pageHeight = getSolvedPageHeight(layout, page.pageNumber);
            const materialized = materializedPages.has(page.pageNumber);
            return (
              <div
                className={`paper-page ${page.kind === "front" ? "paper-page--front" : ""} ${
                  page.pageNumber === visiblePage ? "paper-page--active" : ""
                } ${materialized ? "paper-page--materialized" : "paper-page--placeholder"}`}
                data-materialized={materialized ? "true" : "false"}
                data-page-kind={page.kind}
                id={getPageAnchorId(page.pageNumber)}
                key={page.id}
                ref={(node) => {
                  if (node) pageRefs.current.set(page.pageNumber, node);
                  else pageRefs.current.delete(page.pageNumber);
                }}
                style={{ minHeight: pageHeight }}
              >
                {materialized ? (
                  <SolvedPageView
                    articleAnchorBlockIds={articleAnchors.blockIds}
                    content={content}
                    editionBasePath={editionBasePath}
                    layout={layout}
                    page={page}
                    scrollToItemAnchor={scrollToItemAnchor}
                    scrollToPage={scrollToPage}
                  />
                ) : (
                  <PagePlaceholder page={page} />
                )}
              </div>
            );
          })}
        </section>
      )}
    </main>
  );
}

export function NewspaperFrontPreview({ content }: { content: EditionContent }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<NewspaperLayout | null>(null);
  const [scale, setScale] = useState(0.24);
  const [previewRhythm, setPreviewRhythm] = useState(19);
  const page = layout?.pages.find((candidate) => candidate.pageNumber === 1) ?? layout?.pages[0] ?? null;
  const rawPreviewHeight = (page?.height ?? ARCHIVE_PREVIEW_HEIGHT) * scale;
  const previewHeight = Math.ceil(rawPreviewHeight / previewRhythm) * previewRhythm;
  const articleAnchors = useMemo(() => computeArticleAnchors(layout), [layout]);
  const scrollToPage = useCallback(() => undefined, []);
  const scrollToItemAnchor = useCallback(() => false, []);

  useEffect(() => {
    setLayout(buildNewspaperLayout(content.items, ARCHIVE_PREVIEW_WIDTH, ARCHIVE_PREVIEW_HEIGHT, content.layoutPlan));
  }, [content]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const updateScale = () => {
      const width = node.getBoundingClientRect().width;
      if (width > 0) setScale(width / ARCHIVE_PREVIEW_WIDTH);
      setPreviewRhythm(window.matchMedia("(max-width: 719px)").matches ? 18 : 19);
    };
    const observer = new ResizeObserver(updateScale);
    observer.observe(node);
    updateScale();
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={`archive-front-preview ${page ? "" : "archive-front-preview--loading"}`}
      data-archive-front-preview="true"
      ref={containerRef}
      style={{ height: previewHeight }}
    >
      {layout && page ? (
        <div
          className="archive-front-preview__page"
          style={{
            width: ARCHIVE_PREVIEW_WIDTH,
            height: page.height,
            transform: `scale(${scale})`,
          }}
        >
          <SolvedPageView
            articleAnchorBlockIds={articleAnchors.blockIds}
            content={content}
            disableLinks
            editionTitleId={`archive-edition-title-${content.id}`}
            layout={layout}
            page={page}
            scrollToItemAnchor={scrollToItemAnchor}
            scrollToPage={scrollToPage}
          />
        </div>
      ) : null}
    </div>
  );
}

function EditionProgressTriangleIcon({ direction }: { direction: "previous" | "next" }) {
  const path = direction === "previous" ? "M7.5 1 2.5 5 7.5 9Z" : "M2.5 1 7.5 5 2.5 9Z";

  return (
    <svg aria-hidden="true" className="edition-progress__icon" focusable="false" viewBox="0 0 10 10">
      <path d={path} fill="currentColor" />
    </svg>
  );
}

function EditionProgress({
  currentPage,
  totalPages,
  onNext,
  onPrevious,
  progressRef,
}: {
  currentPage: number | null;
  totalPages: number | null;
  onNext?: () => void;
  onPrevious?: () => void;
  progressRef: React.MutableRefObject<HTMLElement | null>;
}) {
  return (
    <nav className="edition-progress" aria-label="Edition progress" ref={progressRef}>
      <button className="edition-progress__button" disabled={!onPrevious} onClick={onPrevious} type="button">
        <EditionProgressTriangleIcon direction="previous" />
        Previous
      </button>
      <span className="edition-progress__status">
        Page {currentPage ?? "--"} of {totalPages ?? "--"}
      </span>
      <button className="edition-progress__button" disabled={!onNext} onClick={onNext} type="button">
        Next
        <EditionProgressTriangleIcon direction="next" />
      </button>
    </nav>
  );
}

function PagePlaceholder({ page }: { page: SolvedPage }) {
  return (
    <section className="paper-page-content paper-page-content--placeholder" data-page-kind={page.kind} data-page-preset-id={page.presetId}>
      <div className="page-placeholder-label">Loading Page {page.pageNumber}</div>
    </section>
  );
}

function LoadingPage({ content }: { content: EditionContent }) {
  return (
    <section className="paper-page-content paper-page-content--front paper-page-content--loading" aria-label="Loading edition">
      <header className="masthead">
        <div className="masthead__rule" />
        <h1>
          <span>PAPYRUS</span>
        </h1>
        <div className="masthead__meta">
          <span>{content.editionDate}</span>
          <span>INFORMATION ABOUT INFORMATION SYSTEMS</span>
          <span>Measuring type</span>
        </div>
      </header>
    </section>
  );
}

function SolvedPageView({
  articleAnchorBlockIds,
  content,
  disableLinks = false,
  editionBasePath,
  editionTitleId: rawEditionTitleId,
  layout,
  page,
  scrollToItemAnchor,
  scrollToPage,
}: {
  articleAnchorBlockIds: Set<string>;
  content: EditionContent;
  disableLinks?: boolean;
  editionBasePath?: string;
  editionTitleId?: string;
  layout: NewspaperLayout;
  page: SolvedPage;
  scrollToItemAnchor: (articleSlug: string, options?: ScrollToPageOptions) => boolean;
  scrollToPage: (pageNumber: number, options?: ScrollToPageOptions) => void;
}) {
  const front = page.kind === "front";
  const editionTitleId = front ? rawEditionTitleId ?? "edition-title" : undefined;
  return (
    <section
      className={`paper-page-content ${front ? "paper-page-content--front" : "paper-page-content--inside"}`}
      data-page-kind={page.kind}
      data-page-preset-id={page.presetId}
      aria-labelledby={editionTitleId}
      style={getPageStyle(layout, page.pageNumber)}
    >
      {front ? (
        <header className="masthead">
          <div className="masthead__rule" />
          <h1 id={editionTitleId}>
            <span>PAPYRUS</span>
          </h1>
          <div className="masthead__meta">
            <span>{content.editionDate}</span>
            <span>INFORMATION ABOUT INFORMATION SYSTEMS</span>
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
        <>
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
              <FrontStoryBlock
                anchorId={articleAnchorBlockIds.has(block.id) ? block.article?.slug : undefined}
                block={block}
                disableLinks={disableLinks}
                editionBasePath={editionBasePath}
                index={index}
                key={block.id}
                scrollToPage={scrollToPage}
              />
            ))}
          </div>
          {page.frontFooter ? (
            <FrontPageFooter
              disableLinks={disableLinks}
              editionBasePath={editionBasePath}
              footer={page.frontFooter}
              scrollToItemAnchor={scrollToItemAnchor}
            />
          ) : null}
        </>
      ) : (
        <div className={`solved-regions solved-regions--${page.kind}`}>
          {page.regions.map((region) => (
            <SolvedRegionView articleAnchorBlockIds={articleAnchorBlockIds} editionBasePath={editionBasePath} key={region.id} layout={layout} region={region} />
          ))}
        </div>
      )}
    </section>
  );
}

function FrontPageFooter({
  disableLinks = false,
  editionBasePath,
  footer,
  scrollToItemAnchor,
}: {
  disableLinks?: boolean;
  editionBasePath?: string;
  footer: SolvedFrontFooter;
  scrollToItemAnchor: (articleSlug: string, options?: ScrollToPageOptions) => boolean;
}) {
  return (
    <footer
      aria-label="Front page footer"
      className="front-footer"
      data-front-footer="true"
      style={
        {
          "--front-footer-height": `${footer.height}px`,
          "--front-footer-margin-top": `${footer.marginTop}px`,
          "--front-footer-row-height": `${footer.rowHeight}px`,
          "--front-footer-section-columns": footer.sectionColumns,
          "--front-footer-section-rows": footer.sectionRows,
        } as CSSProperties
      }
    >
      <div className="front-footer__heading">
        <span>Inside Papyrus</span>
        <span>{footer.entries.length} sections</span>
      </div>
      {footer.entries.length > 0 ? (
        <nav className="front-footer__sections" aria-label="Front page sections">
          {footer.entries.map((entry) => {
            const href = getItemAnchorHref(entry.articleSlug, entry.pageNumber, editionBasePath);
            if (disableLinks) {
              return (
                <span className="front-footer__section-link" data-footer-section={entry.section} key={`${entry.section}-${entry.articleSlug}`}>
                  <span className="front-footer__section-name">{entry.section}</span>
                  <span className="front-footer__section-title">{entry.articleTitle}</span>
                </span>
              );
            }
            return (
              <a
                className="front-footer__section-link"
                data-footer-section={entry.section}
                href={href}
                key={`${entry.section}-${entry.articleSlug}`}
                onClick={(event) => handleFooterSectionClick(event, entry.articleSlug, href, scrollToItemAnchor)}
              >
                <span className="front-footer__section-name">{entry.section}</span>
                <span className="front-footer__section-title">{entry.articleTitle}</span>
              </a>
            );
          })}
        </nav>
      ) : null}
      <div className="front-footer__utilities" aria-label="Publication utilities">
        {footer.utilityEntries.map((entry) => (
          entry.disabled || disableLinks ? (
            <span
              aria-disabled="true"
              className="front-footer__utility-link"
              data-footer-utility={entry.id}
              key={entry.id}
              role="link"
            >
              {entry.label}
            </span>
          ) : (
            <Link className="front-footer__utility-link" data-footer-utility={entry.id} href={entry.href} key={entry.id}>
              {entry.label}
            </Link>
          )
        ))}
      </div>
    </footer>
  );
}

function handleFooterSectionClick(
  event: ReactMouseEvent<HTMLAnchorElement>,
  articleSlug: string,
  href: string,
  scrollToItemAnchor: (articleSlug: string, options?: ScrollToPageOptions) => boolean,
) {
  event.preventDefault();
  window.history.pushState(null, "", href);
  scrollToItemAnchor(articleSlug, { history: "none" });
}

function SolvedRegionView({
  articleAnchorBlockIds,
  editionBasePath,
  layout,
  region,
}: {
  articleAnchorBlockIds: Set<string>;
  editionBasePath?: string;
  layout: NewspaperLayout;
  region: SolvedRegion;
}) {
  return (
    <section
      className={`solved-region solved-region--${region.type} continuation-section`}
      data-region-id={region.id}
      data-region-role={region.role}
      style={{ height: region.height }}
    >
      {region.blocks.map((block) => (
        <SolvedBlockView
          anchorId={articleAnchorBlockIds.has(block.id) ? block.article?.slug : undefined}
          block={block}
          editionBasePath={editionBasePath}
          key={block.id}
          layout={layout}
        />
      ))}
    </section>
  );
}

function FrontStoryBlock({
  anchorId,
  block,
  disableLinks = false,
  editionBasePath,
  scrollToPage,
}: {
  anchorId?: string;
  block: SolvedBlock;
  disableLinks?: boolean;
  editionBasePath?: string;
  index: number;
  scrollToPage: (pageNumber: number, options?: ScrollToPageOptions) => void;
}) {
  const article = block.article;
  if (!article || !block.front) return null;
  const articleHref = getArticleHref(article.slug, editionBasePath);
  const composed = Boolean(block.front.composition);
  const preludeImages = block.furniture.filter((furniture): furniture is SolvedImageFurniture => (
    furniture.kind === "image" && furniture.templateId === "front-prelude"
  ));
  const measureFurniture = block.furniture.filter((furniture): furniture is SolvedImageFurniture => (
    furniture.kind === "image" && furniture.templateId !== "front-prelude"
  ));
  if (composed) {
    return (
      <article
        className={`front-story front-story--composed ${block.span >= 4 ? "front-story--lead" : ""}`}
        data-article-id={article.slug}
        data-block-id={block.id}
        data-block-type={block.type}
        data-block-preset-id={block.presetId}
        id={anchorId}
        style={getFrontStoryStyle(block)}
      >
        {block.chromeBoxes?.map((box) => (
          <FrontChromeBoxView
            articleHref={articleHref}
            borderTopHeight={block.front?.chrome.borderTopHeight ?? 0}
            box={box}
            disableLinks={disableLinks}
            key={box.id}
          />
        ))}
        {measureFurniture.map((furniture) => (
          <LeadPhotoFigure
            furniture={{ ...furniture, y: furniture.y - (block.front?.chrome.borderTopHeight ?? 0) }}
            key={furniture.id}
          />
        ))}
        <div
          className="story-measure story-measure--composed"
          style={{
            top: Math.max(0, (block.front.composition?.bodyTop ?? block.front.chromeHeight) - block.front.chrome.borderTopHeight),
            height: block.front.composition?.bodyHeight ?? block.front.bodySlotHeight,
          }}
        >
          <div
            className="story-composition-grid"
            style={
              {
                "--paper-columns": block.columnCount,
              } as CSSProperties
            }
          >
            {block.columns.map((column, columnIndex) => (
              <div className="story-composition-column" key={columnIndex}>
                <MeasuredLines lines={column} />
              </div>
            ))}
          </div>
        </div>
        <div className="jump-line">
          {block.jumpTargetPage ? (
            disableLinks ? (
              <span>{block.jumpLabel ?? `SEE MORE ON A${block.jumpTargetPage}`}</span>
            ) : (
              <Link href={getPageHref(block.jumpTargetPage, editionBasePath)} onClick={(event) => handleJumpClick(event, block.jumpTargetPage ?? 1, scrollToPage)}>
                {block.jumpLabel ?? `SEE MORE ON A${block.jumpTargetPage}`}
              </Link>
            )
          ) : (
            disableLinks ? <span>Read the full article</span> : <Link href={articleHref}>Read the full article</Link>
          )}
        </div>
      </article>
    );
  }
  return (
    <article
      className={`front-story ${block.span >= 4 ? "front-story--lead" : ""} ${preludeImages.length > 0 ? "front-story--feature" : ""}`}
      data-article-id={article.slug}
      data-block-id={block.id}
      data-block-type={block.type}
      data-block-preset-id={block.presetId}
      id={anchorId}
      style={getFrontStoryStyle(block)}
    >
      {preludeImages.map((furniture) => <LeadPhotoFigure furniture={furniture} key={furniture.id} />)}
      <div className="story-label">{article.section}</div>
      <h2>
        {disableLinks ? <span>{article.headline}</span> : <Link href={articleHref}>{article.headline}</Link>}
      </h2>
      <p className="story-deck">{article.deck}</p>
      <div className="story-byline">{`${article.byline} / ${article.dateline}`}</div>
      <div className="story-measure" style={{ height: block.front.bodySlotHeight + block.front.chrome.measureChromeHeight }}>
        {measureFurniture.map((furniture) => <LeadPhotoFigure furniture={furniture} key={furniture.id} />)}
        <MeasuredLines lines={block.columns[0] ?? []} />
      </div>
      <div className="jump-line">
        {block.jumpTargetPage ? (
          disableLinks ? (
            <span>{block.jumpLabel ?? `SEE MORE ON A${block.jumpTargetPage}`}</span>
          ) : (
            <Link href={getPageHref(block.jumpTargetPage, editionBasePath)} onClick={(event) => handleJumpClick(event, block.jumpTargetPage ?? 1, scrollToPage)}>
              {block.jumpLabel ?? `SEE MORE ON A${block.jumpTargetPage}`}
            </Link>
          )
        ) : (
          disableLinks ? <span>Read the full article</span> : <Link href={articleHref}>Read the full article</Link>
        )}
      </div>
    </article>
  );
}

function handleJumpClick(event: ReactMouseEvent<HTMLAnchorElement>, pageNumber: number, scrollToPage: (pageNumber: number) => void) {
  event.preventDefault();
  scrollToPage(pageNumber);
}

function FrontChromeBoxView({
  articleHref,
  borderTopHeight,
  box,
  disableLinks = false,
}: {
  articleHref: string;
  borderTopHeight: number;
  box: SolvedChromeBox;
  disableLinks?: boolean;
}) {
  const style = getChromeBoxStyle(box, borderTopHeight);
  if (box.slot === "headline") {
    return (
      <h2 className="front-chrome-box front-chrome-box--headline" data-chrome-slot={box.slot} style={style}>
        {disableLinks ? <span>{box.text}</span> : <Link href={articleHref}>{box.text}</Link>}
      </h2>
    );
  }
  if (box.slot === "deck") {
    return (
      <p className="front-chrome-box front-chrome-box--deck" data-chrome-slot={box.slot} style={style}>
        {box.text}
      </p>
    );
  }
  return (
    <div className={`front-chrome-box front-chrome-box--${box.slot}`} data-chrome-slot={box.slot} style={style}>
      {box.text}
    </div>
  );
}

function SolvedBlockView({
  anchorId,
  block,
  editionBasePath,
  layout,
}: {
  anchorId?: string;
  block: SolvedBlock;
  editionBasePath?: string;
  layout: NewspaperLayout;
}) {
  if (block.type === "articleFrame" && block.article) {
    return <ArticleFrameBlock anchorId={anchorId} block={block} editionBasePath={editionBasePath} layout={layout} />;
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

function ArticleFrameBlock({ anchorId, block, editionBasePath, layout }: { anchorId?: string; block: SolvedBlock; editionBasePath?: string; layout: NewspaperLayout }) {
  const article = block.article;
  if (!article) return null;
  return (
    <article
      className={`solved-block solved-block--articleFrame continuation-section ${block.furniture.some((item) => item.kind === "image") ? "continuation-section--has-photo" : ""}`}
      data-article-id={article.slug}
      data-block-id={block.id}
      data-block-type={block.type}
      data-block-preset-id={block.presetId}
      id={anchorId}
      style={getArticleBlockStyle(layout, block)}
    >
      <div className="continued-title">
        <p>{block.label ?? article.section}</p>
        <h2>
          <Link href={getArticleHref(article.slug, editionBasePath)}>{article.headline}</Link>
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
  const prelude = furniture.templateId === "front-prelude";
  return (
    <figure
      className={prelude ? "front-prelude-photo" : "lead-photo"}
      data-furniture-kind="image"
      style={getImageFigureStyle(furniture, prelude)}
    >
      <div className="photo-frame">
        <Image
          src={furniture.src}
          alt={furniture.alt}
          fill
          sizes="(max-width: 719px) 100vw, 40vw"
          priority
          style={{ objectFit: furniture.objectFit, objectPosition: furniture.objectPosition }}
          unoptimized={shouldBypassImageOptimization(furniture.src)}
        />
      </div>
      {furniture.caption ? <figcaption>{furniture.caption}</figcaption> : null}
    </figure>
  );
}

function ContinuationPhotoFigure({ furniture }: { furniture: SolvedImageFurniture }) {
  return (
    <figure
      className={`continuation-photo continuation-photo--${furniture.templateId}`}
      data-furniture-kind="image"
      style={getImageFigureStyle(furniture)}
    >
      <div className="photo-frame">
        <Image
          src={furniture.src}
          alt={furniture.alt}
          fill
          sizes={furniture.columnSpan > 1 ? "(max-width: 719px) 100vw, 48vw" : "(max-width: 1039px) 50vw, 24vw"}
          style={{ objectFit: furniture.objectFit, objectPosition: furniture.objectPosition }}
          unoptimized={shouldBypassImageOptimization(furniture.src)}
        />
      </div>
      {furniture.caption ? <figcaption>{furniture.caption}</figcaption> : null}
    </figure>
  );
}

function getImageFigureStyle(furniture: SolvedImageFurniture, prelude = false): CSSProperties {
  return {
    ...(prelude ? {} : { left: furniture.x, top: furniture.y, width: furniture.width }),
    height: furniture.height,
    "--image-frame-height": `${furniture.imageHeight}px`,
    "--image-caption-height": `${furniture.captionHeight}px`,
    "--image-caption-font-size": `${furniture.captionFontSize}px`,
    "--image-caption-line-height": `${furniture.captionLineHeight}px`,
  } as CSSProperties;
}

function ContinuationPullQuoteAside({ furniture }: { furniture: SolvedPullQuoteFurniture }) {
  return (
    <aside
      className={`continuation-pullquote continuation-pullquote--${furniture.templateId}`}
      data-furniture-kind="pullQuote"
      style={{
        left: furniture.x,
        top: furniture.y,
        width: furniture.width,
        height: furniture.height,
        fontSize: furniture.fontSize,
        lineHeight: `${furniture.lineHeight}px`,
      }}
    >
      <span className="continuation-pullquote__text">{furniture.text}</span>
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
            fontFamily: line.fontFamily,
            fontSize: line.fontSize,
            lineHeight: `${line.lineHeight}px`,
          }}
        >
          {line.text}
        </span>
      ))}
    </div>
  );
}

function getPageStyle(layout: NewspaperLayout, pageNumber: number): CSSProperties {
  return {
    "--page-height": `${getSolvedPageHeight(layout, pageNumber)}px`,
    "--paper-rhythm": `${layout.rhythm.rowHeight}px`,
    "--paper-line-paint-height": `${layout.rhythm.paintHeight}px`,
    "--paper-row-gap": `${layout.rowGap}px`,
    "--page-padding-top": `${layout.pageChrome.pagePaddingTop}px`,
    "--page-padding-x": `${layout.pageChrome.pagePaddingX}px`,
    "--page-padding-bottom": `${layout.pageChrome.pagePaddingBottom}px`,
    "--masthead-height": `${layout.pageChrome.mastheadHeight}px`,
    "--masthead-kicker-line-height": `${layout.pageChrome.mastheadKickerLineHeight}px`,
    "--masthead-title-font-size": `${layout.pageChrome.mastheadTitleFontSize}px`,
    "--masthead-title-line-height": `${layout.pageChrome.mastheadTitleLineHeight}px`,
    "--masthead-title-margin-top": `${layout.pageChrome.mastheadTitleMarginTop}px`,
    "--masthead-title-margin-bottom": `${layout.pageChrome.mastheadTitleMarginBottom}px`,
    "--masthead-title-optical-shift": `${layout.pageChrome.mastheadTitleOpticalShift}px`,
    "--masthead-meta-line-height": `${layout.pageChrome.mastheadMetaLineHeight}px`,
    "--masthead-meta-gap": `${layout.pageChrome.mastheadMetaGap}px`,
    "--masthead-meta-padding-top": `${layout.pageChrome.mastheadMetaPaddingTop}px`,
    "--front-grid-margin-top": `${layout.pageChrome.frontGridMarginTop}px`,
    "--inside-header-height": `${layout.pageChrome.insideHeaderHeight}px`,
    "--continuation-section-separator-height": `${layout.pageChrome.continuationSectionSeparatorHeight}px`,
    "--continued-title-font-size": `${layout.pageChrome.continuedTitleFontSize}px`,
    "--continued-title-line-height": `${layout.pageChrome.continuedTitleLineHeight}px`,
  } as CSSProperties;
}

function getSolvedPageHeight(layout: NewspaperLayout, pageNumber: number): number {
  return layout.pageHeights[pageNumber] ?? layout.pageHeight;
}

function getFrontStoryStyle(block: SolvedBlock): CSSProperties {
  const front = block.front;
  if (!front) return {};
  const chrome = front.chrome;
  const gridPlacement = front.gridPlacement;
  return {
    gridColumn: gridPlacement ? `${gridPlacement.columnStart + 1} / span ${gridPlacement.columnSpan}` : `span ${block.span}`,
    gridRow: gridPlacement ? `${gridPlacement.rowStart + 1} / span ${gridPlacement.rowSpan}` : undefined,
    "--story-row-height": `${front.rowHeight}px`,
    "--story-border-top": `${chrome.borderTopHeight}px`,
    "--story-padding-top": `${chrome.paddingTop}px`,
    "--story-measure-chrome-height": `${chrome.measureChromeHeight}px`,
    "--story-media-prelude-height": `${chrome.mediaPreludeHeight}px`,
    "--story-media-prelude-margin-bottom": `${chrome.mediaPreludeMarginBottom}px`,
    "--story-label-font-size": `${chrome.labelFontSize}px`,
    "--story-label-line-height": `${chrome.labelLineHeight}px`,
    "--story-label-height": `${chrome.labelHeight}px`,
    "--story-label-paint-buffer": `${chrome.labelPaintBuffer}px`,
    "--story-headline-font-size": `${chrome.headlineFontSize}px`,
    "--story-headline-line-height": `${chrome.headlineLineHeight}px`,
    "--story-headline-height": `${chrome.headlineHeight}px`,
    "--story-headline-paint-buffer": `${chrome.headlinePaintBuffer}px`,
    "--story-headline-margin-top": `${chrome.headlineMarginTop}px`,
    "--story-headline-margin-bottom": `${chrome.headlineMarginBottom}px`,
    "--story-deck-font-size": `${chrome.deckFontSize}px`,
    "--story-deck-line-height": `${chrome.deckLineHeight}px`,
    "--story-deck-height": `${chrome.deckHeight}px`,
    "--story-deck-paint-buffer": `${chrome.deckPaintBuffer}px`,
    "--story-deck-padding-top": `${chrome.deckPaddingTop}px`,
    "--story-deck-padding-bottom": `${chrome.deckPaddingBottom}px`,
    "--story-deck-rule-top-height": `${chrome.deckRuleTopHeight}px`,
    "--story-deck-rule-bottom-height": `${chrome.deckRuleBottomHeight}px`,
    "--story-deck-margin-bottom": `${chrome.deckMarginBottom}px`,
    "--story-byline-font-size": `${chrome.bylineFontSize}px`,
    "--story-byline-line-height": `${chrome.bylineLineHeight}px`,
    "--story-byline-height": `${chrome.bylineHeight}px`,
    "--story-byline-paint-buffer": `${chrome.bylinePaintBuffer}px`,
    "--story-byline-padding-top": `${chrome.bylinePaddingTop}px`,
    "--story-byline-padding-bottom": `${chrome.bylinePaddingBottom}px`,
    "--story-byline-margin-bottom": `${chrome.bylineMarginBottom}px`,
    "--story-jump-height": `${front.jumpReserveHeight}px`,
    "--story-jump-font-size": `${chrome.jumpFontSize}px`,
    "--story-jump-line-height": `${chrome.jumpLineHeight}px`,
    "--story-jump-paint-buffer": `${chrome.jumpPaintBuffer}px`,
    "--story-jump-padding-top": `${chrome.jumpPaddingTop}px`,
    "--story-jump-padding-bottom": `${chrome.jumpPaddingBottom}px`,
    "--story-jump-border-top": `${chrome.jumpBorderTopHeight}px`,
  } as CSSProperties;
}

function getChromeBoxStyle(box: SolvedChromeBox, borderTopHeight: number): CSSProperties {
  return {
    left: box.x,
    top: Math.max(0, box.y - borderTopHeight),
    width: box.width,
    height: box.height,
    fontSize: box.fontSize,
    lineHeight: `${box.lineHeight}px`,
    fontWeight: box.fontWeight,
    fontStyle: box.fontStyle,
    textTransform: box.textTransform,
    "--chrome-box-paint-buffer": `${box.paintBuffer}px`,
    "--chrome-box-padding-top": `${box.paddingTop ?? 0}px`,
    "--chrome-box-padding-bottom": `${box.paddingBottom ?? 0}px`,
    "--chrome-box-rule-top-height": `${box.ruleTopHeight ?? 0}px`,
    "--chrome-box-rule-bottom-height": `${box.ruleBottomHeight ?? 0}px`,
  } as CSSProperties;
}

function getArticleBlockStyle(layout: NewspaperLayout, block: SolvedBlock): CSSProperties {
  const image = block.furniture.find((item): item is SolvedImageFurniture => item.kind === "image");
  const pullQuote = block.furniture.find((item): item is SolvedPullQuoteFurniture => item.kind === "pullQuote");
  const title = block.titleChrome;
  return {
    width: block.width,
    height: block.height,
    minHeight: block.height,
    "--continued-title-height": `${title?.totalHeight ?? 0}px`,
    "--continued-kicker-font-size": `${title?.label.fontSize ?? 11.5}px`,
    "--continued-kicker-line-height": `${title?.label.lineHeight ?? 14}px`,
    "--continued-kicker-height": `${title?.label.height ?? 14}px`,
    "--continued-kicker-paint-buffer": `${title?.label.paintBuffer ?? 0}px`,
    "--continued-title-font-size": `${title?.heading.fontSize ?? layout.pageChrome.continuedTitleFontSize}px`,
    "--continued-title-line-height": `${title?.heading.lineHeight ?? layout.pageChrome.continuedTitleLineHeight}px`,
    "--continued-title-heading-height": `${title?.heading.height ?? block.titleHeight ?? 0}px`,
    "--continued-title-heading-paint-buffer": `${title?.heading.paintBuffer ?? 0}px`,
    "--continued-title-heading-margin-top": `${title?.heading.marginBefore ?? 5}px`,
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

function computeMaterializedPages(visiblePage: number, priorityPages: Set<number>, totalPages: number): Set<number> {
  const pages = new Set<number>();
  for (const pageNumber of priorityPages) addMaterializedWindow(pages, pageNumber, totalPages);
  addMaterializedWindow(pages, visiblePage, totalPages);
  return pages;
}

function computeArticleAnchors(layout: NewspaperLayout | null): { pages: Map<string, number>; blockIds: Set<string> } {
  const pages = new Map<string, number>();
  const blockIds = new Set<string>();
  if (!layout) return { pages, blockIds };

  for (const page of layout.pages) {
    for (const region of page.regions) {
      for (const block of region.blocks) {
        const slug = block.article?.slug;
        if (!slug || pages.has(slug)) continue;
        pages.set(slug, page.pageNumber);
        blockIds.add(block.id);
      }
    }
  }

  return { pages, blockIds };
}

function addMaterializedWindow(pages: Set<number>, center: number, totalPages: number) {
  for (let delta = -PAGE_LOOKAROUND; delta <= PAGE_LOOKAROUND; delta += 1) {
    const candidate = clampPageNumber(center + delta, totalPages);
    pages.add(candidate);
  }
}

function useVisiblePageObserver(
  layout: NewspaperLayout | null,
  setVisiblePage: React.Dispatch<React.SetStateAction<number>>,
  pageRefs: React.MutableRefObject<Map<number, HTMLElement>>,
) {
  useEffect(() => {
    if (!layout) return;
    const ratios = new Map<number, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageNumber = Number((entry.target as HTMLElement).dataset.pageNumber ?? 0);
          if (!pageNumber) continue;
          ratios.set(pageNumber, entry.intersectionRatio);
        }
        let bestPage = 1;
        let bestRatio = -1;
        for (const page of layout.pages) {
          const ratio = ratios.get(page.pageNumber) ?? 0;
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestPage = page.pageNumber;
          }
        }
        setVisiblePage(bestPage);
      },
      {
        root: null,
        threshold: [0, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 1],
      },
    );

    for (const page of layout.pages) {
      const node = pageRefs.current.get(page.pageNumber);
      if (!node) continue;
      node.dataset.pageNumber = String(page.pageNumber);
      observer.observe(node);
    }
    return () => observer.disconnect();
  }, [layout, pageRefs, setVisiblePage]);
}

function getPageAnchorId(pageNumber: number): string {
  return `page-${pageNumber}`;
}

function clampPageNumber(pageNumber: number, totalPages: number): number {
  if (totalPages <= 0) return 1;
  return Math.max(1, Math.min(pageNumber, totalPages));
}

function parseHashPageNumber(hash: string): number | null {
  const match = hash.match(/^#page-(\d+)$/i);
  if (!match) return null;
  return Number(match[1]);
}

function parseItemAnchorHash(hash: string): string | null {
  if (!hash || parseHashPageNumber(hash)) return null;
  try {
    const value = decodeURIComponent(hash.slice(1)).trim();
    return /^[a-z0-9][a-z0-9-]*$/i.test(value) ? value : null;
  } catch {
    return null;
  }
}

function parsePageNumberFromPath(pathname: string, editionBasePath: string): number | null {
  const basePath = normalizePath(editionBasePath);
  const currentPath = normalizePath(pathname);
  if (currentPath === basePath) return 1;

  const match = currentPath.match(new RegExp(`^${escapeRegExp(basePath)}/page/(\\d+)$`));
  if (!match) return null;
  return Number(match[1]);
}

function writePageLocation(pageNumber: number, mode: NonNullable<ScrollToPageOptions["history"]>, editionBasePath?: string) {
  if (mode === "none") return;

  const url = editionBasePath ? getPageHref(pageNumber, editionBasePath) : `${window.location.pathname}${window.location.search}#${getPageAnchorId(pageNumber)}`;
  if (`${window.location.pathname}${window.location.search}${window.location.hash}` === url) return;

  if (mode === "push") {
    window.history.pushState(null, "", url);
    return;
  }

  window.history.replaceState(null, "", url);
}

function getPageHref(pageNumber: number, editionBasePath?: string): string {
  if (!editionBasePath) return `#${getPageAnchorId(pageNumber)}`;
  const basePath = normalizePath(editionBasePath);
  return pageNumber <= 1 ? basePath : `${basePath}/page/${pageNumber}`;
}

function getArticleHref(articleSlug: string, editionBasePath?: string): string {
  return editionBasePath ? `${normalizePath(editionBasePath)}/${encodeURIComponent(articleSlug)}` : `/articles/${articleSlug}`;
}

function getItemAnchorHref(articleSlug: string, pageNumber: number, editionBasePath?: string): string {
  const anchor = `#${encodeURIComponent(articleSlug)}`;
  if (!editionBasePath) return anchor;
  return `${getPageHref(pageNumber, editionBasePath)}${anchor}`;
}

function normalizePath(pathname: string): string {
  const path = pathname.endsWith("/") && pathname !== "/" ? pathname.slice(0, -1) : pathname;
  return path || "/";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isEditableEventTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  const tagName = target.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") return true;

  return target.isContentEditable || target.closest("[contenteditable='true']") !== null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
