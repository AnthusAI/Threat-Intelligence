import { randomUUID } from "node:crypto";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../data/resource";
import {
  buildEmailSubmissionMessageInput,
  extractDirectCitations,
  extractRecipientsFromSesMail,
  extractSenderFromSesMail,
  looksLikeResearchAssignmentRequest,
  lookupRegisteredUserProfileId,
  normalizeEmailAddress,
  parseInboundEmailBody,
} from "../shared/email-submission";

type DataClient = ReturnType<typeof generateClient<Schema>>;
type DataClientErrors = Array<{ message?: string | null } | string | null> | null | undefined;
type DataClientResult<T = unknown> = {
  data?: T | null;
  errors?: DataClientErrors;
};

const LAMBDA_DATA_AUTH_MODE = "iam";
const PROCESSOR_FUNCTION_NAME = process.env.PAPYRUS_EMAIL_SUBMISSION_PROCESSOR_FUNCTION_NAME ?? "";
const INBOUND_LOCAL_PARTS = parseLocalParts(process.env.PAPYRUS_INBOUND_EMAIL_LOCAL_PARTS ?? "submissions,suggestions");
const INBOUND_DOMAIN = (process.env.PAPYRUS_INBOUND_EMAIL_DOMAIN ?? "p.apyr.us").trim().toLowerCase();

let clientPromise: Promise<DataClient> | null = null;
const s3Client = new S3Client({});
const lambdaClient = new LambdaClient({});

export const handler = async (event: Record<string, unknown>) => {
  const record = Array.isArray(event.Records) ? event.Records[0] : null;
  const ses = record && typeof record === "object" ? (record as { ses?: Record<string, unknown> }).ses : null;
  const mail = ses && typeof ses.mail === "object" ? (ses.mail as Record<string, unknown>) : null;
  if (!mail) throw new Error("SES event did not include mail metadata.");

  const senderEmail = extractSenderFromSesMail(mail);
  const recipients = extractRecipientsFromSesMail(mail);
  const recipientEmail = recipients.find((entry) => isConfiguredInboundAddress(entry)) ?? recipients[0] ?? "";
  if (!isConfiguredInboundAddress(recipientEmail)) {
    throw new Error(`Inbound email recipient ${recipientEmail || "(missing)"} is not configured for this environment.`);
  }

  const receipt = ses && typeof ses.receipt === "object" ? (ses.receipt as Record<string, unknown>) : {};
  const action = receipt.action && typeof receipt.action === "object" ? (receipt.action as Record<string, unknown>) : {};
  const s3Bucket = normalizeOptionalString(action.bucketName);
  const s3Key = normalizeOptionalString(action.objectKey);
  const sesMessageId = normalizeOptionalString(mail.messageId);

  const headers = mail.commonHeaders && typeof mail.commonHeaders === "object"
    ? (mail.commonHeaders as Record<string, unknown>)
    : {};
  const subject = normalizeOptionalString(
    Array.isArray(headers.subject) ? headers.subject[0] : headers.subject,
  ) ?? "(no subject)";

  let bodyText = "";
  if (s3Bucket && s3Key) {
    const rawObject = await s3Client.send(new GetObjectCommand({ Bucket: s3Bucket, Key: s3Key }));
    const rawBytes = await streamToBuffer(rawObject.Body);
    bodyText = parseInboundEmailBody(rawBytes).text;
  }

  const client = await getDataClient();
  const now = new Date().toISOString();
  const messageId = `message-email-submission-${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const profileId = await lookupRegisteredUserProfileId(client, senderEmail);
  const authorized = Boolean(profileId);
  const citations = authorized ? extractDirectCitations(bodyText) : [];

  let status = authorized ? "received" : "rejected";
  let responseStatus = authorized ? "PENDING" : "REJECTED";
  let responseError: string | null = authorized
    ? null
    : "Sender email is not registered to an active Papyrus user.";

  if (authorized && looksLikeResearchAssignmentRequest(bodyText, citations.length)) {
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
    subject,
    bodyText,
    senderEmail,
    recipientEmail,
    sesMessageId,
    s3Bucket,
    s3Key,
    authorized,
    authorUserProfileId: profileId,
    authorLabel: senderEmail || "unknown-sender",
    citations,
    status,
    responseStatus,
    responseError,
  });

  const createResponse = await client.models.Message.create(messageInput as never, { authMode: LAMBDA_DATA_AUTH_MODE });
  assertNoDataErrors(createResponse.errors, "create inbound email Message");

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
    senderEmail,
  };
};

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

async function getDataClient(): Promise<DataClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig({
        AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
        AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
        AWS_SESSION_TOKEN: process.env.AWS_SESSION_TOKEN,
        AWS_REGION: process.env.AWS_REGION,
        AMPLIFY_DATA_DEFAULT_NAME: process.env.AMPLIFY_DATA_DEFAULT_NAME,
      } as NodeJS.ProcessEnv);
      Amplify.configure(resourceConfig, libraryOptions);
      return generateClient<Schema>();
    })();
  }
  return clientPromise;
}

function assertNoDataErrors(errors: DataClientErrors, context: string): void {
  if (!errors || errors.length === 0) return;
  const messages = errors.map((entry) => {
    if (!entry) return "unknown GraphQL error";
    if (typeof entry === "string") return entry;
    return entry.message ?? "unknown GraphQL error";
  });
  throw new Error(`${context}: ${messages.join("; ")}`);
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
