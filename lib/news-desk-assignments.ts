export const ASSIGNMENT_ITEM_TYPE = "assignment";
export const ASSIGNMENT_STATUSES = ["dispatched", "researched", "drafted", "culled"] as const;
export const CULLED_STATUS = "culled";
export const MANUAL_CULLING_SOURCE = "manual-news-desk";

export type NewsDeskAssignmentStatus = typeof ASSIGNMENT_STATUSES[number];

export type NewsDeskAssignmentEdition = {
  id: string;
  lineageId?: string | null;
  versionNumber?: number | null;
  previousVersionId?: string | null;
  versionState?: string | null;
  versionCreatedAt?: string | null;
  versionCreatedBy?: string | null;
  changeReason?: string | null;
  contentHash?: string | null;
  slug: string;
  title: string;
  status?: string | null;
  editionDate: string;
  publishedAt?: string | null;
  description?: string | null;
  layoutPlan?: unknown;
  metadata?: unknown;
};

export type NewsDeskAssignmentEditionItem = {
  id: string;
  editionId: string;
  editionLineageId?: string | null;
  itemId: string;
  itemLineageId?: string | null;
  placementKey: string;
  sortKey: string;
  pageNumber?: number | null;
  priority?: number | null;
  metadata?: unknown;
};

export type NewsDeskAssignmentItem = {
  id: string;
  lineageId?: string | null;
  versionNumber?: number | null;
  previousVersionId?: string | null;
  versionState?: string | null;
  versionCreatedAt?: string | null;
  versionCreatedBy?: string | null;
  changeReason?: string | null;
  contentHash?: string | null;
  type: string;
  status: string;
  typeStatus: string;
  slug: string;
  shortSlug?: string | null;
  section?: string | null;
  sectionStatus?: string | null;
  title?: string | null;
  headline?: string | null;
  deck?: string | null;
  body?: Array<string | null> | null;
  byline?: string | null;
  dateline?: string | null;
  publishedAt?: string | null;
  editionDate?: string | null;
  sortTitle?: string | null;
  pullQuotes?: Array<string | null> | null;
  layout?: unknown;
  editorial?: unknown;
  updatedAt?: string | null;
};

export type NewsDeskAssignmentCandidate = {
  assignment: NewsDeskAssignmentItem;
  editionItem: NewsDeskAssignmentEditionItem;
  draftItem?: NewsDeskAssignmentItem | null;
};

export type NewsDeskAssignmentDesk = {
  edition: NewsDeskAssignmentEdition | null;
  editionItems: NewsDeskAssignmentEditionItem[];
  candidates: NewsDeskAssignmentCandidate[];
  loadError?: string | null;
};

export type ManualCullingOptions = {
  actorLabel: string;
  now: string;
  reason?: string;
};

export type NewsDeskAssignmentItemUpdate = {
  id: string;
  status: string;
  typeStatus: string;
  sectionStatus: string;
  editorial: Record<string, unknown>;
};

export type NewsDeskAssignmentVersionPlan = {
  itemChanges: NewsDeskAssignmentItemVersionChange[];
  editionChange: NewsDeskAssignmentEditionVersionChange | null;
};

export type NewsDeskAssignmentItemVersionChange = {
  previousItem: NewsDeskAssignmentItem;
  previousItemUpdate: {
    id: string;
    versionState: "superseded";
    updatedAt: string;
  };
  nextItem: NewsDeskAssignmentItem;
};

export type NewsDeskAssignmentEditionVersionChange = {
  previousEdition: NewsDeskAssignmentEdition;
  previousEditionUpdate: {
    id: string;
    versionState: "superseded";
  };
  nextEdition: NewsDeskAssignmentEdition;
  nextEditionItems: NewsDeskAssignmentEditionItem[];
};

