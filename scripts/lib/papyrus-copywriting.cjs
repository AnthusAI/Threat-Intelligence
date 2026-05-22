const crypto = require("node:crypto");
const {
  attachmentRecord,
  buildJsonModelPayloadAttachment,
} = require("./papyrus-model-attachments.cjs");
const { semanticRelationTypeFieldsForPredicate } = require("./papyrus-relation-types.cjs");
const {
  COPYWRITING_ARTICLE_ASSIGNMENT_TYPE,
  COPYWRITING_BRIEF_ASSIGNMENT_TYPE,
  REPORTING_PACKET_KIND,
} = require("./papyrus-reporting-packet-review.cjs");

const COPYWRITING_ASSIGNMENT_TYPES = new Set([
  COPYWRITING_ARTICLE_ASSIGNMENT_TYPE,
  COPYWRITING_BRIEF_ASSIGNMENT_TYPE,
]);

function buildCopywritingRunPlan({
  assignment,
  assignmentMetadata = null,
  reportingPacketMessage,
  reportingPacketPayload = null,
  semanticRelations = [],
  existingItems = [],
  actorLabel = "papyrus-content-cli",
  actorSub = null,
  now = new Date().toISOString(),
} = {}) {
  if (!assignment?.id) throw new Error("Copywriting requires an Assignment record.");
  if (!COPYWRITING_ASSIGNMENT_TYPES.has(assignment.assignmentTypeKey)) {
    throw new Error(`Assignment ${assignment.id} must be copywriting.article-draft or copywriting.brief-draft.`);
  }
  const metadata = objectValue(assignmentMetadata) ?? objectValue(assignment.metadata) ?? {};
  if (!reportingPacketMessage?.id) throw new Error("Copywriting requires a linked reporting packet Message.");
  if (reportingPacketMessage.messageKind !== REPORTING_PACKET_KIND) {
    throw new Error(`Message ${reportingPacketMessage.id} must be ${REPORTING_PACKET_KIND}.`);
  }
  const packet = normalizeReportingPacket(reportingPacketPayload ?? reportingPacketMessage.metadata);
  const targetItemType = normalizeTargetItemType(metadata.targetItemType)
    ?? (assignment.assignmentTypeKey === COPYWRITING_BRIEF_ASSIGNMENT_TYPE ? "brief" : "article");
  const itemVersion = draftItemForCopywriting({
    assignment,
    metadata,
    packet,
    targetItemType,
    semanticRelations,
    existingItems,
    actorLabel,
    now,
  });
  const privateEditorialMetadata = privateEditorialMetadataForCopywriting({
    assignment,
    metadata,
    packet,
    reportingPacketMessage,
  });
  const event = assignmentEventForCopywriting({
    assignment,
    eventType: "copywriting_drafted",
    note: `Created draft ${targetItemType} Item ${itemVersion.id} from selected reporting packet.`,
    now,
    actorLabel,
    actorSub,
  });
  const eventMetadata = {
    kind: "copywriting.draft_created",
    source: "content-cli",
    assignmentId: assignment.id,
    assignmentTypeKey: assignment.assignmentTypeKey,
    sourceReportingAssignmentId: metadata.sourceReportingAssignmentId ?? null,
    sourceReportingPacketMessageId: reportingPacketMessage.id,
    targetItemType,
    draftItemId: itemVersion.id,
    draftItemLineageId: itemVersion.lineageId,
    versionNumber: itemVersion.versionNumber,
    previousVersionId: itemVersion.previousVersionId ?? null,
    createsEditionItem: false,
    privateEditorialMetadata,
  };
  const metadataAttachment = attachmentRecord(buildJsonModelPayloadAttachment({
    ownerKind: "assignmentEvent",
    ownerId: event.id,
    ownerLineageId: event.id,
    role: "metadata",
    sortKey: "metadata",
    filename: "metadata.json",
    content: eventMetadata,
    now,
  }));
  const producesRelation = semanticRelationRecord({
    predicate: "produces",
    subjectKind: "assignment",
    subjectId: assignment.id,
    subjectLineageId: assignment.id,
    objectKind: "item",
    objectId: itemVersion.id,
    objectLineageId: itemVersion.lineageId,
    objectVersionNumber: itemVersion.versionNumber,
    rank: itemVersion.versionNumber,
    classifierId: assignment.classifierId ?? null,
    importedAt: now,
    createdAt: now,
    updatedAt: now,
    metadata: {
      lifecycle: "copywriting",
      workProductKind: "draft_item",
      assignmentId: assignment.id,
      sourceReportingAssignmentId: metadata.sourceReportingAssignmentId ?? null,
      sourceReportingPacketMessageId: reportingPacketMessage.id,
      targetItemType,
      draftItemId: itemVersion.id,
      draftItemLineageId: itemVersion.lineageId,
      versionNumber: itemVersion.versionNumber,
      createsEditionItem: false,
      privateEditorialMetadata,
    },
  });
  const records = [
    { modelName: "Item", expected: itemVersion },
    { modelName: "SemanticRelation", expected: producesRelation },
    { modelName: "AssignmentEvent", expected: event },
    metadataAttachment,
  ];
  return {
    dryRun: true,
    lifecycle: "copywriting",
    assignmentId: assignment.id,
    sourceReportingPacketMessageId: reportingPacketMessage.id,
    targetItemType,
    draftItem: itemVersion,
    event,
    metadata: eventMetadata,
    metadataAttachment,
    records,
    summary: {
      assignmentId: assignment.id,
      sourceReportingAssignmentId: metadata.sourceReportingAssignmentId ?? null,
      sourceReportingPacketMessageId: reportingPacketMessage.id,
      targetItemType,
      draftItemId: itemVersion.id,
      draftItemLineageId: itemVersion.lineageId,
      versionNumber: itemVersion.versionNumber,
      previousVersionId: itemVersion.previousVersionId ?? null,
      createsDraftItem: true,
      createsEditionItem: false,
      recordCount: records.length,
    },
  };
}

