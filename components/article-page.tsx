"use client";

import Link from "next/link";
import type { Article } from "../lib/articles";
import type { PresentationFooterEntry } from "../lib/presentation-footer";
import type { PublicationItem } from "../lib/publication-items";
import { SITE_BRAND } from "../lib/site-brand";
import { PictogramFigure } from "./pictograms/pictogram-figure";
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
};

export function ArticlePageView({ article, backHref, backLabel = SITE_BRAND.backToHomeLabel, editionFooter, editionDate }: ArticlePageViewProps) {
  const articleDate = editionDate ? formatArticleDate(editionDate) : null;

  return (
    <main className={getArticleShellClassName(editionFooter)}>
      <nav className="article-nav">
        <Link href={backHref}>{backLabel}</Link>
        <span>{article.section}</span>
      </nav>
      <article className="article-page">
        <header>
          <p className="story-label">{article.section}</p>
          <h1>{article.headline}</h1>
          <p className="article-deck">{article.deck}</p>
          <div className="story-byline">
            <span>{article.byline}</span>
            <span>{article.dateline}</span>
            {articleDate ? <time dateTime={editionDate}>{articleDate}</time> : null}
          </div>
        </header>
        <div className="article-body">
          {article.image ? (
            <PictogramFigure
              alt={article.image.alt}
              caption={article.image.caption}
              credit={article.image.credit}
              figureClassName="article-photo"
              height={680}
              layout={article.image.layout}
              priority
              sizes="(max-width: 980px) 100vw, 900px"
              slug={article.slug}
              src={article.image.src}
              themeVariants={article.image.themeVariants}
              width={1200}
            />
          ) : null}
          {article.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </article>
      {editionFooter ? <ArticleEditionFooter footer={editionFooter} /> : null}
    </main>
  );
}

type ItemPageViewProps = {
  item: PublicationItem;
  backHref: string;
  backLabel?: string;
  editionFooter?: ArticlePageEditionFooter;
  editionDate?: string;
};

export function ItemPageView({ item, backHref, backLabel = "Back to edition", editionFooter, editionDate }: ItemPageViewProps) {
  if (item.type === "article") {
    return <ArticlePageView article={item} backHref={backHref} backLabel={backLabel} editionFooter={editionFooter} editionDate={editionDate} />;
  }

  const itemDate = editionDate ? formatArticleDate(editionDate) : null;

  return (
    <main className={getArticleShellClassName(editionFooter)}>
      <nav className="article-nav">
        <Link href={backHref}>{backLabel}</Link>
        <span>{item.section ?? item.type}</span>
      </nav>
      <article className="article-page" data-item-type={item.type}>
        <header>
          <p className="story-label">{item.section ?? item.type}</p>
          <h1>{item.title}</h1>
          {item.deck ? <p className="article-deck">{item.deck}</p> : null}
          {itemDate ? (
            <div className="story-byline">
              <time dateTime={editionDate}>{itemDate}</time>
            </div>
          ) : null}
        </header>
        <div className="article-body">
          {item.image ? (
            <PictogramFigure
              alt={item.image.alt}
              caption={item.image.caption}
              credit={item.image.credit}
              figureClassName="article-photo"
              height={680}
              layout={item.image.layout}
              priority
              sizes="(max-width: 980px) 100vw, 900px"
              slug={item.slug}
              src={item.image.src}
              themeVariants={item.image.themeVariants}
              width={1200}
            />
          ) : null}
          {(item.body ?? []).map((paragraph) => (
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
