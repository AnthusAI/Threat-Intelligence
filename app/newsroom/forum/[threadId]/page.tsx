import { NewsDeskPage } from "../../../../components/news-desk-page";

export const dynamic = "force-dynamic";

type NewsroomForumThreadPageProps = {
  params: Promise<{ threadId: string }>;
  searchParams?: Promise<{
    demo?: string | string[];
    panel?: string | string[];
    reference?: string | string[];
    category?: string | string[];
    node?: string | string[];
    assignment?: string | string[];
    message?: string | string[];
    user?: string | string[];
    item?: string | string[];
    q?: string | string[];
    anchorKind?: string | string[];
    anchorId?: string | string[];
    anchorLineageId?: string | string[];
    maxTokens?: string | string[];
    from?: string | string[];
  }>;
};

export default async function NewsroomForumThreadPage({ params, searchParams }: NewsroomForumThreadPageProps) {
  const { threadId } = await params;
  return (
    <NewsDeskPage
      section="overview"
      selectionPath={["forum", threadId]}
      searchParams={searchParams}
    />
  );
}
