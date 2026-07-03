import type { ArticleImageAsset } from "./articles";
import type { PublicationItem } from "./publication-items";
import {
  createThreatIntelligenceRhythm,
  getMeasuredTextHeight,
  reserveRhythmRows,
  snapDownToRhythm,
  snapPreferredHeightToRhythm,
  snapPreservedImageHeightToRhythm,
  type BlogTextStyle,
  type VerticalRhythm,
} from "./blog-rhythm";
import { layoutAllTextLines, layoutTextLines, prepareWithSegments, type TextLine, type TextObstacle } from "./pretext-layout";

export type FeaturedLayoutMode = "obstacle" | "float" | "stacked";

export type SolvedFeaturedItem = {
  mode: FeaturedLayoutMode;
  textLines: TextLine[];
  imageHeight: number;
  imageWidth: number;
  copyWidth: number;
  textFrameHeight: number;
  hasMore: boolean;
  gap: number;
};

export type SolveFeaturedItemInput = {
  text: string;
  containerWidth: number;
  viewportWidth: number;
  rhythm?: VerticalRhythm;
  textStyle: BlogTextStyle;
  imageAsset: ArticleImageAsset;
  itemIndex?: number;
};

const FLOAT_IMAGE_WIDTH_RATIO = 0.32;
const FLOAT_IMAGE_MIN_PHONE_ROWS = 6;
const FLOAT_IMAGE_MIN_DESKTOP_ROWS = 8;
const FLOAT_COPY_MIN_PHONE_ROWS = 11;
const FLOAT_COPY_MIN_DESKTOP_ROWS = 14;
const LEAD_GAP_ROWS = 2;
const LEAD_GAP_ROWS_NARROW = 1;
const DEFAULT_GAP_ROWS = 4;

export function getFeaturedLayoutMode(viewportWidth: number, hasImage: boolean): FeaturedLayoutMode {
  if (!hasImage) return "stacked";
  return "float";
}

export function solveFeaturedItem(input: SolveFeaturedItemInput): SolvedFeaturedItem {
  const rhythm = input.rhythm ?? createThreatIntelligenceRhythm();
  const gap = getFeaturedLayoutGap(input.viewportWidth, input.itemIndex, rhythm);
  const mode = getFeaturedLayoutMode(input.viewportWidth, true);
  const prepared = prepareWithSegments(input.text, `${input.textStyle.fontSize}px ${input.textStyle.fontFamily}`, {
    whiteSpace: "pre-wrap",
  });
  const aspectRatio = getImageAspectRatio(input.imageAsset);

  if (mode === "obstacle") {
    return solveObstacleFeaturedItem({
      prepared,
      containerWidth: input.containerWidth,
      viewportWidth: input.viewportWidth,
      rhythm,
      textStyle: input.textStyle,
      aspectRatio,
      gap,
      imageLayout: input.imageAsset.layout,
    });
  }

  if (mode === "float") {
    return solveFloatFeaturedItem({
      prepared,
      containerWidth: input.containerWidth,
      viewportWidth: input.viewportWidth,
      rhythm,
      textStyle: input.textStyle,
      aspectRatio,
      gap,
      imageLayout: input.imageAsset.layout,
    });
  }

  const lines = layoutAllTextLines({
    prepared,
    maxWidth: input.containerWidth,
    ...input.textStyle,
  });
  const imageWidth = snapDownToRhythm(Math.round(input.containerWidth), rhythm);
  const imageHeight = snapImageHeight(imageWidth / aspectRatio, rhythm, input.imageAsset.layout);
  return {
    mode,
    textLines: lines,
    imageHeight,
    imageWidth,
    copyWidth: input.containerWidth,
    textFrameHeight: reserveRhythmRows(getMeasuredTextHeight(lines), rhythm),
    hasMore: false,
    gap,
  };
}

type PreparedSolveInput = {
  prepared: ReturnType<typeof prepareWithSegments>;
  containerWidth: number;
  viewportWidth: number;
  rhythm: VerticalRhythm;
  textStyle: BlogTextStyle;
  aspectRatio: number;
  gap: number;
  imageLayout?: ArticleImageAsset["layout"];
};

