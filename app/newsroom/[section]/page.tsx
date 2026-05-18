import { notFound } from "next/navigation";
import { NewsDeskPage } from "../../../components/news-desk-page";
import type { NewsDeskTab } from "../../../components/topic-steering-workspace";

export const dynamic = "force-dynamic";

type NewsDeskSectionPageProps = {
  params: Promise<{ section: string }>;
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
  "users",
  "desks",
  "topics",
  "concepts",
  "references",
  "assignments",
  "doctrine",
]);

export default async function NewsDeskSectionPage({ params, searchParams }: NewsDeskSectionPageProps) {
  const { section } = await params;
  if (!NEWS_DESK_ROUTE_SECTIONS.has(section as NewsDeskTab)) notFound();
  return <NewsDeskPage section={section} searchParams={searchParams} />;
}
