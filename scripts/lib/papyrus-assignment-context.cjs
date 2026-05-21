const DEFAULT_CONTEXT_SOURCES = [
  "doctrine",
  "focus-category",
  "desk-memory",
  "fresh-evidence",
];

const CONTEXT_PROFILE_DEFINITIONS = {
  reporting: {
    maxTokens: 4000,
    sectionBudgets: {
      doctrine: 0.15,
      taxonomy: 0.20,
      desk_memory: 0.25,
      fresh_evidence: 0.40,
    },
  },
  analysis: {
    maxTokens: 6000,
    sectionBudgets: {
      doctrine: 0.15,
      taxonomy: 0.20,
      desk_memory: 0.25,
      fresh_evidence: 0.40,
    },
  },
  briefs: {
    maxTokens: 2500,
    sectionBudgets: {
      doctrine: 0.15,
      taxonomy: 0.20,
      desk_memory: 0.25,
      fresh_evidence: 0.40,
    },
  },
};

function parseMetadataObject(value) {
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

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeStringList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((entry) => normalizeString(entry)).filter(Boolean);
  return String(value)
    .split(",")
    .map((entry) => normalizeString(entry))
    .filter(Boolean);
}

function safeId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "context";
}

function normalizeSectionType(value) {
  const normalized = normalizeString(value)?.toLowerCase() ?? null;
  if (normalized === "rotating") return "floating";
  return normalized;
}

function assignmentSectionKey(sectionTarget, fallback) {
  return normalizeString(sectionTarget?.id)
    ?? normalizeString(sectionTarget?.sectionKey)
    ?? normalizeString(fallback)
    ?? null;
}

