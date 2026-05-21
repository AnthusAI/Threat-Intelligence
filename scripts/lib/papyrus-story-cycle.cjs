const crypto = require("node:crypto");

const { semanticRelationTypeFieldsForPredicate } = require("./papyrus-relation-types.cjs");

const DEFAULT_STORY_CYCLE_SECTIONS = ["culture", "methods", "business", "law"];
const DEFAULT_STORY_CYCLE_SECTION_BUDGETS = {
  culture: 2,
  methods: 1,
  business: 1,
  law: 1,
};
const DEFAULT_RESEARCH_MODE = "source_discovery";
const DEFAULT_OVERASSIGNMENT_RATIO = 1.5;
const REPORTING_ANGLE_LENSES = [
  { key: "accountability", label: "accountability", prompt: "who is responsible, who is affected, and what changed" },
  { key: "reader-impact", label: "reader impact", prompt: "what a reader can use, decide, or watch next" },
  { key: "coverage-gap", label: "coverage gap", prompt: "what remains underreported and which source trail can close it" },
  { key: "evidence-check", label: "evidence check", prompt: "what is confirmed, contested, or still needs verification" },
];
const SECTION_RESEARCH_LENSES = {
  culture: "creative workflows, game design, player experience, generative media",
  arts: "creative workflows, game design, player experience, generative media",
  methods: "implementation patterns, NPC behavior, procedural generation, evaluation",
  business: "studios, tooling markets, labor, production economics",
  law: "copyright, likeness, licensing, liability, platform policy",
  "law-policy": "copyright, likeness, licensing, liability, platform policy",
};
const STORY_CYCLE_SECTION_ALIASES = {
  culture: "arts",
  law: "law-policy",
};

