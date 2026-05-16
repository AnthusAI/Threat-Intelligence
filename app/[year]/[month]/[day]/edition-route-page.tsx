import { notFound, redirect } from "next/navigation";
import { Newspaper } from "../../../../components/newspaper";
import { contentRepository } from "../../../../lib/content-repository";
import { parseEditionDateRoute } from "../../../../lib/edition-routes";

type EditionRoutePageProps = {
  year: string;
  month: string;
  day: string;
  initialPageNumber?: number;
};

export async function EditionRoutePage({ year, month, day, initialPageNumber = 1 }: EditionRoutePageProps) {
  const route = parseEditionDateRoute({ year, month, day });
  if (!route) notFound();
  if (!route.isCanonical) redirect(route.canonicalPath);

  try {
    const content = await contentRepository.loadEditionContent({
      editionDate: route.editionDate,
    });
    if (initialPageNumber < 1 || initialPageNumber > content.layoutPlan.pages.length) notFound();
    return <Newspaper content={content} editionBasePath={route.canonicalPath} initialPageNumber={initialPageNumber} />;
  } catch (error) {
    if (isMissingGraphQLEditionError(error)) notFound();
    throw error;
  }
}

function isMissingGraphQLEditionError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("No published GraphQL edition found");
}
