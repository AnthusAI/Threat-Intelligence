"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import type { ArticleImageLayout, ArticleImageThemeVariants } from "../../../lib/articles";
import { createThreatIntelligenceRhythm, reserveRhythmRows } from "../../../lib/blog-rhythm";
import { shouldBypassImageOptimization } from "../../../lib/image-url";
import { resolveThemedImageSrc } from "../../../lib/themed-image";
import {
  getThreatIntelligencePictogramPhaseOffset,
  isThreatIntelligencePictogramSlug,
} from "./registry";
import { useResolvedPapyrusTheme } from "../../../components/use-resolved-papyrus-theme";
import { THREAT_INTELLIGENCE_PICTOGRAM_REGISTRY } from "./art";
import { PICTOGRAM_PALETTE, PictogramFrame, usePictogramMotion } from "./system";

const DEFAULT_RHYTHM = createThreatIntelligenceRhythm();
const DEFAULT_FRAME_HEIGHT = reserveRhythmRows(DEFAULT_RHYTHM.rowHeight * 24, DEFAULT_RHYTHM);
const DEFAULT_FRAME_WIDTH = reserveRhythmRows(DEFAULT_RHYTHM.rowHeight * 40, DEFAULT_RHYTHM);

type PictogramFigureProps = {
  alt: string;
  caption?: string;
  credit: string;
  figureClassName: string;
  frameHeight?: number;
  frameWidth?: number;
  height?: number;
  layout?: ArticleImageLayout;
  priority?: boolean;
  sizes: string;
  slug: string;
  src?: string;
  themeVariants?: ArticleImageThemeVariants;
  width?: number;
};

export function PictogramFigure({
  alt,
  caption,
  credit,
  figureClassName,
  frameHeight,
  frameWidth,
  height,
  layout,
  priority = false,
  sizes,
  slug,
  src = "",
  themeVariants,
  width,
}: PictogramFigureProps) {
  const resolvedTheme = useResolvedPapyrusTheme();
  const themedImageSrc = resolveThemedImageSrc(src, themeVariants, resolvedTheme);
  const registeredSlug = isThreatIntelligencePictogramSlug(slug) ? slug : null;
  const motionState = usePictogramMotion(registeredSlug ? getThreatIntelligencePictogramPhaseOffset(registeredSlug) : 0);
  const resolvedFrameHeight = frameHeight ?? height ?? DEFAULT_FRAME_HEIGHT;
  const resolvedFrameWidth = frameWidth ?? width ?? DEFAULT_FRAME_WIDTH;

  if (!registeredSlug) {
    if (!themedImageSrc) {
      return null;
    }
    return (
      <figure className={figureClassName}>
        <Image
          src={themedImageSrc}
          alt={alt}
          width={resolvedFrameWidth}
          height={resolvedFrameHeight}
          sizes={sizes}
          priority={priority}
          unoptimized={shouldBypassImageOptimization(themedImageSrc)}
        />
        <figcaption>{caption ?? credit}</figcaption>
      </figure>
    );
  }

  const entry = THREAT_INTELLIGENCE_PICTOGRAM_REGISTRY[registeredSlug];
  const palette = PICTOGRAM_PALETTE;
  const aspectRatio = layout?.aspectRatio ?? entry.aspectRatio ?? 1;
  const Pictogram = entry.render;

  return (
    <figure className={`${figureClassName} pictogram-figure`} data-pictogram-slug={slug}>
      <PictogramFrame aspectRatio={aspectRatio} frameHeight={resolvedFrameHeight} frameWidth={resolvedFrameWidth}>
        <Pictogram alt={alt} palette={palette} timing={motionState} />
      </PictogramFrame>
      <figcaption>{caption ?? credit}</figcaption>
    </figure>
  );
}
