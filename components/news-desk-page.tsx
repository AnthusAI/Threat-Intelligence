import { NewsDeskWorkspace, type NewsDeskTab } from "./topic-steering-workspace";
import { loadCategorySteeringDashboard } from "../lib/category-repository";

export type NewsDeskPageProps = {
  searchParams?: Promise<{
    demo?: string | string[];
    tab?: string | string[];
  }>;
};

export async function NewsDeskPage({ searchParams }: NewsDeskPageProps) {
  const resolvedSearchParams = await searchParams;
  const demo = hasParam(getSearchParam(resolvedSearchParams, "demo"));
  const initialTab = parseNewsDeskTab(getSearchParam(resolvedSearchParams, "tab"));
  const dashboard = demo ? await loadCategorySteeringDashboard({ demo: true }) : null;
  return <NewsDeskWorkspace dashboard={dashboard} initialTab={initialTab} />;
}

function getSearchParam(searchParams: unknown, key: string): string | string[] | null | undefined {
  if (searchParams instanceof URLSearchParams) return searchParams.get(key);
  if (!searchParams || typeof searchParams !== "object") return undefined;
  return (searchParams as Record<string, string | string[] | undefined>)[key];
}

function hasParam(value: string | string[] | null | undefined): boolean {
  if (Array.isArray(value)) return value.some(Boolean);
  return Boolean(value);
}

function parseNewsDeskTab(value: string | string[] | null | undefined): NewsDeskTab {
  const tab = Array.isArray(value) ? value[0] : value;
  return tab === "assignments" ? "assignments" : "categories";
}
