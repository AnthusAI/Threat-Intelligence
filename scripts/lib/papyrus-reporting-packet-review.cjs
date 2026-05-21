const crypto = require("node:crypto");
const {
  attachmentRecord,
  buildJsonModelPayloadAttachment,
} = require("./papyrus-model-attachments.cjs");
const { semanticRelationTypeFieldsForPredicate } = require("./papyrus-relation-types.cjs");

const REPORTING_ASSIGNMENT_TYPE = "reporting.edition-candidate";
const REPORTING_PACKET_KIND = "reporting_context_packet";
const REPORTING_REVIEW_DECISIONS = new Set(["select", "merge", "brief", "hold", "kill"]);

function buildReportingPacketReviewPlan({
  assignment,
  message,
  decision,
  note = "",
  targetItem = null,
  actorLabel = "papyrus-content-cli",
  actorSub = null,
  now = new Date().toISOString(),
  semanticRelations = null,
} = {}) {
  if (!assignment?.id) throw new Error("Reporting packet review requires an Assignment record.");
  if (assignment.assignmentTypeKey !== REPORTING_ASSIGNMENT_TYPE) {
    throw new Error(`Assignment ${assignment.id} must be ${REPORTING_ASSIGNMENT_TYPE}.`);
  }
  if (!message?.id) throw new Error("Reporting packet review requires a Message record.");
  if (message.messageKind !== REPORTING_PACKET_KIND) {
    throw new Error(`Message ${message.id} must be ${REPORTING_PACKET_KIND}.`);
  }
  if (Array.isArray(semanticRelations) && !hasPacketAssignmentLink(semanticRelations, message.id, assignment.id)) {
    throw new Error(`Message ${message.id} is not linked to Assignment ${assignment.id} by a packet relation.`);
  }
  const normalizedDecision = normalizeReportingReviewDecision(decision);
  if (normalizedDecision === "merge" && !targetItem?.id) {
    throw new Error("Reporting packet merge decisions require --target-item.");
  }

  const eventType = `reporting_${normalizedDecision}`;
  const draftItem = normalizedDecision === "select" || normalizedDecision === "brief"
    ? draftItemForReportingPacket({ assignment, message, decision: normalizedDecision, actorLabel, now })
    : null;
  const producedItem = draftItem ?? (normalizedDecision === "merge" ? targetItem : null);
  const metadata = reportingReviewMetadata({
    assignment,
    message,
    decision: normalizedDecision,
    draftItem,
    targetItem,
  });
  const event = assignmentEventForReportingReview({
    assignment,
    eventType,
    note,
    now,
    actorLabel,
    actorSub,
  });
  const metadataAttachment = attachmentRecord(buildJsonModelPayloadAttachment({
    ownerKind: "assignmentEvent",
    ownerId: event.id,
    ownerLineageId: event.id,
    role: "metadata",
    sortKey: "metadata",
    filename: "metadata.json",
    content: metadata,
    now,
  }));
  const records = [
    { modelName: "AssignmentEvent", expected: event },
    metadataAttachment,
  ];
  if (draftItem) records.push({ modelName: "Item", expected: draftItem });
  if (producedItem) {
    records.push({
      modelName: "SemanticRelation",
      expected: semanticRelationRecord({
        predicate: "produces",
        subjectKind: "assignment",
        subjectId: assignment.id,
        subjectLineageId: assignment.id,
        objectKind: "item",
        objectId: producedItem.id,
        objectLineageId: producedItem.lineageId ?? producedItem.id,
        objectVersionNumber: producedItem.versionNumber ?? null,
        rank: 1,
        classifierId: assignment.classifierId ?? null,
        importedAt: now,
        createdAt: now,
        updatedAt: now,
        metadata: {
          lifecycle: "reporting-packet-review",
          decision: normalizedDecision,
          assignmentId: assignment.id,
          messageId: message.id,
          draftItemId: draftItem?.id ?? null,
          targetItemId: targetItem?.id ?? null,
        },
      }),
    });
  }

  return {
    dryRun: true,
    lifecycle: "reporting-packet-review",
    assignmentId: assignment.id,
    messageId: message.id,
    decision: normalizedDecision,
    event,
    metadata,
    metadataAttachment,
    draftItem,
    targetItemId: targetItem?.id ?? null,
    records,
    summary: {
      assignmentId: assignment.id,
      messageId: message.id,
      decision: normalizedDecision,
      eventId: event.id,
      metadataAttachmentId: metadataAttachment.expected.id,
      draftItemId: draftItem?.id ?? null,
      targetItemId: targetItem?.id ?? null,
      createsDraftItem: Boolean(draftItem),
      createsEditionItem: false,
      recordCount: records.length,
    },
  };
}