function solveObstacleFeaturedItem(input: PreparedSolveInput): SolvedFeaturedItem {
  const maxImageWidth = getFloatImageWidth(input);
  let best: {
    score: number;
    textLines: TextLine[];
    imageHeight: number;
    imageWidth: number;
    copyWidth: number;
    textFrameHeight: number;
    hasMore: boolean;
  } | null = null;

  for (const imageWidth of getObstacleImageWidths(maxImageWidth, input.rhythm)) {
    const copyWidth = Math.max(
      getFloatCopyMinimum(input.viewportWidth, input.rhythm),
      input.containerWidth - imageWidth - input.gap,
    );
    const minHeight = input.imageLayout?.minHeight ?? input.rhythm.rowHeight * 6;
    const maxHeight = input.imageLayout?.maxHeight ?? input.rhythm.rowHeight * 18;
    const naturalHeight = imageWidth / input.aspectRatio;
    const imageHeight = input.imageLayout?.crop === "contain"
      ? snapPreservedImageHeightToRhythm(naturalHeight, input.rhythm, minHeight, maxHeight)
      : snapPreferredHeightToRhythm(naturalHeight, input.rhythm, minHeight, maxHeight);
    const obstacle: TextObstacle = {
      x: Math.max(0, copyWidth - imageWidth),
      y: 0,
      width: imageWidth,
      height: imageHeight,
    };

    let candidateHeight = imageHeight;
    let result = layoutTextLines({
      prepared: input.prepared,
      cursor: { segmentIndex: 0, graphemeIndex: 0 },
      maxHeight: candidateHeight,
      maxWidth: copyWidth,
      lineHeight: input.textStyle.lineHeight,
      linePaintHeight: input.textStyle.linePaintHeight,
      fontSize: input.textStyle.fontSize,
      fontFamily: input.textStyle.fontFamily,
      obstacles: [obstacle],
    });

    const textBottom = getMeasuredTextHeight(result.lines);
    if (textBottom > 0 && textBottom < candidateHeight) {
      candidateHeight = reserveRhythmRows(textBottom, input.rhythm);
      obstacle.height = candidateHeight;
      result = layoutTextLines({
        prepared: input.prepared,
        cursor: { segmentIndex: 0, graphemeIndex: 0 },
        maxHeight: candidateHeight,
        maxWidth: copyWidth,
        lineHeight: input.textStyle.lineHeight,
        linePaintHeight: input.textStyle.linePaintHeight,
        fontSize: input.textStyle.fontSize,
        fontFamily: input.textStyle.fontFamily,
        obstacles: [obstacle],
      });
    }

    const whitespace = Math.max(0, candidateHeight - getMeasuredTextHeight(result.lines));
    const score = 50_000 - whitespace * 1.4 - Math.abs(candidateHeight - imageHeight) * 0.35 - Math.abs(maxImageWidth - imageWidth) * 0.2;
    const candidate = {
      score,
      textLines: result.lines,
      imageHeight: candidateHeight,
      imageWidth,
      copyWidth,
      textFrameHeight: reserveRhythmRows(getMeasuredTextHeight(result.lines), input.rhythm),
      hasMore: result.hasMore,
    };
    if (!best || candidate.score > best.score) best = candidate;
  }

  return {
    mode: "obstacle",
    textLines: best?.textLines ?? [],
    imageHeight: best?.imageHeight ?? input.rhythm.rowHeight * 6,
    imageWidth: best?.imageWidth ?? maxImageWidth,
    copyWidth: best?.copyWidth ?? input.containerWidth,
    textFrameHeight: best?.textFrameHeight ?? 0,
    hasMore: best?.hasMore ?? false,
    gap: input.gap,
  };
}

