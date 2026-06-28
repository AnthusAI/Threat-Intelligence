import { notFound, redirect } from "next/navigation";
import { ItemPageView } from "../../../../../components/article-page";
import { getCachedEditionItem } from "../../../../../lib/cached-content-repository";
import { getEditionDatePath, parseEditionArticleRoute } from "../../../../../lib/edition-routes";
import { SITE_BRAND } from "../../../../../lib/site-brand";
// Keep in sync with READER_REVALIDATE_SECONDS in lib/reader-route-config.ts
export const revalidate = 3600;

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

  const item = await getCachedEditionItem({
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

  const item = await getCachedEditionItem({
    editionDate: route.editionDate,
    itemSlug: route.articleSlug,
  });
  if (!item) notFound();

  return <ItemPageView item={item} backHref={`${getEditionDatePath(route.editionDate)}#${item.slug}`} />;
}
