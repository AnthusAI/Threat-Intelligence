"use client";

import { useEffect, useId, useState } from "react";
import type { ReferenceAttachmentRecord } from "../lib/category-repository";
import {
  isPdfAttachment,
  resolveReferenceSourcePreview,
  type ReferenceSourcePreview,
} from "../lib/reference-source-preview";

function PdfSourcePreview({ preview }: { preview: Extract<ReferenceSourcePreview, { kind: "pdf" }> }) {
  const [fullViewport, setFullViewport] = useState(false);
  const viewportTitleId = useId();

  useEffect(() => {
    if (!fullViewport) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullViewport(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [fullViewport]);

  return (
    <>
      <div
        className="news-desk-reference-source-preview news-desk-reference-source-preview--pdf"
        data-news-desk-reference-source-preview="pdf"
      >
        <div className="news-desk-reference-source-preview__frame news-desk-reference-source-preview__frame--pdf">
          <iframe
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            src={preview.embedUrl}
            title={preview.label}
          />
        </div>
        <p className="news-desk-reference-source-preview__actions">
          <button
            className="news-desk-reference-source-preview__viewport-toggle"
            onClick={() => setFullViewport(true)}
            type="button"
          >
            Full viewport
          </button>
          <a href={preview.href} rel="noopener noreferrer" target="_blank">
            {preview.label}
          </a>
        </p>
      </div>
      {fullViewport ? (
        <div
          aria-labelledby={viewportTitleId}
          aria-modal="true"
          className="news-desk-reference-source-preview__viewport"
          data-news-desk-reference-source-preview-viewport="open"
          role="dialog"
        >
          <header className="news-desk-reference-source-preview__viewport-toolbar">
            <p className="news-desk-reference-source-preview__viewport-title" id={viewportTitleId}>
              {preview.label}
            </p>
            <div className="news-desk-reference-source-preview__viewport-toolbar-actions">
              <a href={preview.href} rel="noopener noreferrer" target="_blank">
                Open PDF
              </a>
              <button
                className="news-desk-reference-source-preview__viewport-close"
                onClick={() => setFullViewport(false)}
                type="button"
              >
                Close
              </button>
            </div>
          </header>
          <div className="news-desk-reference-source-preview__viewport-frame">
            <iframe
              referrerPolicy="strict-origin-when-cross-origin"
              src={preview.embedUrl}
              title={`${preview.label} (full viewport)`}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

export function ReferenceSourcePreview({
  attachments = [],
  sourceUri,
}: {
  attachments?: ReferenceAttachmentRecord[];
  sourceUri?: string | null;
}) {
  const preview = resolveReferenceSourcePreview(sourceUri, attachments);
  const pendingPdfPreview = !preview && attachments.some(
    (attachment) => isPdfAttachment(attachment) && Boolean(attachment.storagePath),
  );
  if (!preview) {
    if (!pendingPdfPreview) return null;
    return (
      <p className="news-desk-reference-source-preview__hint" data-news-desk-reference-source-preview="pdf-loading">
        Loading PDF preview…
      </p>
    );
  }

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
    return <PdfSourcePreview preview={preview} />;
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
