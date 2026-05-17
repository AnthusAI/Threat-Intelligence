import { createHash, randomUUID } from "node:crypto";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../data/resource";

type ReviewHandler = Schema["reviewSteeringProposal"]["functionHandler"];
type DataClient = ReturnType<typeof generateClient<Schema>>;
type DataClientErrors = Array<{ message?: string | null } | string | null> | null | undefined;
type DataClientResult<T = unknown> = {
  data?: T | null;
  errors?: DataClientErrors;
};

const CATEGORY_PROPOSAL_KINDS = new Set([
  "new-category",
  "rename-category",
  "merge-category",
  "deprecate-category",
  "seed-change",
  "holdout-change",
  "category-display-copy-edit",
  "category-copy-edit",
  "display-copy-edit",
  "create-category",
  "move-category",
  "archive-category",
]);

let clientPromise: Promise<DataClient> | null = null;

export const handler: ReviewHandler = async (event) => {
  const fieldName = normalizeOptionalString(event.info?.fieldName);
  if (fieldName && fieldName !== "reviewSteeringProposal") {
    throw new Error(`Unsupported steering action ${fieldName}.`);
  }
  return reviewSteeringProposal(event);
};

async function reviewSteeringProposal(event: Parameters<ReviewHandler>[0]) {
  const client = await getDataClient();
  const proposalId = normalizeRequiredString(event.arguments.proposalId, "proposalId");
  const action = normalizeReviewAction(event.arguments.action);
  const proposal = await getRequiredRecord(client.models.SteeringProposal, proposalId, "SteeringProposal");
  const now = new Date().toISOString();
  const actorSub = normalizeOptionalString(event.arguments.actorSub) ?? getIdentitySub(event);
  const actorLabel = normalizeOptionalString(event.arguments.actorLabel) ?? getIdentityLabel(event);
  const selectedCategoryKey = normalizeOptionalString(proposal.categoryKey);
  const decisionId = `decision-${proposalId}-${now.replace(/[^0-9TZ]/g, "")}-${randomUUID().slice(0, 8)}`;

  await requireDataResult(
    client.models.SteeringDecision.create({
      id: decisionId,
      proposalId,
      categorySetId: proposal.categorySetId ?? null,
      action,
      actorSub,
      actorLabel,
      note: normalizeOptionalString(event.arguments.note),
      selectedCategoryKey,
      createdAt: now,
    }),
    "create SteeringDecision",
  );

  const proposalStatus = action === "reject" ? "rejected" : action === "defer" ? "deferred" : "accepted";
  await requireDataResult(
    client.models.SteeringProposal.update({
      id: proposalId,
      status: proposalStatus,
      reviewedAt: now,
      reviewedBy: actorLabel ?? actorSub,
      updatedAt: now,
    }),
    "update SteeringProposal",
  );

  let categoryId: string | null = null;
  if ((action === "accept" || action === "edit") && shouldApplySteeringProposalToCategory(proposal)) {
    categoryId = await createCategoryVersionFromProposal(client, proposal, event.arguments, {
      actorLabel: actorLabel ?? actorSub ?? "Papyrus news desk",
      now,
      reason: `proposal:${proposalId}`,
    });
    await refreshCategorySetCount(client, normalizeRequiredString(proposal.categorySetId, "proposal.categorySetId"));
  }

  return {
    ok: true,
    action,
    proposalId,
    categorySetId: proposal.categorySetId ?? null,
    categoryId,
    decisionId,
    status: proposalStatus,
  };
}

function shouldApplySteeringProposalToCategory(proposal: any): boolean {
  const proposalKind = normalizeOptionalString(proposal.proposalKind);
  return Boolean(
    proposal.categorySetId
      && proposal.categoryKey
      && proposalKind
      && CATEGORY_PROPOSAL_KINDS.has(proposalKind),
  );
}