function buildStoryCyclePlan(options = {}) {
  const now = options.now ?? new Date().toISOString();
  const date = requiredString(options.date, "date");
  const topic = requiredString(options.topic, "topic");
  const corpusKey = cleanString(options.corpusKey) ?? "AI-ML-research";
  const categoryKey = cleanString(options.categoryKey) ?? corpusKey;
  const coverageKey = cleanString(options.coverageKey) ?? `coverage.${safeId(topic).replace(/-/g, ".")}`;
  const runId = cleanString(options.runId) ?? `story-cycle-${safeId(topic)}-${timestampForPath(now)}`;
  const researchMode = normalizeResearchMode(options.researchMode ?? DEFAULT_RESEARCH_MODE);
  const overassignmentRatio = positiveNumber(options.overassignmentRatio, DEFAULT_OVERASSIGNMENT_RATIO);
  const sections = resolveStoryCycleSections(options);
  const sectionBudgets = resolveStoryCycleSectionBudgets(options.sectionBudgets, sections);
  const anglesBySection = normalizeAnglesBySection(options.anglesBySection);
  const category = options.category ?? null;
  const categorySet = options.categorySet ?? null;
  const records = [];
  const coverageNode = storyCycleCoverageNode({
    coverageKey,
    topic,
    corpusKey,
    category,
    categorySet,
    now,
  });
  const reportingLaneNode = storyCycleLaneNode(now);
  records.push({ modelName: "SemanticNode", expected: coverageNode });
  records.push({ modelName: "SemanticNode", expected: reportingLaneNode });

  const researchAssignments = sections.map((section, index) => {
    const assignment = storyCycleResearchAssignment({
      runId,
      date,
      topic,
      corpusKey,
      categoryKey,
      category,
      categorySet,
      coverageNode,
      section,
      researchMode,
      now,
      priority: (index + 1) * 100,
    });
    records.push({ modelName: "Assignment", expected: assignment });
    records.push({ modelName: "AssignmentEvent", expected: storyCycleAssignmentEvent(assignment, {
      note: `Created story-cycle research assignment for ${topic} / ${section.id}.`,
      now,
    }) });
    records.push(...storyCycleAnchorRelations({
      assignment,
      category,
      categorySet,
      coverageNode,
      section,
      now,
    }).map((expected) => ({ modelName: "SemanticRelation", expected })));
    return assignment;
  });

  const reportingAssignments = [];
  for (const [sectionIndex, section] of sections.entries()) {
    const sectionBudget = sectionBudgets.find((budget) => budget.sectionKey === section.id);
    const slotCount = sectionBudget?.slots ?? 1;
    const dispatchCount = Math.ceil(slotCount * overassignmentRatio);
    const researchAssignment = researchAssignments.find((assignment) => assignment.sectionKey === section.id);
    const angleKeys = anglesBySection.get(section.id) ?? [];
    for (let rank = 1; rank <= dispatchCount; rank += 1) {
      const angle = resolveReportingAngle(section.id, rank, angleKeys);
      const assignment = storyCycleReportingAssignment({
        runId,
        date,
        topic,
        corpusKey,
        categoryKey,
        category,
        categorySet,
        coverageNode,
        section,
        sectionBudget,
        angle,
        candidateRank: rank,
        dispatchCount,
        researchAssignment,
        now,
        priority: (sectionIndex + 1) * 100 + rank,
      });
      reportingAssignments.push(assignment);
      records.push({ modelName: "Assignment", expected: assignment });
      records.push({ modelName: "AssignmentEvent", expected: storyCycleAssignmentEvent(assignment, {
        note: `Created story-cycle reporting assignment for ${topic} / ${section.id} / ${angle.label}.`,
        now,
      }) });
      records.push(...storyCycleAnchorRelations({
        assignment,
        category,
        categorySet,
        coverageNode,
        section,
        now,
      }).map((expected) => ({ modelName: "SemanticRelation", expected })));
      records.push({ modelName: "SemanticRelation", expected: storyCycleRelation({
        predicate: "targets_lane",
        subjectKind: "assignment",
        subjectId: assignment.id,
        subjectLineageId: assignment.id,
        objectKind: "semanticNode",
        objectId: reportingLaneNode.id,
        objectLineageId: reportingLaneNode.lineageId,
        objectVersionNumber: reportingLaneNode.versionNumber,
        rank: 1,
        classifierId: categorySet?.classifierId ?? null,
        now,
        metadata: { laneKey: "reporting", laneNodeKey: reportingLaneNode.nodeKey, runId },
      }) });
      if (researchAssignment) {
        records.push({ modelName: "SemanticRelation", expected: storyCycleRelation({
          predicate: "derived_from",
          subjectKind: "assignment",
          subjectId: assignment.id,
          subjectLineageId: assignment.id,
          objectKind: "assignment",
          objectId: researchAssignment.id,
          objectLineageId: researchAssignment.id,
          rank: 1,
          classifierId: categorySet?.classifierId ?? null,
          now,
          metadata: {
            sourceKind: "section_research_assignment",
            runId,
            coverageKey,
          },
        }) });
      }
    }
  }

  if (category) {
    records.push({ modelName: "SemanticRelation", expected: storyCycleRelation({
      predicate: "scoped_to_topic",
      subjectKind: "semanticNode",
      subjectId: coverageNode.id,
      subjectLineageId: coverageNode.lineageId,
      subjectVersionNumber: coverageNode.versionNumber,
      objectKind: "category",
      objectId: category.id,
      objectLineageId: category.lineageId ?? category.id,
      objectVersionNumber: category.versionNumber ?? null,
      rank: 1,
      classifierId: categorySet?.classifierId ?? null,
      now,
      metadata: { runId, coverageKey, categoryKey: category.categoryKey ?? categoryKey },
    }) });
  }

  return {
    ok: true,
    command: "assignments run-story-cycle",
    runId,
    date,
    topic,
    corpusKey,
    categoryKey,
    coverageKey,
    coverageNode,
    sections: sections.map((section) => ({
      key: section.id,
      title: section.title,
      researchLens: sectionResearchLens(section.id),
      slots: sectionBudgets.find((budget) => budget.sectionKey === section.id)?.slots ?? 1,
    })),
    researchMode,
    overassignmentRatio,
    researchAssignments,
    reportingAssignments,
    records: dedupeRecords(records),
    summary: {
      sectionCount: sections.length,
      researchAssignmentCount: researchAssignments.length,
      reportingAssignmentCount: reportingAssignments.length,
      createsItemOrEditionItem: records.some((record) => record.modelName === "Item" || record.modelName === "EditionItem"),
    },
  };
}

