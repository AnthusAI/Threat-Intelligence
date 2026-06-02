import { NewsDeskPage } from "../../../components/news-desk-page";

export const dynamic = "force-dynamic";

type NewsroomInsightsPageProps = {
  searchParams?: Promise<{
    demo?: string | string[];
    domain?: string | string[];
  }>;
};

export default async function NewsroomInsightsPage({ searchParams }: NewsroomInsightsPageProps) {
  return <NewsDeskPage section="insights" searchParams={searchParams} />;
}
