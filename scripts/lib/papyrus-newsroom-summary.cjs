const NEWSROOM_SUMMARY_PAYLOAD_ID = "knowledge-raw-payload-newsroom-summary-current";
const NEWSROOM_SUMMARY_OWNER_TYPE = "newsroom";
const NEWSROOM_SUMMARY_OWNER_ID = "newsroom";
const NEWSROOM_SUMMARY_PAYLOAD_KIND = "summary-snapshot";
const SUMMARY_STALE_AFTER_MS = 15 * 60 * 1000;

function buildNewsroomSummaryPayload({
  corpora = [],
  importRuns = [],
  categorySets = [],
  categories = [],
  proposals = [],
  artifacts = [],
  references = [],
  referenceAttachments = [],
  semanticNodes = [],
  messages = [],
  semanticRelations = [],
  assignments = [],
  assignmentEvents = [],
  now = new Date().toISOString(),
  source = "recount",
} = {}) {
  const currentCategorySets = selectCurrentVersionedRecords(categorySets);
  const currentCategories = selectCurrentVersionedRecords(categories);
  const currentReferences = selectCurrentVersionedRecords(references);
  const currentSemanticNodes = selectCurrentVersionedRecords(semanticNodes);
  const currentSemanticRelations = semanticRelations.filter((relation) => isCurrentRelationState(relation?.relationState));
  const latestImportRun = [...importRuns]
    .sort((left, right) => String(right.importedAt ?? "").localeCompare(String(left.importedAt ?? "")))[0] ?? null;
  const facets = buildNewsroomSummaryFacets({
    importRuns,
    references: currentReferences,
    semanticNodes: currentSemanticNodes,
    messages,
    semanticRelations: currentSemanticRelations,
    assignments,
  });

  return {
    generatedAt: now,
    staleAt: new Date(Date.parse(now) + SUMMARY_STALE_AFTER_MS).toISOString(),
    source,
    latestImportRun,
    counts: {
      corpora: corpora.length,
      importRuns: importRuns.length,
      categorySets: currentCategorySets.length,
      categories: currentCategories.length,
      proposals: proposals.length,
      openProposals: proposals.filter((proposal) => proposal.status === "proposed").length,
      artifacts: artifacts.length,
      references: currentReferences.length,
      referenceAttachments: referenceAttachments.length,
      semanticNodes: currentSemanticNodes.length,
      messages: messages.length,
      semanticRelations: currentSemanticRelations.length,
      assignments: assignments.length,
      assignmentEvents: assignmentEvents.length,
    },
    facets,
    assignmentStatusCounts: facets.assignments.byStatus,
    assignmentTypeCounts: facets.assignments.byType,
    referenceStatusCounts: facets.references.byCurationStatus,
    messageKindCounts: facets.messages.byKind,
    messageDomainCounts: facets.messages.byDomain,
  };
}

