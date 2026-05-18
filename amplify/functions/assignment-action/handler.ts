import { randomUUID } from "node:crypto";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../data/resource";

type AssignmentHandler =
  | Schema["claimAssignment"]["functionHandler"]
  | Schema["releaseAssignment"]["functionHandler"]
  | Schema["completeAssignment"]["functionHandler"]
  | Schema["cancelAssignment"]["functionHandler"]
  | Schema["reopenAssignment"]["functionHandler"]
  | Schema["getAssignmentContext"]["functionHandler"]
  | Schema["listAssignmentQueue"]["functionHandler"]
  | Schema["listAssignmentsForObject"]["functionHandler"];
type DataClient = ReturnType<typeof generateClient<Schema>>;
type DataClientErrors = Array<{ message?: string | null } | string | null> | null | undefined;
type DataClientResult<T = unknown> = {
  data?: T | null;
  errors?: DataClientErrors;
  nextToken?: string | null;
};

const FINAL_STATUSES = new Set(["completed", "canceled"]);
const PUBLICATION_DOCTRINE_DEFINITIONS = [
  { scope: "publication", kind: "mission", label: "Editorial Mission", slug: "editorial-doctrine-mission" },
  { scope: "publication", kind: "policy", label: "Editorial Policy", slug: "editorial-doctrine-policy" },
] as const;
let clientPromise: Promise<DataClient> | null = null;

export const handler = async (event: any): Promise<any> => {
  const fieldName = normalizeRequiredString(event.info?.fieldName ?? event.fieldName, "fieldName");
  if (fieldName === "getAssignmentContext") return getAssignmentContext(event as Parameters<Schema["getAssignmentContext"]["functionHandler"]>[0]);
  if (fieldName === "listAssignmentQueue") return listAssignmentQueue(event as Parameters<Schema["listAssignmentQueue"]["functionHandler"]>[0]);
  if (fieldName === "listAssignmentsForObject") return listAssignmentsForObject(event as Parameters<Schema["listAssignmentsForObject"]["functionHandler"]>[0]);
  return mutateAssignment(event as Parameters<Schema["claimAssignment"]["functionHandler"]>[0], fieldName);
};

async function mutateAssignment(event: Parameters<Schema["claimAssignment"]["functionHandler"]>[0], fieldName: string) {
  const client = await getDataClient();
  const assignmentId = normalizeRequiredString(event.arguments.assignmentId, "assignmentId");
  const assignment = await getRequiredRecord(client.models.Assignment, assignmentId, "Assignment");
  const action = assignmentActionFromField(fieldName);
  const now = new Date().toISOString();
  const actorSub = normalizeOptionalString(event.arguments.actorSub) ?? getIdentitySub(event);
  const actorLabel = normalizeOptionalString(event.arguments.actorLabel) ?? getIdentityLabel(event);
  const next = nextAssignmentUpdate(assignment, action, event.arguments, now);
  await requireDataResult(client.models.Assignment.update({ id: assignmentId, ...next }), `update Assignment ${assignmentId}`);
  const eventId = `assignment-event-${assignmentId}-${now.replace(/[^0-9TZ]/g, "")}-${randomUUID().slice(0, 8)}`;
  await requireDataResult(
    client.models.AssignmentEvent.create({
      id: eventId,
      assignmentId,
      assignmentTypeKey: assignment.assignmentTypeKey,
      queueKey: assignment.queueKey,
      eventType: action,
      fromStatus: assignment.status,
      toStatus: next.status ?? assignment.status,
      actorSub,
      actorLabel,
      note: normalizeOptionalString(event.arguments.note),
      createdAt: now,
      metadata: JSON.stringify({ fieldName }),
    }),
    `create AssignmentEvent ${eventId}`,
  );
  return {
    ok: true,
    assignmentId,
    eventId,
    status: next.status ?? assignment.status,
    action,
  };
}

async function getAssignmentContext(event: Parameters<Schema["getAssignmentContext"]["functionHandler"]>[0]) {
  const client = await getDataClient();
  const assignmentId = normalizeRequiredString(event.arguments.assignmentId, "assignmentId");
  const assignment = await getRequiredRecord(client.models.Assignment, assignmentId, "Assignment");
  return buildAssignmentContext(client, assignment);
}

