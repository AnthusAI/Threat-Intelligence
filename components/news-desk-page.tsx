import { NewsDeskWorkspace, type NewsDeskTab } from "./topic-steering-workspace";
import { loadCategorySteeringDashboard } from "../lib/category-repository";

export type NewsDeskPageProps = {
  section?: string | string[] | null;
  selectionPath?: string[] | null;
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

export async function NewsDeskPage({ section: routeSection, selectionPath, searchParams }: NewsDeskPageProps) {
  const resolvedSearchParams = await searchParams;
  const demo = hasParam(getSearchParam(resolvedSearchParams, "demo"));
  const initialTab = parseNewsDeskTab(routeSection ?? getSearchParam(resolvedSearchParams, "section"), getSearchParam(resolvedSearchParams, "tab"));
  const routeSelection = parseRouteSelection(initialTab, selectionPath);
  const initialSelection = {
    reference: getFirstSearchParam(resolvedSearchParams, "reference"),
    category: routeSelection.category ?? getFirstSearchParam(resolvedSearchParams, "category"),
    node: getFirstSearchParam(resolvedSearchParams, "node"),
    user: getFirstSearchParam(resolvedSearchParams, "user"),
    item: getFirstSearchParam(resolvedSearchParams, "item"),
  };
  const dashboard = demo ? await loadCategorySteeringDashboard({ demo: true }) : null;
  return <NewsDeskWorkspace dashboard={dashboard} initialSelection={initialSelection} initialTab={initialTab} />;
}

function parseRouteSelection(tab: NewsDeskTab, selectionPath: string[] | null | undefined): { category?: string | null } {
  const segments = (selectionPath ?? []).map((segment) => decodeURIComponent(segment)).filter(Boolean);
  if (!segments.length) return {};
  if (tab === "desks") return { category: segments[0] ?? null };
  if (tab === "topics") return { category: segments[1] ?? segments[0] ?? null };
  if (tab === "references" || tab === "concepts") return { category: segments[0] ?? null };
  return {};
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
  if (value === "users" || value === "desks" || value === "topics" || value === "concepts" || value === "references" || value === "assignments" || value === "doctrine") return value;
  return "overview";
}