function buildNewsroomSummaryPayloadRecord(payload, now = new Date().toISOString()) {
  return {
    id: NEWSROOM_SUMMARY_PAYLOAD_ID,
    ownerType: NEWSROOM_SUMMARY_OWNER_TYPE,
    ownerId: NEWSROOM_SUMMARY_OWNER_ID,
    payloadKind: NEWSROOM_SUMMARY_PAYLOAD_KIND,
    importRunId: payload.latestImportRun?.id ?? null,
    payload: JSON.stringify(payload),
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeNewsroomSummaryPayload(value) {
  const parsed = parseJsonish(value);
  const now = new Date().toISOString();
  const facets = normalizeNewsroomSummaryFacets(parsed.facets, parsed);
  return {
    generatedAt: stringOrDefault(parsed.generatedAt, now),
    staleAt: stringOrDefault(parsed.staleAt, now),
    source: stringOrDefault(parsed.source, "missing"),
    latestImportRun: parsed.latestImportRun && typeof parsed.latestImportRun === "object" ? parsed.latestImportRun : null,
    counts: numberRecord(parsed.counts),
    facets,
    assignmentStatusCounts: { ...facets.assignments.byStatus },
    assignmentTypeCounts: { ...facets.assignments.byType },
    referenceStatusCounts: { ...facets.references.byCurationStatus },
    messageKindCounts: { ...facets.messages.byKind },
    messageDomainCounts: { ...facets.messages.byDomain },
  };
}

function applySummaryDeltas(payload, {
  countDeltas = {},
  assignmentStatusDeltas = {},
  assignmentTypeDeltas = {},
  referenceStatusDeltas = {},
  messageKindDeltas = {},
  messageDomainDeltas = {},
  facetDeltas = {},
  latestImportRun,
  source = "incremental",
  actorLabel,
  reason,
  now = new Date().toISOString(),
} = {}) {
  const next = normalizeNewsroomSummaryPayload(payload);
  next.generatedAt = now;
  next.staleAt = new Date(Date.parse(now) + SUMMARY_STALE_AFTER_MS).toISOString();
  next.source = source;
  if (actorLabel) next.actorLabel = actorLabel;
  if (reason) next.reason = reason;
  if (latestImportRun) next.latestImportRun = latestImportRun;
  const parsedFacetDeltas = parseJsonish(facetDeltas);
  applyNumberDeltas(next.counts, countDeltas);
  if (!hasFacetDelta(parsedFacetDeltas, "assignments", "byStatus")) {
    applyNumberDeltas(next.facets.assignments.byStatus, assignmentStatusDeltas);
  }
  if (!hasFacetDelta(parsedFacetDeltas, "assignments", "byType")) {
    applyNumberDeltas(next.facets.assignments.byType, assignmentTypeDeltas);
  }
  if (!hasFacetDelta(parsedFacetDeltas, "references", "byCurationStatus")) {
    applyNumberDeltas(next.facets.references.byCurationStatus, referenceStatusDeltas);
  }
  if (!hasFacetDelta(parsedFacetDeltas, "messages", "byKind")) {
    applyNumberDeltas(next.facets.messages.byKind, messageKindDeltas);
  }
  if (!hasFacetDelta(parsedFacetDeltas, "messages", "byDomain")) {
    applyNumberDeltas(next.facets.messages.byDomain, messageDomainDeltas);
  }
  applyFacetDeltas(next.facets, facetDeltas);
  syncCompatibilityCounts(next);
  return next;
}

function buildNewsroomSummaryFacets({
  importRuns = [],
  references = [],
  semanticNodes = [],
  messages = [],
  semanticRelations = [],
  assignments = [],
} = {}) {
  const facets = createEmptyNewsroomSummaryFacets();
  for (const assignment of assignments) {
    const status = stringOrDefault(assignment?.status, "unknown");
    const type = stringOrDefault(assignment?.assignmentTypeKey, "unknown");
    increment(facets.assignments.byStatus, status, 1);
    increment(facets.assignments.byType, type, 1);
    incrementNested(facets.assignments.statusByType, type, status, 1);
  }
  for (const message of messages) {
    const kind = stringOrDefault(message?.messageKind, "unknown");
    const domain = stringOrDefault(message?.messageDomain, "unknown");
    const status = stringOrDefault(message?.status, "unknown");
    increment(facets.messages.byKind, kind, 1);
    increment(facets.messages.byDomain, domain, 1);
    increment(facets.messages.byStatus, status, 1);
    incrementNested(facets.messages.domainByKind, kind, domain, 1);
  }
  for (const reference of references) {
    const status = stringOrDefault(reference?.curationStatus, "pending");
    const corpus = stringOrDefault(reference?.corpusId, "unknown");
    increment(facets.references.byCurationStatus, status, 1);
    increment(facets.references.byCorpus, corpus, 1);
    incrementNested(facets.references.statusByCorpus, corpus, status, 1);
  }
  for (const node of semanticNodes) {
    increment(facets.semanticNodes.byNodeKind, stringOrDefault(node?.nodeKind, "unknown"), 1);
    increment(facets.semanticNodes.byStatus, stringOrDefault(node?.status, "unknown"), 1);
    increment(facets.semanticNodes.byCorpus, stringOrDefault(node?.corpusId, "unknown"), 1);
    increment(facets.semanticNodes.byCategorySet, stringOrDefault(node?.categorySetId, "unknown"), 1);
  }
  for (const relation of semanticRelations) {
    increment(facets.semanticRelations.byRelationTypeKey, stringOrDefault(relation?.relationTypeKey ?? relation?.predicate, "unknown"), 1);
    increment(facets.semanticRelations.byRelationDomain, stringOrDefault(relation?.relationDomain, "unknown"), 1);
    increment(facets.semanticRelations.bySubjectKind, stringOrDefault(relation?.subjectKind, "unknown"), 1);
    increment(facets.semanticRelations.byObjectKind, stringOrDefault(relation?.objectKind, "unknown"), 1);
  }
  for (const importRun of importRuns) {
    increment(facets.imports.byCorpus, stringOrDefault(importRun?.corpusId, "unknown"), 1);
  }
  return facets;
}

function computeCurrentReferenceDeltaFromChanges(changes = []) {
  const delta = {
    countDelta: 0,
    statusDeltas: {},
    corpusDeltas: {},
    statusByCorpusDeltas: {},
  };
  const referenceChanges = changes.filter((record) => record.modelName === "Reference" && record.action !== "noop");
  for (const change of referenceChanges) {
    applyCurrentReferenceContribution(delta, change.current, -1);
    applyCurrentReferenceContribution(delta, change.expected, 1);
  }
  return delta;
}

function applyCurrentReferenceContribution(delta, reference, weight) {
  if (!reference || !isCurrentVersionState(reference.versionState)) return;
  delta.countDelta += Number(weight) || 0;
  const status = stringOrDefault(reference.curationStatus, "pending");
  const corpus = stringOrDefault(reference.corpusId, "unknown");
  incrementSigned(delta.statusDeltas, status, weight);
  incrementSigned(delta.corpusDeltas, corpus, weight);
  if (!delta.statusByCorpusDeltas[corpus]) delta.statusByCorpusDeltas[corpus] = {};
  incrementSigned(delta.statusByCorpusDeltas[corpus], status, weight);
  if (!Object.keys(delta.statusByCorpusDeltas[corpus]).length) delete delta.statusByCorpusDeltas[corpus];
}

function selectCurrentVersionedRecords(records = []) {
  const byLineage = new Map();
  for (const record of records) {
    if (!isCurrentVersionState(record?.versionState)) continue;
    const lineageId = stringOrDefault(record?.lineageId ?? record?.id, "");
    if (!lineageId) continue;
    const current = byLineage.get(lineageId);
    if (!current || Number(record?.versionNumber ?? 0) > Number(current?.versionNumber ?? 0)) {
      byLineage.set(lineageId, record);
    }
  }
  return Array.from(byLineage.values());
}

function isCurrentVersionState(value) {
  return stringOrDefault(value, "current") === "current";
}

function isCurrentRelationState(value) {
  return stringOrDefault(value, "current") === "current";
}

function createEmptyNewsroomSummaryFacets() {
  return {
    assignments: { byStatus: {}, byType: {}, statusByType: {} },
    messages: { byKind: {}, byDomain: {}, byStatus: {}, domainByKind: {} },
    references: { byCurationStatus: {}, byCorpus: {}, statusByCorpus: {} },
    semanticNodes: { byNodeKind: {}, byStatus: {}, byCorpus: {}, byCategorySet: {} },
    semanticRelations: { byRelationTypeKey: {}, byRelationDomain: {}, bySubjectKind: {}, byObjectKind: {} },
    imports: { byCorpus: {} },
  };
}

function normalizeNewsroomSummaryFacets(value, legacy = {}) {
  const facets = createEmptyNewsroomSummaryFacets();
  const parsed = parseJsonish(value);
  mergeFacetSection(facets.assignments, parsed.assignments, ["statusByType"]);
  mergeFacetSection(facets.messages, parsed.messages, ["domainByKind"]);
  mergeFacetSection(facets.references, parsed.references, ["statusByCorpus"]);
  mergeFacetSection(facets.semanticNodes, parsed.semanticNodes);
  mergeFacetSection(facets.semanticRelations, parsed.semanticRelations);
  mergeFacetSection(facets.imports, parsed.imports);
  Object.assign(facets.assignments.byStatus, numberRecord(legacy.assignmentStatusCounts));
  Object.assign(facets.assignments.byType, numberRecord(legacy.assignmentTypeCounts));
  Object.assign(facets.references.byCurationStatus, numberRecord(legacy.referenceStatusCounts));
  Object.assign(facets.messages.byKind, numberRecord(legacy.messageKindCounts));
  Object.assign(facets.messages.byDomain, numberRecord(legacy.messageDomainCounts));
  return facets;
}

function mergeFacetSection(target, source, nestedKeys = []) {
  const parsed = parseJsonish(source);
  for (const key of Object.keys(target)) {
    if (nestedKeys.includes(key)) target[key] = nestedNumberRecord(parsed[key]);
    else target[key] = numberRecord(parsed[key]);
  }
}

function nestedNumberRecord(value) {
  const parsed = parseJsonish(value);
  const result = {};
  for (const [key, nested] of Object.entries(parsed)) {
    const record = numberRecord(nested);
    if (Object.keys(record).length) result[key] = record;
  }
  return result;
}

function applyFacetDeltas(target, deltas) {
  const parsed = parseJsonish(deltas);
  for (const [sectionKey, sectionDeltas] of Object.entries(parsed)) {
    const section = target[sectionKey];
    if (!section || typeof section !== "object") continue;
    const parsedSection = parseJsonish(sectionDeltas);
    for (const [facetKey, facetDelta] of Object.entries(parsedSection)) {
      if (!section[facetKey] || typeof section[facetKey] !== "object") continue;
      if (isNestedDeltaMap(facetDelta)) applyNestedNumberDeltas(section[facetKey], facetDelta);
      else applyNumberDeltas(section[facetKey], facetDelta);
    }
  }
}

function isNestedDeltaMap(value) {
  const parsed = parseJsonish(value);
  return Object.values(parsed).some((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
}

function hasFacetDelta(facetDeltas, sectionKey, facetKey) {
  return Boolean(facetDeltas?.[sectionKey]?.[facetKey]);
}

function applyNestedNumberDeltas(target, deltas) {
  const parsed = parseJsonish(deltas);
  for (const [outerKey, innerDeltas] of Object.entries(parsed)) {
    if (!target[outerKey] || typeof target[outerKey] !== "object") target[outerKey] = {};
    applyNumberDeltas(target[outerKey], innerDeltas);
    if (!Object.keys(target[outerKey]).length) delete target[outerKey];
  }
}

function syncCompatibilityCounts(payload) {
  payload.assignmentStatusCounts = { ...payload.facets.assignments.byStatus };
  payload.assignmentTypeCounts = { ...payload.facets.assignments.byType };
  payload.referenceStatusCounts = { ...payload.facets.references.byCurationStatus };
  payload.messageKindCounts = { ...payload.facets.messages.byKind };
  payload.messageDomainCounts = { ...payload.facets.messages.byDomain };
}

function applyNumberDeltas(target, deltas) {
  for (const [key, delta] of Object.entries(deltas)) {
    const value = (target[key] ?? 0) + Number(delta);
    const next = Math.max(0, Number.isFinite(value) ? value : 0);
    if (next === 0) delete target[key];
    else target[key] = next;
  }
}

function increment(target, key, delta) {
  applyNumberDeltas(target, { [key]: delta });
}

function incrementSigned(target, key, delta) {
  const value = (target[key] ?? 0) + Number(delta);
  if (!Number.isFinite(value) || value === 0) delete target[key];
  else target[key] = value;
}

function incrementNested(target, outerKey, innerKey, delta) {
  if (!target[outerKey] || typeof target[outerKey] !== "object") target[outerKey] = {};
  increment(target[outerKey], innerKey, delta);
}

function countBy(items, key, defaultValue = "unknown") {
  const counts = {};
  for (const item of items) {
    const value = typeof item?.[key] === "string" && item[key].trim() ? item[key].trim() : defaultValue;
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function numberRecord(value) {
  const parsed = parseJsonish(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed)
    .map(([key, entry]) => [key, Number(entry)])
    .filter(([, entry]) => Number.isFinite(entry)));
}

function parseJsonish(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stringOrDefault(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

module.exports = {
  NEWSROOM_SUMMARY_OWNER_ID,
  NEWSROOM_SUMMARY_OWNER_TYPE,
  NEWSROOM_SUMMARY_PAYLOAD_ID,
  NEWSROOM_SUMMARY_PAYLOAD_KIND,
  applySummaryDeltas,
  buildNewsroomSummaryPayload,
  buildNewsroomSummaryPayloadRecord,
  buildNewsroomSummaryFacets,
  computeCurrentReferenceDeltaFromChanges,
  normalizeNewsroomSummaryPayload,
};
