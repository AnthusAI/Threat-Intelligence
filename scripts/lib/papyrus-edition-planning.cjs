const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { loadSemanticConceptSeeds } = require("./papyrus-categories.cjs");
const { semanticRelationTypeFieldsForPredicate } = require("./papyrus-relation-types.cjs");
const { isEvidenceEligibleReference } = require("./papyrus-reference-policy.cjs");
const {
  buildAssignmentContextMetadata,
  parseMetadataObject,
  resolveContextProfile,
  resolveDeskFocusCategories,
  summarizeFocusCoverage,
} = require("./papyrus-assignment-context.cjs");

const EDITION_ASSIGNMENT_TYPE = "research.edition-candidate";
const DEFAULT_LANES = [
  { laneKey: "reporting", nodeKey: "editorial.form.reporting", label: "Reporting" },
  { laneKey: "analysis", nodeKey: "editorial.form.analysis", label: "Analysis" },
  { laneKey: "briefs", nodeKey: "editorial.form.briefs", label: "Briefs" },
];
const DEFAULT_TOP_DESK_COUNT = 3;
const DEFAULT_PUBLICATION_SLOTS = 1;
const DEFAULT_OVERASSIGNMENT_RATIO = 1.5;
const DEFAULT_MAX_ASSIGNMENTS = 18;

async function loadEditionPlanningState(client) {
  const [
    editions,
    publishedEditions,
    editionItems,
    categorySets,
    categories,
    references,
    semanticRelations,
    semanticNodes,
    assignments,
    assignmentEvents,
  ] = await Promise.all([
    client.listRecords("Edition"),
    client.listRecords("PublishedEdition"),
    client.listRecords("EditionItem"),
    client.listRecords("CategorySet"),
    client.listRecords("Category"),
    client.listRecords("Reference"),
    client.listRecords("SemanticRelation"),
    client.listRecords("SemanticNode"),
    client.listRecords("Assignment"),
    client.listRecords("AssignmentEvent"),
  ]);
  return {
    editions,
    publishedEditions,
    editionItems,
    categorySets,
    categories,
    references,
    semanticRelations,
    semanticNodes,
    assignments,
    assignmentEvents,
  };
}