async function listAssignmentQueue(event: Parameters<Schema["listAssignmentQueue"]["functionHandler"]>[0]) {
  const client = await getDataClient();
  const queueKey = normalizeRequiredString(event.arguments.queueKey, "queueKey");
  const status = normalizeOptionalString(event.arguments.status) ?? "open";
  const queueStatusKey = `${queueKey}#${status}`;
  const model = client.models.Assignment as any;
  const assignments: any[] = [];
  let nextToken: string | null | undefined;
  do {
    const response: DataClientResult<any[]> = await model.listAssignmentsByQueueStatusAndPriority(
      { queueStatusKey },
      { limit: 100, nextToken },
    );
    assertNoDataErrors(response.errors, "list Assignment queue");
    assignments.push(...(response.data ?? []));
    nextToken = response.nextToken;
  } while (nextToken);
  assignments.sort((left, right) => assignmentSortKey(left).localeCompare(assignmentSortKey(right)));
  const limit = Math.max(1, Math.min(100, Number(event.arguments.limit ?? 25)));
  const contexts = [];
  for (const assignment of assignments.slice(0, limit)) contexts.push(await buildAssignmentContext(client, assignment));
  return contexts;
}

async function listAssignmentsForObject(event: Parameters<Schema["listAssignmentsForObject"]["functionHandler"]>[0]) {
  const client = await getDataClient();
  const objectKind = normalizeRequiredString(event.arguments.objectKind, "objectKind");
  const objectLineageId = normalizeRequiredString(event.arguments.objectLineageId, "objectLineageId");
  const status = normalizeOptionalString(event.arguments.status);
  const objectStateKey = semanticStateKey(objectKind, objectLineageId);
  const relations = await listRelationPages(client, "listSemanticRelationsByObjectState", { objectStateKey });
  const assignmentIds = Array.from(new Set(relations
    .filter((relation) => relation.relationState === "current" && relation.subjectKind === "assignment")
    .map((relation) => relation.subjectId)
    .filter(Boolean)));
  const assignments = [];
  for (const assignmentId of assignmentIds) {
    const response = await client.models.Assignment.get({ id: assignmentId });
    assertNoDataErrors(response.errors, `get Assignment ${assignmentId}`);
    if (response.data && (!status || response.data.status === status)) assignments.push(response.data);
  }
  assignments.sort((left, right) => assignmentSortKey(left).localeCompare(assignmentSortKey(right)));
  const limit = Math.max(1, Math.min(100, Number(event.arguments.limit ?? 25)));
  const contexts = [];
  for (const assignment of assignments.slice(0, limit)) contexts.push(await buildAssignmentContext(client, assignment));
  return contexts;
}

async function buildAssignmentContext(client: DataClient, assignment: any) {
  const [relations, events] = await Promise.all([
    listRelationPages(client, "listSemanticRelationsBySubjectState", { subjectStateKey: semanticStateKey("assignment", assignment.id) }),
    listAssignmentEventPages(client, assignment.id),
  ]);
  const targets = relations
    .filter((relation) => relation.relationState === "current")
    .map((relation) => ({
      kind: relation.objectKind,
      id: relation.objectId,
      lineageId: relation.objectLineageId,
      label: targetLabelFromRelation(relation),
      detail: relation.predicate,
    }));
  const rootDeskCategory = await resolveRootDeskCategory(client, assignment, relations);
  const doctrine = await buildAssignmentDoctrineContext(client, rootDeskCategory);
  return {
    assignment,
    doctrine,
    targets,
    events,
  };
}

