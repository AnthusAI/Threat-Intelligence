import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { contentRepository, isGraphQLContentSource } from "../../../lib/content-repository";
import { shouldBypassImageOptimization } from "../../../lib/image-url";

export const dynamic = "force-dynamic";

type ArticlePageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  if (isGraphQLContentSource()) return [];

  const slugs = await contentRepository.listArticleSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: ArticlePageProps) {
  const { slug } = await params;
  const article = await contentRepository.getArticle(slug);
  if (!article) return {};
  return {
    title: `${article.headline} | Papyrus`,
    description: article.deck,
  };
}

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { slug } = await params;
  const article = await contentRepository.getArticle(slug);
  if (!article) notFound();

  return (
    <main className="article-shell">
      <nav className="article-nav">
        <Link href="/">Back to front page</Link>
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
          <figcaption>{article.image.credit}</figcaption>
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