function normalizeReportingReviewDecision(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/^reporting_/, "");
  if (!REPORTING_REVIEW_DECISIONS.has(normalized)) {
    throw new Error("Reporting packet review decision must be select, merge, brief, hold, or kill.");
  }
  return normalized;
}

function hasPacketAssignmentLink(relations, messageId, assignmentId) {
  return relations.some((relation) => (
    relation?.relationState !== "superseded"
    && (
      (
        relation.subjectKind === "assignment"
        && relation.subjectId === assignmentId
        && relation.objectKind === "message"
        && relation.objectId === messageId
        && (relation.relationTypeKey ?? relation.predicate) === "produces"
      )
      || (
        relation.subjectKind === "message"
        && relation.subjectId === messageId
        && relation.objectKind === "assignment"
        && relation.objectId === assignmentId
        && (relation.relationTypeKey ?? relation.predicate) === "comment"
      )
    )
  ));
}

function reportingReviewMetadata({ assignment, message, decision, draftItem, targetItem }) {
  return {
    kind: "reporting.packet_review",
    source: "content-cli",
    assignmentId: assignment.id,
    messageId: message.id,
    decision,
    targetItemId: targetItem?.id ?? null,
    draftItemId: draftItem?.id ?? null,
    privatePacketMessageKind: REPORTING_PACKET_KIND,
    createsEditionItem: false,
  };
}

function assignmentEventForReportingReview({ assignment, eventType, note, now, actorLabel, actorSub }) {
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

function draftItemForReportingPacket({ assignment, message, decision, actorLabel, now }) {
  const type = decision === "brief" ? "brief" : "article";
  const section = assignment.sectionKey ?? assignment.sectionId ?? "unsectioned";
  const lineageId = `item-reporting-packet-${safeId(type)}-${hashShort([assignment.id, message.id, decision])}`;
  const title = `${type === "brief" ? "Brief" : "Article"} draft from ${assignment.title || "reporting packet"}`;
  const slug = `draft-${safeId(section)}-${hashShort([lineageId, assignment.id, message.id])}`;
  const editorial = {
    createdFrom: "reporting-packet-review",
    assignmentId: assignment.id,
    reportingPacketMessageId: message.id,
    decision,
    privateSource: true,
    copywriterConsumesPacket: true,
  };
  const record = {
    id: `${lineageId}-v1`,
    lineageId,
    versionNumber: 1,
    previousVersionId: null,
    versionState: "draft",
    versionCreatedAt: now,
    versionCreatedBy: actorLabel,
    changeReason: "reporting-packet-review",
    contentHash: "",
    type,
    status: "draft",
    typeStatus: `${type}#draft`,
    slug,
    shortSlug: null,
    section,
    sectionStatus: `${section}#draft`,
    title,
    headline: title,
    deck: "Private reporting packet selected for copywriting. Draft copy has not been written.",
    body: [],
    byline: null,
    dateline: null,
    publishedAt: null,
    editionDate: assignmentMetadata(assignment).editionDate ?? null,
    sortTitle: title,
    pullQuotes: [],
    layout: null,
    editorial,
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
    editorial: record.editorial,
  });
  return record;
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

function assignmentMetadata(assignment) {
  if (!assignment?.metadata) return {};
  if (typeof assignment.metadata === "object" && !Array.isArray(assignment.metadata)) return assignment.metadata;
  try {
    const parsed = JSON.parse(String(assignment.metadata));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
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
  REPORTING_PACKET_KIND,
  REPORTING_REVIEW_DECISIONS,
  buildReportingPacketReviewPlan,
  normalizeReportingReviewDecision,
};