async function createCategoryVersionFromProposal(
  client: DataClient,
  proposal: any,
  args: Parameters<ReviewHandler>[0]["arguments"],
  options: { actorLabel: string; now: string; reason: string },
): Promise<string> {
  const categorySetId = normalizeRequiredString(proposal.categorySetId, "proposal.categorySetId");
  const categoryKey = normalizeRequiredString(proposal.categoryKey, "proposal.categoryKey");
  const proposalKind = normalizeOptionalString(proposal.proposalKind);
  const current = await findCurrentCategory(client, categorySetId, categoryKey);
  const lineageId = current?.lineageId ?? `category-${safeId(categorySetId)}-${safeId(categoryKey)}`;
  const versionNumber = Number(current?.versionNumber ?? 0) + 1;
  const categoryId = `${lineageId}-v${versionNumber}`;
  const nextStatus = proposalKind === "archive-category" || proposalKind === "deprecate-category" ? "archived" : "accepted";
  const nextParentCategoryKey = proposalKind === "move-category" || proposalKind === "create-category"
    ? normalizeOptionalString(proposal.targetCategoryKey)
    : current?.parentCategoryKey ?? normalizeOptionalString(proposal.targetCategoryKey);
  const depth = await categoryDepthForParent(client, categorySetId, nextParentCategoryKey);
  const input = {
    id: categoryId,
    lineageId,
    versionNumber,
    previousVersionId: current?.id ?? null,
    versionState: "current",
    versionCreatedAt: options.now,
    versionCreatedBy: options.actorLabel,
    changeReason: options.reason,
    contentHash: "",
    categorySetId,
    corpusId: proposal.corpusId,
    categoryKey,
    parentCategoryId: null,
    parentCategoryKey: nextParentCategoryKey,
    displayName: normalizeOptionalString(args.displayName) ?? proposal.displayName ?? current?.displayName ?? proposal.title,
    shortTitle: normalizeOptionalString(args.shortTitle) ?? proposal.shortTitle ?? current?.shortTitle ?? deriveShortTitle(proposal.displayName ?? current?.displayName ?? proposal.title),
    subtitle: normalizeOptionalString(args.subtitle) ?? proposal.subtitle ?? current?.subtitle ?? null,
    description: normalizeOptionalString(args.description) ?? proposal.description ?? proposal.summary ?? current?.description ?? null,
    aliases: normalizeStringArray(args.aliases) ?? current?.aliases ?? [],
    status: nextStatus,
    seedItemIds: normalizeStringArray(args.seedItemIds) ?? compactStringArray(proposal.suggestedSeedItemIds) ?? current?.seedItemIds ?? [],
    holdoutItemIds: normalizeStringArray(args.holdoutItemIds) ?? compactStringArray(proposal.suggestedHoldoutItemIds) ?? current?.holdoutItemIds ?? [],
    rank: current?.rank ?? null,
    depth,
    isPinned: current?.isPinned ?? false,
    importRunId: proposal.importRunId ?? current?.importRunId ?? null,
    updatedAt: options.now,
  };
  const contentHash = hashStable({ ...input, contentHash: undefined });

  if (current?.id) {
    await requireDataResult(
      client.models.Category.update({ id: current.id, versionState: "superseded", updatedAt: options.now }),
      "supersede Category",
    );
  }
  await requireDataResult(client.models.Category.create({ ...input, contentHash }), "create Category version");
  return categoryId;
}

async function findCurrentCategory(client: DataClient, categorySetId: string, categoryKey: string): Promise<any | null> {
  const records = await listCategoriesForSet(client, categorySetId);
  return records
    .filter((category) => category.categoryKey === categoryKey && category.versionState === "current")
    .sort((left, right) => Number(right.versionNumber ?? 0) - Number(left.versionNumber ?? 0))[0]
    ?? records
      .filter((category) => category.categoryKey === categoryKey)
      .sort((left, right) => Number(right.versionNumber ?? 0) - Number(left.versionNumber ?? 0))[0]
    ?? null;
}

async function listCategoriesForSet(client: DataClient, categorySetId: string): Promise<any[]> {
  const model = client.models.Category as any;
  let nextToken: string | null | undefined;
  const records: any[] = [];
  do {
    const page = await model.listCategoriesBySetAndKey(
      { categorySetId },
      { limit: 100, nextToken },
    );
    assertNoDataErrors(page.errors, "list Category");
    records.push(...(page.data ?? []));
    nextToken = page.nextToken;
  } while (nextToken);
  return records;
}

async function categoryDepthForParent(client: DataClient, categorySetId: string, parentCategoryKey: string | null): Promise<number> {
  if (!parentCategoryKey) return 0;
  const parent = await findCurrentCategory(client, categorySetId, parentCategoryKey);
  return (typeof parent?.depth === "number" ? parent.depth : 0) + 1;
}

async function refreshCategorySetCount(client: DataClient, categorySetId: string): Promise<void> {
  const categories = await listCategoriesForSet(client, categorySetId);
  const categoryCount = categories.filter((category) => category.versionState === "current" && category.status !== "archived").length;
  await requireDataResult(
    client.models.CategorySet.update({ id: categorySetId, categoryCount }),
    "update CategorySet count",
  );
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

function normalizeReviewAction(value: unknown): "accept" | "reject" | "defer" | "edit" {
  const action = normalizeRequiredString(value, "action").toLowerCase();
  if (action === "accept" || action === "reject" || action === "defer" || action === "edit") return action;
  throw new Error(`Unsupported proposal action ${action}.`);
}

function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required.`);
  }
  return value.trim();
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return compactStringArray(value);
}

function compactStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => typeof entry === "string" ? entry.trim() : "")
    .filter(Boolean);
}

function deriveShortTitle(value: unknown): string {
  const words = String(value ?? "")
    .replace(/[_/|]+/g, " ")
    .replace(/[^\p{L}\p{N}\s&+-]/gu, "")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  return words.length ? words.slice(0, 3).join(" ") : "Topic";
}

function getIdentitySub(event: Parameters<ReviewHandler>[0]): string | null {
  const identity = event.identity as { sub?: unknown; username?: unknown } | null | undefined;
  return normalizeOptionalString(identity?.sub) ?? normalizeOptionalString(identity?.username);
}

function getIdentityLabel(event: Parameters<ReviewHandler>[0]): string | null {
  const identity = event.identity as { claims?: Record<string, unknown>; username?: unknown } | null | undefined;
  const claims = identity?.claims ?? {};
  return normalizeOptionalString(claims.email)
    ?? normalizeOptionalString(claims.name)
    ?? normalizeOptionalString(identity?.username);
}

function hashStable(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

function safeId(value: unknown): string {
  return String(value ?? "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "unknown";
}
