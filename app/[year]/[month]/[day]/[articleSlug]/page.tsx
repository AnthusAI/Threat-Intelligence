import { notFound, redirect } from "next/navigation";
import { ArticlePageView } from "../../../../../components/article-page";
import { contentRepository } from "../../../../../lib/content-repository";
import { getEditionDatePath, parseEditionArticleRoute } from "../../../../../lib/edition-routes";

export const dynamic = "force-dynamic";

type DateScopedArticlePageProps = {
  params: Promise<{
    year: string;
    month: string;
    day: string;
    articleSlug: string;
  }>;
};

export async function generateMetadata({ params }: DateScopedArticlePageProps) {
  const { year, month, day, articleSlug } = await params;
  const route = parseEditionArticleRoute({ year, month, day, articleSlug });
  if (!route) return {};

  const article = await contentRepository.getEditionArticle({
    editionDate: route.editionDate,
    articleSlug: route.articleSlug,
  });
  if (!article) return {};

  return {
    title: `${article.headline} | Papyrus`,
    description: article.deck,
  };
}

export default async function DateScopedArticlePage({ params }: DateScopedArticlePageProps) {
  const { year, month, day, articleSlug } = await params;
  const route = parseEditionArticleRoute({ year, month, day, articleSlug });
  if (!route) notFound();
  if (!route.isCanonical) redirect(route.canonicalPath);

  const article = await contentRepository.getEditionArticle({
    editionDate: route.editionDate,
    articleSlug: route.articleSlug,
  });
  if (!article) notFound();

  return <ArticlePageView article={article} backHref={`${getEditionDatePath(route.editionDate)}#${article.slug}`} />;
}
