import type {
  AssignmentEventRecord,
  AssignmentRecord,
  MessageRecord,
  NewsroomSectionRecord,
  SemanticRelationRecord,
} from "./category-repository";

export type ReportingStoryBudgetDecision = "select" | "merge" | "brief" | "hold" | "kill";

export type ReportingStoryBudgetCandidate = {
  assignment: AssignmentRecord;
  assignmentId: string;
  title: string;
  editionId: string;
  editionLabel: string;
  sectionKey: string;
  sectionTitle: string;
  topicKey: string | null;
  coverageConceptId: string | null;
  coverageConceptTitle: string | null;
  candidateRank: number | null;
  slotCount: number | null;
  hasReportingPacket: boolean;
  reportingPacketId: string | null;
  researchPacketCount: number;
  summary: string | null;
  editorRecommendation: string | null;
  recommendedAngle: string | null;
  riskFlags: string[];
  coverageGaps: string[];
  openQuestions: string[];
  acceptedReferenceCount: number;
  proposedReferenceCount: number;
  decision: ReportingStoryBudgetDecision | null;
  decisionEventId: string | null;
  draftItemId: string | null;
  targetItemId: string | null;
};

export type ReportingStoryBudgetSection = {
  key: string;
  title: string;
  editionId: string;
  editionLabel: string;
  slotCount: number;
  dispatchedCount: number;
  selectedCount: number;
  briefedCount: number;
  mergedCount: number;
  heldCount: number;
  killedCount: number;
  undecidedCount: number;
  filledCount: number;
  delta: number;
  state: "needs" | "full" | "over";
  candidates: ReportingStoryBudgetCandidate[];
};

export type ReportingStoryBudget = {
  sections: ReportingStoryBudgetSection[];
  totals: Omit<ReportingStoryBudgetSection, "key" | "title" | "editionId" | "editionLabel" | "candidates">;
};

export type ReportingStoryBudgetInput = {
  assignments: AssignmentRecord[];
  messages: MessageRecord[];
  assignmentEvents: AssignmentEventRecord[];
  semanticRelations: SemanticRelationRecord[];
  newsroomSections?: NewsroomSectionRecord[];
  messagePayloads?: Record<string, unknown>;
};

const REPORTING_ASSIGNMENT_TYPE = "reporting.edition-candidate";
const REPORTING_PACKET_KIND = "reporting_context_packet";
const RESEARCH_PACKET_KIND = "research_packet";

