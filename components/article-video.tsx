"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Pause, Play } from "lucide-react";
import type { ArticleVideoAsset } from "@/lib/articles";
import { resolveThemedVideoSrc } from "@/lib/themed-image";
import { useResolvedPapyrusTheme } from "@/components/use-resolved-papyrus-theme";
import { normalizeDevPreviewDsl, type VideoScriptRef } from "@/lib/video-script";
import {
  resolveVideoMode,
  resolveVideoModeFromEnv,
  type VideoMode,
} from "@/lib/video-mode";
import { SITE_BRAND } from "@/lib/site-brand";

type ArticleVideoFigureProps = {
  video: ArticleVideoAsset;
  slug: string;
  figureClassName?: string;
  priority?: boolean;
  videoScript?: VideoScriptRef | null;
};

const USE_FRAMED_PLAYER = SITE_BRAND.id === "threat-intelligence";

export function ArticleVideoFigure({
  video,
  slug,
  figureClassName = "article-photo article-video",
  videoScript = null,
}: ArticleVideoFigureProps) {
  const theme = useResolvedPapyrusTheme();
  const [hasHydrated, setHasHydrated] = useState(false);
  const [videoMode, setVideoMode] = useState<VideoMode>(() => resolveVideoModeFromEnv());
  const [frameReady, setFrameReady] = useState(Boolean(video.posterSrc));
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [previewReady, setPreviewReady] = useState(false);

  useEffect(() => {
    setHasHydrated(true);
    setVideoMode(resolveVideoMode());
  }, []);

  const resolvedTheme = theme;
  const src = resolveThemedVideoSrc(video.src, video.themeVariants, resolvedTheme);
  const usePreview = videoMode === "preview" && Boolean(videoScript?.dsl);
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
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
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
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [usePreview, video.posterSrc, src]);

  useEffect(() => {
    if (!usePreview) return;
    const onMessage = (event: MessageEvent) => {
      const payload = event.data;
      if (!payload || typeof payload !== "object") return;
      if (payload.kind !== "ti-preview-time") return;
      if (typeof payload.currentTime === "number") {
        setCurrentTime(payload.currentTime);
      }
      if (typeof payload.duration === "number") {
        setDuration(payload.duration);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [usePreview]);

  const postPreviewPlayback = useCallback(
    (kind: "ti-preview-play" | "ti-preview-pause") => {
      iframeRef.current?.contentWindow?.postMessage({ kind }, "*");
    },
    [],
  );

  const handleCtaClick = useCallback(() => {
    if (usePreview) {
      if (isPlaying) {
        postPreviewPlayback("ti-preview-pause");
        setIsPlaying(false);
        return;
      }
      postPreviewPlayback("ti-preview-play");
      setIsPlaying(true);
      return;
    }

    const element = videoRef.current;
    if (!element) return;
    if (isPlaying) {
      element.pause();
      setIsPlaying(false);
      return;
    }
    void element.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
  }, [isPlaying, postPreviewPlayback, usePreview]);

  const handleSeek = useCallback(
    (nextTime: number) => {
      const clamped = Math.max(0, Number.isFinite(nextTime) ? nextTime : 0);
      if (usePreview) {
        iframeRef.current?.contentWindow?.postMessage(
          { kind: "ti-preview-seek", time: clamped },
          "*",
        );
        setCurrentTime(clamped);
        return;
      }
      const element = videoRef.current;
      if (!element) return;
      element.currentTime = clamped;
      setCurrentTime(clamped);
    },
    [usePreview],
  );

  const figureClass = [
    figureClassName,
    USE_FRAMED_PLAYER ? "article-video--framed" : "",
    usePreview ? "article-video--preview" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const seekProgress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const seekStyle = {
    "--seek-progress": `${seekProgress}%`,
  } as CSSProperties;

  const media = usePreview ? (
    hasHydrated ? (
      <iframe
        key={`${slug}-${resolvedTheme}-${src}`}
        ref={iframeRef}
        className="article-video__preview-frame"
        src={previewSrc}
        title={video.alt}
        onLoad={() => setPreviewReady(true)}
      />
    ) : null
  ) : (
    <video
      ref={videoRef}
      playsInline
      preload="auto"
      poster={video.posterSrc}
      aria-label={video.alt}
      className={`article-video__player${frameReady ? " article-video__player--ready" : ""}`}
      key={src}
      src={src}
      onPlay={() => setIsPlaying(true)}
      onPause={() => setIsPlaying(false)}
      onEnded={() => setIsPlaying(false)}
      onTimeUpdate={(event) => {
        setCurrentTime(event.currentTarget.currentTime);
      }}
      onDurationChange={(event) => {
        const nextDuration = event.currentTarget.duration;
        if (Number.isFinite(nextDuration) && nextDuration > 0) {
          setDuration(nextDuration);
        }
      }}
      onLoadedData={(event) => {
        const element = event.currentTarget;
        if (element.videoWidth > 0) {
          setFrameReady(true);
          return;
        }
        element.currentTime = 0.001;
      }}
      onLoadedMetadata={(event) => {
        const element = event.currentTarget;
        if (element.duration > 0) {
          setFrameReady(true);
          setDuration(element.duration);
        }
      }}
      onSeeked={(event) => {
        const element = event.currentTarget;
        if (element.videoWidth > 0) {
          setFrameReady(true);
        }
        setCurrentTime(element.currentTime);
      }}
    >
      <source src={src} type="video/mp4" />
    </video>
  );

  return (
    <figure
      className={figureClass}
      data-media-type={usePreview ? "videoml-preview" : "video"}
      data-video-theme={resolvedTheme}
      data-video-mode={videoMode}
    >
      {USE_FRAMED_PLAYER ? <div className="article-video__media">{media}</div> : media}
      {USE_FRAMED_PLAYER ? (
        <div className="article-video__cta" data-playing={isPlaying ? "true" : "false"}>
          <button
            type="button"
            className="article-video__cta-toggle"
            onClick={handleCtaClick}
            aria-pressed={isPlaying}
          >
            <span className="article-video__cta-label">
              <span className="article-video__cta-label-sizer" aria-hidden="true">
                Pause Video
              </span>
              <span className="article-video__cta-label-text">
                {isPlaying ? "Pause Video" : "Play Video"}
              </span>
            </span>
            <span className="article-video__cta-icon" aria-hidden="true">
              {isPlaying ? <Pause /> : <Play />}
            </span>
          </button>
          <input
            type="range"
            className="article-video__cta-seek"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(currentTime, duration || 0)}
            onChange={(event) => handleSeek(Number(event.target.value))}
            aria-label="Seek video"
            aria-valuemin={0}
            aria-valuemax={duration || 0}
            aria-valuenow={Math.min(currentTime, duration || 0)}
            disabled={!duration}
            style={seekStyle}
          />
        </div>
      ) : null}
      <span className="sr-only" data-video-slug={slug}>
        {video.alt}
      </span>
    </figure>
  );
}
