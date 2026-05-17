import type {
  AssignmentRecord,
  CategorySteeringCategory,
  KnowledgeCommentRecord,
  ReferenceAttachmentRecord,
  ReferenceRecord,
  SemanticNodeRecord,
  SemanticRelationRecord,
} from "./category-repository";

export const SEMANTIC_OBJECT_KINDS = [
  "reference",
  "assignment",
  "item",
  "category",
  "categorySet",
  "semanticNode",
  "semanticRelation",
  "knowledgeComment",
  "steeringProposal",
  "steeringDecision",
  "knowledgeArtifact",
  "knowledgeImportRun",
] as const;

export type SemanticObjectKind = typeof SEMANTIC_OBJECT_KINDS[number];

export type SemanticPredicateId =
  | "classified_as"
  | "mentions"
  | "about"
  | "uses_evidence"
  | "requests_work_on"
  | "produces"
  | "blocked_by"
  | "derived_from"
  | "related_to"
  | "broader_than"
  | "narrower_than"
  | "supports"
  | "contradicts";

export type SemanticPredicateDefinition = {
  id: SemanticPredicateId | string;
  label: string;
  group: "classification" | "evidence" | "ontology" | "commentary" | "generic";
  inverseLabel: string;
};

export const SEMANTIC_PREDICATES: SemanticPredicateDefinition[] = [
  { id: "classified_as", label: "classified as", group: "classification", inverseLabel: "classified references/items" },
  { id: "mentions", label: "mentions", group: "ontology", inverseLabel: "mentioned by" },
  { id: "about", label: "about", group: "commentary", inverseLabel: "commentary" },
  { id: "requests_work_on", label: "requests work on", group: "generic", inverseLabel: "requested work" },
  { id: "uses_evidence", label: "uses evidence", group: "evidence", inverseLabel: "used by" },
  { id: "produces", label: "produces", group: "generic", inverseLabel: "produced by" },
  { id: "blocked_by", label: "blocked by", group: "generic", inverseLabel: "blocks" },
  { id: "derived_from", label: "derived from", group: "generic", inverseLabel: "source for" },
  { id: "related_to", label: "related to", group: "generic", inverseLabel: "related from" },
  { id: "broader_than", label: "broader than", group: "ontology", inverseLabel: "narrower concept" },
  { id: "narrower_than", label: "narrower than", group: "ontology", inverseLabel: "broader concept" },
  { id: "supports", label: "supports", group: "evidence", inverseLabel: "supported by" },
  { id: "contradicts", label: "contradicts", group: "evidence", inverseLabel: "contradicted by" },
];

export type SemanticObjectRecord =
  | ReferenceRecord
  | CategorySteeringCategory
  | SemanticNodeRecord
  | KnowledgeCommentRecord
  | AssignmentRecord
  | SemanticRelationRecord;

export type SemanticObjectSummary = {
  kind: SemanticObjectKind;
  id: string;
  lineageId: string;
  versionNumber?: number | null;
  label: string;
  subtitle?: string | null;
  href: string;
  record?: SemanticObjectRecord;
};

export type SemanticNeighborGroup = {
  predicate: string;
  label: string;
  direction: "outgoing" | "incoming";
  relations: SemanticRelationRecord[];
  objects: SemanticObjectSummary[];
};

export type SemanticWalkResult = {
  start: SemanticObjectSummary | null;
  nodes: SemanticObjectSummary[];
  edges: SemanticRelationRecord[];
  warnings: string[];
};

export type SemanticGraphSnapshotInput = {
  references: ReferenceRecord[];
  categories: CategorySteeringCategory[];
  semanticNodes: SemanticNodeRecord[];
  knowledgeComments: KnowledgeCommentRecord[];
  semanticRelations: SemanticRelationRecord[];
  assignments?: AssignmentRecord[];
  referenceAttachments?: ReferenceAttachmentRecord[];
};

export function semanticStateKey(kind: string, lineageId: string, state = "current"): string {
  return `${kind}#${lineageId}#${state}`;
}

export function semanticVersionKey(kind: string, versionId: string): string {
  return `${kind}#${versionId}`;
}

export function semanticObjectSubjectStateKey(objectKind: string, objectLineageId: string, subjectKind: string, state = "current"): string {
  return `${objectKind}#${objectLineageId}#${state}#${subjectKind}`;
}

export function semanticPredicateObjectStateKey(predicate: string, objectKind: string, objectLineageId: string, state = "current"): string {
  return `${predicate}#${objectKind}#${objectLineageId}#${state}`;
}