function buildStoryCycleOutput(manifest, options = {}) {
  const sectionFilter = cleanString(options.section);
  const sections = (manifest.sections ?? [])
    .filter((section) => !sectionFilter || section.key === sectionFilter)
    .map((section) => {
      const researchRuns = (manifest.researchRuns ?? []).filter((run) => run.sectionKey === section.key);
      const reportingRuns = (manifest.reportingRuns ?? []).filter((run) => run.sectionKey === section.key);
      return {
        sectionKey: section.key,
        sectionTitle: section.title,
        researchLens: section.researchLens ?? null,
        researchPackets: researchRuns.map((run) => ({
          assignmentId: run.assignmentId,
          messageId: run.messageId ?? null,
          packetPath: run.packetPath ?? null,
          summary: run.packet?.summary ?? null,
          acceptedEvidenceCount: countArray(run.packet?.evidenceItemIds),
          proposedReferenceCount: countArray(run.packet?.proposedReferences),
          sourceSnapshotCount: countArray(run.packet?.sourceSnapshots),
          ok: Boolean(run.ok),
        })),
        reportingPackets: reportingRuns.map((run) => ({
          assignmentId: run.assignmentId,
          messageId: run.messageId ?? null,
          packetPath: run.packetPath ?? null,
          angle: run.angle ?? null,
          editorRecommendation: run.packet?.editor_recommendation ?? run.packet?.editorRecommendation ?? null,
          recommendedAngle: run.packet?.recommended_angle ?? run.packet?.recommendedAngle ?? null,
          acceptedEvidenceCount: countArray(run.packet?.accepted_reference_ids ?? run.packet?.acceptedReferenceIds),
          proposedReferenceCount: countArray(run.packet?.proposed_references ?? run.packet?.proposedReferences),
          riskFlags: arrayValue(run.packet?.risk_flags ?? run.packet?.riskFlags),
          coverageGaps: arrayValue(run.packet?.coverage_gaps ?? run.packet?.coverageGaps),
          openQuestions: arrayValue(run.packet?.open_questions ?? run.packet?.openQuestions),
          copywriterBrief: run.packet?.copywriter_brief ?? run.packet?.copywriterBrief ?? null,
          ok: Boolean(run.ok),
        })),
      };
    });
  return {
    ok: true,
    command: "assignments story-cycle-output",
    runId: manifest.runId,
    action: manifest.action,
    date: manifest.date,
    topic: manifest.topic,
    coverageKey: manifest.coverageKey,
    categoryKey: manifest.categoryKey,
    manifestPath: manifest.manifestPath ?? null,
    sections,
    failures: [
      ...(manifest.researchRuns ?? []).filter((run) => !run.ok),
      ...(manifest.reportingRuns ?? []).filter((run) => !run.ok),
    ].map((run) => ({
      phase: run.phase,
      sectionKey: run.sectionKey,
      assignmentId: run.assignmentId,
      exitStatus: run.exitStatus ?? null,
      stderrPath: run.stderrPath ?? null,
      error: run.error ?? null,
    })),
  };
}

function resolveStoryCycleSections(options) {
  const sectionKeys = (Array.isArray(options.sections) && options.sections.length
    ? options.sections
    : DEFAULT_STORY_CYCLE_SECTIONS).map((key) => requiredString(key, "section"));
  const sectionsById = new Map((options.newsroomSections ?? []).map((section) => [section.id, section]));
  return sectionKeys.map((key, index) => {
    const section = sectionsById.get(key) ?? sectionsById.get(STORY_CYCLE_SECTION_ALIASES[key]);
    if (!section) {
      if (options.allowSyntheticSections) return syntheticSection(key, index);
      throw new Error(`Unknown NewsroomSection for story cycle section '${key}'.`);
    }
    return section;
  });
}