function buildEditionPlanningPlan(state, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const editionDate = requiredString(options.editionDate, "editionDate");
  const editionSlug = options.editionSlug ?? `edition-${editionDate}`;
  const topDeskCount = positiveInteger(options.topDeskCount, DEFAULT_TOP_DESK_COUNT);
  const publicationSlots = positiveInteger(options.publicationSlots, DEFAULT_PUBLICATION_SLOTS);
  const overassignmentRatio = positiveNumber(options.overassignmentRatio, DEFAULT_OVERASSIGNMENT_RATIO);
  const maxAssignments = positiveInteger(options.maxAssignments, DEFAULT_MAX_ASSIGNMENTS);
  const focusCategories = Array.isArray(options.focusCategories) ? options.focusCategories : [];
  const explicitContextProfile = options.contextProfile ? requiredString(options.contextProfile, "contextProfile") : null;
  const targetSystemType = options.targetSystemType ? requiredString(options.targetSystemType, "targetSystemType") : null;
  const laneDefinitions = resolveLaneDefinitions(options.lanes ?? DEFAULT_LANES, options.semanticConcepts);
  const existing = buildExistingRecordMaps(state);
  const categorySet = selectAcceptedCategorySet(state.categorySets ?? []);
  const categories = (state.categories ?? []).filter((category) => (
    category.categorySetId === categorySet.id
    && category.versionState === "current"
    && category.status !== "archived"
  ));
  const rootCategories = categories
    .filter((category) => category.depth === 0 || !category.parentCategoryKey)
    .sort(compareCategoryRank);
  if (!rootCategories.length) {
    throw new Error(`No accepted root categories found for category set ${categorySet.id}.`);
  }

  const edition = buildEditionRecord({
    existingEdition: findExistingEdition(state.editions ?? [], editionSlug, editionDate),
    editionDate,
    editionSlug,
    now,
  });
  const categoryGroups = rootCategories.map((rootCategory) => buildDeskGroup(rootCategory, categories, state));
  const scoredGroups = categoryGroups
    .map((group) => scoreDeskGroup(group, state, now))
    .sort((left, right) => right.opportunityScore - left.opportunityScore || compareCategoryRank(left.root, right.root));
  const existingRootKeys = existingEditionRootKeys(state.assignments ?? [], editionSlug);
  const requestedFocusKeys = new Set(focusCategories);
  const focusSelectedGroups = focusCategories.length
    ? scoredGroups.filter((group) => Array.from(requestedFocusKeys).some((focusKey) => group.categoryKeys.has(focusKey)))
    : [];
  const unknownFocusKeys = focusCategories.filter((focusKey) => !scoredGroups.some((group) => group.categoryKeys.has(focusKey)));
  if (unknownFocusKeys.length) {
    throw new Error(`Unknown focus category '${unknownFocusKeys[0]}'.`);
  }
  const selectedGroups = existingRootKeys.length
    ? scoredGroups.filter((group) => existingRootKeys.includes(group.root.categoryKey)).sort((left, right) => existingRootKeys.indexOf(left.root.categoryKey) - existingRootKeys.indexOf(right.root.categoryKey))
    : focusSelectedGroups.length
      ? focusSelectedGroups
    : scoredGroups.slice(0, topDeskCount);
  attachEditionPlanningMetadata(edition, {
    selectedGroups,
    laneDefinitions,
    generatedAt: now,
    publicationSlots,
    overassignmentRatio,
    maxAssignments,
    contextProfile: explicitContextProfile,
    focusCategories,
  });

  const records = [
    withAction("Edition", edition, existing),
    ...laneDefinitions.map((lane) => withAction("SemanticNode", semanticNodeForLane(lane, now), existing)),
  ];
  const assignments = [];
  let assignmentCount = 0;
  for (const [deskIndex, group] of selectedGroups.entries()) {
    const focusPool = resolveDeskFocusCategories(
      group.root,
      categories,
      focusCategories.filter((focusKey) => group.categoryKeys.has(focusKey)),
    );
    let focusCursor = 0;
    for (const [laneIndex, lane] of laneDefinitions.entries()) {
      const dispatchCount = Math.ceil(publicationSlots * overassignmentRatio);
      for (let candidateRank = 1; candidateRank <= dispatchCount; candidateRank += 1) {
        if (assignmentCount >= maxAssignments) break;
        const focusCategory = focusPool[focusCursor % focusPool.length];
        focusCursor += 1;
        const assignmentBundle = buildAssignmentBundle({
          categorySet,
          edition,
          group,
          focusCategory,
          lane,
          now,
          publicationSlots,
          overassignmentRatio,
          dispatchCount,
          candidateRank,
          priority: (deskIndex + 1) * 100 + (laneIndex + 1) * 10 + candidateRank,
          existing,
          contextProfile: options.contextProfile,
          targetSystemType,
        });
        assignments.push(assignmentBundle.assignment);
        records.push(...assignmentBundle.records);
        assignmentCount += 1;
      }
      if (assignmentCount >= maxAssignments) break;
    }
    if (assignmentCount >= maxAssignments) break;
  }

  return {
    editionDate,
    editionSlug,
    generatedAt: now,
    mode: "edition-planning",
    categorySet: summarizeCategorySet(categorySet),
    edition,
    lanes: laneDefinitions.map((lane) => ({
      laneKey: lane.laneKey,
      nodeKey: lane.nodeKey,
      label: lane.label,
    })),
    focusCoverage: summarizeFocusCoverage(assignments),
    desks: selectedGroups.map((group) => summarizeDeskGroup(group)),
    assignments,
    records,
    summary: {
      editionId: edition.id,
      assignmentCount: assignments.length,
      recordCount: records.length,
      createCount: records.filter((record) => record.action === "create").length,
      updateCount: records.filter((record) => record.action === "update").length,
      noopCount: records.filter((record) => record.action === "noop").length,
      maxAssignments,
      publicationSlots,
      overassignmentRatio,
      topDeskCount,
      contextBackedAssignmentCount: assignments.filter((assignment) => Boolean(parseMetadataObject(assignment.metadata).deskCategoryKey)).length,
    },
  };
}

async function applyEditionPlanningPlan(client, plan) {
  const actionable = plan.records.filter((record) => record.action !== "noop");
  let applied = 0;
  for (const record of actionable) {
    await client.upsert(record.modelName, record.expected);
    applied += 1;
    if (applied === actionable.length || applied % 25 === 0) {
      console.error(`edition-planning\tapply\t${applied}/${actionable.length}`);
    }
  }
  return { applied, skipped: plan.records.length - actionable.length };
}

