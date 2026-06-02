import { NewsDeskPage } from "../../../../components/news-desk-page";

export const dynamic = "force-dynamic";

type NewsroomInsightThreadPageProps = {
  params: Promise<{ threadId: string }>;
  searchParams?: Promise<{
    demo?: string | string[];
    domain?: string | string[];
  }>;
};

export default async function NewsroomInsightThreadPage({ params, searchParams }: NewsroomInsightThreadPageProps) {
  const { threadId } = await params;
  return (
    <NewsDeskPage
      section="insights"
      selectionPath={[threadId]}
      searchParams={searchParams}
    />
  );
}