function draftItemForCopywriting({ assignment, metadata, packet, targetItemType, semanticRelations, existingItems, actorLabel, now }) {
  const existing = latestProducedDraftItem({ assignment, semanticRelations, existingItems });
  const lineageId = existing?.lineageId
    ?? metadata.draftItemLineageId
    ?? `item-copywriting-${safeId(targetItemType)}-${hashShort([assignment.id, metadata.sourceReportingPacketMessageId ?? packet.messageId ?? "packet"])}`;
  const versions = existingItems
    .filter((item) => (item.lineageId ?? item.id) === lineageId)
    .sort((left, right) => Number(right.versionNumber ?? 0) - Number(left.versionNumber ?? 0));
  const previous = versions[0] ?? existing ?? null;
  const versionNumber = previous ? Number(previous.versionNumber ?? 0) + 1 : 1;
  const id = `${lineageId}-v${versionNumber}`;
  const section = cleanString(metadata.sectionKey) ?? assignment.sectionKey ?? assignment.sectionId ?? packet.sectionKey ?? "unsectioned";
  const headline = cleanString(packet.recommendedAngle)
    ?? cleanString(packet.nutGrafCandidate)
    ?? cleanString(assignment.title)
    ?? `${titleCase(targetItemType)} draft`;
  const title = targetItemType === "brief" ? `Brief: ${headline}` : headline;
  const deck = cleanString(packet.summary)
    ?? cleanString(packet.whyNow)
    ?? cleanString(assignment.summary)
    ?? "Draft created from a selected private reporting packet.";
  const body = readerFacingBody({ packet, assignment, targetItemType });
  const editionDate = cleanString(metadata.editionDate ?? metadata.storyCycleDate)
    ?? cleanString(packet.editionDate)
    ?? dateFromId(metadata.editionId ?? packet.editionId);
  const record = {
    id,
    lineageId,
    versionNumber,
    previousVersionId: previous?.id ?? null,
    versionState: "draft",
    versionCreatedAt: now,
    versionCreatedBy: actorLabel,
    changeReason: "copywriting-assignment-run",
    contentHash: "",
    type: targetItemType,
    status: "draft",
    typeStatus: `${targetItemType}#draft`,
    slug: `draft-${safeId(section)}-${hashShort([lineageId, versionNumber, title])}`,
    shortSlug: null,
    section,
    sectionStatus: `${section}#draft`,
    title,
    headline,
    deck,
    body,
    byline: null,
    dateline: null,
    editionDate,
    sortTitle: title,
    pullQuotes: [],
    layout: null,
    updatedAt: now,
  };
  record.contentHash = hashStable({
    type: record.type,
    status: record.status,
    slug: record.slug,
    section: record.section,
    title: record.title,
    headline: record.headline,
    deck: record.deck,
    body: record.body,
  });
  return record;
}

