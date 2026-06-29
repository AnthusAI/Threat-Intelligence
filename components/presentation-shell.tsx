"use client";

import Image from "next/image";
import Link from "next/link";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { findEditionSection, getEditionSectionItems } from "../lib/edition-sections";
import { getEditionSectionPath } from "../lib/edition-routes";
import { shouldBypassImageOptimization } from "../lib/image-url";
import { layoutAllTextLines, prepareWithSegments, type TextLine } from "../lib/pretext-layout";
import { truncateWords } from "../lib/excerpts";
import {
  getPublicationItemImageAssets,
  type PublicationItem,
} from "../lib/publication-items";
import type { EditionContent, EditionPresentationFormat, EditionSection } from "../lib/content-types";
import { SITE_BRAND, enforcePresentation } from "../lib/site-brand";
import { BlogPageBackground } from "./blog-page-background";
import { Newspaper } from "./newspaper";
import { ReaderAuthControl } from "./reader-auth-control";
import { readLocalReaderSettings, resolveReaderSettings, subscribeReaderSettingsChanges } from "./reader-settings";

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

const SERIF_TEXT_FONT = 'Georgia, "Times New Roman", serif';
const SANS_TEXT_FONT = 'system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif';
const PRESENTATION_TEXT_FONT = SITE_BRAND.id === "threat-intelligence" ? SANS_TEXT_FONT : SERIF_TEXT_FONT;
const BLOG_TEXT_STYLE = {
  fontSize: 18,
  lineHeight: 28,
  linePaintHeight: 24,
  fontFamily: PRESENTATION_TEXT_FONT,
};
const MAGAZINE_TEXT_STYLE = {
  fontSize: 17,
  lineHeight: 25,
  linePaintHeight: 22,
  fontFamily: PRESENTATION_TEXT_FONT,
};

type PresentationFooterEntry = {
  section: string;
  sectionKey: string;
  articleSlug: string;
  articleTitle: string;
};

type PresentationFooterUtilityEntry =
  | {
      id: "archive";
      label: string;
      href: string;
      disabled: false;
    }
  | {
      id: "newsDesk";
      label: string;
      href: string;
      disabled: false;
    }
  | {
      id: "settings";
      label: string;
      href: string;
      disabled: false;
    }
  | {
      id: "login";
      label: string;
      disabled: true;
    };

type PresentationFooterGeometry = {
  height: number;
  marginTop: number;
  rowHeight: number;
  sectionColumns: number;
  sectionRows: number;
};

const PRESENTATION_FOOTER_UTILITIES: PresentationFooterUtilityEntry[] = [
  { id: "archive", label: "Archive", href: "/archive", disabled: false },
  { id: "newsDesk", label: "Newsroom", href: "/newsroom", disabled: false },
  { id: "settings", label: "Settings", href: "/settings", disabled: false },
  { id: "login", label: "LOGIN", disabled: true },
];

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