async function buildAssignmentDoctrineContext(client: DataClient, rootDeskCategory: any | null): Promise<any[]> {
  const definitions = [
    ...PUBLICATION_DOCTRINE_DEFINITIONS,
    ...(rootDeskCategory ? [
      {
        scope: "desk",
        kind: "mission",
        label: "Desk Mission",
        slug: deskDoctrineSlug(rootDeskCategory.categoryKey, "mission"),
        categoryKey: rootDeskCategory.categoryKey,
        categoryLineageId: rootDeskCategory.lineageId ?? rootDeskCategory.id,
      },
      {
        scope: "desk",
        kind: "policy",
        label: "Desk Policies",
        slug: deskDoctrineSlug(rootDeskCategory.categoryKey, "policy"),
        categoryKey: rootDeskCategory.categoryKey,
        categoryLineageId: rootDeskCategory.lineageId ?? rootDeskCategory.id,
      },
    ] : []),
  ];

  const context = [];
  for (const definition of definitions) {
    const record = await getDoctrineRecordBySlug(client, definition.slug);
    if (!record) continue;
    context.push({
      scope: definition.scope,
      kind: definition.kind,
      label: definition.label,
      slug: definition.slug,
      body: compactStringArray(record.body),
      categoryKey: "categoryKey" in definition ? definition.categoryKey : null,
      categoryLineageId: "categoryLineageId" in definition ? definition.categoryLineageId : null,
    });
  }
  return context;
}

async function resolveRootDeskCategory(client: DataClient, assignment: any, relations: any[]): Promise<any | null> {
  const categoryLineageId = assignmentCategoryLineageIdFromRelations(relations);
  if (categoryLineageId) {
    const category = await getCurrentCategoryByLineage(client, categoryLineageId);
    return category ? resolveRootCategory(client, category) : null;
  }

  const categoryKey = assignmentCategoryKeyFromMetadata(assignment.metadata);
  if (categoryKey && assignment.categorySetId) {
    const category = await getCurrentCategoryBySetAndKey(client, assignment.categorySetId, categoryKey);
    return category ? resolveRootCategory(client, category) : null;
  }

  return null;
}

function assignmentCategoryLineageIdFromRelations(relations: any[]): string | null {
  const direct = relations.find((relation) => (
    relation.relationState === "current"
    && relation.objectKind === "category"
    && relation.predicate === "requests_work_on"
  )) ?? relations.find((relation) => (
    relation.relationState === "current"
    && relation.objectKind === "category"
  ));
  return normalizeOptionalString(direct?.objectLineageId);
}

function assignmentCategoryKeyFromMetadata(value: unknown): string | null {
  const metadata = parseJsonObject(value);
  return normalizeOptionalString(metadata?.categoryKey)
    ?? normalizeOptionalString(metadata?.category_key)
    ?? normalizeOptionalString(metadata?.rootCategoryKey)
    ?? normalizeOptionalString(metadata?.root_category_key)
    ?? normalizeOptionalString(metadata?.topicUid)
    ?? normalizeOptionalString(metadata?.topic_uid);
}

async function resolveRootCategory(client: DataClient, category: any): Promise<any | null> {
  let current = category;
  for (let depth = 0; depth < 10; depth += 1) {
    const parentCategoryKey = normalizeOptionalString(current?.parentCategoryKey);
    if (!parentCategoryKey) return current;
    const parent = await getCurrentCategoryBySetAndKey(client, current.categorySetId, parentCategoryKey);
    if (!parent) return current;
    current = parent;
  }
  return current;
}

async function getCurrentCategoryByLineage(client: DataClient, lineageId: string): Promise<any | null> {
  const model = client.models.Category as any;
  const query = model.listCategoriesByLineageAndVersion;
  if (typeof query !== "function") return null;
  const categories: any[] = [];
  let nextToken: string | null | undefined;
  do {
    const response: DataClientResult<any[]> = await query({ lineageId }, { limit: 100, nextToken });
    assertNoDataErrors(response.errors, "list Category lineage");
    categories.push(...(response.data ?? []));
    nextToken = response.nextToken;
  } while (nextToken);
  return selectCurrentVersion(categories);
}

async function getCurrentCategoryBySetAndKey(client: DataClient, categorySetId: string, categoryKey: string): Promise<any | null> {
  const model = client.models.Category as any;
  const query = model.listCategoriesBySetAndKey;
  if (typeof query !== "function") return null;
  const categories: any[] = [];
  let nextToken: string | null | undefined;
  do {
    const response: DataClientResult<any[]> = await query({ categorySetId, categoryKey }, { limit: 100, nextToken });
    assertNoDataErrors(response.errors, "list Category set/key");
    categories.push(...(response.data ?? []));
    nextToken = response.nextToken;
  } while (nextToken);
  return selectCurrentVersion(categories);
}