function privateEditorialMetadataForCopywriting({ assignment, metadata, packet, reportingPacketMessage }) {
  return {
    createdFrom: "copywriting_assignment",
    copywritingAssignmentId: assignment.id,
    sourceReportingAssignmentId: metadata.sourceReportingAssignmentId ?? null,
    reportingPacketMessageId: reportingPacketMessage.id ?? metadata.sourceReportingPacketMessageId ?? packet.messageId ?? null,
    privateSource: true,
    acceptedReferenceIds: arrayValue(metadata.acceptedReferenceIds ?? packet.acceptedReferenceIds),
    proposedReferences: arrayValue(metadata.proposedReferences ?? packet.proposedReferences),
    unresolvedProposedReferencesStayPrivate: true,
    storyCycleRunId: metadata.storyCycleRunId ?? metadata.coverageThemeRunId ?? metadata.runId ?? packet.storyCycleRunId ?? assignment.importRunId ?? null,
    coverageConceptKey: metadata.coverageConceptKey ?? metadata.coverageKey ?? packet.coverageConceptKey ?? packet.coverageKey ?? null,
  };
}

function readerFacingBody({ packet, assignment, targetItemType }) {
  const paragraphs = [];
  const nutGraf = cleanString(packet.nutGrafCandidate) ?? cleanString(packet.summary);
  if (nutGraf) paragraphs.push(nutGraf);
  for (const fact of arrayValue(packet.confirmedFacts).map(cleanString).filter(Boolean).slice(0, targetItemType === "brief" ? 2 : 5)) {
    paragraphs.push(fact);
  }
  const angle = cleanString(packet.recommendedAngle);
  const whyNow = cleanString(packet.whyNow);
  if (whyNow && whyNow !== nutGraf) paragraphs.push(whyNow);
  if (angle && !paragraphs.some((paragraph) => paragraph.includes(angle))) {
    paragraphs.push(`The working angle is ${angle}.`);
  }
  if (!paragraphs.length) {
    paragraphs.push(cleanString(assignment.brief) ?? cleanString(assignment.summary) ?? "This draft is based on a selected private reporting packet and needs editor review before publication.");
  }
  return paragraphs;
}

function latestProducedDraftItem({ assignment, semanticRelations, existingItems }) {
  const itemById = new Map((existingItems ?? []).map((item) => [item.id, item]));
  const produced = (semanticRelations ?? [])
    .filter((relation) => relation.relationState !== "superseded")
    .filter((relation) => relation.subjectKind === "assignment" && relation.subjectId === assignment.id)
    .filter((relation) => relation.objectKind === "item")
    .filter((relation) => (relation.relationTypeKey ?? relation.predicate) === "produces")
    .map((relation) => itemById.get(relation.objectId))
    .filter(Boolean)
    .sort((left, right) => Number(right.versionNumber ?? 0) - Number(left.versionNumber ?? 0));
  return produced[0] ?? null;
}

function assignmentEventForCopywriting({ assignment, eventType, note, now, actorLabel, actorSub }) {
  return {
    id: `assignment-event-${safeId(assignment.id)}-${safeId(eventType)}-${timestampId(now)}`,
    assignmentId: assignment.id,
    assignmentTypeKey: assignment.assignmentTypeKey,
    queueKey: assignment.queueKey,
    eventType,
    fromStatus: assignment.status ?? null,
    toStatus: assignment.status ?? null,
    actorSub,
    actorLabel,
    note: String(note ?? "").trim() || null,
    createdAt: now,
  };
}

