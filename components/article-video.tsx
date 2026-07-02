"use client";

import { useEffect, useState } from "react";
import type { ArticleVideoAsset } from "@/lib/articles";
import { resolveThemedVideoSrc } from "@/lib/themed-image";
import { useResolvedPapyrusTheme } from "@/components/use-resolved-papyrus-theme";

type ArticleVideoFigureProps = {
  video: ArticleVideoAsset;
  slug: string;
  figureClassName?: string;
  priority?: boolean;
};

export function ArticleVideoFigure({ video, slug, figureClassName = "article-photo article-video" }: ArticleVideoFigureProps) {
  const theme = useResolvedPapyrusTheme();
  const [hasHydrated, setHasHydrated] = useState(false);
  const [frameReady, setFrameReady] = useState(Boolean(video.posterSrc));

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  // Match SSR to the default dark MP4 in `video.src` until after hydration.
  const resolvedTheme = hasHydrated ? theme : "dark";
  const src = resolveThemedVideoSrc(video.src, video.themeVariants, resolvedTheme);

  useEffect(() => {
    setFrameReady(Boolean(video.posterSrc));
  }, [video.posterSrc, src]);

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