function PresentationFooter({
  disableLinks = false,
  editionBasePath,
  entries,
  geometry,
  onSectionClick,
  resolveSectionHref,
  subtitle,
  title,
  utilityEntries = PRESENTATION_FOOTER_UTILITIES,
  variant = "presentation",
}: {
  disableLinks?: boolean;
  editionBasePath?: string;
  entries: PresentationFooterEntry[];
  geometry?: PresentationFooterGeometry;
  onSectionClick?: (event: ReactMouseEvent<HTMLAnchorElement>, entry: PresentationFooterEntry, href: string) => void;
  resolveSectionHref: (entry: PresentationFooterEntry) => string;
  subtitle: string;
  title?: string;
  utilityEntries?: PresentationFooterUtilityEntry[];
  variant?: "newspaper" | "presentation";
}) {
  const className = variant === "newspaper" ? "front-footer" : "front-footer front-footer--presentation";

  return (
    <footer
      aria-label="Publication footer"
      className={className}
      data-front-footer="true"
      data-presentation-footer={variant === "presentation" ? "true" : undefined}
      style={geometry ? getFooterGeometryStyle(geometry) : getPresentationFooterStyle(entries, utilityEntries)}
    >
      <div className="front-footer__heading">
        {title ? (
          <span className="front-footer__brand">
            <span className="front-footer__brand-title">{title}</span>
            {subtitle ? <span className="front-footer__brand-subtitle">{subtitle}</span> : null}
          </span>
        ) : (
          <span>{subtitle}</span>
        )}
        <span className="front-footer__meta">{entries.length} sections</span>
      </div>
      {entries.length > 0 ? (
        <nav className="front-footer__sections" aria-label="Edition sections">
          {entries.map((entry) => {
            const href = resolveSectionHref(entry);
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
                onClick={onSectionClick ? (event) => onSectionClick(event, entry, href) : undefined}
              >
                <span className="front-footer__section-name">{entry.section}</span>
                <span className="front-footer__section-title">{entry.articleTitle}</span>
              </a>
            );
          })}
        </nav>
      ) : null}
      <div className="front-footer__utilities" aria-label="Publication utilities">
        {utilityEntries.map((entry) => {
          if (entry.id === "newsDesk" && disableLinks) return null;

          if (entry.id === "login" && !disableLinks) {
            return (
              <ReaderAuthControl className="front-footer__utility-link" dataFooterUtility={entry.id} key={entry.id} postAuthPath={editionBasePath} />
            );
          }

          return entry.disabled || disableLinks ? (
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
          );
        })}
      </div>
    </footer>
  );
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
  usePresentationTargetScroll(targetSection);
  return (
    <main className="presentation-page presentation-page--blog" data-presentation-engine="blog">
      <BlogPageBackground />
      <PresentationHeader content={content} />
      <SectionNavigation content={content} editionBasePath={editionBasePath} />
      <div className="blog-sections" ref={contentRef}>
        {sections.map((section) => (
          <section className="blog-section" data-edition-section={section.key} id={getSectionAnchorId(section.key)} key={section.key}>
            <header className="presentation-section-header">
              <p>{section.label}</p>
              {section.description ? <span>{section.description}</span> : null}
            </header>
            {getEditionSectionItems(section, content.items).map((item, index) => (
              <PresentationItem
                editionBasePath={editionBasePath}
                index={index}
                item={item}
                key={item.slug}
                mode="blog"
              />
            ))}
          </section>
        ))}
      </div>
      <PresentationFooter
        editionBasePath={editionBasePath}
        entries={footerEntries}
        onSectionClick={handleBlogFooterSectionClick}
        resolveSectionHref={(entry) => getBlogFooterSectionHref(entry, editionBasePath)}
        subtitle={SITE_BRAND.id === "threat-intelligence" ? "" : footerSubtitle}
        title={SITE_BRAND.id === "threat-intelligence" ? "ANTHUS THREAT INTELLIGENCE" : undefined}
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
      <PresentationHeader content={content} />
      <SectionNavigation content={content} editionBasePath={editionBasePath} />
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

function PresentationHeader({ content }: { content: EditionContent }) {
  const title = SITE_BRAND.id === "papyrus" ? content.title : SITE_BRAND.mastheadTitle;
  const subtitle = SITE_BRAND.id === "papyrus" ? content.description : SITE_BRAND.mastheadSubtitle;
  const tagline = SITE_BRAND.id === "papyrus" ? null : SITE_BRAND.mastheadTagline;
  const displayDate = SITE_BRAND.id === "threat-intelligence"
    ? formatMastheadDate(content.editionDate)
    : content.editionDate;

  return (
    <header className="presentation-header">
      <div className="presentation-header__copy-stack">
        <h1>
          {SITE_BRAND.id === "threat-intelligence"
            ? title.split(/\s+/).map((word) => <span key={word}>{word}</span>)
            : title}
        </h1>
        <div className="presentation-header__meta">
          {subtitle ? <span className="presentation-header__subtitle">{subtitle}</span> : null}
          <p className="presentation-header__date">{displayDate}</p>
        </div>
        {tagline ? <span className="presentation-header__tagline">{tagline}</span> : null}
      </div>
    </header>
  );
}

function SectionNavigation({ content, editionBasePath }: { content: EditionContent; editionBasePath?: string }) {
  return (
    <nav className="presentation-section-nav" aria-label="Edition sections">
      {content.sections.map((section) => (
        <Link href={getSectionHref(content, section, editionBasePath)} key={section.key}>
          {section.label}
        </Link>
      ))}
    </nav>
  );
}

function PresentationItem({
  editionBasePath,
  index,
  item,
  mode,
}: {
  editionBasePath?: string;
  index?: number;
  item: PublicationItem;
  mode: "blog" | "magazine" | "magazine-feature";
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const maxWidth = useMeasuredWidth(frameRef);
  const image = getPublicationItemImageAssets(item)[0];
  const textStyle = mode === "blog" ? BLOG_TEXT_STYLE : MAGAZINE_TEXT_STYLE;
  const text = getPresentationBodyText(item, mode);
  const lines = useMemo(() => {
    if (!maxWidth || !text.trim()) return [];
    return layoutAllTextLines({
      prepared: prepareWithSegments(text, `${textStyle.fontSize}px ${textStyle.fontFamily}`),
      maxWidth,
      ...textStyle,
    });
  }, [maxWidth, text, textStyle]);
  const textHeight = getMeasuredTextHeight(lines);
  const directHref = editionBasePath ? `${editionBasePath}/${encodeURIComponent(item.slug)}` : `/articles/${encodeURIComponent(item.slug)}`;

  return (
    <article
      className={`presentation-item presentation-item--${mode}`}
      data-item-id={item.slug}
      data-item-index={index}
      data-item-type={item.type}
      data-has-image={image ? "true" : "false"}
      id={item.slug}
    >
      <header className="presentation-item__header">
        <p>{item.section ?? "General"}</p>
        <h2>
          <Link href={directHref}>{getPresentationTitle(item)}</Link>
        </h2>
        {item.deck ? <span>{item.deck}</span> : null}
        {mode === "blog" ? (
          <Link className="presentation-item__cta" href={directHref}>
            Read Article
          </Link>
        ) : null}
      </header>
      {image ? (
        <figure className="presentation-item__image">
          <Image
            src={image.src}
            alt={image.alt}
            width={1200}
            height={760}
            sizes={mode === "blog" ? "(max-width: 900px) 100vw, 760px" : "(max-width: 900px) 100vw, 50vw"}
            unoptimized={shouldBypassImageOptimization(image.src)}
          />
          <figcaption>{image.caption ?? image.credit}</figcaption>
        </figure>
      ) : null}
      <div className="presentation-item__text-frame" ref={frameRef} style={{ height: textHeight }}>
        <MeasuredPresentationLines lines={lines} />
      </div>
    </article>
  );
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

function getSectionHref(content: EditionContent, section: EditionSection, editionBasePath?: string): string {
  if (SITE_BRAND.id === "threat-intelligence") {
    const anchor = `#${getSectionAnchorId(section.key)}`;
    return editionBasePath ? `${editionBasePath}${anchor}` : anchor;
  }
  if (editionBasePath) return `${editionBasePath}/section/${encodeURIComponent(section.key)}`;
  const datedPath = getEditionSectionPath(content.editionDate, section.key);
  return datedPath.startsWith("//") ? `#${getSectionAnchorId(section.key)}` : datedPath;
}

function getSectionAnchorId(sectionKey: string): string {
  return `section-${sectionKey}`;
}

function getMeasuredTextHeight(lines: TextLine[]): number {
  const last = lines[lines.length - 1];
  return last ? last.y + last.paintHeight : 0;
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

function buildPresentationFooterEntries(content: EditionContent): PresentationFooterEntry[] {
  const entries: PresentationFooterEntry[] = [];
  const seenSections = new Set<string>();

  for (const section of content.sections) {
    const sectionKey = section.label.trim().toLowerCase();
    if (!sectionKey || seenSections.has(sectionKey)) continue;

    const leadItem = getEditionSectionItems(section, content.items).find((item) => isFooterEligibleItem(item));
    if (!leadItem) continue;

    seenSections.add(sectionKey);
    entries.push({
      section: section.label,
      sectionKey: section.key,
      articleSlug: leadItem.slug,
      articleTitle: leadItem.type === "article" ? leadItem.headline : leadItem.title,
    });
  }

  return entries;
}

function isFooterEligibleItem(item: PublicationItem): boolean {
  return item.type === "article" || item.type === "brief";
}

function getFooterGeometryStyle(geometry: PresentationFooterGeometry): CSSProperties {
  return {
    "--front-footer-height": `${geometry.height}px`,
    "--front-footer-margin-top": `${geometry.marginTop}px`,
    "--front-footer-row-height": `${geometry.rowHeight}px`,
    "--front-footer-section-columns": geometry.sectionColumns,
    "--front-footer-section-rows": geometry.sectionRows,
  } as CSSProperties;
}

function getPresentationFooterStyle(
  entries: PresentationFooterEntry[],
  utilityEntries: PresentationFooterUtilityEntry[],
): CSSProperties {
  const { sectionColumns, sectionRows } = getPresentationFooterGrid(entries.length, utilityEntries.length);
  return {
    "--front-footer-section-columns": sectionColumns,
    "--front-footer-section-rows": sectionRows,
    "--front-footer-utility-rows": utilityEntries.length,
  } as CSSProperties;
}

function getPresentationFooterGrid(entryCount: number, utilityCount: number) {
  const maxColumns = Math.max(1, Math.min(4, Math.max(entryCount, utilityCount)));
  const sectionColumns = entryCount === 0 ? 1 : Math.min(entryCount, maxColumns);
  const sectionRows = entryCount === 0 ? 0 : Math.ceil(entryCount / sectionColumns);
  return { sectionColumns, sectionRows };
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

function formatMastheadDate(value: string): string {
  const normalized = value?.trim();
  if (!normalized) return value;
  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
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