function resolveStoryCycleSectionBudgets(rawBudgets, sections) {
  const explicit = new Map();
  if (Array.isArray(rawBudgets)) {
    for (const entry of rawBudgets) {
      const [rawKey, rawSlots] = String(entry).split(":", 2);
      const rawSectionKey = cleanString(rawKey);
      const key = STORY_CYCLE_SECTION_ALIASES[rawSectionKey] ?? rawSectionKey;
      const slots = positiveInteger(rawSlots, null);
      if (!key || !slots) throw new Error(`Invalid --section-budgets entry '${entry}'. Expected section:slots.`);
      explicit.set(key, slots);
    }
  } else if (rawBudgets && typeof rawBudgets === "object") {
    for (const [key, value] of Object.entries(rawBudgets)) {
      const slots = positiveInteger(value, null);
      if (slots) explicit.set(key, slots);
    }
  }
  return sections.map((section) => ({
    sectionKey: section.id,
    slots: explicit.get(section.id) ?? DEFAULT_STORY_CYCLE_SECTION_BUDGETS[section.id] ?? positiveInteger(section.defaultPageBudget, 1),
  }));
}

function normalizeAnglesBySection(value) {
  const result = new Map();
  if (!value) return result;
  const entries = Array.isArray(value) ? value : Object.entries(value).map(([section, angles]) => `${section}:${Array.isArray(angles) ? angles.join("|") : angles}`);
  for (const entry of entries) {
    const [section, rawAngles] = String(entry).split(":", 2);
    const key = cleanString(section);
    const angles = String(rawAngles ?? "").split(/[|,]/).map((angle) => cleanString(angle)).filter(Boolean);
    if (key && angles.length) result.set(key, angles);
  }
  return result;
}

function storyCycleCoverageNode({ coverageKey, topic, corpusKey, category, categorySet, now }) {
  const lineageId = `semantic-node-${safeId(coverageKey)}`;
  const record = {
    id: `${lineageId}-v1`,
    lineageId,
    versionNumber: 1,
    previousVersionId: null,
    versionState: "current",
    versionCreatedAt: now,
    versionCreatedBy: "papyrus-content-cli",
    changeReason: "story-cycle-coverage-concept",
    nodeKey: coverageKey,
    nodeKind: "coverageQuestion",
    corpusId: categorySet?.corpusId ?? `knowledge-corpus-${safeId(corpusKey)}`,
    categorySetId: categorySet?.id ?? null,
    categoryLineageId: category?.lineageId ?? null,
    categoryKey: category?.categoryKey ?? null,
    displayName: topic,
    description: `Coverage concept for story-cycle research and reporting: ${topic}.`,
    aliases: [],
    status: "accepted",
    importRunId: null,
    createdAt: now,
    newsroomFeedKey: "semanticNodes",
    updatedAt: now,
  };
  return { ...record, contentHash: hashStable({
    nodeKey: record.nodeKey,
    nodeKind: record.nodeKind,
    displayName: record.displayName,
    description: record.description,
  }) };
}

function storyCycleLaneNode(now) {
  const lineageId = "semantic-node-editorial-form-reporting";
  const record = {
    id: `${lineageId}-v1`,
    lineageId,
    versionNumber: 1,
    previousVersionId: null,
    versionState: "current",
    versionCreatedAt: now,
    versionCreatedBy: "papyrus-content-cli",
    changeReason: "story-cycle-lane-seed",
    nodeKey: "editorial.form.reporting",
    nodeKind: "editorialForm",
    corpusId: null,
    categorySetId: null,
    categoryLineageId: null,
    categoryKey: null,
    displayName: "Reporting",
    description: "A publication item whose primary purpose is reported factual coverage.",
    aliases: ["reported story", "news report"],
    status: "accepted",
    importRunId: null,
    createdAt: now,
    newsroomFeedKey: "semanticNodes",
    updatedAt: now,
  };
  return { ...record, contentHash: hashStable({
    nodeKey: record.nodeKey,
    nodeKind: record.nodeKind,
    displayName: record.displayName,
    description: record.description,
    aliases: record.aliases,
  }) };
}

