import { createHash, randomUUID } from "node:crypto";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../data/resource";

type ReviewHandler = Schema["reviewCurationProposal"]["functionHandler"];
type PromoteHandler = Schema["promoteCurationTopicRevision"]["functionHandler"];
type DataClient = ReturnType<typeof generateClient<Schema>>;
const TOPIC_MUTATION_PROPOSAL_KINDS = new Set([
  "new-topic",
  "rename-topic",
  "merge-topic",
  "deprecate-topic",
  "seed-change",
  "holdout-change",
  "topic-display-copy-edit",
  "topic-copy-edit",
  "display-copy-edit",
]);

let clientPromise: Promise<DataClient> | null = null;

export const handler: ReviewHandler | PromoteHandler = async (event: any) => {
  const operation = event.info.fieldName;
  if (operation === "reviewCurationProposal") return reviewCurationProposal(event);
  if (operation === "promoteCurationTopicRevision") return promoteCurationTopicRevision(event);
  throw new Error(`Unsupported curation action ${operation}.`);
};

async function reviewCurationProposal(event: Parameters<ReviewHandler>[0]) {
  const client = await getDataClient();
  const proposalId = normalizeRequiredString(event.arguments.proposalId, "proposalId");
  const action = normalizeReviewAction(event.arguments.action);
  const proposal = await getRequiredRecord(client.models.CurationProposal, proposalId, "CurationProposal");
  const now = new Date().toISOString();
  const actorSub = normalizeOptionalString(event.arguments.actorSub) ?? getIdentitySub(event);
  const actorLabel = normalizeOptionalString(event.arguments.actorLabel) ?? getIdentityLabel(event);
  const topicUid = normalizeOptionalString(event.arguments.displayName)
    ? normalizeOptionalString(proposal.topicUid)
    : normalizeOptionalString(proposal.topicUid);
  const decisionId = `decision-${proposalId}-${now.replace(/[^0-9TZ]/g, "")}-${randomUUID().slice(0, 8)}`;

  await client.models.CurationDecision.create({
    id: decisionId,
    proposalId,
    topicSetId: proposal.topicSetId ?? null,
    action,
    actorSub,
    actorLabel,
    note: normalizeOptionalString(event.arguments.note),
    selectedTopicUid: topicUid,
    createdAt: now,
  });

  const proposalStatus = action === "reject" ? "rejected" : action === "defer" ? "deferred" : "accepted";
  await client.models.CurationProposal.update({
    id: proposalId,
    status: proposalStatus,
    reviewedAt: now,
    reviewedBy: actorLabel ?? actorSub,
    updatedAt: now,
  });

  let topicId: string | null = null;
  let revisionId: string | null = null;
  if ((action === "accept" || action === "edit") && shouldApplyTopicProposal(proposal)) {
    topicId = await upsertAcceptedTopicFromProposal(client, proposal, event.arguments, now);
    revisionId = await upsertDraftRevision(client, proposal, decisionId, now);
  }

  return {
    ok: true,
    action,
    proposalId,
    topicId,
    revisionId,
    decisionId,
    status: proposalStatus,
  };
}

function shouldApplyTopicProposal(proposal: any): boolean {
  const proposalKind = normalizeOptionalString(proposal.proposalKind);
  return Boolean(
    proposal.topicSetId
      && proposal.topicUid
      && proposalKind
      && TOPIC_MUTATION_PROPOSAL_KINDS.has(proposalKind),
  );
}

async function promoteCurationTopicRevision(event: Parameters<PromoteHandler>[0]) {
  const client = await getDataClient();
  const revisionId = normalizeRequiredString(event.arguments.revisionId, "revisionId");
  const revision = await getRequiredRecord(client.models.CurationTopicRevision, revisionId, "CurationTopicRevision");
  const now = new Date().toISOString();
  const actorSub = normalizeOptionalString(event.arguments.actorSub) ?? getIdentitySub(event);
  const actorLabel = normalizeOptionalString(event.arguments.actorLabel) ?? getIdentityLabel(event);
  const decisionId = `decision-revision-${revisionId}-${now.replace(/[^0-9TZ]/g, "")}-${randomUUID().slice(0, 8)}`;

  await client.models.CurationDecision.create({
    id: decisionId,
    proposalId: `revision:${revisionId}`,
    topicSetId: revision.topicSetId,
    action: "promote-revision",
    actorSub,
    actorLabel,
    note: normalizeOptionalString(event.arguments.note),
    selectedTopicUid: null,
    createdAt: now,
  });

  await client.models.CurationTopicRevision.update({
    id: revisionId,
    status: "accepted",
    acceptedAt: now,
    acceptedBy: actorLabel ?? actorSub,
  });

  await client.models.CurationTopicSet.update({
    id: revision.topicSetId,
    status: "accepted",
    acceptedRevisionId: revisionId,
    latestDraftRevisionId: null,
  });

  return {
    ok: true,
    action: "promote-revision",
    revisionId,
    decisionId,
    status: "accepted",
  };
}