type NewsroomEditorial = {
  newsroom?: {
    assignment?: {
      targetArticleSlots?: number | null;
      evidenceItemIds?: Array<string | null> | null;
      [key: string]: unknown;
    };
    culling?: {
      previousStatus?: string | null;
      previousTypeStatus?: string | null;
      previousSectionStatus?: string | null;
      [key: string]: unknown;
    };
    draft?: {
      articleItemId?: string | null;
      [key: string]: unknown;
    };
    assignmentItemId?: string | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export function createEmptyAssignmentDesk(loadError: string | null = null): NewsDeskAssignmentDesk {
  return {
    edition: null,
    editionItems: [],
    candidates: [],
    loadError,
  };
}

export function buildAssignmentDesk(
  editions: NewsDeskAssignmentEdition[],
  editionItems: NewsDeskAssignmentEditionItem[],
  items: NewsDeskAssignmentItem[],
): NewsDeskAssignmentDesk {
  const assignmentItems = items.filter(isAssignmentItem);
  const assignmentById = new Map(assignmentItems.map((item) => [item.id, item]));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const candidateEditionItems = editionItems.filter((editionItem) => (
    editionItem.placementKey.startsWith("assignment:")
    && assignmentById.has(editionItem.itemId)
  ));
  const assignmentEditionIds = new Set(candidateEditionItems.map((editionItem) => editionItem.editionId));
  const selectedEdition = editions
    .filter((edition) => edition.versionState === undefined || edition.versionState === null || edition.versionState === "current")
    .filter((edition) => assignmentEditionIds.has(edition.id))
    .sort(compareEditionsByFreshness)[0] ?? null;

  if (!selectedEdition) return createEmptyAssignmentDesk();

  const draftByAssignmentId = indexDraftItemsByAssignment(items);
  const selectedEditionItems = editionItems
    .filter((editionItem) => editionItem.editionId === selectedEdition.id)
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey));
  const selectedAssignmentEditionItems = candidateEditionItems
    .filter((editionItem) => editionItem.editionId === selectedEdition.id)
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey));
  const candidates: NewsDeskAssignmentCandidate[] = [];
  for (const editionItem of selectedAssignmentEditionItems) {
    const assignment = assignmentById.get(editionItem.itemId) ?? itemById.get(editionItem.itemId);
    if (!assignment) continue;
    const draftItemId = getDraftArticleItemId(assignment);
    const draftItem = draftItemId ? itemById.get(draftItemId) ?? draftByAssignmentId.get(assignment.id) : draftByAssignmentId.get(assignment.id);
    candidates.push({
      assignment,
      editionItem,
      draftItem: draftItem ?? null,
    });
  }

  return {
    edition: selectedEdition,
    editionItems: selectedEditionItems,
    candidates,
    loadError: null,
  };
}

export function buildCullItemUpdate(
  item: NewsDeskAssignmentItem,
  { actorLabel, now, reason = "" }: ManualCullingOptions,
): NewsDeskAssignmentItemUpdate {
  const editorial = normalizeEditorial(item.editorial);
  const newsroom = editorial.newsroom ?? {};
  const existingCulling = isObject(newsroom.culling) ? newsroom.culling : {};
  const sectionStatus = `${slugify(item.section ?? "news")}#${CULLED_STATUS}`;

  return {
    id: item.id,
    status: CULLED_STATUS,
    typeStatus: `${item.type}#${CULLED_STATUS}`,
    sectionStatus,
    editorial: {
      ...editorial,
      newsroom: {
        ...newsroom,
        culling: {
          ...existingCulling,
          status: CULLED_STATUS,
          source: MANUAL_CULLING_SOURCE,
          culledAt: now,
          culledBy: actorLabel,
          reason: reason.trim() || null,
          previousStatus: existingCulling.previousStatus ?? item.status,
          previousTypeStatus: existingCulling.previousTypeStatus ?? item.typeStatus,
          previousSectionStatus: existingCulling.previousSectionStatus ?? item.sectionStatus ?? `${slugify(item.section ?? "news")}#${item.status}`,
          restoredAt: null,
          restoredBy: null,
        },
      },
    },
  };
}

export function buildRestoreItemUpdate(
  item: NewsDeskAssignmentItem,
  { actorLabel, now }: ManualCullingOptions,
): NewsDeskAssignmentItemUpdate {
  const editorial = normalizeEditorial(item.editorial);
  const newsroom = editorial.newsroom ?? {};
  const existingCulling = isObject(newsroom.culling) ? newsroom.culling : {};
  const restoredStatus = String(existingCulling.previousStatus ?? defaultRestoredStatus(item));
  const restoredTypeStatus = String(existingCulling.previousTypeStatus ?? `${item.type}#${restoredStatus}`);
  const restoredSectionStatus = String(existingCulling.previousSectionStatus ?? `${slugify(item.section ?? "news")}#${restoredStatus}`);

  return {
    id: item.id,
    status: restoredStatus,
    typeStatus: restoredTypeStatus,
    sectionStatus: restoredSectionStatus,
    editorial: {
      ...editorial,
      newsroom: {
        ...newsroom,
        culling: {
          ...existingCulling,
          status: "restored",
          source: MANUAL_CULLING_SOURCE,
          restoredAt: now,
          restoredBy: actorLabel,
        },
      },
    },
  };
}