function solveFloatFeaturedItem(input: PreparedSolveInput): SolvedFeaturedItem {
  const imageWidth = getFloatImageWidth(input);
  const copyWidth = Math.max(getFloatCopyMinimum(input.viewportWidth, input.rhythm), input.containerWidth - imageWidth - input.gap);
  const imageHeight = snapImageHeight(imageWidth / input.aspectRatio, input.rhythm, input.imageLayout);
  const lines = layoutAllTextLines({
    prepared: input.prepared,
    maxWidth: copyWidth,
    lineHeight: input.textStyle.lineHeight,
    linePaintHeight: input.textStyle.linePaintHeight,
    fontSize: input.textStyle.fontSize,
    fontFamily: input.textStyle.fontFamily,
  });

  return {
    mode: "float",
    textLines: lines,
    imageHeight,
    imageWidth,
    copyWidth,
    textFrameHeight: reserveRhythmRows(getMeasuredTextHeight(lines), input.rhythm),
    hasMore: false,
    gap: input.gap,
  };
}

function getFeaturedLayoutGap(viewportWidth: number, itemIndex: number | undefined, rhythm: VerticalRhythm): number {
  if (itemIndex === 0) {
    return rhythmLengthRows(viewportWidth <= 600 ? LEAD_GAP_ROWS_NARROW : LEAD_GAP_ROWS, rhythm);
  }
  return rhythmLengthRows(DEFAULT_GAP_ROWS, rhythm);
}

function getFloatImageWidth(input: PreparedSolveInput): number {
  const preferred = snapDownToRhythm(Math.round(input.containerWidth * FLOAT_IMAGE_WIDTH_RATIO), input.rhythm);
  const viewportCap = snapDownToRhythm(Math.floor(input.viewportWidth / 3), input.rhythm);
  const copyCap = snapDownToRhythm(
    Math.max(0, input.containerWidth - input.gap - getFloatCopyMinimum(input.viewportWidth, input.rhythm)),
    input.rhythm,
  );
  const softMinimum = getFloatImageMinimum(input.viewportWidth, input.rhythm);
  const hardMinimum = rhythmLengthRows(5, input.rhythm);
  const hardMaximum = Math.max(hardMinimum, Math.min(viewportCap, copyCap > 0 ? copyCap : viewportCap));

  if (hardMaximum <= softMinimum) return hardMaximum;
  return clamp(Math.min(preferred, hardMaximum), softMinimum, hardMaximum);
}

function getFloatImageMinimum(viewportWidth: number, rhythm: VerticalRhythm): number {
  return rhythmLengthRows(viewportWidth <= 600 ? FLOAT_IMAGE_MIN_PHONE_ROWS : FLOAT_IMAGE_MIN_DESKTOP_ROWS, rhythm);
}

function getFloatCopyMinimum(viewportWidth: number, rhythm: VerticalRhythm): number {
  return rhythmLengthRows(viewportWidth <= 600 ? FLOAT_COPY_MIN_PHONE_ROWS : FLOAT_COPY_MIN_DESKTOP_ROWS, rhythm);
}

function getObstacleImageWidths(maximum: number, rhythm: VerticalRhythm): number[] {
  const candidateRows = [0, 1, 2].map((offset) => Math.max(rhythm.rowHeight * 5, maximum - (offset * rhythm.rowHeight)));
  return Array.from(new Set(candidateRows));
}

function snapImageHeight(
  naturalHeight: number,
  rhythm: VerticalRhythm,
  layout?: ArticleImageAsset["layout"],
): number {
  const minHeight = layout?.minHeight ?? rhythm.rowHeight * 6;
  const maxHeight = layout?.maxHeight ?? rhythm.rowHeight * 24;
  return layout?.crop === "contain"
    ? snapPreservedImageHeightToRhythm(naturalHeight, rhythm, Math.min(minHeight, naturalHeight), maxHeight)
    : snapPreferredHeightToRhythm(naturalHeight, rhythm, minHeight, maxHeight);
}

function getImageAspectRatio(asset: ArticleImageAsset): number {
  if (asset.layout?.aspectRatio) return asset.layout.aspectRatio;
  return 1;
}

function rhythmLengthRows(rows: number, rhythm: VerticalRhythm): number {
  return rows * rhythm.rowHeight;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function isFeaturedBlogItem(item: PublicationItem, index?: number, mode?: string): boolean {
  return mode === "blog" && index === 0 && Boolean(item.type === "article" || item.type === "brief");
}