export function predicateLabel(predicate: string, direction: "outgoing" | "incoming" = "outgoing"): string {
  const definition = SEMANTIC_PREDICATES.find((entry) => entry.id === predicate);
  if (!definition) return predicate.replaceAll("_", " ");
  return direction === "incoming" ? definition.inverseLabel : definition.label;
}

export function newsDeskHrefForSemanticObject(kind: string, lineageId: string): string {
  const encoded = encodeURIComponent(lineageId);
  if (kind === "reference") return `/news-desk?section=references&reference=${encoded}`;
  if (kind === "category") return `/news-desk?section=topics&category=${encoded}`;
  if (kind === "semanticNode") return `/news-desk?section=concepts&node=${encoded}`;
  if (kind === "assignment") return `/news-desk?section=assignments&assignment=${encoded}`;
  if (kind === "item") return `/news-desk?section=overview&item=${encoded}`;
  if (kind === "knowledgeComment") return `/news-desk?section=references&comment=${encoded}`;
  return `/news-desk?section=overview&object=${encodeURIComponent(kind)}:${encoded}`;
}

export function createSemanticGraphSnapshot(input: SemanticGraphSnapshotInput) {
  return new SemanticGraphSnapshot(input);
}

export class SemanticGraphSnapshot {
  private referencesById = new Map<string, ReferenceRecord>();
  private referencesByLineage = new Map<string, ReferenceRecord>();
  private categoriesById = new Map<string, CategorySteeringCategory>();
  private categoriesByLineage = new Map<string, CategorySteeringCategory>();
  private semanticNodesById = new Map<string, SemanticNodeRecord>();
  private semanticNodesByLineage = new Map<string, SemanticNodeRecord>();
  private commentsById = new Map<string, KnowledgeCommentRecord>();
  private commentsByLineage = new Map<string, KnowledgeCommentRecord>();
  private assignmentsById = new Map<string, AssignmentRecord>();
  private relationsBySubjectState = new Map<string, SemanticRelationRecord[]>();
  private relationsByObjectState = new Map<string, SemanticRelationRecord[]>();

  readonly attachmentsByReferenceLineage = new Map<string, ReferenceAttachmentRecord[]>();

  constructor(private input: SemanticGraphSnapshotInput) {
    for (const reference of input.references) {
      indexVersionedRecord(reference, this.referencesById, this.referencesByLineage);
    }
    for (const category of input.categories) {
      indexVersionedRecord(category, this.categoriesById, this.categoriesByLineage);
    }
    for (const node of input.semanticNodes) {
      indexVersionedRecord(node, this.semanticNodesById, this.semanticNodesByLineage);
    }
    for (const comment of input.knowledgeComments) {
      this.commentsById.set(comment.id, comment);
      this.commentsByLineage.set(comment.subjectLineageId, comment);
    }
    for (const assignment of input.assignments ?? []) {
      this.assignmentsById.set(assignment.id, assignment);
    }
    for (const relation of input.semanticRelations.filter((entry) => entry.relationState === "current")) {
      pushMap(this.relationsBySubjectState, relation.subjectStateKey, relation);
      pushMap(this.relationsByObjectState, relation.objectStateKey, relation);
    }
    for (const attachment of input.referenceAttachments ?? []) {
      pushMap(this.attachmentsByReferenceLineage, attachment.referenceLineageId, attachment);
    }
  }

  resolve(kind: string, idOrLineageId: string): SemanticObjectSummary | null {
    if (!idOrLineageId) return null;
    if (kind === "reference") return summarizeReference(this.referencesByLineage.get(idOrLineageId) ?? this.referencesById.get(idOrLineageId) ?? null);
    if (kind === "category") return summarizeCategory(this.categoriesByLineage.get(idOrLineageId) ?? this.categoriesById.get(idOrLineageId) ?? null);
    if (kind === "semanticNode") return summarizeSemanticNode(this.semanticNodesByLineage.get(idOrLineageId) ?? this.semanticNodesById.get(idOrLineageId) ?? null);
    if (kind === "knowledgeComment") return summarizeComment(this.commentsByLineage.get(idOrLineageId) ?? this.commentsById.get(idOrLineageId) ?? null);
    if (kind === "assignment") return summarizeAssignment(this.assignmentsById.get(idOrLineageId) ?? null);
    return null;
  }