export function buildReportingStoryBudget(input: ReportingStoryBudgetInput): ReportingStoryBudget {
  const sectionsByKey = new Map((input.newsroomSections ?? []).map((section) => [section.id, section]));
  const linkedMessageIdsByAssignment = buildLinkedMessageIdsByAssignment(input.semanticRelations ?? []);
  const relationsByAssignment = groupRelationsByAssignment(input.semanticRelations ?? []);
  const messagesById = new Map((input.messages ?? []).map((message) => [message.id, message]));
  const candidates = (input.assignments ?? [])
    .filter((assignment) => assignment.assignmentTypeKey === REPORTING_ASSIGNMENT_TYPE)
    .map((assignment) => {
      const linkedMessages = (linkedMessageIdsByAssignment.get(assignment.id) ?? [])
        .map((id) => messagesById.get(id))
        .filter((message): message is MessageRecord => Boolean(message));
      const fallbackMessages = linkedMessages.length
        ? linkedMessages
        : (input.messages ?? []).filter((message) => metadataAssignmentId(message.metadata) === assignment.id);
      const reportingMessages = fallbackMessages
        .filter((message) => message.messageKind === REPORTING_PACKET_KIND)
        .sort(compareCreatedAtDesc);
      const researchPacketCount = fallbackMessages.filter((message) => message.messageKind === RESEARCH_PACKET_KIND).length;
      const reportingMessage = reportingMessages[0] ?? null;
      const packet = reportingMessage ? reportingPacketMetadata(reportingMessage, input.messagePayloads?.[reportingMessage.id]) : {};
      const assignmentMetadata = parseObject(assignment.metadata);
      const slotTarget = parseObject(packet.slotTarget ?? assignmentMetadata.slotTarget);
      const relations = relationsByAssignment.get(assignment.id) ?? [];
      const topicRelation = relationByType(relations, "targets_topic", "category");
      const topicMetadata = parseObject(topicRelation?.metadata);
      const conceptRelation = relationByType(relations, "requests_work_on", "semanticNode")
        ?? relationByType(relations, "uses_signal", "semanticNode");
      const conceptMetadata = parseObject(conceptRelation?.metadata);
      const sectionKey = normalizeString(packet.sectionKey)
        ?? normalizeString(assignment.sectionKey)
        ?? normalizeString(assignment.sectionId)
        ?? normalizeString(assignmentMetadata.sectionKey)
        ?? normalizeString(assignmentMetadata.sectionId)
        ?? relationObjectId(relations, "targets_section")
        ?? "unsectioned";
      const section = sectionsByKey.get(sectionKey);
      const editionId = normalizeString(packet.editionId)
        ?? normalizeString(assignmentMetadata.editionId)
        ?? relationObjectId(relations, "planned_for_edition")
        ?? normalizeString(assignmentMetadata.editionSlug)
        ?? "unplanned";
      const decision = latestReportingDecision(input.assignmentEvents ?? [], assignment.id);
      return {
        assignment,
        assignmentId: assignment.id,
        title: assignment.title,
        editionId,
        editionLabel: normalizeString(assignmentMetadata.editionSlug) ?? editionId,
        sectionKey,
        sectionTitle: section?.title ?? normalizeTitle(sectionKey),
        topicKey: normalizeString(packet.topicKey)
          ?? normalizeString(assignmentMetadata.focusCategoryKey)
          ?? normalizeString(topicMetadata.categoryKey)
          ?? normalizeString(assignment.primaryFocusCategoryKey),
        coverageConceptId: normalizeString(packet.coverageConceptLineageId)
          ?? normalizeString(assignmentMetadata.coverageConceptLineageId)
          ?? normalizeString(conceptRelation?.objectLineageId),
        coverageConceptTitle: normalizeString(packet.coverageConceptTitle)
          ?? normalizeString(assignmentMetadata.coverageConceptTitle)
          ?? normalizeString(conceptMetadata.coverageConceptTitle)
          ?? normalizeString(conceptMetadata.nodeKey)
          ?? normalizeString(conceptRelation?.objectId),
        candidateRank: normalizeNumber(packet.candidateRank ?? assignmentMetadata.candidateRank ?? slotTarget.candidateRank),
        slotCount: normalizeNumber(slotTarget.slots ?? assignmentMetadata.publicationSlots ?? section?.defaultPageBudget),
        hasReportingPacket: Boolean(reportingMessage),
        reportingPacketId: reportingMessage?.id ?? null,
        researchPacketCount,
        summary: normalizeString(packet.summary) ?? reportingMessage?.summary ?? assignment.summary ?? null,
        editorRecommendation: normalizeString(packet.editorRecommendation),
        recommendedAngle: normalizeString(packet.recommendedAngle),
        riskFlags: stringList(packet.riskFlags),
        coverageGaps: stringList(packet.coverageGaps),
        openQuestions: stringList(packet.openQuestions),
        acceptedReferenceCount: stringList(packet.acceptedReferenceIds).length,
        proposedReferenceCount: arrayLength(packet.proposedReferences),
        decision: decision?.decision ?? null,
        decisionEventId: decision?.eventId ?? null,
        draftItemId: decision?.draftItemId ?? null,
        targetItemId: decision?.targetItemId ?? null,
      };
    })
    .sort(compareCandidates);

  const grouped = new Map<string, ReportingStoryBudgetCandidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.editionId}::${candidate.sectionKey}`;
    grouped.set(key, [...(grouped.get(key) ?? []), candidate]);
  }

  const sections = Array.from(grouped.values())
    .map((sectionCandidates) => buildSectionBudget(sectionCandidates))
    .sort((left, right) => (
      left.editionLabel.localeCompare(right.editionLabel)
      || left.title.localeCompare(right.title)
    ));
  return {
    sections,
    totals: totalBudget(sections),
  };
}

function buildLinkedMessageIdsByAssignment(relations: SemanticRelationRecord[]): Map<string, string[]> {
  const byAssignment = new Map<string, string[]>();
  for (const relation of relations) {
    if (relation.relationState === "superseded") continue;
    const relationType = relation.relationTypeKey ?? relation.predicate;
    if (relationType === "produces" && relation.subjectKind === "assignment" && relation.objectKind === "message") {
      byAssignment.set(relation.subjectId, [...(byAssignment.get(relation.subjectId) ?? []), relation.objectId]);
      continue;
    }
    if (relationType === "comment" && relation.subjectKind === "message" && relation.objectKind === "assignment") {
      byAssignment.set(relation.objectId, [...(byAssignment.get(relation.objectId) ?? []), relation.subjectId]);
    }
  }
  return byAssignment;
}

function groupRelationsByAssignment(relations: SemanticRelationRecord[]): Map<string, SemanticRelationRecord[]> {
  const byAssignment = new Map<string, SemanticRelationRecord[]>();
  for (const relation of relations) {
    if (relation.subjectKind !== "assignment") continue;
    if (relation.relationState === "superseded") continue;
    byAssignment.set(relation.subjectId, [...(byAssignment.get(relation.subjectId) ?? []), relation]);
  }
  return byAssignment;
}

function relationByType(relations: SemanticRelationRecord[], predicate: string, objectKind?: string): SemanticRelationRecord | null {
  return relations.find((relation) => (
    (relation.relationTypeKey ?? relation.predicate) === predicate
    && (!objectKind || relation.objectKind === objectKind)
  )) ?? null;
}

function buildSectionBudget(candidates: ReportingStoryBudgetCandidate[]): ReportingStoryBudgetSection {
  const first = candidates[0];
  const slotCount = Math.max(1, ...candidates.map((candidate) => candidate.slotCount ?? 0));
  const selectedCount = candidates.filter((candidate) => candidate.decision === "select").length;
  const briefedCount = candidates.filter((candidate) => candidate.decision === "brief").length;
  const mergedCount = candidates.filter((candidate) => candidate.decision === "merge").length;
  const heldCount = candidates.filter((candidate) => candidate.decision === "hold").length;
  const killedCount = candidates.filter((candidate) => candidate.decision === "kill").length;
  const undecidedCount = candidates.filter((candidate) => !candidate.decision).length;
  const filledCount = selectedCount + briefedCount;
  const delta = filledCount - slotCount;
  return {
    key: first.sectionKey,
    title: first.sectionTitle,
    editionId: first.editionId,
    editionLabel: first.editionLabel,
    slotCount,
    dispatchedCount: candidates.length,
    selectedCount,
    briefedCount,
    mergedCount,
    heldCount,
    killedCount,
    undecidedCount,
    filledCount,
    delta,
    state: delta > 0 ? "over" : delta === 0 ? "full" : "needs",
    candidates,
  };
}

function totalBudget(sections: ReportingStoryBudgetSection[]): ReportingStoryBudget["totals"] {
  const totals = sections.reduce((memo, section) => ({
    slotCount: memo.slotCount + section.slotCount,
    dispatchedCount: memo.dispatchedCount + section.dispatchedCount,
    selectedCount: memo.selectedCount + section.selectedCount,
    briefedCount: memo.briefedCount + section.briefedCount,
    mergedCount: memo.mergedCount + section.mergedCount,
    heldCount: memo.heldCount + section.heldCount,
    killedCount: memo.killedCount + section.killedCount,
    undecidedCount: memo.undecidedCount + section.undecidedCount,
    filledCount: memo.filledCount + section.filledCount,
    delta: memo.delta + section.delta,
  }), {
    slotCount: 0,
    dispatchedCount: 0,
    selectedCount: 0,
    briefedCount: 0,
    mergedCount: 0,
    heldCount: 0,
    killedCount: 0,
    undecidedCount: 0,
    filledCount: 0,
    delta: 0,
  });
  return {
    ...totals,
    state: totals.delta > 0 ? "over" : totals.delta === 0 ? "full" : "needs",
  };
}

function latestReportingDecision(events: AssignmentEventRecord[], assignmentId: string) {
  const event = events
    .filter((entry) => entry.assignmentId === assignmentId && entry.eventType.startsWith("reporting_"))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0];
  if (!event) return null;
  const metadata = parseObject(event.metadata);
  const decision = normalizeDecision(metadata.decision ?? event.eventType.replace(/^reporting_/, ""));
  if (!decision) return null;
  return {
    decision,
    eventId: event.id,
    draftItemId: normalizeString(metadata.draftItemId),
    targetItemId: normalizeString(metadata.targetItemId),
  };
}

function reportingPacketMetadata(message: MessageRecord, payload: unknown): Record<string, unknown> {
  const fromPayload = reportingObjectFromPayload(payload);
  if (fromPayload) return fromPayload;
  const metadata = parseObject(message.metadata);
  const reporting = parseObject(metadata.reporting);
  return Object.keys(reporting).length ? reporting : metadata;
}

function reportingObjectFromPayload(payload: unknown): Record<string, unknown> | null {
  const parsed = parseObject(payload);
  if (!Object.keys(parsed).length) return null;
  const reporting = parseObject(parsed.reporting);
  return Object.keys(reporting).length ? reporting : parsed;
}

function metadataAssignmentId(value: unknown): string | null {
  const metadata = parseObject(value);
  return normalizeString(metadata.assignmentId);
}

function relationObjectId(relations: SemanticRelationRecord[], predicate: string): string | null {
  const relation = relations.find((entry) => (entry.relationTypeKey ?? entry.predicate) === predicate);
  return relation ? normalizeString(relation.objectLineageId) ?? normalizeString(relation.objectId) : null;
}

function compareCandidates(left: ReportingStoryBudgetCandidate, right: ReportingStoryBudgetCandidate): number {
  return (
    left.editionLabel.localeCompare(right.editionLabel)
    || left.sectionTitle.localeCompare(right.sectionTitle)
    || (left.candidateRank ?? 9999) - (right.candidateRank ?? 9999)
    || left.title.localeCompare(right.title)
  );
}

function compareCreatedAtDesc(left: MessageRecord, right: MessageRecord): number {
  return String(right.createdAt).localeCompare(String(left.createdAt));
}

function parseObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => typeof entry === "string" ? entry.trim() : "")
    .filter(Boolean);
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeDecision(value: unknown): ReportingStoryBudgetDecision | null {
  const decision = String(value ?? "").trim().toLowerCase().replace(/^reporting_/, "") as ReportingStoryBudgetDecision;
  return decision === "select" || decision === "merge" || decision === "brief" || decision === "hold" || decision === "kill"
    ? decision
    : null;
}

function normalizeTitle(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Unsectioned";
}
