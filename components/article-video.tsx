"use client";

import { useEffect, useRef, useState } from "react";
import type { ArticleVideoAsset } from "@/lib/articles";
import { resolveThemedVideoSrc } from "@/lib/themed-image";
import { useResolvedPapyrusTheme } from "@/components/use-resolved-papyrus-theme";
import { normalizeDevPreviewDsl, type VideoScriptRef } from "@/lib/video-script";

type ArticleVideoFigureProps = {
  video: ArticleVideoAsset;
  slug: string;
  figureClassName?: string;
  priority?: boolean;
  videoScript?: VideoScriptRef | null;
};

const IS_DEV_PREVIEW = process.env.NODE_ENV === "development";

export function ArticleVideoFigure({
  video,
  slug,
  figureClassName = "article-photo article-video",
  videoScript = null,
}: ArticleVideoFigureProps) {
  const theme = useResolvedPapyrusTheme();
  const [hasHydrated, setHasHydrated] = useState(false);
  const [frameReady, setFrameReady] = useState(Boolean(video.posterSrc));
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [previewReady, setPreviewReady] = useState(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const resolvedTheme = theme;
  const src = resolveThemedVideoSrc(video.src, video.themeVariants, resolvedTheme);
  const usePreview = IS_DEV_PREVIEW && Boolean(videoScript?.dsl);
  const previewStorageKey = `ti-preview:${slug}`;
  const previewSrc = src
    ? `/videoml/ti-preview.html?target=${encodeURIComponent(slug)}&theme=${resolvedTheme}&audio=${encodeURIComponent(src)}`
    : `/videoml/ti-preview.html?target=${encodeURIComponent(slug)}&theme=${resolvedTheme}`;

  const previewDsl = videoScript?.dsl ? normalizeDevPreviewDsl(videoScript.dsl) : null;

  if (usePreview && previewDsl && typeof window !== "undefined") {
    sessionStorage.setItem(previewStorageKey, previewDsl);
  }

  useEffect(() => {
    if (!usePreview || !previewDsl) return;
    sessionStorage.setItem(previewStorageKey, previewDsl);
  }, [previewDsl, previewStorageKey, usePreview]);

  useEffect(() => {
    setPreviewReady(false);
  }, [previewSrc, slug, usePreview]);

  useEffect(() => {
    if (!usePreview || !previewReady) return;
    iframeRef.current?.contentWindow?.postMessage(
      {
        kind: "ti-preview-refresh",
        target: slug,
        theme: resolvedTheme,
        audio: src || undefined,
      },
      "*",
    );
  }, [previewReady, resolvedTheme, slug, src, usePreview]);

  useEffect(() => {
    if (usePreview) return;
    setFrameReady(Boolean(video.posterSrc));
  }, [usePreview, video.posterSrc, src]);

  if (usePreview && videoScript) {
    return (
      <figure
        className={`${figureClassName} article-video--preview`}
        data-media-type="videoml-preview"
        data-video-theme={resolvedTheme}
      >
        {hasHydrated ? (
          <iframe
            key={`${slug}-${resolvedTheme}-${src}`}
            ref={iframeRef}
            className="article-video__preview-frame"
            src={previewSrc}
            title={video.alt}
            onLoad={() => setPreviewReady(true)}
          />
        ) : null}
        <span className="sr-only" data-video-slug={slug}>
          {video.alt}
        </span>
      </figure>
    );
  }

  return (
    <figure className={figureClassName} data-media-type="video" data-video-theme={resolvedTheme}>
      <video
        controls
        playsInline
        preload="auto"
        poster={video.posterSrc}
        aria-label={video.alt}
        className={`article-video__player${frameReady ? " article-video__player--ready" : ""}`}
        key={src}
        src={src}
        onLoadedData={(event) => {
          const element = event.currentTarget;
          if (element.videoWidth > 0) {
            setFrameReady(true);
            return;
          }
          element.currentTime = 0.001;
        }}
        onLoadedMetadata={(event) => {
          if (event.currentTarget.duration > 0) {
            setFrameReady(true);
          }
        }}
        onSeeked={(event) => {
          if (event.currentTarget.videoWidth > 0) {
            setFrameReady(true);
          }
        }}
      >
        <source src={src} type="video/mp4" />
      </video>
      <span className="sr-only" data-video-slug={slug}>
        {video.alt}
      </span>
    </figure>
  );
}