function storyCycleResearchAssignment({ runId, date, topic, corpusKey, categoryKey, category, categorySet, coverageNode, section, researchMode, now, priority }) {
  const id = `assignment-story-cycle-research-${safeId(runId)}-${safeId(section.id)}`;
  const queueKey = `story-cycle:${date}:section:${section.id}:lane:research`;
  const metadata = storyCycleAssignmentMetadata({
    kind: "story_cycle.research_assignment",
    runId,
    date,
    topic,
    corpusKey,
    categoryKey,
    category,
    categorySet,
    coverageNode,
    section,
    contextProfile: "researcher",
    expectedOutput: "Private research packet for section-shaped reporting context, not reader copy.",
    researchMode,
    researchLens: sectionResearchLens(section.id),
  });
  return {
    id,
    assignmentTypeKey: "research.edition-candidate",
    queueKey,
    queueStatusKey: `${queueKey}#open`,
    status: "open",
    priority,
    title: `Research ${topic} for ${section.title}`,
    summary: `Section-shaped research on ${topic} for ${section.title}.`,
    brief: `${section.title} research lens: ${sectionResearchLens(section.id)}.`,
    instructions: `Research ${topic} through the ${section.title} section lens. Produce a private research_packet only.`,
    metadata: JSON.stringify(metadata),
    corpusId: categorySet?.corpusId ?? `knowledge-corpus-${safeId(corpusKey)}`,
    categorySetId: categorySet?.id ?? null,
    classifierId: categorySet?.classifierId ?? null,
    sourceSnapshotId: null,
    importRunId: null,
    sectionId: section.id,
    sectionKey: section.id,
    sectionType: normalizeSectionType(section.type),
    sectionStatusKey: `${section.id}#open`,
    sectionQueueStatusKey: `${section.id}#${queueKey}#open`,
    primaryFocusCategoryKey: category?.categoryKey ?? categoryKey,
    topicScopeCategoryKeys: [category?.categoryKey ?? categoryKey].filter(Boolean),
    createdBy: "papyrus-content-cli",
    createdAt: now,
    updatedAt: now,
    newsroomFeedKey: "assignment#open",
  };
}

function storyCycleReportingAssignment({ runId, date, topic, corpusKey, categoryKey, category, categorySet, coverageNode, section, sectionBudget, angle, candidateRank, dispatchCount, researchAssignment, now, priority }) {
  const id = `assignment-story-cycle-reporting-${safeId(runId)}-${safeId(section.id)}-${String(candidateRank).padStart(2, "0")}-${safeId(angle.key)}`;
  const queueKey = `story-cycle:${date}:section:${section.id}:lane:reporting`;
  const metadata = storyCycleAssignmentMetadata({
    kind: "story_cycle.reporting_assignment",
    runId,
    date,
    topic,
    corpusKey,
    categoryKey,
    category,
    categorySet,
    coverageNode,
    section,
    contextProfile: "reporting",
    expectedOutput: "Private reporting context packet for editor selection and copywriting, not reader copy.",
    researchMode: null,
    researchLens: sectionResearchLens(section.id),
    sourceResearchAssignmentId: researchAssignment?.id ?? null,
    slotTarget: {
      sectionKey: section.id,
      slots: sectionBudget?.slots ?? 1,
      candidateRank,
      dispatchCount,
    },
    angleDiversity: {
      lensKey: angle.key,
      lensLabel: angle.label,
      lensPrompt: angle.prompt,
      diversityKey: `${section.id}:${coverageNode.nodeKey}:${angle.key}:${candidateRank}`,
      duplicateAnglePenalty: 0,
    },
  });
  return {
    id,
    assignmentTypeKey: "reporting.edition-candidate",
    queueKey,
    queueStatusKey: `${queueKey}#open`,
    status: "open",
    priority,
    title: `Report ${topic} for ${section.title}: ${angle.label}`,
    summary: `Reporting candidate on ${topic} for ${section.title}, angle: ${angle.label}.`,
    brief: `Build a private reporting context packet. Angle: ${angle.prompt}.`,
    instructions: `Use the ${section.title} doctrine and section research packet. Produce reporting_context_packet only.`,
    metadata: JSON.stringify(metadata),
    corpusId: categorySet?.corpusId ?? `knowledge-corpus-${safeId(corpusKey)}`,
    categorySetId: categorySet?.id ?? null,
    classifierId: categorySet?.classifierId ?? null,
    sourceSnapshotId: null,
    importRunId: null,
    sectionId: section.id,
    sectionKey: section.id,
    sectionType: normalizeSectionType(section.type),
    sectionStatusKey: `${section.id}#open`,
    sectionQueueStatusKey: `${section.id}#${queueKey}#open`,
    primaryFocusCategoryKey: category?.categoryKey ?? categoryKey,
    topicScopeCategoryKeys: [category?.categoryKey ?? categoryKey].filter(Boolean),
    createdBy: "papyrus-content-cli",
    createdAt: now,
    updatedAt: now,
    newsroomFeedKey: "assignment#open",
  };
}