function semanticRelationRecord(input) {
  const subjectStateKey = semanticStateKey(input.subjectKind, input.subjectLineageId);
  const objectStateKey = semanticStateKey(input.objectKind, input.objectLineageId);
  const subjectVersionKey = `${input.subjectKind}#${input.subjectId}`;
  const objectVersionKey = `${input.objectKind}#${input.objectId}`;
  return {
    id: `semantic-relation-${hashShort([
      subjectVersionKey,
      input.predicate,
      objectVersionKey,
      input.rank ?? "",
      input.classifierId ?? "",
    ])}`,
    relationState: "current",
    predicate: input.predicate,
    ...semanticRelationTypeFieldsForPredicate(input.predicate),
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    subjectLineageId: input.subjectLineageId,
    subjectVersionNumber: input.subjectVersionNumber ?? null,
    objectKind: input.objectKind,
    objectId: input.objectId,
    objectLineageId: input.objectLineageId,
    objectVersionNumber: input.objectVersionNumber ?? null,
    subjectStateKey,
    objectStateKey,
    objectSubjectStateKey: `${objectStateKey}#${input.subjectKind}`,
    predicateObjectStateKey: `${input.predicate}#${objectStateKey}`,
    subjectVersionKey,
    objectVersionKey,
    score: input.score ?? input.confidence ?? 1,
    confidence: input.confidence ?? null,
    rank: input.rank ?? null,
    classifierId: input.classifierId ?? null,
    modelVersion: input.modelVersion ?? null,
    reviewRecommended: Boolean(input.reviewRecommended),
    sourceSnapshotId: input.sourceSnapshotId ?? null,
    importRunId: input.importRunId ?? null,
    importedAt: input.importedAt ?? null,
    createdAt: input.createdAt ?? input.importedAt ?? new Date().toISOString(),
    updatedAt: input.updatedAt ?? input.importedAt ?? new Date().toISOString(),
    newsroomFeedKey: "semanticRelations",
    metadata: JSON.stringify(input.metadata ?? {}),
  };
}

function normalizeReportingPacket(payload) {
  const parsed = objectValue(payload) ?? {};
  const reporting = objectValue(parsed.reporting) ?? parsed;
  return {
    messageId: cleanString(parsed.messageId),
    summary: cleanString(reporting.summary),
    sectionKey: cleanString(reporting.sectionKey ?? reporting.section_key),
    editionId: cleanString(reporting.editionId ?? reporting.edition_id),
    editionDate: cleanString(reporting.editionDate ?? reporting.edition_date),
    storyCycleRunId: cleanString(reporting.storyCycleRunId ?? reporting.story_cycle_run_id ?? reporting.coverageThemeRunId ?? reporting.coverage_theme_run_id),
    coverageConceptKey: cleanString(reporting.coverageConceptKey ?? reporting.coverage_concept_key ?? reporting.coverageKey ?? reporting.coverage_key),
    whyNow: cleanString(reporting.whyNow ?? reporting.why_now),
    nutGrafCandidate: cleanString(reporting.nutGrafCandidate ?? reporting.nut_graf_candidate),
    recommendedAngle: cleanString(reporting.recommendedAngle ?? reporting.recommended_angle),
    confirmedFacts: arrayValue(reporting.confirmedFacts ?? reporting.confirmed_facts),
    acceptedReferenceIds: arrayValue(reporting.acceptedReferenceIds ?? reporting.accepted_reference_ids),
    proposedReferences: arrayValue(reporting.proposedReferences ?? reporting.proposed_references),
    copywriterBrief: cleanString(reporting.copywriterBrief ?? reporting.copywriter_brief),
  };
}

function objectValue(value) {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeTargetItemType(value) {
  const normalized = cleanString(value);
  return normalized === "article" || normalized === "brief" ? normalized : null;
}

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function titleCase(value) {
  return String(value ?? "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function dateFromId(value) {
  const match = String(value ?? "").match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function semanticStateKey(kind, lineageId) {
  return `${kind}#${lineageId}#current`;
}

function safeId(value) {
  return String(value ?? "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "unknown";
}

function timestampId(value) {
  return String(value ?? new Date().toISOString()).replace(/[^0-9TZ]/g, "");
}

function hashShort(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function hashStable(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

module.exports = {
  COPYWRITING_ASSIGNMENT_TYPES,
  buildCopywritingRunPlan,
};
