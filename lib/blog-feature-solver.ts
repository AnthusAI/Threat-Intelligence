import type { ArticleImageAsset } from "./articles";
import type { PublicationItem } from "./publication-items";
import {
  createThreatIntelligenceRhythm,
  getLineStackHeight,
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

const OBSTACLE_MIN_VIEWPORT = 640;
const OBSTACLE_MAX_VIEWPORT = 1099;
const FEATURED_IMAGE_WIDTH_RATIOS = [0.36, 0.38, 0.4, 0.42, 0.44];
const FLOAT_IMAGE_WIDTH_RATIO = 0.36;
const LEAD_GAP_ROWS = 6;
const DEFAULT_GAP_ROWS = 4;

export function getFeaturedLayoutMode(viewportWidth: number, hasImage: boolean): FeaturedLayoutMode {
  if (!hasImage) return "stacked";
  if (viewportWidth >= OBSTACLE_MIN_VIEWPORT && viewportWidth <= OBSTACLE_MAX_VIEWPORT) return "obstacle";
  if (viewportWidth > OBSTACLE_MAX_VIEWPORT) return "float";
  return "stacked";
}

export function solveFeaturedItem(input: SolveFeaturedItemInput): SolvedFeaturedItem {
  const rhythm = input.rhythm ?? createThreatIntelligenceRhythm();
  const gap = rhythmLengthRows(input.itemIndex === 0 ? LEAD_GAP_ROWS : DEFAULT_GAP_ROWS, rhythm);
  const mode = getFeaturedLayoutMode(input.viewportWidth, true);
  const prepared = prepareWithSegments(input.text, `${input.textStyle.fontSize}px ${input.textStyle.fontFamily}`, {
    whiteSpace: "pre-wrap",
  });
  const aspectRatio = getImageAspectRatio(input.imageAsset);

  if (mode === "obstacle") {
    return solveObstacleFeaturedItem({
      prepared,
      containerWidth: input.containerWidth,
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
  rhythm: VerticalRhythm;
  textStyle: BlogTextStyle;
  aspectRatio: number;
  gap: number;
  imageLayout?: ArticleImageAsset["layout"];
};

function solveObstacleFeaturedItem(input: PreparedSolveInput): SolvedFeaturedItem {
  let best: {
    score: number;
    textLines: TextLine[];
    imageHeight: number;
    imageWidth: number;
    copyWidth: number;
    textFrameHeight: number;
    hasMore: boolean;
  } | null = null;

  for (const ratio of FEATURED_IMAGE_WIDTH_RATIOS) {
    const imageWidth = snapDownToRhythm(Math.round(input.containerWidth * ratio), input.rhythm);
    const copyWidth = Math.max(
      input.rhythm.rowHeight * 8,
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
    const score = 50_000 - whitespace * 1.4 - Math.abs(candidateHeight - imageHeight) * 0.35 - Math.abs(ratio - 0.4) * 120;
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
    imageWidth: best?.imageWidth ?? snapDownToRhythm(Math.round(input.containerWidth * 0.4), input.rhythm),
    copyWidth: best?.copyWidth ?? input.containerWidth,
    textFrameHeight: best?.textFrameHeight ?? 0,
    hasMore: best?.hasMore ?? false,
    gap: input.gap,
  };
}

function solveFloatFeaturedItem(input: PreparedSolveInput): SolvedFeaturedItem {
  const imageWidth = snapDownToRhythm(Math.round(input.containerWidth * FLOAT_IMAGE_WIDTH_RATIO), input.rhythm);
  const copyWidth = Math.max(input.rhythm.rowHeight * 8, input.containerWidth - imageWidth - input.gap);
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

function snapImageHeight(
  naturalHeight: number,
  rhythm: VerticalRhythm,
  layout?: ArticleImageAsset["layout"],
): number {
  const minHeight = layout?.minHeight ?? rhythm.rowHeight * 6;
  const maxHeight = layout?.maxHeight ?? rhythm.rowHeight * 24;
  return layout?.crop === "contain"
    ? snapPreservedImageHeightToRhythm(naturalHeight, rhythm, minHeight, maxHeight)
    : snapPreferredHeightToRhythm(naturalHeight, rhythm, minHeight, maxHeight);
}

function getImageAspectRatio(asset: ArticleImageAsset): number {
  if (asset.layout?.aspectRatio) return asset.layout.aspectRatio;
  return 1;
}

function rhythmLengthRows(rows: number, rhythm: VerticalRhythm): number {
  return rows * rhythm.rowHeight;
}

export function isFeaturedBlogItem(item: PublicationItem, index?: number, mode?: string): boolean {
  return mode === "blog" && index === 0 && Boolean(item.type === "article" || item.type === "brief");
}
