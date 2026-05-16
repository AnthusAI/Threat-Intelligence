import Image from "next/image";
import Link from "next/link";
import type { Article } from "../lib/articles";
import { shouldBypassImageOptimization } from "../lib/image-url";

type ArticlePageViewProps = {
  article: Article;
  backHref: string;
  backLabel?: string;
};

export function ArticlePageView({ article, backHref, backLabel = "Back to front page" }: ArticlePageViewProps) {
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
        <div className="article-body">
          {article.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </article>
    </main>
  );
}
