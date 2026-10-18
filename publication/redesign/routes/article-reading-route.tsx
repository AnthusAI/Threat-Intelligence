import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArticleVideoFigure } from "@anthusai/papyrus/components/article-video";
import { getCachedEditionItem, loadCachedEditionContent } from "@anthusai/papyrus/lib/cached-content-repository";
import { parseEditionArticleRoute } from "@anthusai/papyrus/lib/edition-routes";
import type { EditionContent } from "@anthusai/papyrus/lib/content-types";
import { getPublicationItemVideoAsset, type PublicationItem } from "@anthusai/papyrus/lib/publication-items";
import { formatLongEditionDate } from "../edition-front-page-model";
import { ArrowIcon } from "../edition-front-page";
import { buildEditionNavigation } from "../edition-navigation";
import { AnimatedPictogramFigure } from "../figures/animated-pictogram-plate";
import { PUBLICATION_NAME } from "../publication-identity";
import { ReaderSiteShell } from "../reader-site-shell";

export type EditionArticleRouteParameters = { year: string; month: string; day: string; articleSlug: string };

export async function generateArticleReadingMetadata(routeParameters: EditionArticleRouteParameters): Promise<Metadata> {
  const parsedRoute = parseEditionArticleRoute(routeParameters);
  if (!parsedRoute) return {};
  const item = await getCachedEditionItem({ editionDate: parsedRoute.editionDate, itemSlug: parsedRoute.articleSlug }).catch(() => undefined);
  if (!item) return {};
  const headline = item.type === "article" ? item.headline : item.title;
  return {
    title: `${headline} | ${PUBLICATION_NAME}`,
    description: item.deck,
    openGraph: { title: headline, description: item.deck ?? undefined, type: "article" },
  };
}

export async function ArticleReadingRoute({ routeParameters }: { routeParameters: EditionArticleRouteParameters }) {
  const parsedRoute = parseEditionArticleRoute(routeParameters);
  if (!parsedRoute) notFound();
  if (!parsedRoute.isCanonical) redirect(parsedRoute.canonicalPath);

  const content = await loadCachedEditionContent({ editionDate: parsedRoute.editionDate });
  const item = content.items.find((candidate) => candidate.slug === parsedRoute.articleSlug);
  if (!item) notFound();
  return <ArticleReadingView content={content} item={item} />;
}

export function ArticleReadingView({ content, item }: { content: EditionContent; item: PublicationItem }) {
  const navigation = buildEditionNavigation(content);
  const desk = navigation.desks.find((candidate) => candidate.articles.some((article) => article.slug === item.slug));
  const articleInDesk = desk?.articles.find((article) => article.slug === item.slug);
  const otherArticlesFromDesk = desk?.articles.filter((article) => article.slug !== item.slug) ?? [];
  const headline = item.type === "article" ? item.headline : item.title;
  const deck = item.deck;
  const body = item.body ?? [];
  const video = getPublicationItemVideoAsset(item) ?? null;
  const image = item.image;
  const videoScript = content.videoScripts?.[item.slug] ?? null;

  return (
    <ReaderSiteShell
      deskLinks={navigation.deskLinks}
      editionLineLeft={`Edition ${content.editionDate.replace(/-/g, ".")}`}
      editionLineRight={desk ? `${desk.numberLabel} ${desk.name}` : undefined}
      homeHref="/"
    >
      <article className="ti-article">
        <header className="ti-article__header">
          <p className="ti-kicker">
            <Link className="ti-kicker__signal" href={navigation.editionBasePath}>
              Edition · {formatLongEditionDate(content.editionDate)}
            </Link>
            {desk && articleInDesk ? (
              <Link href={`${navigation.editionBasePath}#${desk.anchorId}`}>
                {desk.numberLabel} {desk.name} · {articleInDesk.numberLabel}
              </Link>
            ) : null}
          </p>
          <h1 className="ti-article__headline">{headline}</h1>
          {deck ? <p className="ti-article__dek">{deck}</p> : null}
          {item.type === "article" ? <p className="ti-article__byline">{item.byline}</p> : null}
        </header>
        {video ? (
          <div className="ti-article__video" id="video-edition">
            <ArticleVideoFigure slug={item.slug} video={video} videoScript={videoScript} />
          </div>
        ) : null}
        <AnimatedPictogramFigure
          accessibleDescription={image?.alt ?? headline}
          caption={image?.caption}
          className="ti-article__figure"
          fallbackImageSource={image?.src}
          figureNumberLabel={desk?.numberLabel}
          pictogramSlug={item.slug}
          priority
        />
        <div className="ti-article__body">
          {body.map((paragraph, paragraphIndex) => (
            <p key={`${paragraphIndex}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
          ))}
        </div>
      </article>
      {desk && otherArticlesFromDesk.length > 0 ? (
        <section aria-labelledby="ti-article-more-from-desk" className="ti-desk-section ti-article__more">
          <div className="ti-desk-section__label">
            <p className="ti-desk-section__number">{desk.numberLabel}</p>
            <h2 className="ti-desk-section__name" id="ti-article-more-from-desk">
              {desk.name}
            </h2>
            <p className="ti-desk-section__count">Also from this desk</p>
          </div>
          <div className="ti-desk-section__content">
            <ul className="ti-article-cards">
              {otherArticlesFromDesk.map((article) => (
                <li key={article.slug}>
                  <article className="ti-article-card">
                    <p className="ti-article-card__number">
                      {article.numberLabel} · {article.isDeskLead ? "Lead article" : "Article"}
                    </p>
                    <h3 className="ti-article-card__headline">
                      <Link href={article.href}>{article.headline}</Link>
                    </h3>
                    <p className="ti-article-card__dek">{article.deck}</p>
                    <Link aria-label={`Read article: ${article.headline}`} className="ti-text-link ti-article-card__read" href={article.href}>
                      Read article <ArrowIcon />
                    </Link>
                  </article>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
      <p className="ti-article__back">
        <Link className="ti-secondary-button" href={navigation.editionBasePath}>
          Back to the edition
        </Link>
      </p>
    </ReaderSiteShell>
  );
}