function storyCycleAssignmentMetadata(input) {
  return {
    kind: input.kind,
    storyCycleRunId: input.runId,
    storyCycleDate: input.date,
    topic: input.topic,
    corpusKey: input.corpusKey,
    editionDate: input.date,
    editionId: `edition-${input.date}`,
    coverageConceptId: input.coverageNode.id,
    coverageConceptLineageId: input.coverageNode.lineageId,
    coverageConceptKey: input.coverageNode.nodeKey,
    coverageConceptTitle: input.coverageNode.displayName,
    categoryKey: input.category?.categoryKey ?? input.categoryKey,
    focusCategoryKey: input.category?.categoryKey ?? input.categoryKey,
    focusCategoryLineageId: input.category?.lineageId ?? null,
    focusCategoryTitle: input.category?.displayName ?? input.category?.shortTitle ?? input.categoryKey,
    categorySetId: input.categorySet?.id ?? null,
    classifierId: input.categorySet?.classifierId ?? null,
    sectionId: input.section.id,
    sectionKey: input.section.id,
    sectionTitle: input.section.title,
    sectionType: normalizeSectionType(input.section.type),
    sectionMission: input.section.editorialMission ?? null,
    sectionPolicies: input.section.editorialPolicy ? [input.section.editorialPolicy] : [],
    assignmentGuidance: input.section.assignmentGuidance ?? null,
    killCriteria: input.section.killCriteria ?? null,
    visualGuidance: input.section.visualGuidance ?? null,
    contextProfile: input.contextProfile,
    contextSources: ["publication-doctrine", "section-doctrine", "assignment-brief", "accepted-knowledge-base-evidence", "recent-section-memory", "fresh-source-needs"],
    researchMode: input.researchMode,
    researchLens: input.researchLens,
    sourceResearchAssignmentId: input.sourceResearchAssignmentId ?? null,
    slotTarget: input.slotTarget ?? null,
    angleDiversity: input.angleDiversity ?? null,
    expectedOutput: input.expectedOutput,
    publicReaderVisible: false,
    createdBy: "assignments run-story-cycle",
  };
}

function storyCycleAssignmentEvent(assignment, { note, now }) {
  return {
    id: `assignment-event-${assignment.id}-created`,
    assignmentId: assignment.id,
    assignmentTypeKey: assignment.assignmentTypeKey,
    queueKey: assignment.queueKey,
    eventType: "created",
    fromStatus: null,
    toStatus: "open",
    actorSub: null,
    actorLabel: "Papyrus content CLI",
    note,
    createdAt: now,
  };
}

function storyCycleAnchorRelations({ assignment, category, categorySet, coverageNode, section, now }) {
  const relations = [
    storyCycleRelation({
      predicate: "targets_section",
      subjectKind: "assignment",
      subjectId: assignment.id,
      subjectLineageId: assignment.id,
      objectKind: "newsroomSection",
      objectId: section.id,
      objectLineageId: section.id,
      rank: 1,
      classifierId: categorySet?.classifierId ?? null,
      now,
      metadata: { sectionKey: section.id, sectionTitle: section.title, runId: parseJson(assignment.metadata).storyCycleRunId },
    }),
    storyCycleRelation({
      predicate: "requests_work_on",
      subjectKind: "assignment",
      subjectId: assignment.id,
      subjectLineageId: assignment.id,
      objectKind: "semanticNode",
      objectId: coverageNode.id,
      objectLineageId: coverageNode.lineageId,
      objectVersionNumber: coverageNode.versionNumber,
      rank: 1,
      classifierId: categorySet?.classifierId ?? null,
      now,
      metadata: { coverageConceptKey: coverageNode.nodeKey, coverageConceptTitle: coverageNode.displayName },
    }),
  ];
  if (category) {
    relations.push(storyCycleRelation({
      predicate: "targets_topic",
      subjectKind: "assignment",
      subjectId: assignment.id,
      subjectLineageId: assignment.id,
      objectKind: "category",
      objectId: category.id,
      objectLineageId: category.lineageId ?? category.id,
      objectVersionNumber: category.versionNumber ?? null,
      rank: 1,
      classifierId: categorySet?.classifierId ?? null,
      now,
      metadata: { categoryKey: category.categoryKey, sectionKey: section.id },
    }));
  }
  return relations;
}

