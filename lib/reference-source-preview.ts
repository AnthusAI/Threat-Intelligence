import type { ReferenceAttachmentRecord } from "./category-repository";

export type ReferenceSourcePreview =
  | {
      kind: "youtube";
      videoId: string;
      embedUrl: string;
      thumbnailUrl: string;
      watchUrl: string;
    }
  | {
      kind: "pdf";
      href: string;
      label: string;
    }
  | {
      kind: "html";
      href: string;
      label: string;
    };

export function youtubeVideoIdFromUri(sourceUri: string): string | null {
  try {
    const parsed = new URL(sourceUri);
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be") {
      const token = parsed.pathname.replace(/^\/+/, "").split("/")[0] ?? "";
      return token || null;
    }
    if (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com") {
      const fromQuery = parsed.searchParams.get("v");
      if (fromQuery) return fromQuery;
      if (parsed.pathname.startsWith("/shorts/")) {
        return parsed.pathname.slice("/shorts/".length).split("/")[0] || null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function isPdfAttachment(attachment: ReferenceAttachmentRecord): boolean {
  const mediaType = (attachment.mediaType ?? "").toLowerCase();
  if (mediaType.includes("pdf")) return true;
  const path = `${attachment.storagePath ?? ""} ${attachment.sourceUri ?? ""} ${attachment.filename ?? ""}`.toLowerCase();
  return path.includes(".pdf");
}

function isHtmlAttachment(attachment: ReferenceAttachmentRecord): boolean {
  const mediaType = (attachment.mediaType ?? "").toLowerCase();
  if (mediaType.includes("html")) return true;
  const path = `${attachment.storagePath ?? ""} ${attachment.sourceUri ?? ""} ${attachment.filename ?? ""}`.toLowerCase();
  return path.endsWith(".html") || path.endsWith(".htm");
}

function pdfPreviewFromUri(sourceUri: string | null | undefined): ReferenceSourcePreview | null {
  if (!sourceUri) return null;
  const lower = sourceUri.toLowerCase();
  if (!lower.includes(".pdf") && !lower.includes("/pdf")) return null;
  return { kind: "pdf", href: sourceUri, label: "Open PDF source" };
}

function htmlPreviewFromUri(sourceUri: string | null | undefined): ReferenceSourcePreview | null {
  if (!sourceUri) return null;
  try {
    const parsed = new URL(sourceUri);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (youtubeVideoIdFromUri(sourceUri)) return null;
    const lowerPath = parsed.pathname.toLowerCase();
    if (lowerPath.endsWith(".pdf")) return null;
    return { kind: "html", href: sourceUri, label: "Open web source" };
  } catch {
    return null;
  }
}

export function resolveReferenceSourcePreview(
  sourceUri: string | null | undefined,
  attachments: ReferenceAttachmentRecord[] = [],
): ReferenceSourcePreview | null {
  const videoId = sourceUri ? youtubeVideoIdFromUri(sourceUri) : null;
  if (videoId) {
    const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    return {
      kind: "youtube",
      videoId,
      embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`,
      watchUrl,
    };
  }

  const pdfAttachment = attachments.find((attachment) => isPdfAttachment(attachment));
  if (pdfAttachment) {
    const href = pdfAttachment.sourceUri ?? pdfAttachment.storagePath ?? sourceUri;
    if (href) {
      return {
        kind: "pdf",
        href,
        label: pdfAttachment.filename ?? "Open PDF attachment",
      };
    }
  }

  const pdfFromUri = pdfPreviewFromUri(sourceUri);
  if (pdfFromUri) return pdfFromUri;

  const htmlAttachment = attachments.find((attachment) => isHtmlAttachment(attachment));
  if (htmlAttachment) {
    const href = htmlAttachment.sourceUri ?? htmlAttachment.storagePath ?? sourceUri;
    if (href) {
      return {
        kind: "html",
        href,
        label: htmlAttachment.filename ?? "Open HTML attachment",
      };
    }
  }

  return htmlPreviewFromUri(sourceUri);
}