  resolveRelationObject(relation: SemanticRelationRecord, direction: "outgoing" | "incoming"): SemanticObjectSummary | null {
    return direction === "outgoing"
      ? this.resolve(relation.objectKind, relation.objectLineageId) ?? fallbackRelationObject(relation, "object")
      : this.resolve(relation.subjectKind, relation.subjectLineageId) ?? fallbackRelationObject(relation, "subject");
  }

  outgoing(kind: string, lineageId: string): SemanticRelationRecord[] {
    return this.relationsBySubjectState.get(semanticStateKey(kind, lineageId)) ?? [];
  }

  incoming(kind: string, lineageId: string): SemanticRelationRecord[] {
    return this.relationsByObjectState.get(semanticStateKey(kind, lineageId)) ?? [];
  }

  neighbors(kind: string, lineageId: string): SemanticNeighborGroup[] {
    const groups: SemanticNeighborGroup[] = [];
    groups.push(...groupRelations(this.outgoing(kind, lineageId), "outgoing", (relation) => this.resolveRelationObject(relation, "outgoing")));
    groups.push(...groupRelations(this.incoming(kind, lineageId), "incoming", (relation) => this.resolveRelationObject(relation, "incoming")));
    return groups;
  }

  referencesForCategory(categoryLineageId: string): SemanticObjectSummary[] {
    return this.subjectsForObject("category", categoryLineageId, "reference", "classified_as");
  }

  referencesForSemanticNode(nodeLineageId: string, predicate?: string): SemanticObjectSummary[] {
    return this.subjectsForObject("semanticNode", nodeLineageId, "reference", predicate);
  }

  subjectsForObject(objectKind: string, objectLineageId: string, subjectKind: string, predicate?: string): SemanticObjectSummary[] {
    const relations = this.incoming(objectKind, objectLineageId)
      .filter((relation) => relation.subjectKind === subjectKind)
      .filter((relation) => !predicate || relation.predicate === predicate);
    return uniqueSemanticObjects(relations.map((relation) => this.resolve(relation.subjectKind, relation.subjectLineageId) ?? fallbackRelationObject(relation, "subject")));
  }

  commentsFor(kind: string, lineageId: string): KnowledgeCommentRecord[] {
    const stateKey = semanticStateKey(kind, lineageId);
    return this.input.knowledgeComments.filter((comment) => comment.subjectStateKey === stateKey || comment.subjectLineageId === lineageId);
  }

  attachmentsForReference(referenceLineageId: string): ReferenceAttachmentRecord[] {
    return (this.attachmentsByReferenceLineage.get(referenceLineageId) ?? []).sort((left, right) => left.sortKey.localeCompare(right.sortKey));
  }

  walk(kind: string, lineageId: string, depth = 2): SemanticWalkResult {
    const start = this.resolve(kind, lineageId);
    if (!start) return { start: null, nodes: [], edges: [], warnings: [`Missing start object ${kind}#${lineageId}`] };
    const nodes = new Map<string, SemanticObjectSummary>([[`${start.kind}#${start.lineageId}`, start]]);
    const edges = new Map<string, SemanticRelationRecord>();
    let frontier = [start];
    for (let level = 0; level < Math.max(0, depth); level += 1) {
      const nextFrontier: SemanticObjectSummary[] = [];
      for (const node of frontier) {
        for (const relation of [...this.outgoing(node.kind, node.lineageId), ...this.incoming(node.kind, node.lineageId)]) {
          edges.set(relation.id, relation);
          const neighbor = relation.subjectLineageId === node.lineageId && relation.subjectKind === node.kind
            ? this.resolveRelationObject(relation, "outgoing")
            : this.resolveRelationObject(relation, "incoming");
          if (!neighbor) continue;
          const key = `${neighbor.kind}#${neighbor.lineageId}`;
          if (!nodes.has(key)) {
            nodes.set(key, neighbor);
            nextFrontier.push(neighbor);
          }
        }
      }
      frontier = nextFrontier;
      if (!frontier.length) break;
    }
    return { start, nodes: Array.from(nodes.values()), edges: Array.from(edges.values()), warnings: [] };
  }
}

function indexVersionedRecord<T extends { id: string; lineageId?: string | null; versionState?: string | null; versionNumber?: number | null }>(
  record: T,
  byId: Map<string, T>,
  byLineage: Map<string, T>,
) {
  byId.set(record.id, record);
  const lineageId = record.lineageId ?? record.id;
  const current = byLineage.get(lineageId);
  if (!current || record.versionState === "current" || Number(record.versionNumber ?? 0) > Number(current.versionNumber ?? 0)) {
    byLineage.set(lineageId, record);
  }
}