function verifyEditionPlanningPlan(state, plan) {
  const editions = state.editions ?? [];
  const publishedEditions = state.publishedEditions ?? [];
  const editionItems = state.editionItems ?? [];
  const assignments = state.assignments ?? [];
  const relations = state.semanticRelations ?? [];
  const failures = [];
  const edition = editions.find((record) => record.id === plan.edition.id);
  if (!edition) failures.push(`Missing Edition ${plan.edition.id}.`);
  if (edition && edition.status !== "planning") failures.push(`Edition ${edition.id} has status ${edition.status}, expected planning.`);
  const published = publishedEditions.find((record) => record.sourceEditionId === plan.edition.id || record.editionDate === plan.editionDate || record.slug === plan.editionSlug);
  if (published) failures.push(`PublishedEdition ${published.id} exists for planning edition ${plan.editionSlug}.`);
  const readerPlacements = editionItems.filter((record) => record.editionId === plan.edition.id);
  if (readerPlacements.length) failures.push(`Planning edition ${plan.edition.id} has ${readerPlacements.length} EditionItem rows.`);

  const assignmentIds = new Set(plan.assignments.map((assignment) => assignment.id));
  const persistedAssignments = assignments.filter((assignment) => assignmentIds.has(assignment.id));
  if (persistedAssignments.length !== plan.assignments.length) {
    failures.push(`Persisted ${persistedAssignments.length}/${plan.assignments.length} planned assignments.`);
  }

  const relationPredicatesByAssignment = new Map();
  for (const relation of relations) {
    if (relation.relationState !== "current" || !assignmentIds.has(relation.subjectId)) continue;
    const predicates = relationPredicatesByAssignment.get(relation.subjectId) ?? new Set();
    predicates.add(relation.relationTypeKey ?? relation.predicate);
    relationPredicatesByAssignment.set(relation.subjectId, predicates);
  }
  for (const assignment of plan.assignments) {
    const predicates = relationPredicatesByAssignment.get(assignment.id) ?? new Set();
    for (const predicate of ["planned_for_edition", "requests_work_on", "targets_lane"]) {
      if (!predicates.has(predicate)) failures.push(`Assignment ${assignment.id} is missing ${predicate}.`);
    }
    const metadata = parseJsonObject(assignment.metadata);
    if ((metadata.referenceLineageIds ?? []).length && !predicates.has("uses_evidence")) {
      failures.push(`Assignment ${assignment.id} has evidence metadata but no uses_evidence relation.`);
    }
    for (const key of [
      "deskCategoryKey",
      "deskCategoryLineageId",
      "focusCategoryKey",
      "focusCategoryLineageId",
      "focusCategoryTitle",
      "contextProfile",
      "contextTokenBudget",
    ]) {
      if (!metadata[key]) failures.push(`Assignment ${assignment.id} is missing ${key} metadata.`);
    }
    if (!Array.isArray(metadata.contextSources) || !metadata.contextSources.length) {
      failures.push(`Assignment ${assignment.id} is missing contextSources metadata.`);
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    counts: {
      editions: editions.filter((record) => record.id === plan.edition.id).length,
      publishedEditions: published ? 1 : 0,
      editionItems: readerPlacements.length,
      assignments: persistedAssignments.length,
      assignmentRelations: Array.from(relationPredicatesByAssignment.values()).reduce((sum, predicates) => sum + predicates.size, 0),
    },
  };
}

function writeEditionPlanningReport(plan, payload, options = {}) {
  const runId = options.runId ?? `edition-planning-${plan.editionDate}-${timestampForPath(plan.generatedAt)}`;
  const outputDir = path.resolve(options.outputDir ?? path.join(".papyrus-runs", runId));
  fs.mkdirSync(outputDir, { recursive: true });
  const filepath = path.join(outputDir, options.filename ?? "edition-planning-report.json");
  fs.writeFileSync(filepath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { outputDir, filepath };
}

function selectAcceptedCategorySet(categorySets) {
  const candidates = categorySets
    .filter((categorySet) => categorySet.status === "accepted" && categorySet.versionState === "current")
    .sort((left, right) => compareNullableDates(right.generatedAt, left.generatedAt)
      || String(right.versionCreatedAt ?? "").localeCompare(String(left.versionCreatedAt ?? ""))
      || String(left.displayName ?? "").localeCompare(String(right.displayName ?? "")));
  if (!candidates.length) throw new Error("No current accepted CategorySet found.");
  return candidates[0];
}

function findExistingEdition(editions, editionSlug, editionDate) {
  return editions.find((edition) => edition.slug === editionSlug)
    ?? editions.find((edition) => edition.editionDate === editionDate && edition.status === "planning")
    ?? null;
}

function buildEditionRecord({ existingEdition, editionDate, editionSlug, now }) {
  const lineageId = existingEdition?.lineageId ?? `edition-${safeId(editionSlug)}`;
  const base = {
    id: existingEdition?.id ?? `${lineageId}-v1`,
    lineageId,
    versionNumber: existingEdition?.versionNumber ?? 1,
    previousVersionId: existingEdition?.previousVersionId ?? null,
    versionState: "current",
    versionCreatedAt: existingEdition?.versionCreatedAt ?? now,
    versionCreatedBy: existingEdition?.versionCreatedBy ?? "papyrus-content-cli",
    changeReason: "edition-planning",
    slug: editionSlug,
    title: `Edition Planning: ${editionDate}`,
    status: "planning",
    editionDate,
    description: "Private Newsroom planning edition for lane-based research assignment dispatch.",
    layoutPlan: null,
    metadata: existingEdition?.metadata ?? JSON.stringify({
      planningKind: "lane-based-edition-planning",
      createdBy: "papyrus-content-cli",
      publicReaderVisible: false,
    }),
  };
  return {
    ...base,
    contentHash: existingEdition?.contentHash ?? hashStable({
      slug: base.slug,
      status: base.status,
      editionDate: base.editionDate,
      description: base.description,
      metadata: base.metadata,
    }),
  };
}

function attachEditionPlanningMetadata(edition, { selectedGroups, laneDefinitions, generatedAt, publicationSlots, overassignmentRatio, maxAssignments, contextProfile, focusCategories }) {
  const current = parseJsonObject(edition.metadata);
  const metadata = {
    ...current,
    planningKind: "lane-based-edition-planning",
    generatedAt: current.generatedAt ?? generatedAt,
    selectedRootCategoryKeys: selectedGroups.map((group) => group.root.categoryKey),
    selectedRootCategoryLineageIds: selectedGroups.map((group) => group.root.lineageId),
    laneKeys: laneDefinitions.map((lane) => lane.laneKey),
    laneNodeKeys: laneDefinitions.map((lane) => lane.nodeKey),
    publicationSlots,
    overassignmentRatio,
    maxAssignments,
    contextProfile: contextProfile ?? null,
    requestedFocusCategoryKeys: focusCategories ?? [],
    publicReaderVisible: false,
  };
  edition.metadata = JSON.stringify(metadata);
  edition.contentHash = hashStable({
    slug: edition.slug,
    status: edition.status,
    editionDate: edition.editionDate,
    description: edition.description,
    metadata,
  });
}

function resolveLaneDefinitions(lanes, semanticConcepts = loadSemanticConceptSeeds()) {
  const conceptByNodeKey = new Map(semanticConcepts.map((concept) => [concept.nodeKey, concept]));
  return lanes.map((lane) => {
    const concept = conceptByNodeKey.get(lane.nodeKey);
    if (!concept) throw new Error(`Missing semantic concept for lane ${lane.laneKey}: ${lane.nodeKey}`);
    return {
      ...lane,
      label: lane.label ?? concept.displayName,
      concept,
    };
  });
}

function semanticNodeForLane(lane, now) {
  const lineageId = semanticNodeLineageIdFor(lane.nodeKey);
  const record = {
    id: `${lineageId}-v1`,
    lineageId,
    versionNumber: 1,
    previousVersionId: null,
    versionState: "current",
    versionCreatedAt: now,
    versionCreatedBy: "papyrus-content-cli",
    changeReason: "edition-lane-seed",
    nodeKey: lane.nodeKey,
    nodeKind: lane.concept.nodeKind,
    corpusId: null,
    categorySetId: null,
    categoryLineageId: null,
    categoryKey: null,
    displayName: lane.concept.displayName,
    description: lane.concept.description,
    aliases: lane.concept.aliases ?? [],
    status: "accepted",
    importRunId: null,
    createdAt: now,
    newsroomFeedKey: "semanticNodes",
    updatedAt: now,
  };
  return {
    ...record,
    contentHash: hashStable({
      nodeKey: record.nodeKey,
      nodeKind: record.nodeKind,
      displayName: record.displayName,
      description: record.description,
      aliases: record.aliases,
    }),
  };
}

function buildDeskGroup(root, categories, state) {
  const descendants = descendantsForRoot(root, categories);
  const categoryLineageIds = new Set(descendants.map((category) => category.lineageId));
  const categoryKeys = new Set(descendants.map((category) => category.categoryKey));
  const classifiedRelations = (state.semanticRelations ?? [])
    .filter((relation) => relation.relationState === "current")
    .filter((relation) => (relation.relationTypeKey ?? relation.predicate) === "classified_as")
    .filter((relation) => relation.subjectKind === "reference")
    .filter((relation) => relation.objectKind === "category")
    .filter((relation) => categoryLineageIds.has(relation.objectLineageId));
  const referenceByLineage = new Map((state.references ?? [])
    .filter(isEvidenceEligibleReference)
    .map((reference) => [reference.lineageId, reference]));
  const evidenceReferences = uniqueBy(
    classifiedRelations.map((relation) => referenceByLineage.get(relation.subjectLineageId)).filter(Boolean),
    (reference) => reference.lineageId,
  ).sort(compareReferenceFreshness);
  const signalNodes = (state.semanticNodes ?? [])
    .filter((node) => node.nodeKind !== "editorialForm")
    .filter((node) => categoryKeys.has(node.categoryKey) || categoryLineageIds.has(node.categoryLineageId))
    .sort((left, right) => String(left.displayName ?? left.nodeKey).localeCompare(String(right.displayName ?? right.nodeKey)));
  return {
    root,
    categories: descendants,
    categoryLineageIds,
    categoryKeys,
    classifiedRelations,
    evidenceReferences,
    signalNodes,
  };
}

function scoreDeskGroup(group, state, now) {
  const freshness = scoreFreshness(group.evidenceReferences, now);
  const evidenceDensity = Math.min(25, group.evidenceReferences.length * 5);
  const sourceDiversity = Math.min(15, uniqueDomains(group.evidenceReferences).length * 5);
  const categoryConfidence = Math.min(10, averageScore(group.classifiedRelations) * 10);
  const graphRelevance = Math.min(10, group.signalNodes.length * 2);
  const activeDuplicateCount = countActiveAssignmentsForRoot(state.assignments ?? [], group.root.categoryKey);
  const coverageGap = activeDuplicateCount ? 3 : 10;
  const deskPolicyFit = 10;
  const duplicateWorkPenalty = Math.min(10, activeDuplicateCount * 2);
  const scoreBreakdown = {
    freshness,
    evidenceDensity,
    sourceDiversity,
    categoryConfidence,
    graphRelevance,
    coverageGap,
    deskPolicyFit,
    duplicateWorkPenalty,
  };
  return {
    ...group,
    scoreBreakdown,
    opportunityScore: Math.max(0, Object.entries(scoreBreakdown).reduce((sum, [key, value]) => (
      key === "duplicateWorkPenalty" ? sum - value : sum + value
    ), 0)),
  };
}

function buildAssignmentBundle({ categorySet, edition, group, focusCategory, lane, now, publicationSlots, overassignmentRatio, dispatchCount, candidateRank, priority, existing, contextProfile, targetSystemType }) {
  const queueKey = `edition:${edition.slug}:desk:${safeId(group.root.categoryKey)}:lane:${lane.laneKey}`;
  const assignmentId = `assignment-${safeId(EDITION_ASSIGNMENT_TYPE)}-${hashShort([
    edition.id,
    group.root.lineageId,
    lane.laneKey,
    candidateRank,
  ])}`;
  const evidenceReferences = selectEvidenceReferences(group.evidenceReferences, candidateRank);
  const signalNodes = group.signalNodes.slice(0, 3);
  const candidateAngle = candidateAngleForLane(lane, group.root, candidateRank);
  const resolvedContextProfile = resolveContextProfile(contextProfile, lane.laneKey);
  const metadata = {
    editionDate: edition.editionDate,
    editionSlug: edition.slug,
    editionId: edition.id,
    editionLineageId: edition.lineageId,
    categoryKey: focusCategory.categoryKey,
    categoryLineageId: focusCategory.lineageId,
    corpusKey: null,
    ...buildAssignmentContextMetadata({
      deskCategory: group.root,
      focusCategory,
      lane,
      contextProfile: resolvedContextProfile,
      publicationSlots,
      dispatchCount,
      overassignmentRatio,
      candidateRank,
      opportunityScore: group.opportunityScore,
      scoreBreakdown: group.scoreBreakdown,
      candidateAngle,
      evidenceReferences,
      signalNodes,
      targetSystemType,
    }),
  };
  const assignment = {
    id: assignmentId,
    assignmentTypeKey: EDITION_ASSIGNMENT_TYPE,
    queueKey,
    queueStatusKey: `${queueKey}#open`,
    status: "open",
    priority,
    title: `${lane.label} candidate ${candidateRank}: ${group.root.displayName}`,
    brief: candidateAngle,
    instructions: instructionsForLane(lane, group.root),
    assigneeType: null,
    assigneeId: null,
    assigneeKey: null,
    claimedAt: null,
    claimExpiresAt: null,
    completedAt: null,
    canceledAt: null,
    corpusId: group.root.corpusId,
    categorySetId: categorySet.id,
    classifierId: categorySet.classifierId,
    sourceSnapshotId: null,
    importRunId: null,
    createdBy: "papyrus-content-cli",
    createdAt: now,
    updatedAt: now,
    newsroomFeedKey: "assignments",
    metadata: JSON.stringify(metadata),
  };
  const assignmentEvent = {
    id: `assignment-event-${assignmentId}-created`,
    assignmentId,
    assignmentTypeKey: assignment.assignmentTypeKey,
    queueKey,
    eventType: "created",
    fromStatus: null,
    toStatus: "open",
    actorSub: null,
    actorLabel: "papyrus-content-cli",
    note: "Created by lane-based edition planning.",
    createdAt: now,
    metadata: JSON.stringify({
      editionId: edition.id,
      editionSlug: edition.slug,
      laneKey: lane.laneKey,
      deskCategoryKey: metadata.deskCategoryKey,
      focusCategoryKey: metadata.focusCategoryKey,
      candidateRank,
      contextProfile: metadata.contextProfile,
      contextTokenBudget: metadata.contextTokenBudget,
    }),
  };
  const laneNode = semanticNodeForLane(lane, now);
  const relationRecords = [
    semanticRelationRecord({
      predicate: "planned_for_edition",
      subjectKind: "assignment",
      subjectId: assignment.id,
      subjectLineageId: assignment.id,
      subjectVersionNumber: null,
      objectKind: "edition",
      objectId: edition.id,
      objectLineageId: edition.lineageId,
      objectVersionNumber: edition.versionNumber,
      rank: 1,
      importedAt: now,
      metadata: { editionSlug: edition.slug, assignmentTypeKey: assignment.assignmentTypeKey },
    }),
    semanticRelationRecord({
      predicate: "requests_work_on",
      subjectKind: "assignment",
      subjectId: assignment.id,
      subjectLineageId: assignment.id,
      subjectVersionNumber: null,
      objectKind: "category",
      objectId: focusCategory.id,
      objectLineageId: focusCategory.lineageId,
      objectVersionNumber: focusCategory.versionNumber,
      rank: 1,
      classifierId: categorySet.classifierId,
      importedAt: now,
      metadata: { categoryKey: focusCategory.categoryKey, deskCategoryKey: group.root.categoryKey, laneKey: lane.laneKey },
    }),
    semanticRelationRecord({
      predicate: "targets_lane",
      subjectKind: "assignment",
      subjectId: assignment.id,
      subjectLineageId: assignment.id,
      subjectVersionNumber: null,
      objectKind: "semanticNode",
      objectId: laneNode.id,
      objectLineageId: laneNode.lineageId,
      objectVersionNumber: laneNode.versionNumber,
      rank: 1,
      importedAt: now,
      metadata: { laneKey: lane.laneKey, laneNodeKey: lane.nodeKey },
    }),
    ...evidenceReferences.map((reference, index) => semanticRelationRecord({
      predicate: "uses_evidence",
      subjectKind: "assignment",
      subjectId: assignment.id,
      subjectLineageId: assignment.id,
      subjectVersionNumber: null,
      objectKind: "reference",
      objectId: reference.id,
      objectLineageId: reference.lineageId,
      objectVersionNumber: reference.versionNumber,
      rank: index + 1,
      importedAt: now,
      metadata: { externalItemId: reference.externalItemId, title: reference.title },
    })),
    ...signalNodes.map((node, index) => semanticRelationRecord({
      predicate: "uses_signal",
      subjectKind: "assignment",
      subjectId: assignment.id,
      subjectLineageId: assignment.id,
      subjectVersionNumber: null,
      objectKind: "semanticNode",
      objectId: node.id,
      objectLineageId: node.lineageId,
      objectVersionNumber: node.versionNumber,
      rank: index + 1,
      importedAt: now,
      metadata: { nodeKey: node.nodeKey, categoryKey: node.categoryKey },
    })),
  ];
  return {
    assignment,
    records: [
      withAction("Assignment", assignment, existing),
      withAction("AssignmentEvent", assignmentEvent, existing),
      ...relationRecords.map((record) => withAction(record.modelName, record.expected, existing)),
    ],
  };
}

function semanticRelationRecord(input) {
  const subjectStateKey = semanticStateKey(input.subjectKind, input.subjectLineageId);
  const objectStateKey = semanticStateKey(input.objectKind, input.objectLineageId);
  const objectSubjectStateKey = `${objectStateKey}#${input.subjectKind}`;
  const predicateObjectStateKey = `${input.predicate}#${objectStateKey}`;
  const subjectVersionKey = semanticVersionKey(input.subjectKind, input.subjectId);
  const objectVersionKey = semanticVersionKey(input.objectKind, input.objectId);
  const expected = {
    id: `semantic-relation-${hashShort([
      subjectVersionKey,
      input.predicate,
      objectVersionKey,
      input.rank ?? "",
      input.classifierId ?? "",
      input.modelVersion ?? "",
    ])}`,
    relationState: "current",
    predicate: input.predicate,
    ...semanticRelationTypeFieldsForPredicate(input.predicate),
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    subjectLineageId: input.subjectLineageId,
    objectKind: input.objectKind,
    objectId: input.objectId,
    objectLineageId: input.objectLineageId,
    subjectStateKey,
    objectStateKey,
    objectSubjectStateKey,
    predicateObjectStateKey,
    subjectVersionKey,
    objectVersionKey,
    reviewRecommended: Boolean(input.reviewRecommended),
    importedAt: input.importedAt,
    createdAt: input.createdAt ?? input.importedAt,
    updatedAt: input.updatedAt ?? input.importedAt,
    newsroomFeedKey: "semanticRelations",
    metadata: JSON.stringify(input.metadata ?? {}),
  };
  setOptional(expected, "subjectVersionNumber", input.subjectVersionNumber);
  setOptional(expected, "objectVersionNumber", input.objectVersionNumber);
  setOptional(expected, "score", input.score);
  setOptional(expected, "confidence", input.confidence);
  setOptional(expected, "rank", input.rank);
  setOptional(expected, "classifierId", input.classifierId);
  setOptional(expected, "modelVersion", input.modelVersion);
  setOptional(expected, "sourceSnapshotId", input.sourceSnapshotId);
  setOptional(expected, "importRunId", input.importRunId);
  return {
    modelName: "SemanticRelation",
    expected,
  };
}

function setOptional(target, key, value) {
  if (value === undefined || value === null) return;
  target[key] = value;
}

function withAction(modelName, expected, existing) {
  const current = existing[modelName]?.get(expected.id) ?? null;
  if (["Assignment", "AssignmentEvent", "SemanticNode", "SemanticRelation"].includes(modelName) && current) {
    return { modelName, expected: current, current, action: "noop" };
  }
  if (!current) return { modelName, expected, current: null, action: "create" };
  return recordsEquivalent(current, expected) ? { modelName, expected, current, action: "noop" } : { modelName, expected, current, action: "update" };
}

function buildExistingRecordMaps(state) {
  return {
    Edition: mapById(state.editions ?? []),
    SemanticNode: mapById(state.semanticNodes ?? []),
    Assignment: mapById(state.assignments ?? []),
    AssignmentEvent: mapById(state.assignmentEvents ?? []),
    SemanticRelation: mapById(state.semanticRelations ?? []),
  };
}

function descendantsForRoot(root, categories) {
  const byParentKey = new Map();
  for (const category of categories) {
    if (!category.parentCategoryKey) continue;
    const siblings = byParentKey.get(category.parentCategoryKey) ?? [];
    siblings.push(category);
    byParentKey.set(category.parentCategoryKey, siblings);
  }
  const result = [];
  const queue = [root];
  const seen = new Set();
  while (queue.length) {
    const next = queue.shift();
    if (!next || seen.has(next.categoryKey)) continue;
    seen.add(next.categoryKey);
    result.push(next);
    queue.push(...(byParentKey.get(next.categoryKey) ?? []));
  }
  return result;
}

function selectEvidenceReferences(references, candidateRank) {
  if (!references.length) return [];
  const offset = ((candidateRank - 1) * 3) % references.length;
  const selected = references.slice(offset, offset + 3);
  if (selected.length >= 3 || references.length <= selected.length) return selected;
  return selected.concat(references.slice(0, 3 - selected.length));
}

function candidateAngleForLane(lane, root, rank) {
  if (lane.laneKey === "reporting") return `Report a fresh evidence-led candidate story for ${root.displayName}, option ${rank}.`;
  if (lane.laneKey === "analysis") return `Analyze the pattern, context, and implications around ${root.displayName}, option ${rank}.`;
  if (lane.laneKey === "briefs") return `Prepare concise brief candidates from the latest useful evidence around ${root.displayName}, option ${rank}.`;
  return `Prepare a ${lane.label} candidate for ${root.displayName}, option ${rank}.`;
}

function instructionsForLane(lane, root) {
  const base = `Use publication doctrine, root-desk doctrine for ${root.displayName}, accepted category context, semantic graph context, and linked references. Return a private research packet for editor selection, not reader-facing copy.`;
  if (lane.laneKey === "reporting") return `${base} Emphasize factual findings, source trail, what happened, what is new, and what evidence supports publication.`;
  if (lane.laneKey === "analysis") return `${base} Emphasize explanation, patterns, implications, limits, uncertainty, and how the evidence fits the desk.`;
  if (lane.laneKey === "briefs") return `${base} Emphasize short, high-signal updates that could become compact briefs or evidence notes.`;
  return base;
}

function scoreFreshness(references, now) {
  if (!references.length) return 0;
  const latest = references
    .map((reference) => Date.parse(reference.sourcePublishedAt ?? reference.sourceUpdatedAt ?? reference.retrievedAt ?? reference.importedAt ?? reference.updatedAt ?? ""))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => right - left)[0];
  if (!latest) return 5;
  const ageDays = Math.max(0, (Date.parse(now) - latest) / 86400000);
  if (ageDays <= 14) return 30;
  if (ageDays <= 90) return 20;
  if (ageDays <= 365) return 10;
  return 5;
}

function averageScore(relations) {
  const scores = relations.map((relation) => Number(relation.score)).filter((score) => Number.isFinite(score));
  if (!scores.length) return 0;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function uniqueDomains(references) {
  return uniqueBy(references.map((reference) => {
    try {
      return reference.sourceUri ? new URL(reference.sourceUri).hostname.replace(/^www\./, "") : null;
    } catch {
      return null;
    }
  }).filter(Boolean), (domain) => domain);
}

function countActiveAssignmentsForRoot(assignments, rootCategoryKey) {
  return assignments.filter((assignment) => (
    assignment.assignmentTypeKey === EDITION_ASSIGNMENT_TYPE
    && !["completed", "canceled"].includes(assignment.status)
    && (
      parseJsonObject(assignment.metadata).deskCategoryKey === rootCategoryKey
      || parseJsonObject(assignment.metadata).rootCategoryKey === rootCategoryKey
    )
  )).length;
}

function existingEditionRootKeys(assignments, editionSlug) {
  const keys = [];
  const seen = new Set();
  for (const assignment of assignments) {
    if (assignment.assignmentTypeKey !== EDITION_ASSIGNMENT_TYPE || assignment.status === "canceled") continue;
    const metadata = parseJsonObject(assignment.metadata);
    const deskCategoryKey = metadata.deskCategoryKey ?? metadata.rootCategoryKey;
    if (metadata.editionSlug !== editionSlug || !deskCategoryKey || seen.has(deskCategoryKey)) continue;
    seen.add(deskCategoryKey);
    keys.push(deskCategoryKey);
  }
  return keys;
}

function summarizeDeskGroup(group) {
  return {
    categoryKey: group.root.categoryKey,
    categoryLineageId: group.root.lineageId,
    displayName: group.root.displayName,
    opportunityScore: group.opportunityScore,
    scoreBreakdown: group.scoreBreakdown,
    categoryCount: group.categories.length,
    referenceCount: group.evidenceReferences.length,
    signalCount: group.signalNodes.length,
  };
}

function summarizeCategorySet(categorySet) {
  return {
    id: categorySet.id,
    lineageId: categorySet.lineageId,
    corpusId: categorySet.corpusId,
    classifierId: categorySet.classifierId,
    displayName: categorySet.displayName,
    generatedAt: categorySet.generatedAt,
  };
}

function recordsEquivalent(left, right) {
  return JSON.stringify(normalizeRecord(left)) === JSON.stringify(normalizeRecord(right));
}

function normalizeRecord(value, key = "") {
  if (Array.isArray(value)) return value.map((entry) => normalizeRecord(entry, key));
  if (typeof value === "string" && ["metadata", "layoutPlan", "payload"].includes(key)) return normalizeRecord(parseJsonObject(value), key);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const entryKey of Object.keys(value).sort()) {
    if (value[entryKey] === undefined || value[entryKey] === null) continue;
    const normalized = normalizeRecord(value[entryKey], entryKey);
    if (normalized === undefined || normalized === null) continue;
    result[entryKey] = normalized;
  }
  return result;
}

function mapById(records) {
  return new Map(records.map((record) => [record.id, record]));
}

function uniqueBy(values, keyFn) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function compareCategoryRank(left, right) {
  return (Number(left.rank ?? 9999) - Number(right.rank ?? 9999))
    || String(left.displayName ?? left.categoryKey).localeCompare(String(right.displayName ?? right.categoryKey));
}

function compareReferenceFreshness(left, right) {
  return compareNullableDates(referenceBestDate(right), referenceBestDate(left))
    || String(left.title ?? left.externalItemId).localeCompare(String(right.title ?? right.externalItemId));
}

function compareNullableDates(left, right) {
  const leftTime = Date.parse(left ?? "");
  const rightTime = Date.parse(right ?? "");
  const leftValid = Number.isFinite(leftTime);
  const rightValid = Number.isFinite(rightTime);
  if (leftValid && rightValid) return leftTime - rightTime;
  if (leftValid) return -1;
  if (rightValid) return 1;
  return 0;
}

function referenceBestDate(reference) {
  return reference.sourcePublishedAt ?? reference.sourceUpdatedAt ?? reference.retrievedAt ?? reference.importedAt ?? reference.updatedAt ?? null;
}

function semanticNodeLineageIdFor(nodeKey) {
  return `semantic-node-${safeId(nodeKey)}`;
}

function semanticStateKey(kind, lineageId) {
  return `${kind}#${lineageId}#current`;
}

function semanticVersionKey(kind, versionId) {
  return `${kind}#${versionId}`;
}

function timestampForPath(value) {
  return String(value).replace(/[^0-9TZ]/g, "").replace(/Z$/, "Z");
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function parseJsonObject(value) {
  return parseMetadataObject(value);
}

function safeId(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 140) || hashShort(value);
}

function hashShort(value) {
  return hashStable(value).slice(0, 16);
}

function hashStable(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

module.exports = {
  DEFAULT_LANES,
  EDITION_ASSIGNMENT_TYPE,
  applyEditionPlanningPlan,
  buildEditionPlanningPlan,
  loadEditionPlanningState,
  verifyEditionPlanningPlan,
  writeEditionPlanningReport,
};
