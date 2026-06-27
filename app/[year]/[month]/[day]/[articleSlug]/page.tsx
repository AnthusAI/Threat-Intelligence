import { notFound, redirect } from "next/navigation";
import { ItemPageView } from "../../../../../components/article-page";
import { contentRepository } from "../../../../../lib/content-repository";
import { getEditionDatePath, parseEditionArticleRoute } from "../../../../../lib/edition-routes";
import { SITE_BRAND } from "../../../../../lib/site-brand";

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

  const item = await contentRepository.getEditionItem({
    editionDate: route.editionDate,
    itemSlug: route.articleSlug,
  });
  if (!item) return {};

  return {
    title: `${item.type === "article" ? item.headline : item.title} | ${SITE_BRAND.articleTitleSuffix}`,
    description: item.deck,
  };
}

export default async function DateScopedArticlePage({ params }: DateScopedArticlePageProps) {
  const { year, month, day, articleSlug } = await params;
  const route = parseEditionArticleRoute({ year, month, day, articleSlug });
  if (!route) notFound();
  if (!route.isCanonical) redirect(route.canonicalPath);

  const item = await contentRepository.getEditionItem({
    editionDate: route.editionDate,
    itemSlug: route.articleSlug,
  });
  if (!item) notFound();

  return <ItemPageView item={item} backHref={`${getEditionDatePath(route.editionDate)}#${item.slug}`} />;
}