function storyCycleRelation(input) {
  const subjectLineageId = input.subjectLineageId ?? input.subjectId;
  const objectLineageId = input.objectLineageId ?? input.objectId;
  const subjectStateKey = `${input.subjectKind}#${subjectLineageId}#current`;
  const objectStateKey = `${input.objectKind}#${objectLineageId}#current`;
  const subjectVersionKey = `${input.subjectKind}#${input.subjectId}`;
  const objectVersionKey = `${input.objectKind}#${input.objectId}`;
  return {
    id: `semantic-relation-${hashShort([subjectVersionKey, input.predicate, objectVersionKey, input.rank ?? "", input.classifierId ?? ""])}`,
    relationState: "current",
    predicate: input.predicate,
    ...semanticRelationTypeFieldsForPredicate(input.predicate),
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    subjectLineageId,
    subjectVersionNumber: input.subjectVersionNumber ?? null,
    objectKind: input.objectKind,
    objectId: input.objectId,
    objectLineageId,
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
    importedAt: input.importedAt ?? input.now,
    createdAt: input.now,
    updatedAt: input.now,
    newsroomFeedKey: "semanticRelations",
    metadata: JSON.stringify(input.metadata ?? {}),
  };
}

function resolveReportingAngle(sectionKey, rank, overrideKeys) {
  const key = overrideKeys[rank - 1];
  if (key) {
    const known = REPORTING_ANGLE_LENSES.find((lens) => lens.key === key);
    return known ?? { key: safeId(key), label: key, prompt: key };
  }
  return REPORTING_ANGLE_LENSES[(rank - 1) % REPORTING_ANGLE_LENSES.length];
}

function sectionResearchLens(sectionKey) {
  return SECTION_RESEARCH_LENSES[sectionKey] ?? `section-specific evidence, doctrine, and recent desk memory for ${sectionKey}`;
}

function syntheticSection(key, index) {
  const title = key.split(/[-_\s]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") || key;
  return {
    id: key,
    title,
    shortTitle: title,
    type: "canonical",
    editorialMission: `Cover ${title}.`,
    editorialPolicy: `Use the ${title} section lens.`,
    assignmentGuidance: null,
    killCriteria: null,
    visualGuidance: null,
    enabled: true,
    sortOrder: index + 1,
    defaultArticleTypes: ["article"],
    defaultPageBudget: DEFAULT_STORY_CYCLE_SECTION_BUDGETS[key] ?? 1,
  };
}

function dedupeRecords(records) {
  const seen = new Set();
  const result = [];
  for (const record of records) {
    const key = `${record.modelName}:${record.expected?.id ?? JSON.stringify(record.expected)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(record);
  }
  return result;
}

function countArray(value) {
  return arrayValue(value).length;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeSectionType(value) {
  const normalized = cleanString(value);
  return normalized === "rotating" ? "floating" : normalized;
}

function normalizeResearchMode(value) {
  const normalized = String(value ?? DEFAULT_RESEARCH_MODE).trim().replace(/-/g, "_");
  if (["internal_brief", "source_discovery", "full_research"].includes(normalized)) return normalized;
  throw new Error(`Invalid research mode '${value}'.`);
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
  const text = cleanString(value);
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
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

function timestampForPath(value) {
  return String(value).replace(/[^0-9TZ]/g, "").replace(/Z$/, "Z");
}

module.exports = {
  DEFAULT_STORY_CYCLE_SECTIONS,
  DEFAULT_STORY_CYCLE_SECTION_BUDGETS,
  REPORTING_ANGLE_LENSES,
  SECTION_RESEARCH_LENSES,
  buildStoryCycleOutput,
  buildStoryCyclePlan,
};
