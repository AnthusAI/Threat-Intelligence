import { createHmac, timingSafeEqual } from "node:crypto";

const URL_PATTERN = /https?:\/\/\S+/gi;

export function slackSigningSecret(): string {
  return (process.env.PAPYRUS_SLACK_SIGNING_SECRET ?? process.env.SLACK_SIGNING_SECRET ?? "").trim();
}

export function allowedSlackUserIds(): Set<string> {
  const raw = (process.env.PAPYRUS_SLACK_ALLOWED_USER_IDS ?? "").trim();
  if (!raw) return new Set();
  return new Set(raw.split(",").map((entry) => entry.trim()).filter(Boolean));
}

export function verifySlackRequestSignature(input: {
  signingSecret: string;
  timestamp: string;
  rawBody: Buffer;
  signature: string;
  maxAgeSeconds?: number;
}): boolean {
  const secret = input.signingSecret.trim();
  const timestamp = input.timestamp.trim();
  const signature = input.signature.trim();
  if (!secret || !timestamp || !signature) return false;
  const requestTs = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(requestTs)) return false;
  const maxAge = input.maxAgeSeconds ?? 60 * 5;
  if (Math.abs(Math.floor(Date.now() / 1000) - requestTs) > maxAge) return false;
  const base = `v0:${timestamp}:${input.rawBody.toString("utf8")}`;
  const digest = createHmac("sha256", secret).update(base).digest("hex");
  const expected = `v0=${digest}`;
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, signatureBuffer);
}

export function slackThreadId(teamId: string, channelId: string, threadTs: string): string {
  const team = (teamId || "unknown").trim() || "unknown";
  const channel = channelId.trim();
  const root = threadTs.trim().replace(/\./g, "-");
  return `thread-slack-${team}-${channel}-${root}`;
}

export function chatMessageIdForSlackEvent(eventId: string): string {
  const token = eventId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 40) || "unknown";
  return `message-console-slack-${token}`;
}

export function shouldIgnoreSlackEvent(event: Record<string, unknown>): string | null {
  if (event.bot_id || event.subtype === "bot_message" || event.subtype === "message_changed" || event.subtype === "message_deleted") {
    return "bot-or-non-user-message";
  }
  const user = String(event.user ?? "").trim();
  if (!user) return "missing-user";
  const allowed = allowedSlackUserIds();
  if (allowed.size > 0 && !allowed.has(user)) return "unauthorized-user";
  const text = String(event.text ?? "").trim();
  if (!text && !Array.isArray(event.files)) return "empty-message";
  return null;
}

function slackAgentInstructions(): string {
  return [
    "You are handling authorized inbound Slack messages for Papyrus reference intake.",
    "Use execute_tactus with the papyrus.* tool surface.",
    "",
    "Goals:",
    "1. Register scholarly references for each relevant URL/DOI the submitter cited (skip unsubscribe/footer/nav links).",
    "2. When prose discusses a specific reference, create an insight Message via papyrus.reference.insight_create.",
    "3. When the submitter asks a question or gives a command (knowledge search, list recent references, curation review), use the appropriate tools.",
    "4. Keep Slack replies concise; use bullet lists when listing references.",
  ].join("\n");
}

export function buildSlackPrompt(input: {
  event: Record<string, unknown>;
  teamId: string | null;
  channelId: string;
  threadTs: string;
}): string {
  const user = String(input.event.user ?? "slack-user").trim();
  const text = String(input.event.text ?? "").trim();
  const urls = text.match(URL_PATTERN) ?? [];
  const lines = [
    slackAgentInstructions(),
    "",
    `Slack team id: ${input.teamId ?? "(unknown)"}`,
    `Slack channel id: ${input.channelId}`,
    `Slack thread ts: ${input.threadTs}`,
    `Slack user id: ${user}`,
    "",
    "User message:",
    text || "(no text; see files metadata if present)",
  ];
  if (Array.isArray(input.event.files) && input.event.files.length > 0) {
    lines.push("", "Slack files JSON:", JSON.stringify(input.event.files, null, 2));
  }
  if (urls.length > 0) {
    lines.push("", `Detected URL count: ${urls.length}`, "URLs:", ...urls.map((url) => `- ${url}`));
  }
  return lines.join("\n").trim();
}