async function getDoctrineRecordBySlug(client: DataClient, slug: string): Promise<any | null> {
  const model = client.models.Item as any;
  const query = model.itemBySlug;
  if (typeof query !== "function") return null;
  const records: any[] = [];
  let nextToken: string | null | undefined;
  do {
    const response: DataClientResult<any[]> = await query({ slug }, { limit: 100, nextToken });
    assertNoDataErrors(response.errors, "query Item by slug");
    records.push(...(response.data ?? []));
    nextToken = response.nextToken;
  } while (nextToken);
  return records.find((record) => record.type === "doctrine" && record.status === "private")
    ?? records.find((record) => record.type === "doctrine")
    ?? null;
}

function selectCurrentVersion(records: any[]): any | null {
  return [...records]
    .filter((record) => record && record.status !== "deprecated")
    .sort((left, right) => {
      const stateDiff = versionStateRank(left.versionState) - versionStateRank(right.versionState);
      if (stateDiff !== 0) return stateDiff;
      return Number(right.versionNumber ?? 0) - Number(left.versionNumber ?? 0);
    })[0] ?? null;
}

function versionStateRank(versionState: unknown): number {
  if (versionState === "current") return 0;
  if (versionState === "draft") return 1;
  if (versionState === "superseded") return 8;
  return 5;
}

function deskDoctrineSlug(categoryKey: string, kind: "mission" | "policy"): string {
  return `desk-doctrine-${safeDoctrineKey(categoryKey)}-${kind}`;
}

function safeDoctrineKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "topic";
}

function compactStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
}

async function listRelationPages(client: DataClient, queryName: string, input: Record<string, unknown>): Promise<any[]> {
  const model = client.models.SemanticRelation as any;
  const query = model[queryName];
  if (typeof query !== "function") throw new Error(`SemanticRelation query ${queryName} is not available.`);
  const records: any[] = [];
  let nextToken: string | null | undefined;
  do {
    const response: DataClientResult<any[]> = await query(input, { limit: 100, nextToken });
    assertNoDataErrors(response.errors, queryName);
    records.push(...(response.data ?? []));
    nextToken = response.nextToken;
  } while (nextToken);
  return records;
}

