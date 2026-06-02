import {
  directCitationRationale,
  extractDirectCitations,
  titleFromUrl,
} from "./email-submission";

const HREF_PATTERN = /href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
const SKIP_URL_MARKERS = [
  "unsubscribe",
  "list-unsubscribe",
  "/unsubscribe",
  "mailchi.mp/unsubscribe",
  "/opt-out",
  "preferences",
  "email-preferences",
  "doubleclick.net",
  "facebook.com/sharer",
  "twitter.com/intent",
  "linkedin.com/sharing",
  "fonts.googleapis.com",
];
const SKIP_URL_PREFIXES = ["mailto:", "tel:", "javascript:", "cid:", "#"];

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

export function normalizeHrefUrl(raw: string): string | null {
  let url = decodeHtmlEntities(String(raw ?? "").trim());
  if (!url) return null;
  if (url.startsWith("//")) url = `https:${url}`;
  if (url.startsWith("<") && url.endsWith(">")) url = url.slice(1, -1).trim();
  const lowered = url.toLowerCase();
  if (SKIP_URL_PREFIXES.some((prefix) => lowered.startsWith(prefix))) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  return url.replace(/[.,);]+$/, "");
}

export function isSkippableNewsletterUrl(url: string): boolean {
  const lowered = String(url ?? "").toLowerCase();
  if (SKIP_URL_MARKERS.some((marker) => lowered.includes(marker))) return true;
  if (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(lowered)) return true;
  return false;
}

export function extractHrefUrlsFromHtml(html: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(HREF_PATTERN)) {
    const candidate = normalizeHrefUrl(match[1] ?? match[2] ?? match[3] ?? "");
    if (!candidate || seen.has(candidate) || isSkippableNewsletterUrl(candidate)) continue;
    seen.add(candidate);
    urls.push(candidate);
  }
  return urls;
}

export function extractDirectCitationsFromIntake(input: {
  bodyText: string;
  htmlParts?: string[];
}): Array<{ kind: string; url: string; title: string; ingestion_rationale: string; doi?: string }> {
  const citations = extractDirectCitations(input.bodyText);
  const seen = new Set(citations.map((entry) => entry.url));
  for (const htmlPart of input.htmlParts ?? []) {
    for (const url of extractHrefUrlsFromHtml(htmlPart)) {
      if (seen.has(url)) continue;
      seen.add(url);
      citations.push({
        kind: "url",
        url,
        title: titleFromUrl(url),
        ingestion_rationale: directCitationRationale(url),
      });
    }
  }
  return citations;
}

function decodeQuotedPrintable(value: string): string {
  return value
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function decodePartBody(body: string, transferEncoding: string): string {
  const encoding = transferEncoding.trim().toLowerCase();
  if (encoding === "base64") {
    return Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8");
  }
  if (encoding === "quoted-printable") {
    return decodeQuotedPrintable(body);
  }
  return body;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectMimeBodies(raw: string): { plain: string[]; html: string[]; subject: string } {
  const subjectMatch = raw.match(/^Subject:\s*(.*)$/im);
  const subject = subjectMatch?.[1]?.trim() ?? "";
  const plain: string[] = [];
  const html: string[] = [];
  const partPattern =
    /Content-Type:\s*(text\/(?:plain|html))[^\r\n]*(?:[\r\n]+(?![\r\n])[^\r\n]+)*[\r\n]+(?:Content-Transfer-Encoding:\s*([^\r\n]+)[\r\n]+)?[\r\n]+([\s\S]*?)(?=[\r\n]--[^\r\n]+[\r\n]|$)/gi;
  let match: RegExpExecArray | null = partPattern.exec(raw);
  while (match) {
    const contentType = match[1]?.toLowerCase() ?? "";
    const encoding = match[2] ?? "";
    const body = decodePartBody(match[3] ?? "", encoding);
    if (contentType === "text/plain" && body.trim()) plain.push(body.trim());
    if (contentType === "text/html" && body.trim()) html.push(body.trim());
    match = partPattern.exec(raw);
  }
  return { plain, html, subject };
}

function preprocessRawMimeForLinkScan(raw: string): string {
  return raw
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function extractHrefUrlsFromRawMime(raw: string): string[] {
  const decoded = preprocessRawMimeForLinkScan(raw);
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const match of decoded.matchAll(HREF_PATTERN)) {
    const candidate = normalizeHrefUrl(match[1] ?? match[2] ?? match[3] ?? "");
    if (!candidate || seen.has(candidate) || isSkippableNewsletterUrl(candidate)) continue;
    seen.add(candidate);
    urls.push(candidate);
  }
  return urls;
}

export function parseInboundMimeForIntake(rawBytes: Uint8Array): {
  subject: string;
  bodyText: string;
  htmlParts: string[];
  citations: Array<{ kind: string; url: string; title: string; ingestion_rationale: string; doi?: string }>;
} {
  const raw = Buffer.from(rawBytes).toString("utf8");
  const { plain, html, subject } = collectMimeBodies(raw);
  let bodyText = plain.join("\n\n").trim();
  if (!bodyText && html.length > 0) {
    bodyText = htmlToText(html.join("\n\n"));
  }
  const citations = extractDirectCitationsFromIntake({ bodyText, htmlParts: html });
  if (citations.length === 0) {
    const seen = new Set(citations.map((entry) => entry.url));
    for (const url of extractHrefUrlsFromRawMime(raw)) {
      if (seen.has(url)) continue;
      seen.add(url);
      citations.push({
        kind: "url",
        url,
        title: titleFromUrl(url),
        ingestion_rationale: directCitationRationale(url),
      });
    }
  }
  return {
    subject: subject || "(no subject)",
    bodyText,
    htmlParts: html,
    citations,
  };
}
