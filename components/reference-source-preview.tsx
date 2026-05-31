"use client";

import type { ReferenceAttachmentRecord } from "../lib/category-repository";
import { resolveReferenceSourcePreview } from "../lib/reference-source-preview";

export function ReferenceSourcePreview({
  attachments = [],
  sourceUri,
}: {
  attachments?: ReferenceAttachmentRecord[];
  sourceUri?: string | null;
}) {
  const preview = resolveReferenceSourcePreview(sourceUri, attachments);
  if (!preview) return null;

  if (preview.kind === "youtube") {
    return (
      <div
        className="news-desk-reference-source-preview news-desk-reference-source-preview--youtube"
        data-news-desk-reference-source-preview="youtube"
      >
        <div className="news-desk-reference-source-preview__frame">
          <iframe
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            src={preview.embedUrl}
            title={`YouTube preview ${preview.videoId}`}
          />
        </div>
        <p className="news-desk-reference-source-preview__actions">
          <a href={preview.watchUrl} rel="noopener noreferrer" target="_blank">
            Open on YouTube
          </a>
        </p>
      </div>
    );
  }

  if (preview.kind === "pdf") {
    return (
      <div
        className="news-desk-reference-source-preview news-desk-reference-source-preview--pdf"
        data-news-desk-reference-source-preview="pdf"
      >
        <p className="news-desk-reference-source-preview__actions">
          <a href={preview.href} rel="noopener noreferrer" target="_blank">
            {preview.label}
          </a>
        </p>
        <p className="news-desk-reference-source-preview__hint">
          PDF preview in the newsroom UI is not embedded yet; use the link to open the file.
        </p>
      </div>
    );
  }

  return (
    <div
      className="news-desk-reference-source-preview news-desk-reference-source-preview--html"
      data-news-desk-reference-source-preview="html"
    >
      <p className="news-desk-reference-source-preview__actions">
        <a href={preview.href} rel="noopener noreferrer" target="_blank">
          {preview.label}
        </a>
      </p>
    </div>
  );
}
