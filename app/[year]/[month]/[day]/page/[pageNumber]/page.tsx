import { notFound, redirect } from "next/navigation";
import { EditionRoutePage } from "../../edition-route-page";
import { parseEditionPageRoute } from "../../../../../../lib/edition-routes";

export const dynamic = "force-dynamic";

type EditionPageRouteProps = {
  params: Promise<{
    year: string;
    month: string;
    day: string;
    pageNumber: string;
  }>;
};

export default async function EditionPageRoute({ params }: EditionPageRouteProps) {
  const { year, month, day, pageNumber } = await params;
  const route = parseEditionPageRoute({ year, month, day, pageNumber });
  if (!route) notFound();
  if (!route.isCanonical) redirect(route.canonicalPath);

  return <EditionRoutePage day={day} initialPageNumber={route.pageNumber} month={month} year={year} />;
}
