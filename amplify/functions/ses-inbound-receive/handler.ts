import { randomUUID } from "node:crypto";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  buildEmailSubmissionMessageInput,
  extractDirectCitations,
  extractRecipientsFromRawMime,
  extractRecipientsFromSesMail,
  extractSenderFromRawMime,
  extractSenderFromSesMail,
  looksLikeResearchAssignmentRequest,
  lookupRegisteredUserProfileIdWithGraphql,
  normalizeEmailAddress,
  parseInboundEmailBody,
} from "../shared/email-submission";
import { graphqlWithInboundJwt } from "../shared/inbound-authoring-client";

const PROCESSOR_FUNCTION_NAME = process.env.PAPYRUS_EMAIL_SUBMISSION_PROCESSOR_FUNCTION_NAME ?? "";
const INBOUND_LOCAL_PARTS = parseLocalParts(process.env.PAPYRUS_INBOUND_EMAIL_LOCAL_PARTS ?? "submissions,suggestions");
const INBOUND_DOMAIN = (process.env.PAPYRUS_INBOUND_EMAIL_DOMAIN ?? "p.apyr.us").trim().toLowerCase();

const s3Client = new S3Client({});
const lambdaClient = new LambdaClient({});

type InboundPayload = {
  senderEmail: string;
  recipients: string[];
  subject: string;
  bodyText: string;
  s3Bucket: string | null;
  s3Key: string | null;
  sesMessageId: string | null;
};

