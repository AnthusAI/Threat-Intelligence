import { createHash } from "node:crypto";

export const INBOUND_EMAIL_INTAKE_PREFIX = "inbound-email/";
export const INBOUND_EMAIL_ARCHIVE_PREFIX = "inbound-email-archived/";

export function shouldProcessInboundS3Key(key: string | null | undefined): boolean {
  const normalized = (key ?? "").trim();
  if (!normalized.startsWith(INBOUND_EMAIL_INTAKE_PREFIX)) return false;
  if (normalized.startsWith(INBOUND_EMAIL_ARCHIVE_PREFIX)) return false;
  const basename = normalized.split("/").pop() ?? "";
  if (!basename || basename === "AMAZON_SES_SETUP_NOTIFICATION") return false;
  const remainder = normalized.slice(INBOUND_EMAIL_INTAKE_PREFIX.length);
  if (remainder.includes("/")) return false;
  return true;
}

export function inboundMessageIdFromS3(bucket: string, key: string): string {
  const digest = createHash("sha256").update(`${bucket}/${key}`, "utf8").digest("hex").slice(0, 20);
  return `message-email-submission-${digest}`;
}

export function parseMessageMetadata(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}
