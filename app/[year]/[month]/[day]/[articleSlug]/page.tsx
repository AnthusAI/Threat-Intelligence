import { generateEditionItemStaticParams } from "@anthusai/papyrus/lib/reader-static-params";
import {
  ArticleReadingRoute,
  generateArticleReadingMetadata,
  type EditionArticleRouteParameters,
} from "@/publication/redesign/routes/article-reading-route";

export const revalidate = 60;

export async function generateStaticParams() {
  return generateEditionItemStaticParams();
}

type ArticleReadingPageProps = { params: Promise<EditionArticleRouteParameters> };

export async function generateMetadata({ params }: ArticleReadingPageProps) {
  return generateArticleReadingMetadata(await params);
}

export default async function ArticleReadingPage({ params }: ArticleReadingPageProps) {
  return <ArticleReadingRoute routeParameters={await params} />;
}
