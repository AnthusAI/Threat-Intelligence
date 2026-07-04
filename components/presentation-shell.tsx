"use client";

import Link from "next/link";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { findEditionSection, getEditionSectionItems } from "../lib/edition-sections";
import { buildPresentationFooterEntries, type PresentationFooterEntry } from "../lib/presentation-footer";
import {
  createThreatIntelligenceBlogTextStyle,
  createThreatIntelligenceRhythm,
  getMeasuredTextHeight,
  reserveRhythmRows,
  TI_COPY_ROW_MULTIPLE,
} from "../lib/blog-rhythm";
import {
  solveFeaturedItem,
} from "../lib/blog-feature-solver";
import { layoutAllTextLines, prepareWithSegments, type TextLine } from "../lib/pretext-layout";
import { truncateWords } from "../lib/excerpts";
import {
  getPublicationItemImageAssets,
  getPublicationItemVideoAsset,
  type PublicationItem,
} from "../lib/publication-items";
import type { EditionContent, EditionPresentationFormat, EditionSection } from "../lib/content-types";
import type { ArticleVideoAsset } from "../lib/articles";
import type { VideoScriptRef } from "../lib/video-script";
import { SITE_BRAND, enforcePresentation } from "../lib/site-brand";
import { ArticleVideoFigure } from "./article-video";
import { PresentationRhythmHRule } from "./presentation-rhythm-hrule";
import { BlogPageBackground } from "../publications/threat_intelligence/blog-defense/page-background";
import { Newspaper } from "./newspaper";
import { PictogramFigure } from "../publications/threat_intelligence/pictograms/figure";
import { PresentationFooter } from "./presentation-footer";
import { getSectionAnchorId, PresentationHeader } from "./presentation-header";
import { readLocalReaderSettings, resolveReaderSettings, subscribeReaderSettingsChanges } from "./reader-settings";
import { useRhythmOverlay } from "./use-rhythm-overlay";

type PresentationShellProps = {
  content: EditionContent;
  editionBasePath?: string;
  mastheadHomeHref?: string;
  initialPageNumber?: number;
  lockedPresentation?: EditionPresentationFormat;
  target?: PresentationTarget;
};

export type PresentationTarget =
  | { kind: "edition" }
  | { kind: "section"; sectionKey: string };

type PapyrusTestWindow = Window & typeof globalThis & {
  __PAPYRUS_SCENARIO__?: string;
};

const PRESENTATION_TEXT_FONT = SITE_BRAND.textFont;
const BLOG_TEXT_STYLE = createThreatIntelligenceBlogTextStyle(PRESENTATION_TEXT_FONT);
const BLOG_RHYTHM = createThreatIntelligenceRhythm();
const MAGAZINE_TEXT_STYLE = {
  fontSize: 17,
  lineHeight: 25,
  linePaintHeight: 22,
  fontFamily: PRESENTATION_TEXT_FONT,
};

export function PresentationShell({
  content,
  editionBasePath,
  mastheadHomeHref,
  initialPageNumber = 1,
  lockedPresentation,
  target = { kind: "edition" },
}: PresentationShellProps) {
  const defaultPresentation = enforcePresentation(content.defaultPresentation ?? SITE_BRAND.defaultPresentation);
  const [preferredPresentation, setPreferredPresentation] = useState<EditionPresentationFormat>(defaultPresentation);
  const activePresentation = enforcePresentation(lockedPresentation ?? preferredPresentation);
  const targetSection = target.kind === "section" ? findEditionSection(content.sections, target.sectionKey) : undefined;

  useEffect(() => {
    if (lockedPresentation) return;
    const localSettings = readLocalReaderSettings();
    setPreferredPresentation(enforcePresentation(localSettings.presentation));
    const unsubscribe = subscribeReaderSettingsChanges((settings) => {
      setPreferredPresentation(enforcePresentation(settings.presentation));
    });
    void resolveReaderSettings()
      .then((resolution) => setPreferredPresentation(enforcePresentation(resolution.settings.presentation)))
      .catch(() => undefined);
    return unsubscribe;
  }, [lockedPresentation]);

  if (activePresentation === "newspaper") {
    return (
      <PresentationFrame>
        <Newspaper
          content={content}
          editionBasePath={editionBasePath}
          mastheadHomeHref={mastheadHomeHref}
          initialPageNumber={initialPageNumber}
          initialSectionKey={targetSection?.key}
          preserveContentLocation={Boolean(targetSection)}
        />
      </PresentationFrame>
    );
  }

  const presentationProps = {
    content,
    editionBasePath,
    targetSection,
  };

  return (
    <PresentationFrame>
      {activePresentation === "blog" ? (
        <BlogPresentation {...presentationProps} />
      ) : (
        <MagazinePresentation {...presentationProps} />
      )}
    </PresentationFrame>
  );
}

