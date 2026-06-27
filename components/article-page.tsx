import Image from "next/image";
import Link from "next/link";
import type { Article } from "../lib/articles";
import { shouldBypassImageOptimization } from "../lib/image-url";
import type { PublicationItem } from "../lib/publication-items";
import { SITE_BRAND } from "../lib/site-brand";

type ArticlePageViewProps = {
  article: Article;
  backHref: string;
  backLabel?: string;
};

export function ArticlePageView({ article, backHref, backLabel = SITE_BRAND.backToHomeLabel }: ArticlePageViewProps) {
  return (
    <main className="article-shell">
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
          </div>
        </header>
        {article.image ? (
          <figure className="article-photo">
            <Image
              src={article.image.src}
              alt={article.image.alt}
              width={1200}
              height={680}
              sizes="(max-width: 980px) 100vw, 900px"
              priority
              unoptimized={shouldBypassImageOptimization(article.image.src)}
            />
            <figcaption>{article.image.caption ?? article.image.credit}</figcaption>
          </figure>
        ) : null}
        <div className="article-body">
          {article.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </article>
    </main>
  );
}

type ItemPageViewProps = {
  item: PublicationItem;
  backHref: string;
  backLabel?: string;
};

export function ItemPageView({ item, backHref, backLabel = "Back to edition" }: ItemPageViewProps) {
  if (item.type === "article") return <ArticlePageView article={item} backHref={backHref} backLabel={backLabel} />;

  return (
    <main className="article-shell">
      <nav className="article-nav">
        <Link href={backHref}>{backLabel}</Link>
        <span>{item.section ?? item.type}</span>
      </nav>
      <article className="article-page" data-item-type={item.type}>
        <header>
          <p className="story-label">{item.section ?? item.type}</p>
          <h1>{item.title}</h1>
          {item.deck ? <p className="article-deck">{item.deck}</p> : null}
        </header>
        {item.image ? (
          <figure className="article-photo">
            <Image
              src={item.image.src}
              alt={item.image.alt}
              width={1200}
              height={680}
              sizes="(max-width: 980px) 100vw, 900px"
              priority
              unoptimized={shouldBypassImageOptimization(item.image.src)}
            />
            <figcaption>{item.image.caption ?? item.image.credit}</figcaption>
          </figure>
        ) : null}
        <div className="article-body">
          {(item.body ?? []).map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </article>
    </main>
  );
}