export function applyAssignmentItemUpdates(
  desk: NewsDeskAssignmentDesk,
  updates: NewsDeskAssignmentItemUpdate[],
): NewsDeskAssignmentDesk {
  if (updates.length === 0) return desk;
  const updateById = new Map(updates.map((update) => [update.id, update]));
  return {
    ...desk,
    candidates: desk.candidates.map((candidate) => ({
      ...candidate,
      assignment: mergeItemUpdate(candidate.assignment, updateById.get(candidate.assignment.id)),
      draftItem: candidate.draftItem ? mergeItemUpdate(candidate.draftItem, updateById.get(candidate.draftItem.id)) : candidate.draftItem,
    })),
  };
}

export function buildAssignmentManualVersionPlan(
  desk: NewsDeskAssignmentDesk,
  candidate: NewsDeskAssignmentCandidate,
  action: "cull" | "restore",
  options: ManualCullingOptions,
): NewsDeskAssignmentVersionPlan {
  const baseUpdates = buildAssignmentManualUpdates(candidate, action, options);
  const itemsById = new Map<string, NewsDeskAssignmentItem>();
  itemsById.set(candidate.assignment.id, candidate.assignment);
  if (candidate.draftItem) itemsById.set(candidate.draftItem.id, candidate.draftItem);

  const itemChanges = baseUpdates.map((update) => {
    const previousItem = itemsById.get(update.id);
    if (!previousItem) throw new Error(`Could not find item ${update.id} for ${action}.`);
    return buildItemVersionChange(previousItem, update, options, action);
  });

  syncLinkedDraftVersionIds(candidate, itemChanges);

  const editionChange = desk.edition
    ? buildEditionVersionChange(desk.edition, desk.editionItems, itemChanges, options, action)
    : null;

  return { itemChanges, editionChange };
}

export function applyAssignmentVersionPlan(
  desk: NewsDeskAssignmentDesk,
  plan: NewsDeskAssignmentVersionPlan,
): NewsDeskAssignmentDesk {
  if (plan.itemChanges.length === 0) return desk;
  const nextItemByPreviousId = new Map(plan.itemChanges.map((change) => [change.previousItem.id, change.nextItem]));
  const nextItemsById = new Map<string, NewsDeskAssignmentItem>();
  for (const candidate of desk.candidates) {
    const assignment = nextItemByPreviousId.get(candidate.assignment.id) ?? candidate.assignment;
    nextItemsById.set(assignment.id, assignment);
    if (candidate.draftItem) {
      const draftItem = nextItemByPreviousId.get(candidate.draftItem.id) ?? candidate.draftItem;
      nextItemsById.set(draftItem.id, draftItem);
    }
  }

  const nextEdition = plan.editionChange?.nextEdition ?? desk.edition;
  const nextEditionItems = plan.editionChange?.nextEditionItems ?? desk.editionItems.map((editionItem) => {
    const nextItem = nextItemByPreviousId.get(editionItem.itemId);
    return nextItem
      ? {
        ...editionItem,
        itemId: nextItem.id,
        itemLineageId: nextItem.lineageId ?? nextItem.id,
      }
      : editionItem;
  });

  if (!nextEdition) {
    return {
      ...desk,
      candidates: desk.candidates.map((candidate) => ({
        ...candidate,
        assignment: nextItemByPreviousId.get(candidate.assignment.id) ?? candidate.assignment,
        draftItem: candidate.draftItem ? nextItemByPreviousId.get(candidate.draftItem.id) ?? candidate.draftItem : candidate.draftItem,
      })),
    };
  }

  const rebuilt = buildAssignmentDesk([nextEdition], nextEditionItems, Array.from(nextItemsById.values()));
  return {
    ...rebuilt,
    loadError: desk.loadError ?? rebuilt.loadError,
  };
}

export function getAssignmentEvidenceCount(item: NewsDeskAssignmentItem): number {
  const evidence = normalizeEditorial(item.editorial).newsroom?.assignment?.evidenceItemIds;
  return Array.isArray(evidence) ? evidence.filter(Boolean).length : 0;
}

