import type { HydratedModelPayload } from "./model-payloads";
import type { ReferenceRecord } from "./category-repository";
import type { SemanticGraph } from "./semantic-graph";

function metadataRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return metadataRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeDisplayText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function referenceMetadataField(
  payload: HydratedModelPayload | null,
  fallback: unknown,
  key: "subtitle" | "summary",
): string | null {
  const payloadRecord = metadataRecord(payload?.json);
  if (payloadRecord) {
    const value = normalizeDisplayText(payloadRecord[key]);
    if (value) return value;
  }
  const fallbackRecord = metadataRecord(fallback);
  return fallbackRecord ? normalizeDisplayText(fallbackRecord[key]) : null;
}

export function referenceSummaryFromGraph(graph: SemanticGraph | null | undefined, lineageId: string): string | null {
  if (!graph || !lineageId) return null;
  for (const message of graph.summariesFor("reference", lineageId)) {
    const summary = normalizeDisplayText(message.summary);
    if (!summary) continue;
    if (/can['’]t summarize|don['’]t have the document|link alone/i.test(summary)) continue;
    return summary;
  }
  return null;
}

export function referenceDisplaySummary(
  graph: SemanticGraph | null | undefined,
  lineageId: string,
  payload: HydratedModelPayload | null,
  fallback?: unknown,
): string | null {
  return referenceMetadataField(payload, fallback, "summary")
    ?? referenceSummaryFromGraph(graph, lineageId);
}

export function resolveCanonicalReferenceLineage(
  references: ReferenceRecord[],
  requestedLineageId: string,
): string {
  if (!requestedLineageId) return requestedLineageId;
  const target = references.find((reference) => (reference.lineageId ?? reference.id) === requestedLineageId);
  if (!target?.sourceUri) return requestedLineageId;
  const duplicates = references.filter((reference) =>
    reference.versionState === "current"
    && reference.sourceUri === target.sourceUri);
  if (duplicates.length <= 1) return requestedLineageId;
  const preferred = duplicates.find((reference) => reference.curationStatus !== "archived")
    ?? duplicates.find((reference) => !(reference.lineageId ?? "").includes("research-proposal"))
    ?? target;
  return preferred.lineageId ?? preferred.id ?? requestedLineageId;
}