function groupRelations(
  relations: SemanticRelationRecord[],
  direction: "outgoing" | "incoming",
  objectFor: (relation: SemanticRelationRecord) => SemanticObjectSummary | null,
): SemanticNeighborGroup[] {
  const groups = new Map<string, SemanticRelationRecord[]>();
  for (const relation of relations) pushMap(groups, relation.predicate, relation);
  return Array.from(groups.entries()).map(([predicate, entries]) => ({
    predicate,
    label: predicateLabel(predicate, direction),
    direction,
    relations: entries.sort(compareRelations),
    objects: uniqueSemanticObjects(entries.map(objectFor)),
  }));
}

function compareRelations(left: SemanticRelationRecord, right: SemanticRelationRecord): number {
  const rankDiff = (left.rank ?? 999999) - (right.rank ?? 999999);
  if (rankDiff !== 0) return rankDiff;
  return (right.score ?? 0) - (left.score ?? 0);
}

function uniqueSemanticObjects(objects: Array<SemanticObjectSummary | null>): SemanticObjectSummary[] {
  const map = new Map<string, SemanticObjectSummary>();
  for (const object of objects) {
    if (!object) continue;
    map.set(`${object.kind}#${object.lineageId}`, object);
  }
  return Array.from(map.values()).sort((left, right) => left.label.localeCompare(right.label));
}

function summarizeReference(record: ReferenceRecord | null): SemanticObjectSummary | null {
  if (!record) return null;
  const lineageId = record.lineageId ?? record.id;
  return {
    kind: "reference",
    id: record.id,
    lineageId,
    versionNumber: record.versionNumber,
    label: record.title ?? record.externalItemId,
    subtitle: record.mediaType ?? record.storagePath ?? record.sourceUri,
    href: newsDeskHrefForSemanticObject("reference", lineageId),
    record,
  };
}

function summarizeCategory(record: CategorySteeringCategory | null): SemanticObjectSummary | null {
  if (!record) return null;
  const lineageId = record.lineageId ?? record.id;
  return {
    kind: "category",
    id: record.id,
    lineageId,
    versionNumber: record.versionNumber,
    label: record.displayName,
    subtitle: record.subtitle ?? record.categoryKey,
    href: newsDeskHrefForSemanticObject("category", lineageId),
    record,
  };
}

function summarizeSemanticNode(record: SemanticNodeRecord | null): SemanticObjectSummary | null {
  if (!record) return null;
  const lineageId = record.lineageId ?? record.id;
  return {
    kind: "semanticNode",
    id: record.id,
    lineageId,
    versionNumber: record.versionNumber,
    label: record.displayName ?? record.nodeKey,
    subtitle: record.nodeKind,
    href: newsDeskHrefForSemanticObject("semanticNode", lineageId),
    record,
  };
}

function summarizeComment(record: KnowledgeCommentRecord | null): SemanticObjectSummary | null {
  if (!record) return null;
  const lineageId = record.id;
  return {
    kind: "knowledgeComment",
    id: record.id,
    lineageId,
    versionNumber: record.subjectVersionNumber,
    label: record.commentKind,
    subtitle: record.body,
    href: newsDeskHrefForSemanticObject("knowledgeComment", lineageId),
    record,
  };
}

function summarizeAssignment(record: AssignmentRecord | null): SemanticObjectSummary | null {
  if (!record) return null;
  return {
    kind: "assignment",
    id: record.id,
    lineageId: record.id,
    label: record.title,
    subtitle: `${record.assignmentTypeKey} / ${record.status}`,
    href: newsDeskHrefForSemanticObject("assignment", record.id),
    record,
  };
}

function fallbackRelationObject(relation: SemanticRelationRecord, side: "subject" | "object"): SemanticObjectSummary {
  const kind = (side === "subject" ? relation.subjectKind : relation.objectKind) as SemanticObjectKind;
  const id = side === "subject" ? relation.subjectId : relation.objectId;
  const lineageId = side === "subject" ? relation.subjectLineageId : relation.objectLineageId;
  const versionNumber = side === "subject" ? relation.subjectVersionNumber : relation.objectVersionNumber;
  return {
    kind,
    id,
    lineageId,
    versionNumber,
    label: `${kind} ${lineageId}`,
    href: newsDeskHrefForSemanticObject(kind, lineageId),
  };
}

function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}