async function listAssignmentEventPages(client: DataClient, assignmentId: string): Promise<any[]> {
  const model = client.models.AssignmentEvent as any;
  const records: any[] = [];
  let nextToken: string | null | undefined;
  do {
    const response: DataClientResult<any[]> = await model.listAssignmentEventsByAssignmentAndCreatedAt(
      { assignmentId },
      { limit: 100, nextToken },
    );
    assertNoDataErrors(response.errors, "list AssignmentEvent");
    records.push(...(response.data ?? []));
    nextToken = response.nextToken;
  } while (nextToken);
  return records.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function nextAssignmentUpdate(assignment: any, action: string, args: Record<string, unknown>, now: string): Record<string, unknown> {
  if (action === "claim") {
    if (FINAL_STATUSES.has(assignment.status)) throw new Error(`Cannot claim ${assignment.status} assignment ${assignment.id}.`);
    const assigneeType = normalizeOptionalString(args.assigneeType) ?? "user";
    const assigneeId = normalizeOptionalString(args.assigneeId) ?? normalizeOptionalString(args.actorSub) ?? "unknown";
    return {
      status: "claimed",
      queueStatusKey: `${assignment.queueKey}#claimed`,
      assigneeType,
      assigneeId,
      assigneeKey: `${assigneeType}#${assigneeId}`,
      claimedAt: now,
      updatedAt: now,
    };
  }
  if (action === "release") {
    if (FINAL_STATUSES.has(assignment.status)) throw new Error(`Cannot release ${assignment.status} assignment ${assignment.id}.`);
    return {
      status: "open",
      queueStatusKey: `${assignment.queueKey}#open`,
      assigneeType: null,
      assigneeId: null,
      assigneeKey: null,
      claimedAt: null,
      claimExpiresAt: null,
      updatedAt: now,
    };
  }
  if (action === "complete") {
    if (assignment.status === "canceled") throw new Error(`Cannot complete canceled assignment ${assignment.id}.`);
    return {
      status: "completed",
      queueStatusKey: `${assignment.queueKey}#completed`,
      completedAt: now,
      updatedAt: now,
    };
  }
  if (action === "cancel") {
    if (assignment.status === "completed") throw new Error(`Cannot cancel completed assignment ${assignment.id}.`);
    return {
      status: "canceled",
      queueStatusKey: `${assignment.queueKey}#canceled`,
      canceledAt: now,
      updatedAt: now,
    };
  }
  if (action === "reopen") {
    return {
      status: "open",
      queueStatusKey: `${assignment.queueKey}#open`,
      completedAt: null,
      canceledAt: null,
      updatedAt: now,
    };
  }
  throw new Error(`Unsupported assignment action ${action}.`);
}

function assignmentActionFromField(fieldName: string): string {
  if (fieldName === "claimAssignment") return "claim";
  if (fieldName === "releaseAssignment") return "release";
  if (fieldName === "completeAssignment") return "complete";
  if (fieldName === "cancelAssignment") return "cancel";
  if (fieldName === "reopenAssignment") return "reopen";
  throw new Error(`Unsupported assignment action ${fieldName}.`);
}

async function getDataClient(): Promise<DataClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(process.env as never);
      Amplify.configure(resourceConfig, libraryOptions);
      return generateClient<Schema>();
    })();
  }
  return clientPromise;
}

async function getRequiredRecord(
  model: { get(input: { id: string }): Promise<{ data?: unknown | null; errors?: DataClientErrors }> },
  id: string,
  modelName: string,
): Promise<any> {
  const response = await model.get({ id });
  assertNoDataErrors(response.errors, `get ${modelName}`);
  if (!response.data) throw new Error(`${modelName} ${id} was not found.`);
  return response.data;
}

async function requireDataResult<T>(promise: Promise<DataClientResult<T>>, operation: string): Promise<T> {
  const response = await promise;
  assertNoDataErrors(response.errors, operation);
  if (!response.data) throw new Error(`${operation} returned no data.`);
  return response.data;
}

function assertNoDataErrors(errors: DataClientErrors, operation: string): void {
  if (!errors?.length) return;
  throw new Error(`${operation} failed: ${errors.map(formatDataError).join("; ")}`);
}

function formatDataError(error: { message?: string | null } | string | null): string {
  if (typeof error === "string") return error;
  return error?.message ?? "GraphQL data operation failed.";
}

function semanticStateKey(kind: string, lineageId: string): string {
  return `${kind}#${lineageId}#current`;
}

function assignmentSortKey(assignment: any): string {
  return `${String(assignment.priority ?? 999999).padStart(6, "0")}#${assignment.createdAt ?? ""}#${assignment.id}`;
}

function targetLabelFromRelation(relation: any): string {
  const metadata = parseJsonObject(relation.metadata);
  return normalizeOptionalString(metadata?.title)
    ?? normalizeOptionalString(metadata?.displayName)
    ?? normalizeOptionalString(metadata?.externalItemId)
    ?? relation.objectLineageId;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${fieldName} is required.`);
  return value.trim();
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getIdentitySub(event: any): string | null {
  const identity = event.identity as { sub?: string | null; claims?: Record<string, unknown> } | null | undefined;
  return normalizeOptionalString(identity?.sub) ?? normalizeOptionalString(identity?.claims?.sub);
}

function getIdentityLabel(event: any): string | null {
  const identity = event.identity as { username?: string | null; claims?: Record<string, unknown> } | null | undefined;
  return normalizeOptionalString(identity?.claims?.email)
    ?? normalizeOptionalString(identity?.claims?.name)
    ?? normalizeOptionalString(identity?.username)
    ?? getIdentitySub(event);
}
