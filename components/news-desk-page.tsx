import { NewsDeskWorkspace, type NewsDeskTab } from "./topic-steering-workspace";
import {
  createDemoCategorySteeringDashboard,
  loadAnalysisProfileSummaries,
  loadCategorySteeringDashboard,
  loadConfiguredCorpusSummaries,
} from "../lib/category-repository";

export type NewsDeskPageProps = {
  sectionPageId?: string | null;
  section?: string | string[] | null;
  selectionPath?: string[] | null;
  searchParams?: Promise<{
    demo?: string | string[];
    section?: string | string[];
    tab?: string | string[];
    panel?: string | string[];
    reference?: string | string[];
    category?: string | string[];
    node?: string | string[];
    message?: string | string[];
    assignment?: string | string[];
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

export async function NewsDeskPage({ section: routeSection, sectionPageId, selectionPath, searchParams }: NewsDeskPageProps) {
  const resolvedSearchParams = await searchParams;
  const initialTab = parseNewsDeskTab(routeSection ?? getSearchParam(resolvedSearchParams, "section"), getSearchParam(resolvedSearchParams, "tab"));
  const routeSelection = parseRouteSelection(initialTab, selectionPath);
  const initialSelection = {
    assignment: routeSelection.assignment ?? getFirstSearchParam(resolvedSearchParams, "assignment"),
    reference: routeSelection.reference ?? getFirstSearchParam(resolvedSearchParams, "reference"),
    category: routeSelection.category ?? getFirstSearchParam(resolvedSearchParams, "category"),
    node: getFirstSearchParam(resolvedSearchParams, "node"),
    message: routeSelection.message ?? getFirstSearchParam(resolvedSearchParams, "message"),
    user: getFirstSearchParam(resolvedSearchParams, "user"),
    item: getFirstSearchParam(resolvedSearchParams, "item"),
    panel: routeSelection.panel ?? getFirstSearchParam(resolvedSearchParams, "panel"),
    searchQuery: getFirstSearchParam(resolvedSearchParams, "q"),
    searchAnchorKind: getFirstSearchParam(resolvedSearchParams, "anchorKind"),
    searchAnchorId: getFirstSearchParam(resolvedSearchParams, "anchorId"),
    searchAnchorLineageId: getFirstSearchParam(resolvedSearchParams, "anchorLineageId"),
    searchMaxTokens: getFirstSearchParam(resolvedSearchParams, "maxTokens"),
    searchFrom: getFirstSearchParam(resolvedSearchParams, "from"),
  };
  const useDemoDashboard = getFirstSearchParam(resolvedSearchParams, "demo") === "1";
  const analysisProfiles = await loadAnalysisProfileSummaries();
  const configuredCorpora = await loadConfiguredCorpusSummaries();
  const dashboard = useDemoDashboard ? createDemoCategorySteeringDashboard() : await loadCategorySteeringDashboard();
  return <NewsDeskWorkspace analysisProfiles={analysisProfiles} configuredCorpora={configuredCorpora} dashboard={dashboard} initialSelection={initialSelection} initialTab={initialTab} sectionPageId={sectionPageId ?? null} />;
}

function parseRouteSelection(tab: NewsDeskTab, selectionPath: string[] | null | undefined): { assignment?: string | null; category?: string | null; message?: string | null; panel?: string | null; reference?: string | null } {
  const segments = (selectionPath ?? []).map((segment) => decodeURIComponent(segment)).filter(Boolean);
  if (!segments.length) return {};
  if (tab === "administration") return { panel: segments[0] ?? null };
  if (tab === "topics") return { category: segments[1] ?? segments[0] ?? null };
  if (tab === "references") return segments[0]?.startsWith("reference-") ? { reference: segments[0] } : { category: segments[0] ?? null };
  if (tab === "concepts") return { category: segments[0] ?? null };
  if (tab === "messages") return { message: segments[0] ?? null };
  if (tab === "assignments") return { assignment: segments[0] ?? null };
  return {};
}

function getSearchParam(searchParams: unknown, key: string): string | string[] | null | undefined {
  if (searchParams instanceof URLSearchParams) return searchParams.get(key);
  if (!searchParams || typeof searchParams !== "object") return undefined;
  return (searchParams as Record<string, string | string[] | undefined>)[key];
}

function getFirstSearchParam(searchParams: unknown, key: string): string | null {
  const value = getSearchParam(searchParams, key);
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.trim() ? first.trim() : null;
}

function parseNewsDeskTab(sectionValue: string | string[] | null | undefined, legacyTabValue: string | string[] | null | undefined): NewsDeskTab {
  const section = Array.isArray(sectionValue) ? sectionValue[0] : sectionValue;
  const legacyTab = Array.isArray(legacyTabValue) ? legacyTabValue[0] : legacyTabValue;
  const rawValue = section ?? (legacyTab === "categories" ? "topics" : legacyTab);
  const value = rawValue === "users" || rawValue === "doctrine"
    ? "administration"
    : rawValue === "desks"
      ? "topics"
      : rawValue;
  if (value === "administration" || value === "topics" || value === "concepts" || value === "references" || value === "messages" || value === "assignments" || value === "search") return value;
  return "overview";
}
