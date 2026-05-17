import { NewsDeskWorkspace, type NewsDeskTab } from "./topic-steering-workspace";
import { loadCategorySteeringDashboard } from "../lib/category-repository";

export type NewsDeskPageProps = {
  section?: string | string[] | null;
  searchParams?: Promise<{
    demo?: string | string[];
    section?: string | string[];
    tab?: string | string[];
    reference?: string | string[];
    category?: string | string[];
    node?: string | string[];
    user?: string | string[];
    item?: string | string[];
  }>;
};

export async function NewsDeskPage({ section: routeSection, searchParams }: NewsDeskPageProps) {
  const resolvedSearchParams = await searchParams;
  const demo = hasParam(getSearchParam(resolvedSearchParams, "demo"));
  const initialTab = parseNewsDeskTab(routeSection ?? getSearchParam(resolvedSearchParams, "section"), getSearchParam(resolvedSearchParams, "tab"));
  const initialSelection = {
    reference: getFirstSearchParam(resolvedSearchParams, "reference"),
    category: getFirstSearchParam(resolvedSearchParams, "category"),
    node: getFirstSearchParam(resolvedSearchParams, "node"),
    user: getFirstSearchParam(resolvedSearchParams, "user"),
    item: getFirstSearchParam(resolvedSearchParams, "item"),
  };
  const dashboard = demo ? await loadCategorySteeringDashboard({ demo: true }) : null;
  return <NewsDeskWorkspace dashboard={dashboard} initialSelection={initialSelection} initialTab={initialTab} />;
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

function getFirstSearchParam(searchParams: unknown, key: string): string | null {
  const value = getSearchParam(searchParams, key);
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.trim() ? first.trim() : null;
}

function parseNewsDeskTab(sectionValue: string | string[] | null | undefined, legacyTabValue: string | string[] | null | undefined): NewsDeskTab {
  const section = Array.isArray(sectionValue) ? sectionValue[0] : sectionValue;
  const legacyTab = Array.isArray(legacyTabValue) ? legacyTabValue[0] : legacyTabValue;
  const value = section ?? (legacyTab === "categories" ? "topics" : legacyTab);
  if (value === "users" || value === "topics" || value === "concepts" || value === "references" || value === "assignments") return value;
  return "overview";
}