export function getAssignmentTargetArticleSlots(item: NewsDeskAssignmentItem): number | null {
  const value = normalizeEditorial(item.editorial).newsroom?.assignment?.targetArticleSlots;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function getAssignmentAngle(item: NewsDeskAssignmentItem): string {
  const angle = normalizeEditorial(item.editorial).newsroom?.assignment?.angle;
  return typeof angle === "string" ? angle : "";
}

export function getAssignmentBrief(item: NewsDeskAssignmentItem): string {
  const brief = normalizeEditorial(item.editorial).newsroom?.assignment?.brief;
  return typeof brief === "string" ? brief : "";
}

export function getCullingReason(item: NewsDeskAssignmentItem): string {
  const reason = normalizeEditorial(item.editorial).newsroom?.culling?.reason;
  return typeof reason === "string" ? reason : "";
}

export function isCulledItem(item: NewsDeskAssignmentItem): boolean {
  return item.status === CULLED_STATUS || item.typeStatus.endsWith(`#${CULLED_STATUS}`);
}

export function normalizeEditorial(value: unknown): NewsroomEditorial {
  const normalized = normalizeJsonish(value);
  return isObject(normalized) ? normalized as NewsroomEditorial : {};
}

function isAssignmentItem(item: NewsDeskAssignmentItem): boolean {
  return item.type === ASSIGNMENT_ITEM_TYPE
    && ASSIGNMENT_STATUSES.some((status) => item.typeStatus === `${ASSIGNMENT_ITEM_TYPE}#${status}`);
}

function getDraftArticleItemId(assignment: NewsDeskAssignmentItem): string | null {
  const id = normalizeEditorial(assignment.editorial).newsroom?.draft?.articleItemId;
  return typeof id === "string" && id.trim() ? id : null;
}

function indexDraftItemsByAssignment(items: NewsDeskAssignmentItem[]): Map<string, NewsDeskAssignmentItem> {
  const map = new Map<string, NewsDeskAssignmentItem>();
  for (const item of items) {
    if (item.type !== "article") continue;
    const assignmentItemId = normalizeEditorial(item.editorial).newsroom?.assignmentItemId;
    if (typeof assignmentItemId === "string" && assignmentItemId.trim()) map.set(assignmentItemId, item);
  }
  return map;
}

function compareEditionsByFreshness(left: NewsDeskAssignmentEdition, right: NewsDeskAssignmentEdition): number {
  const leftDate = left.publishedAt ?? `${left.editionDate}T00:00:00.000Z`;
  const rightDate = right.publishedAt ?? `${right.editionDate}T00:00:00.000Z`;
  const dateDiff = rightDate.localeCompare(leftDate);
  if (dateDiff !== 0) return dateDiff;
  return right.id.localeCompare(left.id);
}

function mergeItemUpdate(item: NewsDeskAssignmentItem, update: NewsDeskAssignmentItemUpdate | undefined): NewsDeskAssignmentItem {
  return update ? { ...item, ...update } : item;
}

function buildAssignmentManualUpdates(
  candidate: NewsDeskAssignmentCandidate,
  action: "cull" | "restore",
  options: ManualCullingOptions,
): NewsDeskAssignmentItemUpdate[] {
  const updates = new Map<string, NewsDeskAssignmentItemUpdate>();
  const affectedItems = [candidate.assignment, candidate.draftItem].filter((item): item is NewsDeskAssignmentItem => Boolean(item));
  for (const item of affectedItems) {
    const update = action === "cull"
      ? buildCullItemUpdate(item, options)
      : buildRestoreItemUpdate(item, options);
    updates.set(update.id, update);
  }
  return Array.from(updates.values());
}

function buildItemVersionChange(
  previousItem: NewsDeskAssignmentItem,
  update: NewsDeskAssignmentItemUpdate,
  { actorLabel, now, reason = "" }: ManualCullingOptions,
  action: "cull" | "restore",
): NewsDeskAssignmentItemVersionChange {
  const lineageId = previousItem.lineageId ?? previousItem.id;
  const versionNumber = nextVersionNumber(previousItem.versionNumber);
  const nextItem: NewsDeskAssignmentItem = {
    ...previousItem,
    ...update,
    id: versionedId(lineageId, versionNumber),
    lineageId,
    versionNumber,
    previousVersionId: previousItem.id,
    versionState: "current",
    versionCreatedAt: now,
    versionCreatedBy: actorLabel,
    changeReason: reason.trim() || `manual ${action}`,
    updatedAt: now,
  };
  nextItem.contentHash = contentHashFor(nextItem);

  return {
    previousItem,
    previousItemUpdate: {
      id: previousItem.id,
      versionState: "superseded",
      updatedAt: now,
    },
    nextItem,
  };
}

function syncLinkedDraftVersionIds(
  candidate: NewsDeskAssignmentCandidate,
  itemChanges: NewsDeskAssignmentItemVersionChange[],
) {
  if (!candidate.draftItem) return;
  const assignmentChange = itemChanges.find((change) => change.previousItem.id === candidate.assignment.id);
  const draftChange = itemChanges.find((change) => change.previousItem.id === candidate.draftItem?.id);
  if (!assignmentChange || !draftChange) return;

  const assignmentEditorial = normalizeEditorial(assignmentChange.nextItem.editorial);
  const assignmentNewsroom = assignmentEditorial.newsroom ?? {};
  assignmentChange.nextItem.editorial = {
    ...assignmentEditorial,
    newsroom: {
      ...assignmentNewsroom,
      draft: {
        ...(isObject(assignmentNewsroom.draft) ? assignmentNewsroom.draft : {}),
        articleItemId: draftChange.nextItem.id,
      },
    },
  };
  assignmentChange.nextItem.contentHash = contentHashFor(assignmentChange.nextItem);

  const draftEditorial = normalizeEditorial(draftChange.nextItem.editorial);
  const draftNewsroom = draftEditorial.newsroom ?? {};
  draftChange.nextItem.editorial = {
    ...draftEditorial,
    newsroom: {
      ...draftNewsroom,
      assignmentItemId: assignmentChange.nextItem.id,
    },
  };
  draftChange.nextItem.contentHash = contentHashFor(draftChange.nextItem);
}

function buildEditionVersionChange(
  previousEdition: NewsDeskAssignmentEdition,
  editionItems: NewsDeskAssignmentEditionItem[],
  itemChanges: NewsDeskAssignmentItemVersionChange[],
  { actorLabel, now, reason = "" }: ManualCullingOptions,
  action: "cull" | "restore",
): NewsDeskAssignmentEditionVersionChange {
  const itemChangeByPreviousId = new Map(itemChanges.map((change) => [change.previousItem.id, change]));
  const lineageId = previousEdition.lineageId ?? previousEdition.id;
  const versionNumber = nextVersionNumber(previousEdition.versionNumber);
  const nextEdition: NewsDeskAssignmentEdition = {
    ...previousEdition,
    id: versionedId(lineageId, versionNumber),
    lineageId,
    versionNumber,
    previousVersionId: previousEdition.id,
    versionState: "current",
    versionCreatedAt: now,
    versionCreatedBy: actorLabel,
    changeReason: reason.trim() || `manual assignment ${action}`,
  };
  nextEdition.contentHash = contentHashFor(nextEdition);

  const nextEditionItems = editionItems.map((editionItem) => {
    const itemChange = itemChangeByPreviousId.get(editionItem.itemId);
    const nextItem = itemChange?.nextItem;
    const nextItemId = nextItem?.id ?? editionItem.itemId;
    const itemLineageId = nextItem?.lineageId ?? editionItem.itemLineageId ?? editionItem.itemId;
    return {
      ...editionItem,
      id: versionedEditionItemId(nextEdition.id, editionItem),
      editionId: nextEdition.id,
      editionLineageId: lineageId,
      itemId: nextItemId,
      itemLineageId,
    };
  });

  return {
    previousEdition,
    previousEditionUpdate: {
      id: previousEdition.id,
      versionState: "superseded",
    },
    nextEdition,
    nextEditionItems,
  };
}

function defaultRestoredStatus(item: NewsDeskAssignmentItem): string {
  if (item.type === "article") return "draft";
  if (item.type === ASSIGNMENT_ITEM_TYPE) return "dispatched";
  return "draft";
}

function nextVersionNumber(versionNumber: number | null | undefined): number {
  return typeof versionNumber === "number" && Number.isFinite(versionNumber)
    ? Math.max(1, Math.trunc(versionNumber)) + 1
    : 2;
}

function versionedId(lineageId: string, versionNumber: number): string {
  return `${lineageId}-v${versionNumber}`;
}

function versionedEditionItemId(editionId: string, editionItem: NewsDeskAssignmentEditionItem): string {
  return `${editionId}-${slugify(editionItem.sortKey || editionItem.placementKey || editionItem.id)}-${stableHash(editionItem.id)}`;
}

function contentHashFor(value: unknown): string {
  return `fnv1a32:${stableHash(stripHash(value))}`;
}

function stripHash(value: unknown): unknown {
  if (!isObject(value)) return value;
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "contentHash") continue;
    copy[key] = entry;
  }
  return copy;
}

function stableHash(value: unknown): string {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

function normalizeJsonish(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "news";
}
