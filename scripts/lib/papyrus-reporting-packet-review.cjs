const crypto = require("node:crypto");
const {
  attachmentRecord,
  buildJsonModelPayloadAttachment,
} = require("./papyrus-model-attachments.cjs");
const { semanticRelationTypeFieldsForPredicate } = require("./papyrus-relation-types.cjs");

const REPORTING_ASSIGNMENT_TYPE = "reporting.edition-candidate";
const REPORTING_PACKET_KIND = "reporting_context_packet";
const REPORTING_REVIEW_DECISIONS = new Set(["select", "merge", "brief", "hold", "kill"]);
const COPYWRITING_ARTICLE_ASSIGNMENT_TYPE = "copywriting.article-draft";
const COPYWRITING_BRIEF_ASSIGNMENT_TYPE = "copywriting.brief-draft";

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
  const copywritingAssignment = normalizedDecision === "select" || normalizedDecision === "brief"
    ? copywritingAssignmentForReportingPacket({ assignment, message, decision: normalizedDecision, actorLabel, now })
    : null;
  const producedItem = normalizedDecision === "merge" ? targetItem : null;
  const metadata = reportingReviewMetadata({
    assignment,
    message,
    decision: normalizedDecision,
    copywritingAssignment,
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
  if (copywritingAssignment) {
    records.push({ modelName: "Assignment", expected: copywritingAssignment });
    records.push({
      modelName: "SemanticRelation",
      expected: semanticRelationRecord({
        predicate: "derived_from",
        subjectKind: "assignment",
        subjectId: copywritingAssignment.id,
        subjectLineageId: copywritingAssignment.id,
        objectKind: "assignment",
        objectId: assignment.id,
        objectLineageId: assignment.id,
        rank: 1,
        classifierId: assignment.classifierId ?? null,
        importedAt: now,
        createdAt: now,
        updatedAt: now,
        metadata: {
          lifecycle: "reporting-packet-review",
          sourceKind: "reporting_assignment",
          decision: normalizedDecision,
          reportingAssignmentId: assignment.id,
          reportingPacketMessageId: message.id,
          copywritingAssignmentId: copywritingAssignment.id,
        },
      }),
    });
    records.push({
      modelName: "SemanticRelation",
      expected: semanticRelationRecord({
        predicate: "derived_from",
        subjectKind: "assignment",
        subjectId: copywritingAssignment.id,
        subjectLineageId: copywritingAssignment.id,
        objectKind: "message",
        objectId: message.id,
        objectLineageId: message.id,
        rank: 2,
        classifierId: assignment.classifierId ?? null,
        importedAt: now,
        createdAt: now,
        updatedAt: now,
        metadata: {
          lifecycle: "reporting-packet-review",
          sourceKind: "reporting_context_packet",
          decision: normalizedDecision,
          reportingAssignmentId: assignment.id,
          reportingPacketMessageId: message.id,
          copywritingAssignmentId: copywritingAssignment.id,
        },
      }),
    });
  }
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
          copywritingAssignmentId: null,
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
    copywritingAssignment,
    targetItemId: targetItem?.id ?? null,
    records,
    summary: {
      assignmentId: assignment.id,
      messageId: message.id,
      decision: normalizedDecision,
      eventId: event.id,
      metadataAttachmentId: metadataAttachment.expected.id,
      copywritingAssignmentId: copywritingAssignment?.id ?? null,
      draftItemId: null,
      targetItemId: targetItem?.id ?? null,
      createsCopywritingAssignment: Boolean(copywritingAssignment),
      createsDraftItem: false,
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

function reportingReviewMetadata({ assignment, message, decision, copywritingAssignment, targetItem }) {
  return {
    kind: "reporting.packet_review",
    source: "content-cli",
    assignmentId: assignment.id,
    messageId: message.id,
    decision,
    targetItemId: targetItem?.id ?? null,
    copywritingAssignmentId: copywritingAssignment?.id ?? null,
    targetItemType: copywritingAssignment ? copywritingTargetItemType(copywritingAssignment.assignmentTypeKey) : null,
    createsCopywritingAssignment: Boolean(copywritingAssignment),
    createsDraftItem: false,
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

function copywritingAssignmentForReportingPacket({ assignment, message, decision, actorLabel, now }) {
  const targetItemType = decision === "brief" ? "brief" : "article";
  const assignmentTypeKey = targetItemType === "brief"
    ? COPYWRITING_BRIEF_ASSIGNMENT_TYPE
    : COPYWRITING_ARTICLE_ASSIGNMENT_TYPE;
  const section = assignment.sectionKey ?? assignment.sectionId ?? "unsectioned";
  const metadata = assignmentMetadata(assignment);
  const packet = reportingPacketPayload(message);
  const reporting = reportingPacketFields(packet);
  const coverageConceptKey = reporting.coverageConceptKey
    ?? metadata.coverageConceptKey
    ?? metadata.coverageKey
    ?? null;
  const editionId = reporting.editionId
    ?? metadata.editionId
    ?? (metadata.storyCycleDate ? `edition-${metadata.storyCycleDate}` : null);
  const storyCycleRunId = metadata.storyCycleRunId ?? reporting.storyCycleRunId ?? null;
  const id = `assignment-copywriting-${safeId(targetItemType)}-${hashShort([assignment.id, message.id, decision])}`;
  const queueKey = `copywriting:${editionId ?? "unplanned"}:section:${section}:type:${targetItemType}`;
  const copywriterBrief = cleanString(reporting.copywriterBrief)
    ?? cleanString(message.summary)
    ?? `Draft a reader-facing ${targetItemType} from the selected private reporting packet.`;
  const copywritingMetadata = {
    kind: "copywriting.assignment",
    createdFrom: "reporting_packet_selection",
    sourceReportingAssignmentId: assignment.id,
    sourceReportingPacketMessageId: message.id,
    sourceReportingPacketKind: REPORTING_PACKET_KIND,
    decision,
    targetItemType,
    sectionKey: section,
    editionId,
    coverageConceptKey,
    topic: reporting.topic ?? metadata.topic ?? null,
    acceptedReferenceIds: arrayValue(reporting.acceptedReferenceIds),
    proposedReferences: arrayValue(reporting.proposedReferences),
    storyCycleRunId,
    recommendedAngle: reporting.recommendedAngle ?? null,
    editorRecommendation: reporting.editorRecommendation ?? null,
    reportingPacketSummary: reporting.summary ?? message.summary ?? null,
  };
  return {
    id,
    assignmentTypeKey,
    queueKey,
    queueStatusKey: `${queueKey}#open`,
    status: "open",
    priority: (Number.isFinite(Number(assignment.priority)) ? Number(assignment.priority) : 100) + 1,
    title: `${targetItemType === "brief" ? "Write brief" : "Write article"} from ${assignment.title || "selected reporting packet"}`,
    summary: `Copywriting handoff for selected ${targetItemType} packet from ${assignment.title || assignment.id}.`,
    brief: copywriterBrief,
    instructions: [
      "Consume the private reporting_context_packet and copywriter brief.",
      "Create a complete reader-facing draft Item for editor review.",
      "Do not publish the Item and do not create EditionItem placement.",
      "Do not copy internal doctrine, desk memory, private source notes, or unresolved proposed references into reader-facing fields.",
    ].join("\n"),
    metadata: JSON.stringify(copywritingMetadata),
    corpusId: assignment.corpusId ?? null,
    categorySetId: assignment.categorySetId ?? null,
    classifierId: assignment.classifierId ?? null,
    sourceSnapshotId: assignment.sourceSnapshotId ?? null,
    importRunId: assignment.importRunId ?? null,
    sectionId: assignment.sectionId ?? section,
    sectionKey: section,
    sectionType: assignment.sectionType ?? null,
    sectionStatusKey: `${section}#open`,
    sectionQueueStatusKey: `${section}#${queueKey}#open`,
    primaryFocusCategoryKey: assignment.primaryFocusCategoryKey ?? metadata.categoryKey ?? null,
    topicScopeCategoryKeys: Array.isArray(assignment.topicScopeCategoryKeys)
      ? assignment.topicScopeCategoryKeys.filter(Boolean)
      : [metadata.categoryKey ?? assignment.primaryFocusCategoryKey].filter(Boolean),
    createdBy: actorLabel,
    createdAt: now,
    updatedAt: now,
    newsroomFeedKey: "assignment#open",
  };
}

function copywritingTargetItemType(assignmentTypeKey) {
  return assignmentTypeKey === COPYWRITING_BRIEF_ASSIGNMENT_TYPE ? "brief" : "article";
}

function reportingPacketPayload(message) {
  return reportingPacketFields(message?.metadata);
}

function reportingPacketFields(value) {
  const metadata = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : assignmentMetadata({ metadata: value });
  const reporting = metadata.reporting && typeof metadata.reporting === "object" && !Array.isArray(metadata.reporting)
    ? metadata.reporting
    : metadata;
  return {
    summary: cleanString(reporting.summary),
    topic: cleanString(reporting.topic),
    sectionKey: cleanString(reporting.sectionKey ?? reporting.section_key),
    editionId: cleanString(reporting.editionId ?? reporting.edition_id),
    storyCycleRunId: cleanString(reporting.storyCycleRunId ?? reporting.story_cycle_run_id),
    coverageConceptKey: cleanString(reporting.coverageConceptKey ?? reporting.coverage_concept_key),
    editorRecommendation: cleanString(reporting.editorRecommendation ?? reporting.editor_recommendation),
    recommendedAngle: cleanString(reporting.recommendedAngle ?? reporting.recommended_angle),
    copywriterBrief: cleanString(reporting.copywriterBrief ?? reporting.copywriter_brief),
    acceptedReferenceIds: reporting.acceptedReferenceIds ?? reporting.accepted_reference_ids,
    proposedReferences: reporting.proposedReferences ?? reporting.proposed_references,
  };
}

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
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
  COPYWRITING_ARTICLE_ASSIGNMENT_TYPE,
  COPYWRITING_BRIEF_ASSIGNMENT_TYPE,
  REPORTING_PACKET_KIND,
  REPORTING_REVIEW_DECISIONS,
  buildReportingPacketReviewPlan,
  normalizeReportingReviewDecision,
};