function assignmentSectionFields({ sectionTarget = null, status = "open", queueKey = null, primaryFocusCategoryKey = null, topicScopeCategoryKeys = [] } = {}) {
  const sectionKey = assignmentSectionKey(sectionTarget);
  const normalizedStatus = normalizeString(status) ?? "open";
  const normalizedQueueKey = normalizeString(queueKey);
  return {
    sectionId: normalizeString(sectionTarget?.id) ?? sectionKey,
    sectionKey,
    sectionType: normalizeSectionType(sectionTarget?.type),
    sectionStatusKey: sectionKey ? `${sectionKey}#${normalizedStatus}` : null,
    sectionQueueStatusKey: sectionKey && normalizedQueueKey ? `${sectionKey}#${normalizedQueueKey}#${normalizedStatus}` : null,
    primaryFocusCategoryKey: normalizeString(primaryFocusCategoryKey),
    topicScopeCategoryKeys: normalizeStringList(topicScopeCategoryKeys),
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

function compareFocusCategoryRank(left, right) {
  const pinnedDiff = Number(Boolean(right.isPinned)) - Number(Boolean(left.isPinned));
  if (pinnedDiff !== 0) return pinnedDiff;
  const rankDiff = Number(left.rank ?? 999999) - Number(right.rank ?? 999999);
  if (rankDiff !== 0) return rankDiff;
  return String(left.categoryKey ?? left.displayName ?? "").localeCompare(String(right.categoryKey ?? right.displayName ?? ""));
}

function resolveDeskFocusCategories(rootCategory, categories, explicitFocusKeys) {
  const descendants = descendantsForRoot(rootCategory, categories)
    .filter((category) => category.status !== "archived");
  const descendantFocuses = descendants
    .filter((category) => category.categoryKey !== rootCategory.categoryKey)
    .sort(compareFocusCategoryRank);
  if (!explicitFocusKeys?.length) return descendantFocuses.length ? descendantFocuses : [rootCategory];

  const requested = normalizeStringList(explicitFocusKeys);
  const focusByKey = new Map(descendants.map((category) => [category.categoryKey, category]));
  return requested.map((focusKey) => {
    const focus = focusByKey.get(focusKey);
    if (!focus) throw new Error(`Unknown focus category '${focusKey}' under desk ${rootCategory.categoryKey}.`);
    return focus;
  });
}

function defaultContextProfileForLane(laneKey) {
  if (laneKey === "analysis") return "analysis";
  if (laneKey === "briefs") return "briefs";
  return "reporting";
}

function resolveContextProfile(contextProfile, laneKey, contextTokenBudget) {
  const key = safeId(contextProfile || defaultContextProfileForLane(laneKey));
  const definition = CONTEXT_PROFILE_DEFINITIONS[key] ?? CONTEXT_PROFILE_DEFINITIONS[defaultContextProfileForLane(laneKey)];
  const maxTokens = positiveInteger(contextTokenBudget, definition.maxTokens);
  return {
    key,
    maxTokens,
    sectionBudgets: Object.entries(definition.sectionBudgets).map(([section, share]) => ({ section, share })),
    contextSources: DEFAULT_CONTEXT_SOURCES,
  };
}

function buildAssignmentContextMetadata({
  deskCategory,
  focusCategory,
  sectionTarget,
  lane,
  contextProfile,
  publicationSlots,
  dispatchCount,
  overassignmentRatio,
  candidateRank,
  opportunityScore,
  scoreBreakdown,
  candidateAngle,
  evidenceReferences,
  signalNodes,
  targetSystemType,
}) {
  const focusTitle = focusCategory.displayName ?? focusCategory.shortTitle ?? focusCategory.categoryKey;
  const deskTitle = deskCategory.displayName ?? deskCategory.shortTitle ?? deskCategory.categoryKey;
  const coverageNode = selectCoverageConceptNode(signalNodes);
  return {
    deskCategoryKey: deskCategory.categoryKey,
    deskCategoryLineageId: deskCategory.lineageId,
    deskCategoryTitle: deskTitle,
    focusCategoryKey: focusCategory.categoryKey,
    focusCategoryLineageId: focusCategory.lineageId,
    focusCategoryTitle: focusTitle,
    contextProfile: contextProfile.key,
    contextTokenBudget: contextProfile.maxTokens,
    contextSources: contextProfile.contextSources,
    laneKey: lane.laneKey,
    laneLabel: lane.label,
    laneNodeKey: lane.nodeKey,
    sectionId: sectionTarget?.id ?? null,
    sectionTitle: sectionTarget?.title ?? null,
    sectionType: normalizeSectionType(sectionTarget?.type),
    sectionKey: sectionTarget?.id ? safeId(sectionTarget.id) : safeId(deskCategory.displayName ?? deskCategory.shortTitle ?? deskCategory.categoryKey),
    sectionMission: sectionTarget?.editorialMission ?? null,
    sectionPolicies: sectionTarget?.editorialPolicy ? [sectionTarget.editorialPolicy] : [],
    assignmentGuidance: sectionTarget?.assignmentGuidance ?? null,
    killCriteria: sectionTarget?.killCriteria ?? null,
    visualGuidance: sectionTarget?.visualGuidance ?? null,
    publicationSlots,
    dispatchCount,
    overassignmentRatio,
    candidateRank,
    opportunityScore,
    scoreBreakdown,
    candidateAngle,
    referenceLineageIds: evidenceReferences.map((reference) => reference.lineageId),
    semanticNodeLineageIds: signalNodes.map((node) => node.lineageId),
    coverageConceptId: coverageNode?.id ?? null,
    coverageConceptLineageId: coverageNode?.lineageId ?? null,
    coverageConceptKey: coverageNode?.nodeKey ?? null,
    coverageConceptTitle: coverageNode?.displayName ?? coverageNode?.nodeKey ?? null,
    policyRationale: "Live section context uses publication doctrine, section doctrine, accepted topic scope, recent section memory, and linked evidence.",
    expectedOutput: "Private research packet for editor selection, not reader copy.",
    rootCategoryKey: deskCategory.categoryKey,
    rootCategoryLineageId: deskCategory.lineageId,
    rootCategoryTitle: deskTitle,
    researchTrackKey: "live-desk-context",
    researchTrackTitle: "Live Desk Context",
    researchLens: focusCategory.categoryKey,
    researchLensTitle: focusTitle,
    assignmentTemplateKey: focusCategory.categoryKey,
    assignmentTemplateTitle: focusTitle,
    targetSystemType: targetSystemType ?? null,
    expectedEvidenceClasses: [],
    comparisonQuestions: [],
    evidenceRubric: [],
  };
}

function selectCoverageConceptNode(signalNodes = []) {
  const nodes = Array.isArray(signalNodes) ? signalNodes.filter(Boolean) : [];
  return nodes.find((node) => ["coverageQuestion", "coverageTheme", "storyExploration"].includes(node.nodeKind))
    ?? nodes.find((node) => String(node.nodeKey ?? "").startsWith("coverage."))
    ?? nodes[0]
    ?? null;
}

function summarizeFocusCoverage(assignments) {
  const counts = new Map();
  for (const assignment of assignments) {
    const topicScopeCategoryKeys = Array.isArray(assignment.topicScopeCategoryKeys)
      ? assignment.topicScopeCategoryKeys.map(normalizeString).filter(Boolean)
      : [];
    const focusCategoryKey = normalizeString(assignment.primaryFocusCategoryKey)
      ?? topicScopeCategoryKeys[0]
      ?? null;
    const deskCategoryKey = normalizeString(assignment.sectionKey)
      ?? normalizeString(assignment.sectionId)
      ?? null;
    const metadata = parseMetadataObject(assignment.metadata);
    const queueKey = normalizeString(assignment.queueKey);
    const laneKey = normalizeString(metadata.laneKey)
      ?? laneKeyFromQueueKey(queueKey)
      ?? null;
    const key = [
      deskCategoryKey ?? "",
      laneKey ?? "",
      focusCategoryKey ?? "",
    ].join("\t");
    const current = counts.get(key) ?? {
      deskCategoryKey,
      laneKey,
      queueKey,
      focusCategoryKey,
      focusCategoryTitle: focusCategoryKey,
      count: 0,
    };
    current.count += 1;
    counts.set(key, current);
  }
  return Array.from(counts.values()).sort((left, right) => (
    String(left.deskCategoryKey).localeCompare(String(right.deskCategoryKey))
    || String(left.laneKey).localeCompare(String(right.laneKey))
    || String(left.focusCategoryKey).localeCompare(String(right.focusCategoryKey))
  ));
}

function laneKeyFromQueueKey(queueKey) {
  const normalized = normalizeString(queueKey);
  if (!normalized) return null;
  const parts = normalized.split(":");
  const laneIndex = parts.lastIndexOf("lane");
  if (laneIndex >= 0 && parts[laneIndex + 1]) return normalizeString(parts[laneIndex + 1]);
  return normalizeString(normalized.split(".").pop());
}

function assignmentDeskCategoryKey(assignment) {
  return normalizeString(assignment.sectionKey)
    ?? normalizeString(assignment.sectionId)
    ?? null;
}

function assignmentFocusCategoryKey(assignment) {
  return normalizeString(assignment.primaryFocusCategoryKey)
    ?? (Array.isArray(assignment.topicScopeCategoryKeys)
      ? assignment.topicScopeCategoryKeys.map(normalizeString).find(Boolean)
      : null)
    ?? null;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  CONTEXT_PROFILE_DEFINITIONS,
  DEFAULT_CONTEXT_SOURCES,
  assignmentSectionFields,
  assignmentDeskCategoryKey,
  assignmentFocusCategoryKey,
  buildAssignmentContextMetadata,
  compareFocusCategoryRank,
  defaultContextProfileForLane,
  descendantsForRoot,
  parseMetadataObject,
  resolveContextProfile,
  resolveDeskFocusCategories,
  safeId,
  selectCoverageConceptNode,
  summarizeFocusCoverage,
};
