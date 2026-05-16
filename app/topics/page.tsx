import { TopicSteeringWorkspace } from "../../components/topic-steering-workspace";
import { loadTopicSteeringDashboard } from "../../lib/curation-repository";

export const dynamic = "force-dynamic";

type TopicsPageProps = {
  searchParams?: Promise<{
    demo?: string | string[];
  }>;
};

export default async function TopicsPage({ searchParams }: TopicsPageProps) {
  const resolvedSearchParams = await searchParams;
  const dashboard = await loadTopicSteeringDashboard({ demo: hasParam(getSearchParam(resolvedSearchParams, "demo")) });
  return <TopicSteeringWorkspace dashboard={dashboard} />;
}

function getSearchParam(searchParams: unknown, key: string): string | string[] | null | undefined {
  if (searchParams instanceof URLSearchParams) return searchParams.get(key);
  if (!searchParams || typeof searchParams !== "object") return undefined;
  const value = (searchParams as Record<string, string | string[] | undefined>)[key];
  return value;
}

function hasParam(value: string | string[] | null | undefined): boolean {
  if (Array.isArray(value)) return value.some(Boolean);
  return Boolean(value);
}
