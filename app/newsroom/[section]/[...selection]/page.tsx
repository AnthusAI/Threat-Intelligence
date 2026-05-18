import { notFound } from "next/navigation";
import { NewsDeskPage } from "../../../../components/news-desk-page";
import type { NewsDeskTab } from "../../../../components/topic-steering-workspace";

export const dynamic = "force-dynamic";

type NewsDeskNestedSectionPageProps = {
  params: Promise<{ section: string; selection: string[] }>;
  searchParams?: Promise<{
    demo?: string | string[];
    reference?: string | string[];
    category?: string | string[];
    node?: string | string[];
    user?: string | string[];
    item?: string | string[];
  }>;
};

const NEWS_DESK_ROUTE_SECTIONS = new Set<NewsDeskTab>([
  "desks",
  "topics",
  "concepts",
  "references",
]);

export default async function NewsDeskNestedSectionPage({ params, searchParams }: NewsDeskNestedSectionPageProps) {
  const { section, selection } = await params;
  if (!NEWS_DESK_ROUTE_SECTIONS.has(section as NewsDeskTab)) notFound();
  return <NewsDeskPage section={section} selectionPath={selection} searchParams={searchParams} />;
}