export const handler = async (event: Record<string, unknown>) => {
  const inbound = await resolveInboundPayload(event);
  const recipientEmail = inbound.recipients.find((entry) => isConfiguredInboundAddress(entry)) ?? inbound.recipients[0] ?? "";
  if (!isConfiguredInboundAddress(recipientEmail)) {
    throw new Error(`Inbound email recipient ${recipientEmail || "(missing)"} is not configured for this environment.`);
  }

  const now = new Date().toISOString();
  const messageId = `message-email-submission-${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const profileId = await lookupRegisteredUserProfileIdWithGraphql(inbound.senderEmail);
  const authorized = Boolean(profileId);
  const citations = authorized ? extractDirectCitations(inbound.bodyText) : [];

  let status = authorized ? "received" : "rejected";
  let responseStatus = authorized ? "PENDING" : "REJECTED";
  let responseError: string | null = authorized
    ? null
    : "Sender email is not registered to an active Papyrus user.";

  if (authorized && looksLikeResearchAssignmentRequest(inbound.bodyText, citations.length)) {
    status = "rejected";
    responseStatus = "REJECTED";
    responseError = "Submission looks like a research assignment request. Send direct citations (URLs or DOIs), not open-ended research tasks.";
  } else if (authorized && citations.length === 0) {
    status = "rejected";
    responseStatus = "REJECTED";
    responseError = "No direct citations (URL or DOI) were found in the email body.";
  }

  const messageInput = buildEmailSubmissionMessageInput({
    id: messageId,
    now,
    subject: inbound.subject,
    bodyText: inbound.bodyText,
    senderEmail: inbound.senderEmail,
    recipientEmail,
    sesMessageId: inbound.sesMessageId,
    s3Bucket: inbound.s3Bucket,
    s3Key: inbound.s3Key,
    authorized,
    authorUserProfileId: profileId,
    authorLabel: inbound.senderEmail || "unknown-sender",
    citations,
    status,
    responseStatus,
    responseError,
  });

  await graphqlWithInboundJwt(
    `mutation CreateInboundEmailMessage($input: CreateMessageInput!) {
      createMessage(input: $input) {
        id
      }
    }`,
    { input: messageInput },
  );

  if (authorized && responseStatus === "PENDING" && PROCESSOR_FUNCTION_NAME) {
    await lambdaClient.send(new InvokeCommand({
      FunctionName: PROCESSOR_FUNCTION_NAME,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify({
        messageId,
        corpusKey: process.env.PAPYRUS_INBOUND_EMAIL_CORPUS_KEY ?? "AI-ML-research",
      })),
    }));
  }

  return {
    ok: true,
    messageId,
    authorized,
    status,
    responseStatus,
    directCitationCount: citations.length,
    recipientEmail,
    senderEmail: inbound.senderEmail,
  };
};

async function resolveInboundPayload(event: Record<string, unknown>): Promise<InboundPayload> {
  if (event.source === "aws.s3" && event.detail && typeof event.detail === "object") {
    return resolveFromS3ObjectCreated(event.detail as Record<string, unknown>);
  }

  const record = Array.isArray(event.Records) ? event.Records[0] : null;
  if (record && typeof record === "object") {
    const s3Record = record as { s3?: { bucket?: { name?: string }; object?: { key?: string } }; ses?: { mail?: Record<string, unknown>; receipt?: Record<string, unknown> } };
    if (s3Record.s3) {
      const bucket = normalizeOptionalString(s3Record.s3.bucket?.name);
      const key = normalizeOptionalString(s3Record.s3.object?.key);
      if (bucket && key) {
        return loadInboundFromS3Object(bucket, key, null);
      }
    }

    const mail = s3Record.ses?.mail;
    if (mail && typeof mail === "object") {
      return resolveFromSesMail(mail, s3Record.ses?.receipt);
    }
  }

  throw new Error("Unsupported inbound email event payload.");
}

async function resolveFromS3ObjectCreated(detail: Record<string, unknown>): Promise<InboundPayload> {
  const bucketInfo = detail.bucket && typeof detail.bucket === "object" ? detail.bucket as Record<string, unknown> : {};
  const objectInfo = detail.object && typeof detail.object === "object" ? detail.object as Record<string, unknown> : {};
  const bucket = normalizeOptionalString(bucketInfo.name);
  const key = normalizeOptionalString(objectInfo.key);
  if (!bucket || !key) throw new Error("S3 Object Created event did not include bucket and object key.");
  return loadInboundFromS3Object(bucket, key, sesMessageIdFromObjectKey(key));
}

async function resolveFromSesMail(
  mail: Record<string, unknown>,
  receipt: Record<string, unknown> | undefined,
): Promise<InboundPayload> {
  const senderEmail = extractSenderFromSesMail(mail);
  const recipients = extractRecipientsFromSesMail(mail);
  const receiptData = receipt && typeof receipt === "object" ? receipt : {};
  const action = receiptData.action && typeof receiptData.action === "object" ? receiptData.action as Record<string, unknown> : {};
  const s3Bucket = normalizeOptionalString(action.bucketName);
  const s3Key = normalizeOptionalString(action.objectKey);
  const sesMessageId = normalizeOptionalString(mail.messageId);

  const headers = mail.commonHeaders && typeof mail.commonHeaders === "object"
    ? (mail.commonHeaders as Record<string, unknown>)
    : {};
  const subject = normalizeOptionalString(
    Array.isArray(headers.subject) ? headers.subject[0] : headers.subject,
  ) ?? "(no subject)";

  if (s3Bucket && s3Key) {
    const loaded = await loadInboundFromS3Object(s3Bucket, s3Key, sesMessageId);
    return {
      ...loaded,
      senderEmail: loaded.senderEmail || senderEmail,
      recipients: loaded.recipients.length > 0 ? loaded.recipients : recipients,
      subject: loaded.subject !== "(no subject)" ? loaded.subject : subject,
    };
  }

  return {
    senderEmail,
    recipients,
    subject,
    bodyText: "",
    s3Bucket,
    s3Key,
    sesMessageId,
  };
}

async function loadInboundFromS3Object(
  bucket: string,
  key: string,
  sesMessageId: string | null,
): Promise<InboundPayload> {
  const rawObject = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const rawBytes = await streamToBuffer(rawObject.Body);
  const parsed = parseInboundEmailBody(rawBytes);
  return {
    senderEmail: extractSenderFromRawMime(rawBytes),
    recipients: extractRecipientsFromRawMime(rawBytes),
    subject: parsed.subject || "(no subject)",
    bodyText: parsed.text,
    s3Bucket: bucket,
    s3Key: key,
    sesMessageId,
  };
}

function sesMessageIdFromObjectKey(key: string): string | null {
  const basename = key.split("/").pop() ?? "";
  const match = basename.match(/^[A-Za-z0-9_-]+$/);
  return match ? basename : null;
}

function isConfiguredInboundAddress(address: string): boolean {
  const normalized = normalizeEmailAddress(address);
  if (!normalized.includes("@")) return false;
  const [localPart, domain] = normalized.split("@", 2);
  return domain === INBOUND_DOMAIN && INBOUND_LOCAL_PARTS.includes(localPart);
}

function parseLocalParts(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

async function streamToBuffer(body: unknown): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  if (body instanceof Uint8Array) return body;
  if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === "function") {
    return (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}