function PresentationFrame({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function BlogPresentation({
  content,
  editionBasePath,
  targetSection,
}: {
  content: EditionContent;
  editionBasePath?: string;
  targetSection?: EditionSection;
}) {
  const sections = content.sections;
  const footerEntries = useMemo(() => buildPresentationFooterEntries(content), [content]);
  const footerSubtitle = SITE_BRAND.id === "papyrus" ? (content.description?.trim() || "Inside Papyrus") : SITE_BRAND.mastheadSubtitle;
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLElement | null>(null);
  const showRhythmOverlay = useRhythmOverlay();
  const headerObstacles = useBlogHeaderObstacles(pageRef);
  usePresentationTargetScroll(targetSection);
  useEffect(() => {
    (window as PapyrusTestWindow).__PAPYRUS_SCENARIO__ = content.scenarioId;
    return () => {
      delete (window as PapyrusTestWindow).__PAPYRUS_SCENARIO__;
    };
  }, [content.scenarioId]);
  return (
    <main
      className="presentation-page presentation-page--blog blog-rhythm-shell"
      data-presentation-engine="blog"
      data-rhythm-overlay={showRhythmOverlay ? "true" : "false"}
      ref={pageRef}
      style={{
        "--ti-rhythm": `${BLOG_RHYTHM.rowHeight / TI_COPY_ROW_MULTIPLE}px`,
        "--ti-row-height": `${BLOG_RHYTHM.rowHeight}px`,
        "--ti-paint-buffer": `${BLOG_RHYTHM.paintBuffer}px`,
        "--ti-paint-height": `${BLOG_RHYTHM.paintHeight}px`,
      } as CSSProperties}
    >
      <BlogPageBackground headerObstacles={headerObstacles} pageRef={pageRef} rhythm={BLOG_RHYTHM} />
      <PresentationHeader
        description={content.description}
        editionBasePath={editionBasePath}
        editionDate={content.editionDate}
        sections={content.sections}
        title={content.title}
      />
      <div className="blog-sections" ref={contentRef}>
        {sections.map((section, sectionIndex) => (
          <section className="blog-section" data-edition-section={section.key} id={getSectionAnchorId(section.key)} key={section.key}>
            {sectionIndex === 0 && content.editionVideo ? (
              <EditionOverviewVideo
                editionVideo={content.editionVideo}
                videoScript={content.videoScripts?.["edition-overview"] ?? null}
              />
            ) : null}
            <header className="presentation-section-header">
              <div className="presentation-section-header__band">
                <p>{section.label}</p>
              </div>
              {section.description ? <span>{section.description}</span> : null}
            </header>
            {getEditionSectionItems(section, content.items).flatMap((item, index) => {
              const elements = [];
              if (index > 0) {
                elements.push(
                  <PresentationRhythmHRule
                    hideInSecondaryPair={index === 2}
                    key={`hrule-before-${item.slug}`}
                  />,
                );
              }
              elements.push(
                <PresentationItem
                  editionBasePath={editionBasePath}
                  index={index}
                  item={item}
                  key={item.slug}
                  mode="blog"
                  videoScript={content.videoScripts?.[item.slug] ?? null}
                />,
              );
              return elements;
            })}
          </section>
        ))}
      </div>
      <PresentationFooter
        editionBasePath={editionBasePath}
        entries={footerEntries}
        onSectionClick={handleBlogFooterSectionClick}
        resolveSectionHref={(entry) => getBlogFooterSectionHref(entry, editionBasePath)}
        subtitle={SITE_BRAND.footerSubtitleOverride ?? footerSubtitle}
        title={SITE_BRAND.footerTitle}
      />
    </main>
  );
}

function MagazinePresentation({
  content,
  editionBasePath,
  targetSection,
}: {
  content: EditionContent;
  editionBasePath?: string;
  targetSection?: EditionSection;
}) {
  const sections = targetSection ? [targetSection] : content.sections;
  usePresentationTargetScroll(targetSection);
  return (
    <main className="presentation-page presentation-page--magazine" data-presentation-engine="magazine">
      <PresentationHeader
        description={content.description}
        editionBasePath={editionBasePath}
        editionDate={content.editionDate}
        sections={content.sections}
        title={content.title}
      />
      <div className="magazine-sections">
        {sections.map((section) => {
          const items = getEditionSectionItems(section, content.items);
          return (
            <section className="magazine-section" data-edition-section={section.key} id={getSectionAnchorId(section.key)} key={section.key}>
              <header className="presentation-section-header presentation-section-header--magazine">
                <p>{section.label}</p>
                {section.description ? <span>{section.description}</span> : null}
              </header>
              <div className="magazine-spread">
                {items.map((item, index) => (
                  <PresentationItem
                    editionBasePath={editionBasePath}
                    item={item}
                    key={item.slug}
                    mode={index === 0 ? "magazine-feature" : "magazine"}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}

function EditionOverviewVideo({
  editionVideo,
  videoScript,
}: {
  editionVideo: ArticleVideoAsset;
  videoScript?: VideoScriptRef | null;
}) {
  return (
    <section className="presentation-edition-video" aria-label={editionVideo.alt}>
      <ArticleVideoFigure
        figureClassName="presentation-edition-video__figure article-video"
        slug="edition-overview"
        video={editionVideo}
        videoScript={videoScript}
      />
    </section>
  );
}

function PresentationItem({
  editionBasePath,
  index,
  item,
  mode,
  videoScript = null,
}: {
  editionBasePath?: string;
  index?: number;
  item: PublicationItem;
  mode: "blog" | "magazine" | "magazine-feature";
  videoScript?: VideoScriptRef | null;
}) {
  const articleRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const containerWidth = useMeasuredWidth(articleRef);
  const frameWidth = useMeasuredWidth(frameRef);
  const viewportWidth = useViewportWidth();
  const image = getPublicationItemImageAssets(item)[0];
  const video = getPublicationItemVideoAsset(item);
  const textStyle = mode === "blog" ? BLOG_TEXT_STYLE : MAGAZINE_TEXT_STYLE;
  const text = getPresentationBodyText(item, mode);
  const itemRole = getPresentationItemRole(mode, index);
  const isFeaturedBlogItem = mode === "blog" && Boolean(image);
  const featuredLayout = useMemo(() => {
    if (!isFeaturedBlogItem || !containerWidth || !image) return null;
    return solveFeaturedItem({
      text,
      containerWidth,
      viewportWidth,
      rhythm: BLOG_RHYTHM,
      textStyle,
      imageAsset: image,
      itemIndex: index,
    });
  }, [containerWidth, image, index, isFeaturedBlogItem, text, textStyle, viewportWidth]);
  const lines = useMemo(() => {
    if (featuredLayout) return featuredLayout.textLines;
    const maxWidth = frameWidth || containerWidth;
    if (!maxWidth || !text.trim()) return [];
    return layoutAllTextLines({
      prepared: prepareWithSegments(text, `${textStyle.fontSize}px ${textStyle.fontFamily}`, { whiteSpace: "pre-wrap" }),
      maxWidth,
      ...textStyle,
    });
  }, [containerWidth, featuredLayout, frameWidth, text, textStyle]);
  const textHeight = featuredLayout?.textFrameHeight ?? reserveRhythmRows(getMeasuredTextHeight(lines), BLOG_RHYTHM);
  const layoutMode = featuredLayout?.mode ?? "stacked";
  const directHref = editionBasePath ? `${editionBasePath}/${encodeURIComponent(item.slug)}` : `/articles/${encodeURIComponent(item.slug)}`;
  const itemStyle = featuredLayout
    ? ({
        "--feature-copy-width": `${featuredLayout.copyWidth}px`,
        "--feature-image-width": `${featuredLayout.imageWidth}px`,
        "--feature-image-height": `${featuredLayout.imageHeight}px`,
        "--feature-media-height": `${featuredLayout.mediaHeight}px`,
        "--feature-text-frame-height": `${featuredLayout.textFrameHeight}px`,
        "--feature-layout-gap": `${featuredLayout.gap}px`,
      } as CSSProperties)
    : undefined;

  return (
    <article
      className={`presentation-item presentation-item--${mode}`}
      data-feature-layout={isFeaturedBlogItem ? layoutMode : undefined}
      data-item-id={item.slug}
      data-item-index={index}
      data-item-role={itemRole}
      data-item-type={item.type}
      data-has-image={image ? "true" : "false"}
      data-has-video={video ? "true" : "false"}
      id={item.slug}
      ref={articleRef}
      style={itemStyle}
    >
      <div className="presentation-item__copy">
        <header className="presentation-item__header">
          <p>{item.section ?? "General"}</p>
          <h2>
            <Link href={directHref}>{getPresentationTitle(item)}</Link>
          </h2>
          {item.deck ? <span>{item.deck}</span> : null}
        </header>
        {mode === "blog" ? (
          <div className="presentation-item__body">
            {image ? (
              <div className="presentation-item__media">
                <PictogramFigure
                  alt={image.alt}
                  caption={image.caption}
                  credit={image.credit}
                  figureClassName="presentation-item__image"
                  frameHeight={featuredLayout?.imageHeight}
                  frameWidth={featuredLayout?.imageWidth}
                  layout={image.layout}
                  sizes="(max-width: 900px) 100vw, 760px"
                  slug={item.slug}
                  src={image.src}
                  themeVariants={image.themeVariants}
                />
              </div>
            ) : null}
            <div
              className="presentation-item__text-frame"
              data-layout-mode={layoutMode}
              ref={frameRef}
              style={{ height: textHeight }}
            >
              <MeasuredPresentationLines lines={lines} />
            </div>
            <Link
              className="presentation-item__cta"
              href={directHref}
            >
              Read Article
            </Link>
          </div>
        ) : (
          <div className="presentation-item__text-frame" ref={frameRef} style={{ height: textHeight }}>
            <MeasuredPresentationLines lines={lines} />
          </div>
        )}
      </div>
      {image && mode !== "blog" ? (
        <div className="presentation-item__media">
          <PictogramFigure
            alt={image.alt}
            caption={image.caption}
            credit={image.credit}
            figureClassName="presentation-item__image"
            frameHeight={featuredLayout?.imageHeight}
            frameWidth={featuredLayout?.imageWidth}
            layout={image.layout}
            sizes="(max-width: 900px) 100vw, 50vw"
            slug={item.slug}
            src={image.src}
            themeVariants={image.themeVariants}
          />
        </div>
      ) : null}
      {video && mode === "blog" ? (
        <div className="presentation-item__video">
          <ArticleVideoFigure
            figureClassName="presentation-item__video-figure article-video"
            slug={item.slug}
            video={video}
            videoScript={videoScript}
          />
        </div>
      ) : null}
    </article>
  );
}

function getPresentationItemRole(mode: "blog" | "magazine" | "magazine-feature", index?: number): "lead" | "secondary" {
  if (mode === "magazine-feature") return "lead";
  if (mode === "blog" && index === 0) return "lead";
  return "secondary";
}

function MeasuredPresentationLines({ lines }: { lines: TextLine[] }) {
  return (
    <div className="presentation-measured-lines">
      {lines.map((line, index) => (
        <span
          className="presentation-measured-line"
          key={`${index}-${line.text}`}
          style={{
            "--line-font-family": line.fontFamily,
            "--line-font-size": `${line.fontSize}px`,
            "--line-height": `${line.lineHeight}px`,
            "--line-paint-height": `${line.paintHeight}px`,
            left: line.x,
            top: line.y,
          } as CSSProperties}
        >
          {line.text}
        </span>
      ))}
    </div>
  );
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

type BlogHeaderObstacle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function useBlogHeaderObstacles(pageRef: RefObject<HTMLElement | null>): BlogHeaderObstacle[] {
  const [obstacles, setObstacles] = useState<BlogHeaderObstacle[]>([]);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;

    const update = () => {
      const pageRect = page.getBoundingClientRect();
      const background = page.querySelector<HTMLElement>(".blog-page-background");
      const backgroundRect = background?.getBoundingClientRect();
      if (!backgroundRect) return;

      const selectors = [
        ".presentation-header__eyebrow",
        ".presentation-header__word",
        ".presentation-header__meta",
        ".presentation-header__subtitle",
        ".presentation-header__date",
        ".presentation-header__tagline",
        ".presentation-section-nav a",
      ];
      // Block-level header elements span the full page width even when their
      // text ends mid-line, and a full-width obstacle would sever the margin
      // rails of the defense graph. Measure the rendered content instead of
      // the element box so obstacles stay as tight as the visible text.
      const measureObstacleRect = (element: HTMLElement): DOMRect => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const contentRect = range.getBoundingClientRect();
        range.detach();
        if (contentRect.width > 0 && contentRect.height > 0) return contentRect;
        return element.getBoundingClientRect();
      };

      const next: BlogHeaderObstacle[] = [];
      for (const selector of selectors) {
        const elements = Array.from(page.querySelectorAll<HTMLElement>(selector));
        for (const element of elements) {
          const rect = measureObstacleRect(element);
          const intersectionTop = Math.max(rect.top, backgroundRect.top);
          const intersectionBottom = Math.min(rect.bottom, backgroundRect.bottom);
          const intersectionLeft = Math.max(rect.left, backgroundRect.left);
          const intersectionRight = Math.min(rect.right, backgroundRect.right);
          const width = intersectionRight - intersectionLeft;
          const height = intersectionBottom - intersectionTop;
          if (width <= 0 || height <= 0) continue;
          next.push({
            x: intersectionLeft - backgroundRect.left,
            y: intersectionTop - backgroundRect.top,
            width,
            // A tight buffer around the exact measured glyph box: enough to keep
            // graph ink off the text without inflating to a full rhythm row,
            // which would make the obstacle far taller than the real line.
            height: height + BLOG_RHYTHM.paintBuffer * 2,
          });
        }
      }
      setObstacles(next);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(page);
    window.addEventListener("resize", update);
    void document.fonts?.ready.then(update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [pageRef]);

  return obstacles;
}

function usePresentationTargetScroll(targetSection: EditionSection | undefined) {
  useEffect(() => {
    const scrollToCurrentTarget = () => {
      const hashTarget = parseItemAnchorHash(window.location.hash);
      const targetId = hashTarget ?? (targetSection ? getSectionAnchorId(targetSection.key) : null);
      if (!targetId) return;
      document.getElementById(targetId)?.scrollIntoView({ block: "start" });
    };
    requestAnimationFrame(scrollToCurrentTarget);
    window.addEventListener("hashchange", scrollToCurrentTarget);
    return () => window.removeEventListener("hashchange", scrollToCurrentTarget);
  }, [targetSection]);
}

function getPresentationTitle(item: PublicationItem): string {
  return item.type === "article" ? item.headline : item.title;
}

function getPresentationBodyText(item: PublicationItem, mode: "blog" | "magazine" | "magazine-feature"): string {
  const body = item.type === "article" ? item.body.join("\n\n") : (item.body ?? []).join("\n\n");
  if (mode !== "blog") return body;
  const excerpt = String(item.excerpt ?? "").trim();
  if (excerpt) return excerpt;
  return truncateWords(body, 80);
}

function parseItemAnchorHash(hash: string): string | null {
  if (!hash) return null;
  try {
    const value = decodeURIComponent(hash.slice(1)).trim();
    return /^[a-z0-9][a-z0-9-]*$/i.test(value) ? value : null;
  } catch {
    return null;
  }
}

function getBlogFooterSectionHref(entry: PresentationFooterEntry, editionBasePath?: string): string {
  const anchor = `#${getSectionAnchorId(entry.sectionKey)}`;
  return editionBasePath ? `${editionBasePath}${anchor}` : anchor;
}

function handleBlogFooterSectionClick(
  event: ReactMouseEvent<HTMLAnchorElement>,
  entry: PresentationFooterEntry,
  href: string,
) {
  event.preventDefault();
  window.history.pushState(null, "", href);
  document.getElementById(getSectionAnchorId(entry.sectionKey))?.scrollIntoView({ block: "start" });
}
