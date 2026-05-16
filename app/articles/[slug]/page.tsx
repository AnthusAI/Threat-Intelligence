import { notFound } from "next/navigation";
import { ArticlePageView } from "../../../components/article-page";
import { contentRepository, isGraphQLContentSource } from "../../../lib/content-repository";

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

  return <ArticlePageView article={article} backHref="/" />;
}