async function upsertAcceptedTopicFromProposal(
  client: DataClient,
  proposal: any,
  args: Parameters<ReviewHandler>[0]["arguments"],
  now: string,
): Promise<string> {
  const topicSetId = normalizeRequiredString(proposal.topicSetId, "proposal.topicSetId");
  const topicUid = normalizeRequiredString(proposal.topicUid, "proposal.topicUid");
  const topicId = `topic-${safeId(topicSetId)}-${safeId(topicUid)}`;
  const current = await client.models.CurationTopic.get({ id: topicId });
  const input = {
    id: topicId,
    topicSetId,
    corpusId: proposal.corpusId,
    topicUid,
    displayName: normalizeOptionalString(args.displayName) ?? proposal.displayName ?? proposal.title,
    subtitle: normalizeOptionalString(args.subtitle) ?? proposal.subtitle ?? null,
    description: normalizeOptionalString(args.description) ?? proposal.description ?? proposal.summary ?? null,
    aliases: normalizeStringArray(args.aliases),
    status: "accepted",
    seedItemIds: normalizeStringArray(args.seedItemIds) ?? compactStringArray(proposal.suggestedSeedItemIds),
    holdoutItemIds: normalizeStringArray(args.holdoutItemIds) ?? compactStringArray(proposal.suggestedHoldoutItemIds),
    rank: current.data?.rank ?? null,
    isPinned: current.data?.isPinned ?? false,
    importRunId: proposal.importRunId ?? null,
    updatedAt: now,
  };

  if (current.data) await client.models.CurationTopic.update(input);
  else await client.models.CurationTopic.create(input);
  return topicId;
}

async function upsertDraftRevision(
  client: DataClient,
  proposal: any,
  decisionId: string,
  now: string,
): Promise<string> {
  const topicSetId = normalizeRequiredString(proposal.topicSetId, "proposal.topicSetId");
  const revisionId = `revision-${safeId(topicSetId)}-draft`;
  const topicCount = await countTopicsForTopicSet(client, topicSetId);
  const contentHash = hashStable({ topicSetId, topicCount, sourceDecisionId: decisionId, updatedAt: now });
  const current = await client.models.CurationTopicRevision.get({ id: revisionId });
  const input = {
    id: revisionId,
    topicSetId,
    corpusId: proposal.corpusId,
    revisionKind: "draft",
    status: "draft",
    contentHash,
    sourceImportRunId: proposal.importRunId ?? null,
    sourceDecisionId: decisionId,
    topicCount,
    createdAt: current.data?.createdAt ?? now,
    acceptedAt: null,
    acceptedBy: null,
  };
  if (current.data) await client.models.CurationTopicRevision.update(input);
  else await client.models.CurationTopicRevision.create(input);
  await client.models.CurationTopicSet.update({
    id: topicSetId,
    latestDraftRevisionId: revisionId,
    topicCount,
  });
  return revisionId;
}

async function countTopicsForTopicSet(client: DataClient, topicSetId: string): Promise<number> {
  let nextToken: string | null | undefined;
  let count = 0;
  do {
    const page = await client.models.CurationTopic.listCurationTopicsByTopicSetAndTopicUid(
      { topicSetId },
      { limit: 100, nextToken },
    );
    count += page.data?.length ?? 0;
    nextToken = page.nextToken;
  } while (nextToken);
  return count;
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
  model: { get(input: { id: string }): Promise<{ data?: unknown | null }> },
  id: string,
  modelName: string,
): Promise<any> {
  const response = await model.get({ id });
  if (!response.data) throw new Error(`${modelName} ${id} was not found.`);
  return response.data;
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
  return value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || hashStable(value).slice(0, 12);
}

function hashStable(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function getIdentitySub(event: unknown): string | null {
  const identity = (event as { identity?: { sub?: unknown; username?: unknown } }).identity;
  return normalizeOptionalString(identity?.sub) ?? normalizeOptionalString(identity?.username);
}

function getIdentityLabel(event: unknown): string | null {
  const identity = (event as { identity?: { claims?: Record<string, unknown>; username?: unknown } }).identity;
  return (
    normalizeOptionalString(identity?.claims?.email) ??
    normalizeOptionalString(identity?.claims?.["cognito:username"]) ??
    normalizeOptionalString(identity?.username)
  );
}
