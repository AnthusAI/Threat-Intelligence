import {
  layoutNextLine,
  prepareWithSegments,
  type LayoutCursor,
  type LayoutLine,
  type PreparedTextWithSegments,
} from "@chenglou/pretext";
import type { ArticleImageAsset } from "./articles";
import {
  type ArticleFrameBlockSpec,
  type EditionLayoutPlan,
  type LayoutBlockSpec,
  type LayoutMediaSpec,
  type LayoutPageSpec,
  type LayoutPullQuoteSpec,
  type LayoutRegionSpec,
  type ResponsivePlacementAnchor,
  type ResponsivePlacementSpec,
  type ResponsiveSpanPolicy,
  type ResponsiveVerticalPlacement,
} from "./layout-plan";
import {
  type ArticlePublicationItem,
  type PublicationItem,
  getArticlePublicationItems,
  getPublicationItemImageAssets,
  getPublicationItemText,
} from "./publication-items";

export type TextLine = {
  text: string;
  width: number;
  x: number;
  y: number;
  lineHeight: number;
  paintHeight: number;
};

export type SolvedTextLine = TextLine;

export type SolvedFurniture = SolvedImageFurniture | SolvedPullQuoteFurniture | SolvedMediaClusterFurniture | SolvedAdFurniture;

export type SolvedImageFurniture = {
  kind: "image";
  id: string;
  src: string;
  alt: string;
  credit: string;
  templateId: string;
  columnStart: number;
  columnSpan: number;
  x: number;
  y: number;
  width: number;
  height: number;
  aspectRatio: number;
  objectFit: "contain" | "cover";
  objectPosition: string;
  wrapsText: boolean;
  preferredHeight: number;
};

export type SolvedPullQuoteFurniture = {
  kind: "pullQuote";
  id: string;
  text: string;
  templateId: string;
  columnStart: number;
  columnSpan: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  lineHeight: number;
  wrapsText: boolean;
};

export type SolvedMediaClusterFurniture = {
  kind: "mediaCluster";
  id: string;
  templateId: string;
  images: SolvedImageFurniture[];
  caption: string;
  x: number;
  y: number;
  width: number;
  height: number;
  wrapsText: false;
};

export type SolvedAdFurniture = {
  kind: "ad";
  id: string;
  src?: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  wrapsText: false;
};

export type SolvedBlock = {
  id: string;
  type: LayoutBlockSpec["type"];
  presetId?: string;
  item?: PublicationItem;
  article?: ArticlePublicationItem;
  pageNumber: number;
  jumpTargetPage?: number;
  jumpLabel?: string;
  label?: string;
  title?: string;
  deck?: string;
  byline?: string;
  dateline?: string;
  section?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  span: number;
  columnCount: number;
  columns: TextLine[][];
  furniture: SolvedFurniture[];
  textRange?: PlacedTextRange;
  hasMore?: boolean;
  front?: SolvedFrontStoryMetrics;
  titleHeight?: number;
  bodyHeight?: number;
};

export type SolvedFrontStoryMetrics = {
  rowHeight: number;
  bodySlotHeight: number;
  chromeHeight: number;
  jumpReserveHeight: number;
  chrome: StoryChromeMetrics;
};

export type SolvedRegion = {
  id: string;
  type: LayoutRegionSpec["type"];
  role?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  columnCount: number;
  blocks: SolvedBlock[];
};

export type SolvedPage = {
  id: string;
  pageNumber: number;
  presetId: LayoutPageSpec["presetId"];
  kind: string;
  height: number;
  columnCount: number;
  regions: SolvedRegion[];
};

export type NewspaperLayout = {
  columnCount: number;
  contentWidth: number;
  gap: number;
  pageHeight: number;
  frontPageHeight: number;
  pageHeights: Record<number, number>;
  pageChrome: PageChromeMetrics;
  pages: SolvedPage[];
  textRanges: PlacedTextRange[];
};

export type PageChromeMetrics = {
  pagePaddingTop: number;
  pagePaddingX: number;
  pagePaddingBottom: number;
  mastheadHeight: number;
  mastheadKickerLineHeight: number;
  mastheadTitleFontSize: number;
  mastheadTitleLineHeight: number;
  mastheadMetaLineHeight: number;
  mastheadMetaGap: number;
  insideHeaderHeight: number;
  continuedTitleHeight: number;
  continuedTitleChromeHeight: number;
  continuedTitleFontSize: number;
  continuedTitleLineHeight: number;
};

export type StoryChromeMetrics = {
  borderTopHeight: number;
  paddingTop: number;
  labelLineHeight: number;
  headlineFontSize: number;
  headlineLineHeight: number;
  headlineHeight: number;
  headlineLineCount: number;
  headlineMarginTop: number;
  headlineMarginBottom: number;
  deckFontSize: number;
  deckLineHeight: number;
  deckHeight: number;
  deckLineCount: number;
  deckMarginBottom: number;
  bylineFontSize: number;
  bylineLineHeight: number;
  bylineHeight: number;
  bylineLineCount: number;
  bylineMarginBottom: number;
  measureChromeHeight: number;
  jumpLineHeight: number;
  jumpPaddingTop: number;
  jumpBorderTopHeight: number;
};

export type TextObstacle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PlacedTextRange = {
  articleId: string;
  pageId: string;
  blockId: string;
  startCursor: LayoutCursor;
  endCursor: LayoutCursor;
  exhausted: boolean;
};

export type ArticleFlow = {
  article: ArticlePublicationItem;
  currentCursor: LayoutCursor;
  placedRanges: PlacedTextRange[];
};

type LayoutConfig = {
  columnCount: number;
  contentWidth: number;
  gap: number;
  pageChrome: PageChromeMetrics;
  lineHeight: number;
  linePaintHeight: number;
  frontBodyFont: string;
  continuationBodyFont: string;
  frontRows: FrontRow[];
  continuationHeight: number;
};

type FrontRow = {
  startIndex: number;
  endIndex: number;
  height: number;
};

type PreparedTextCache = Map<string, PreparedTextWithSegments>;

type ArticleFrameCandidate = {
  block: SolvedBlock;
  range: PlacedTextRange;
  score: number;
  whitespace: number;
};

type MediaVariant = {
  id: string;
  placement: ResponsivePlacementSpec | null;
  columnStart: number;
  columnSpan: number;
  fallbackPenalty: number;
};

type PullQuoteVariant = {
  id: string;
  placement: ResponsivePlacementSpec | null;
  columnStart: number;
  columnSpan: number;
  fallbackPenalty: number;
};

const EMPTY_CURSOR: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
const STORY_MEASURE_CHROME_HEIGHT = 9;
const MASTHEAD_RULE_HEIGHT = 6;
const MASTHEAD_RULE_MARGIN_BOTTOM = 9;
const MASTHEAD_TITLE_MARGIN_TOP = 6;
const MASTHEAD_TITLE_MARGIN_BOTTOM = 10;
const MASTHEAD_PADDING_BOTTOM = 12;
const MASTHEAD_BORDER_BOTTOM = 4;
const MASTHEAD_MARGIN_BOTTOM = 18;
const MASTHEAD_META_BORDER_TOP = 1;
const MASTHEAD_META_PADDING_TOP = 8;
const INSIDE_HEADER_PADDING_BOTTOM = 8;
const INSIDE_HEADER_BORDER_BOTTOM = 2;
const INSIDE_HEADER_MARGIN_BOTTOM = 14;
const CONTINUED_TITLE_KICKER_LINE_HEIGHT = 14;
const CONTINUED_TITLE_HEADING_MARGIN_TOP = 5;
const CONTINUED_TITLE_PADDING_BOTTOM = 12;
const CONTINUED_TITLE_BORDER_BOTTOM = 1;
const CONTINUED_TITLE_MARGIN_BOTTOM = 14;
const CONTINUATION_SECTION_SEPARATOR_HEIGHT = 38;
const FURNITURE_COLLISION_GUTTER = 14;
const PULL_QUOTE_VERTICAL_PADDING = 24;

export function buildNewspaperLayout(
  items: PublicationItem[],
  pageWidth: number,
  viewportHeight: number,
  layoutPlan: EditionLayoutPlan,
): NewspaperLayout {
  const config = getLayoutConfig(pageWidth, viewportHeight);
  const itemsBySlug = new Map(items.map((item) => [item.slug, item]));
  const flows = createArticleFlows(items);
  const prepared: PreparedTextCache = new Map();
  const pages: SolvedPage[] = [];
  const textRanges: PlacedTextRange[] = [];

  for (const pageSpec of layoutPlan.pages) {
    const page = solvePage(pageSpec, itemsBySlug, flows, prepared, config);
    pages.push(page);
    textRanges.push(...collectPageTextRanges(page));
  }

  const pageHeights: Record<number, number> = {};
  for (const page of pages) {
    pageHeights[page.pageNumber] = page.height;
  }
  const maxPageHeight = Math.max(...pages.map((page) => page.height), 0);

  return {
    columnCount: config.columnCount,
    contentWidth: config.contentWidth,
    gap: config.gap,
    pageHeight: maxPageHeight,
    frontPageHeight: pageHeights[1] ?? maxPageHeight,
    pageHeights,
    pageChrome: config.pageChrome,
    pages,
    textRanges,
  };
}

function solvePage(
  pageSpec: LayoutPageSpec,
  itemsBySlug: Map<string, PublicationItem>,
  flows: Map<string, ArticleFlow>,
  prepared: PreparedTextCache,
  config: LayoutConfig,
): SolvedPage {
  if (pageSpec.presetId === "front.mosaic") {
    return solveFrontMosaicPage(pageSpec, itemsBySlug, flows, prepared, config);
  }
  return solveStackedEditorialPage(pageSpec, itemsBySlug, flows, prepared, config);
}

function solveFrontMosaicPage(
  pageSpec: LayoutPageSpec,
  itemsBySlug: Map<string, PublicationItem>,
  flows: Map<string, ArticleFlow>,
  prepared: PreparedTextCache,
  config: LayoutConfig,
): SolvedPage {
  const regionSpec = pageSpec.regions[0];
  const blocks = regionSpec.blocks
    .filter((block): block is ArticleFrameBlockSpec => block.type === "articleFrame")
    .map((blockSpec, index) => solveFrontArticleFrame(blockSpec, index, itemsBySlug, flows, prepared, config, pageSpec.pageNumber));
  const gridHeight = getFrontPageGridHeight(config);
  const pageHeight = getFrontPageHeight(config);

  return {
    id: pageSpec.id ?? pageIdFor(pageSpec.pageNumber),
    pageNumber: pageSpec.pageNumber,
    presetId: pageSpec.presetId,
    kind: "front",
    height: pageHeight,
    columnCount: config.columnCount,
    regions: [
      {
        id: regionSpec.id,
        type: regionSpec.type,
        role: regionSpec.role,
        x: 0,
        y: config.pageChrome.mastheadHeight,
        width: config.contentWidth,
        height: gridHeight,
        columnCount: config.columnCount,
        blocks,
      },
    ],
  };
}

function solveFrontArticleFrame(
  blockSpec: ArticleFrameBlockSpec,
  index: number,
  itemsBySlug: Map<string, PublicationItem>,
  flows: Map<string, ArticleFlow>,
  prepared: PreparedTextCache,
  config: LayoutConfig,
  pageNumber: number,
): SolvedBlock {
  const item = requireArticleItem(blockSpec.itemId, itemsBySlug);
  const flow = getOrCreateFlow(flows, blockSpec.flowKey ?? blockSpec.itemId, item);
  if (blockSpec.startCursor === "beginning") flow.currentCursor = { ...EMPTY_CURSOR };

  const span = Math.min(blockSpec.span?.preferred ?? 1, config.columnCount);
  const blockWidth = getSpanWidth(config, span);
  const chrome = getStoryChromeMetrics(config, item, index, blockWidth);
  const chromeHeight = getStoryChromeHeight(chrome);
  const jumpReserveHeight = getStoryJumpReserveHeight(chrome);
  const rowHeight = getFrontRowHeight(config, index);
  const bodySlotHeight = Math.max(config.linePaintHeight, rowHeight - chromeHeight - jumpReserveHeight);
  const lineLimitHeight = blockSpec.cutPolicy?.maxBodyLines
    ? getLineLimitHeight(blockSpec.cutPolicy.maxBodyLines, config.lineHeight, config.linePaintHeight)
    : bodySlotHeight;
  const maxHeight = Math.min(bodySlotHeight, lineLimitHeight);
  const imageWrap = index === 0 ? getLeadImageWrap(item, blockWidth, config.lineHeight) : null;
  const startCursor = { ...flow.currentCursor };
  const result = layoutTextLines({
    prepared: getPrepared(prepared, item, config.frontBodyFont),
    cursor: startCursor,
    maxHeight,
    maxWidth: blockWidth,
    lineHeight: config.lineHeight,
    linePaintHeight: config.linePaintHeight,
    obstacles: imageWrap ? [imageWrap] : [],
  });
  const range = createTextRange({
    flow,
    pageId: pageIdFor(pageNumber),
    blockId: blockSpec.id,
    startCursor,
    endCursor: result.cursor,
    exhausted: !result.hasMore,
  });
  commitTextRange(flow, range);

  return {
    id: blockSpec.id,
    type: "articleFrame",
    presetId: blockSpec.presetId,
    item,
    article: item,
    pageNumber,
    jumpTargetPage: result.hasMore ? blockSpec.cutPolicy?.jumpTargetPage : undefined,
    jumpLabel:
      result.hasMore && blockSpec.cutPolicy?.jumpTargetPage
        ? formatContinuationJumpLabel(item, blockSpec.cutPolicy.jumpTargetPage)
        : undefined,
    label: item.section,
    title: item.headline,
    deck: item.deck,
    byline: item.byline,
    dateline: item.dateline,
    section: item.section,
    x: 0,
    y: 0,
    width: blockWidth,
    height: rowHeight,
    span,
    columnCount: 1,
    columns: [result.lines],
    furniture: imageWrap ? [leadImageToFurniture(item, imageWrap)] : [],
    textRange: range,
    hasMore: result.hasMore,
    front: {
      rowHeight,
      bodySlotHeight,
      chromeHeight,
      jumpReserveHeight,
      chrome,
    },
    bodyHeight: bodySlotHeight,
  };
}

function solveStackedEditorialPage(
  pageSpec: LayoutPageSpec,
  itemsBySlug: Map<string, PublicationItem>,
  flows: Map<string, ArticleFlow>,
  prepared: PreparedTextCache,
  config: LayoutConfig,
): SolvedPage {
  const pageStartY = config.pageChrome.insideHeaderHeight;
  const regions: SolvedRegion[] = [];
  let currentY = pageStartY;
  const ratios = pageSpec.regions.map((region) => region.size?.ratio ?? 1 / pageSpec.regions.length);
  const ratioTotal = ratios.reduce((total, ratio) => total + ratio, 0) || 1;

  for (let index = 0; index < pageSpec.regions.length; index += 1) {
    const regionSpec = pageSpec.regions[index];
    const allocatedHeight = Math.max(
      config.linePaintHeight,
      Math.floor((config.continuationHeight * ratios[index]) / ratioTotal) -
        (index > 0 ? CONTINUATION_SECTION_SEPARATOR_HEIGHT : 0),
    );
    const region = solveRegion(regionSpec, pageSpec, allocatedHeight, itemsBySlug, flows, prepared, config, currentY);
    regions.push(region);
    currentY += region.height + (index < pageSpec.regions.length - 1 ? CONTINUATION_SECTION_SEPARATOR_HEIGHT : 0);
  }

  const contentBottom = Math.max(...regions.map((region) => region.y + region.height), pageStartY);
  const height = Math.ceil(
    config.pageChrome.pagePaddingTop +
      contentBottom +
      config.pageChrome.pagePaddingBottom,
  );

  return {
    id: pageSpec.id ?? pageIdFor(pageSpec.pageNumber),
    pageNumber: pageSpec.pageNumber,
    presetId: pageSpec.presetId,
    kind: getPageKind(pageSpec),
    height,
    columnCount: config.columnCount,
    regions,
  };
}

function solveRegion(
  regionSpec: LayoutRegionSpec,
  pageSpec: LayoutPageSpec,
  allocatedHeight: number,
  itemsBySlug: Map<string, PublicationItem>,
  flows: Map<string, ArticleFlow>,
  prepared: PreparedTextCache,
  config: LayoutConfig,
  y: number,
): SolvedRegion {
  const blocks: SolvedBlock[] = [];
  let currentY = 0;

  for (const blockSpec of regionSpec.blocks) {
    const remainingHeight = Math.max(config.linePaintHeight, allocatedHeight - currentY);
    const block = solveBlock(blockSpec, pageSpec, remainingHeight, itemsBySlug, flows, prepared, config);
    blocks.push({ ...block, y: currentY });
    currentY += block.height;
  }

  return {
    id: regionSpec.id,
    type: regionSpec.type,
    role: regionSpec.role,
    x: 0,
    y,
    width: config.contentWidth,
    height: Math.max(currentY, allocatedHeight),
    columnCount: config.columnCount,
    blocks,
  };
}

function solveBlock(
  blockSpec: LayoutBlockSpec,
  pageSpec: LayoutPageSpec,
  allocatedHeight: number,
  itemsBySlug: Map<string, PublicationItem>,
  flows: Map<string, ArticleFlow>,
  prepared: PreparedTextCache,
  config: LayoutConfig,
): SolvedBlock {
  if (blockSpec.type === "articleFrame") {
    return solveArticleFrameBlock(blockSpec, pageSpec, allocatedHeight, itemsBySlug, flows, prepared, config);
  }
  return solveStaticBlock(blockSpec, pageSpec, allocatedHeight, itemsBySlug, config);
}

function solveArticleFrameBlock(
  blockSpec: ArticleFrameBlockSpec,
  pageSpec: LayoutPageSpec,
  allocatedHeight: number,
  itemsBySlug: Map<string, PublicationItem>,
  flows: Map<string, ArticleFlow>,
  prepared: PreparedTextCache,
  config: LayoutConfig,
): SolvedBlock {
  const item = requireArticleItem(blockSpec.itemId, itemsBySlug);
  const flow = getOrCreateFlow(flows, blockSpec.flowKey ?? blockSpec.itemId, item);
  const startCursor = blockSpec.startCursor === "beginning" ? { ...EMPTY_CURSOR } : { ...flow.currentCursor };
  const blockWidth = getBlockWidth(config, blockSpec.span);
  const title = getContinuationTitleMetrics(config, item, blockWidth);
  const bodyBudget = Math.max(config.linePaintHeight, allocatedHeight - title.totalHeight);
  const candidates = solveArticleFrameCandidates({
    blockSpec,
    pageSpec,
    item,
    flow,
    startCursor,
    blockWidth,
    bodyBudget,
    prepared,
    config,
  });
  const best = chooseBestCandidate(candidates, blockSpec.id);
  commitTextRange(flow, best.range);
  return best.block;
}

function solveArticleFrameCandidates({
  blockSpec,
  pageSpec,
  item,
  flow,
  startCursor,
  blockWidth,
  bodyBudget,
  prepared,
  config,
}: {
  blockSpec: ArticleFrameBlockSpec;
  pageSpec: LayoutPageSpec;
  item: ArticlePublicationItem;
  flow: ArticleFlow;
  startCursor: LayoutCursor;
  blockWidth: number;
  bodyBudget: number;
  prepared: PreparedTextCache;
  config: LayoutConfig;
}): ArticleFrameCandidate[] {
  const localColumnCounts = getLocalColumnCountCandidates(blockSpec.localGrid?.columns, config, blockWidth);
  const candidates: ArticleFrameCandidate[] = [];

  for (const columnCount of localColumnCounts) {
    const localConfig = { ...config, columnCount, contentWidth: blockWidth };
    const mediaVariants = getMediaVariants(blockSpec.media[0], localConfig);
    const pullQuoteVariants = getPullQuoteVariants(item, blockSpec.pullQuote, localConfig);

    for (const mediaVariant of mediaVariants) {
      const image = createImageFurniture(item, mediaVariant, localConfig, bodyBudget);
      if (blockSpec.media[0]?.required && !image) continue;

      const minimumHeight = Math.max(config.linePaintHeight, image ? image.y + image.height : 0);
      const textHeights = getTextHeightVariants(Math.max(minimumHeight, bodyBudget), minimumHeight, localConfig);
      for (const textHeight of textHeights) {
        for (const pullQuoteVariant of pullQuoteVariants) {
          const pullQuote = createPullQuoteFurniture(item, pullQuoteVariant, localConfig, textHeight, image);
          if (blockSpec.pullQuote?.required && !pullQuote) continue;

          const furniture: SolvedFurniture[] = [];
          if (image) furniture.push(image);
          if (pullQuote) furniture.push(pullQuote);
          const textResult = layoutTextColumns({
            item,
            prepared,
            cursor: startCursor,
            columnCount,
            textHeight,
            localConfig,
            furniture,
          });
          const range = createTextRange({
            flow,
            pageId: pageIdFor(pageSpec.pageNumber),
            blockId: blockSpec.id,
            startCursor,
            endCursor: textResult.cursor,
            exhausted: !textResult.hasMore,
          });
          const linesHeight = Math.max(...textResult.columns.map(getLinesHeight), 0);
          const furnitureBottom = getFurnitureBottom(furniture);
          const bodyHeight = Math.max(furnitureBottom, textResult.hasMore ? textHeight : linesHeight, config.linePaintHeight);
          const title = getContinuationTitleMetrics(config, item, blockWidth);
          const blockHeight = title.totalHeight + bodyHeight;
          const whitespace = getColumnWhitespace(textResult.columns, bodyHeight, furniture);
          const deadColumns = getDeadColumnCount(textResult.columns, bodyHeight, furniture);
          const score =
            50_000 -
            whitespace * 1.1 -
            deadColumns * 8_000 -
            (image ? Math.abs(image.height - image.preferredHeight) * 0.35 : 800) -
            (pullQuote ? 0 : 180) -
            mediaVariant.fallbackPenalty -
            pullQuoteVariant.fallbackPenalty -
            Math.max(0, config.columnCount - columnCount) * 240;

          candidates.push({
            block: {
              id: blockSpec.id,
              type: "articleFrame",
              presetId: blockSpec.presetId,
              item,
              article: item,
              pageNumber: pageSpec.pageNumber,
              label: blockSpec.startCursor === "current" ? formatContinuationSourceLabel(item, 1) : item.section,
              title: item.headline,
              deck: item.deck,
              byline: item.byline,
              dateline: item.dateline,
              section: item.section,
              x: 0,
              y: 0,
              width: blockWidth,
              height: blockHeight,
              span: getBlockSpan(config, blockSpec.span),
              columnCount,
              columns: textResult.columns,
              furniture,
              textRange: range,
              hasMore: textResult.hasMore,
              titleHeight: title.headingHeight,
              bodyHeight,
            },
            range,
            score,
            whitespace,
          });
        }
      }
    }
  }

  return candidates;
}

function solveStaticBlock(
  blockSpec: LayoutBlockSpec,
  pageSpec: LayoutPageSpec,
  allocatedHeight: number,
  itemsBySlug: Map<string, PublicationItem>,
  config: LayoutConfig,
): SolvedBlock {
  const width = config.contentWidth;
  if (blockSpec.type === "itemStack") {
    const items = blockSpec.itemIds.map((itemId) => requireKnownItem(itemId, itemsBySlug));
    return {
      id: blockSpec.id,
      type: blockSpec.type,
      pageNumber: pageSpec.pageNumber,
      title: blockSpec.title,
      x: 0,
      y: 0,
      width,
      height: Math.min(allocatedHeight, 220 + items.length * 72),
      span: config.columnCount,
      columnCount: 1,
      columns: [],
      furniture: [],
    };
  }
  if (blockSpec.type === "adBlock") {
    return {
      id: blockSpec.id,
      type: blockSpec.type,
      presetId: blockSpec.presetId,
      item: blockSpec.itemId ? requireKnownItem(blockSpec.itemId, itemsBySlug) : undefined,
      pageNumber: pageSpec.pageNumber,
      title: "Advertisement",
      x: 0,
      y: 0,
      width,
      height: Math.max(260, Math.min(allocatedHeight, 720)),
      span: config.columnCount,
      columnCount: config.columnCount,
      columns: [],
      furniture: [
        {
          kind: "ad",
          id: `${blockSpec.id}-ad`,
          src: blockSpec.imageUrl,
          label: "Advertisement",
          x: 0,
          y: 0,
          width,
          height: Math.max(260, Math.min(allocatedHeight, 720)),
          wrapsText: false,
        },
      ],
    };
  }
  return {
    id: blockSpec.id,
    type: blockSpec.type,
    pageNumber: pageSpec.pageNumber,
    x: 0,
    y: 0,
    width,
    height: blockSpec.type === "rule" ? 18 : Math.min(allocatedHeight, 120),
    span: config.columnCount,
    columnCount: config.columnCount,
    columns: [],
    furniture: [],
  };
}

function layoutTextColumns({
  item,
  prepared,
  cursor,
  columnCount,
  textHeight,
  localConfig,
  furniture,
}: {
  item: ArticlePublicationItem;
  prepared: PreparedTextCache;
  cursor: LayoutCursor;
  columnCount: number;
  textHeight: number;
  localConfig: LayoutConfig;
  furniture: SolvedFurniture[];
}): { columns: TextLine[][]; cursor: LayoutCursor; hasMore: boolean } {
  const columns: TextLine[][] = [];
  const preparedText = getPrepared(prepared, item, localConfig.continuationBodyFont);
  const columnWidth = getSpanWidth(localConfig, 1);
  let current = { ...cursor };
  let hasMore = true;

  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    const result = layoutTextLines({
      prepared: preparedText,
      cursor: current,
      maxHeight: textHeight,
      maxWidth: columnWidth,
      lineHeight: localConfig.lineHeight,
      linePaintHeight: localConfig.linePaintHeight,
      obstacles: getColumnTextObstacles(furniture, columnIndex),
    });
    columns.push(result.lines);
    current = result.cursor;
    hasMore = result.hasMore;
    if (!hasMore) {
      while (columns.length < columnCount) columns.push([]);
      break;
    }
  }

  return { columns, cursor: current, hasMore };
}

function getMediaVariants(media: LayoutMediaSpec | undefined, config: LayoutConfig): MediaVariant[] {
  if (!media) return [{ id: "none", placement: null, columnStart: 0, columnSpan: 0, fallbackPenalty: 900 }];
  const variants = resolvePlacementVariants(media.placement, config).map((variant) => ({
    ...variant,
    fallbackPenalty: variant.fallbackPenalty + Math.abs(variant.columnSpan - media.placement.span.preferred) * 900,
  }));
  if (media.required) return variants;
  return [...variants, { id: "none", placement: null, columnStart: 0, columnSpan: 0, fallbackPenalty: 1_400 }];
}

function getPullQuoteVariants(
  article: ArticlePublicationItem,
  pullQuote: LayoutPullQuoteSpec | undefined,
  config: LayoutConfig,
): PullQuoteVariant[] {
  const none = { id: "none", placement: null, columnStart: 0, columnSpan: 0, fallbackPenalty: 0 };
  if (!pullQuote || !article.pullQuotes?.[0]) return [none];
  const variants = pullQuote.placements.flatMap((placement, placementIndex) =>
    resolvePlacementVariants(placement, config).map((variant) => ({
      ...variant,
      fallbackPenalty: variant.fallbackPenalty + placementIndex * 100,
    })),
  );
  return pullQuote.required ? variants : [none, ...variants];
}

function resolvePlacementVariants(placement: ResponsivePlacementSpec, config: LayoutConfig): Array<{
  id: string;
  placement: ResponsivePlacementSpec;
  columnStart: number;
  columnSpan: number;
  fallbackPenalty: number;
}> {
  const collapsed = config.columnCount < placement.span.min;
  if (collapsed && placement.collapse === "omit") return [];
  const spans = collapsed
    ? [placement.collapse === "fullWidth" ? config.columnCount : 1]
    : getSpanCandidates(placement.span, config.columnCount);
  return spans.map((span, index) => {
    const anchor = collapsed && placement.collapse === "inline" ? "inline" : placement.anchor;
    const columnStart = getColumnStart(resolveAnchor(anchor), span, config.columnCount);
    return {
      id: `${resolveAnchor(anchor)}-span${span}-${placement.vertical}`,
      placement,
      columnStart,
      columnSpan: span,
      fallbackPenalty: index * 120 + (collapsed ? 320 : 0),
    };
  });
}

function createImageFurniture(
  article: ArticlePublicationItem,
  variant: MediaVariant,
  config: LayoutConfig,
  textHeight: number,
): SolvedImageFurniture | null {
  if (!variant.placement || variant.columnSpan === 0) return null;
  const asset = getPreferredImage(article, variant.placement, variant.placement ? undefined : undefined);
  if (!asset) return null;
  const columnWidth = getSpanWidth(config, 1);
  const width = Math.round(getSpanWidth(config, variant.columnSpan));
  const x = Math.round(variant.columnStart * (columnWidth + config.gap));
  const aspectRatio = getImageAspectRatio(asset);
  const preferredHeight = Math.round(width / aspectRatio);
  const height = variant.placement.crop === "cropAllowed"
    ? clamp(preferredHeight, asset.layout?.minHeight ?? 140, asset.layout?.maxHeight ?? 420)
    : preferredHeight;
  const y = getFurnitureY(variant.placement.vertical, height, textHeight, config);
  const focalPoint = asset.layout?.focalPoint ?? { x: 0.5, y: 0.5 };
  return {
    kind: "image",
    id: `${article.slug}-${variant.id}-image`,
    src: asset.src,
    alt: asset.alt,
    credit: asset.credit,
    templateId: `image-${variant.id}`,
    columnStart: variant.columnStart,
    columnSpan: variant.columnSpan,
    x,
    y,
    width,
    height,
    aspectRatio,
    objectFit: variant.placement.crop === "cropAllowed" ? "cover" : "contain",
    objectPosition: `${Math.round(focalPoint.x * 100)}% ${Math.round(focalPoint.y * 100)}%`,
    wrapsText: variant.placement.wrapsText,
    preferredHeight,
  };
}

function createPullQuoteFurniture(
  article: ArticlePublicationItem,
  variant: PullQuoteVariant,
  config: LayoutConfig,
  textHeight: number,
  image: SolvedImageFurniture | null,
): SolvedPullQuoteFurniture | null {
  if (!variant.placement || variant.columnSpan === 0) return null;
  const text = article.pullQuotes?.[0];
  if (!text) return null;
  const columnWidth = getSpanWidth(config, 1);
  const width = Math.round(getSpanWidth(config, variant.columnSpan));
  const x = Math.round(variant.columnStart * (columnWidth + config.gap));
  const metrics = getPullQuoteMetrics(text, width, config);
  const y = getPullQuoteY({
    x,
    width,
    height: metrics.height,
    textHeight,
    anchorRatio: getVerticalAnchorRatio(variant.placement.vertical),
    image,
    config,
  });
  if (y === null) return null;
  return {
    kind: "pullQuote",
    id: `${article.slug}-${variant.id}-pullquote`,
    text,
    templateId: `pullquote-${variant.id}`,
    columnStart: variant.columnStart,
    columnSpan: variant.columnSpan,
    x,
    y,
    width,
    height: metrics.height,
    fontSize: metrics.fontSize,
    lineHeight: metrics.lineHeight,
    wrapsText: true,
  };
}

function getPreferredImage(
  article: ArticlePublicationItem,
  _placement: ResponsivePlacementSpec,
  assetRole: string | undefined,
): ArticleImageAsset | null {
  const assets = getPublicationItemImageAssets(article);
  if (assetRole) {
    const roleAsset = assets.find((asset) => asset.roles?.some((role) => role === assetRole));
    if (roleAsset) return roleAsset;
  }
  return (
    assets.find((asset) => asset.roles?.some((role) => role === "continuationInset")) ??
    assets.find((asset) => asset.roles?.some((role) => role === "continuation")) ??
    assets[0] ??
    null
  );
}

function chooseBestCandidate(candidates: ArticleFrameCandidate[], blockId: string): ArticleFrameCandidate {
  const best = candidates.reduce<ArticleFrameCandidate | null>(
    (winner, candidate) => (!winner || candidate.score > winner.score ? candidate : winner),
    null,
  );
  if (!best) throw new Error(`No valid articleFrame candidate solved for ${blockId}`);
  return best;
}

function getLocalColumnCountCandidates(
  policy: ResponsiveSpanPolicy | undefined,
  config: LayoutConfig,
  blockWidth: number,
): number[] {
  const maxByWidth = getResponsiveColumnCount(blockWidth + config.pageChrome.pagePaddingX * 2, blockWidth, config.gap);
  const min = Math.min(policy?.min ?? 1, maxByWidth, config.columnCount);
  const max = Math.min(policy?.max ?? config.columnCount, maxByWidth, config.columnCount);
  const preferred = clamp(policy?.preferred ?? max, min, max);
  const candidates = [preferred, min, max];
  return Array.from(new Set(candidates)).sort((left, right) => (
    Math.abs(left - preferred) - Math.abs(right - preferred) || right - left
  ));
}

function getTextHeightVariants(maxHeight: number, minHeight: number, config: LayoutConfig): number[] {
  if (config.columnCount === 1) return [maxHeight];
  const candidates = [maxHeight, minHeight].map((height) => clamp(Math.round(height), minHeight, maxHeight));
  return Array.from(new Set(candidates)).sort((a, b) => b - a);
}

function getPageKind(pageSpec: LayoutPageSpec): string {
  if (pageSpec.presetId === "page.regionStack" && pageSpec.regions.length > 1) return "regionStack";
  if (pageSpec.presetId === "page.railMain") return "railMain";
  return "articlePage";
}

function collectPageTextRanges(page: SolvedPage): PlacedTextRange[] {
  return page.regions.flatMap((region) => region.blocks.flatMap((block) => (block.textRange ? [block.textRange] : [])));
}

function createArticleFlows(items: PublicationItem[]): Map<string, ArticleFlow> {
  return new Map(
    getArticlePublicationItems(items).map((article) => [
      article.slug,
      {
        article,
        currentCursor: { ...EMPTY_CURSOR },
        placedRanges: [],
      },
    ]),
  );
}

function getOrCreateFlow(flows: Map<string, ArticleFlow>, flowKey: string, article: ArticlePublicationItem): ArticleFlow {
  const existing = flows.get(flowKey);
  if (existing) return existing;
  const flow = {
    article,
    currentCursor: { ...EMPTY_CURSOR },
    placedRanges: [],
  };
  flows.set(flowKey, flow);
  return flow;
}

function requireKnownItem(itemId: string, itemsBySlug: Map<string, PublicationItem>): PublicationItem {
  const item = itemsBySlug.get(itemId);
  if (!item) throw new Error(`Layout references missing item ${itemId}`);
  return item;
}

function requireArticleItem(itemId: string, itemsBySlug: Map<string, PublicationItem>): ArticlePublicationItem {
  const item = requireKnownItem(itemId, itemsBySlug);
  if (item.type !== "article") throw new Error(`Layout articleFrame requires article item ${itemId}`);
  return item;
}

function createTextRange({
  flow,
  pageId,
  blockId,
  startCursor,
  endCursor,
  exhausted,
}: {
  flow: ArticleFlow;
  pageId: string;
  blockId: string;
  startCursor: LayoutCursor;
  endCursor: LayoutCursor;
  exhausted: boolean;
}): PlacedTextRange {
  return {
    articleId: flow.article.slug,
    pageId,
    blockId,
    startCursor,
    endCursor,
    exhausted,
  };
}

function commitTextRange(flow: ArticleFlow, range: PlacedTextRange): void {
  flow.currentCursor = { ...range.endCursor };
  flow.placedRanges.push(range);
}

function pageIdFor(pageNumber: number): string {
  return `page-${pageNumber}`;
}

function getLayoutConfig(pageWidth: number, viewportHeight: number): LayoutConfig {
  const narrow = pageWidth < 560;
  const medium = pageWidth >= 560 && pageWidth < 1040;
  const gap = narrow ? 14 : 18;
  const sideMargin = narrow ? 18 : 30;
  const contentWidth = Math.max(280, pageWidth - sideMargin * 2);
  const columnCount = getResponsiveColumnCount(pageWidth, contentWidth, gap);
  const pageChrome = getPageChromeMetrics(pageWidth, narrow);
  const targetPageHeight = getTargetPageHeight(pageWidth, viewportHeight);
  const frontGridHeight = getFrontGridHeight(targetPageHeight, narrow, medium);
  const frontRowMaxHeight = narrow ? 520 : medium ? 560 : 620;
  const continuationChrome =
    pageChrome.pagePaddingTop +
    pageChrome.insideHeaderHeight +
    pageChrome.continuedTitleHeight +
    pageChrome.pagePaddingBottom;
  const continuationHeight = Math.max(760, targetPageHeight - continuationChrome);

  return {
    columnCount,
    contentWidth,
    gap,
    pageChrome,
    lineHeight: narrow ? 18 : 19,
    linePaintHeight: (narrow ? 18 : 19) + 4,
    frontBodyFont: `${narrow ? 15 : 16}px Georgia, "Times New Roman", serif`,
    continuationBodyFont: `${narrow ? 16 : 17}px Georgia, "Times New Roman", serif`,
    frontRows: getFrontRows(columnCount, gap, frontGridHeight, frontRowMaxHeight),
    continuationHeight,
  };
}

function getResponsiveColumnCount(pageWidth: number, contentWidth: number, gap: number): number {
  if (pageWidth < 560) return 1;
  const minimumColumnWidth = 168;
  for (const columnCount of [6, 5, 4, 3, 2] as const) {
    const columnWidth = (contentWidth - gap * (columnCount - 1)) / columnCount;
    if (columnWidth >= minimumColumnWidth) return columnCount;
  }
  return 1;
}

function getTargetPageHeight(pageWidth: number, viewportHeight: number): number {
  if (pageWidth < 720) return Math.max(3000, viewportHeight * 3.25);
  if (pageWidth < 1040) return Math.max(1900, viewportHeight * 2.1);
  return Math.max(1320, viewportHeight * 1.72);
}

function getPageChromeMetrics(pageWidth: number, narrow: boolean): PageChromeMetrics {
  const pagePaddingTop = narrow ? 18 : 26;
  const pagePaddingX = narrow ? 18 : 30;
  const pagePaddingBottom = narrow ? 18 : 30;
  const mastheadKickerLineHeight = 14;
  const mastheadTitleFontSize = narrow
    ? clamp(pageWidth * 0.22, 54.4, 89.6)
    : clamp(pageWidth * 0.12, 72, 145.6);
  const mastheadTitleLineHeight = mastheadTitleFontSize * 0.84;
  const mastheadMetaLineHeight = narrow ? 16 : 18;
  const mastheadMetaGap = narrow ? 5 : 0;
  const mastheadHeight =
    MASTHEAD_RULE_HEIGHT +
    MASTHEAD_RULE_MARGIN_BOTTOM +
    mastheadKickerLineHeight +
    MASTHEAD_TITLE_MARGIN_TOP +
    mastheadTitleLineHeight +
    MASTHEAD_TITLE_MARGIN_BOTTOM +
    MASTHEAD_META_BORDER_TOP +
    MASTHEAD_META_PADDING_TOP +
    mastheadMetaLineHeight +
    MASTHEAD_PADDING_BOTTOM +
    MASTHEAD_BORDER_BOTTOM +
    MASTHEAD_MARGIN_BOTTOM +
    (narrow ? mastheadMetaGap * 2 : 0);
  const insideHeaderHeight = INSIDE_HEADER_PADDING_BOTTOM + INSIDE_HEADER_BORDER_BOTTOM + INSIDE_HEADER_MARGIN_BOTTOM + 18;
  const continuedTitleFontSize = narrow ? clamp(pageWidth * 0.075, 28, 42) : clamp(pageWidth * 0.035, 32, 56);
  const continuedTitleLineHeight = continuedTitleFontSize * 0.94;
  const continuedTitleHeight = Math.ceil(
    CONTINUED_TITLE_KICKER_LINE_HEIGHT +
      CONTINUED_TITLE_HEADING_MARGIN_TOP +
      continuedTitleLineHeight * 2 +
      CONTINUED_TITLE_PADDING_BOTTOM +
      CONTINUED_TITLE_BORDER_BOTTOM +
      CONTINUED_TITLE_MARGIN_BOTTOM,
  );

  return {
    pagePaddingTop,
    pagePaddingX,
    pagePaddingBottom,
    mastheadHeight: Math.ceil(mastheadHeight),
    mastheadKickerLineHeight,
    mastheadTitleFontSize,
    mastheadTitleLineHeight,
    mastheadMetaLineHeight,
    mastheadMetaGap,
    insideHeaderHeight,
    continuedTitleHeight,
    continuedTitleChromeHeight:
      CONTINUED_TITLE_KICKER_LINE_HEIGHT +
      CONTINUED_TITLE_HEADING_MARGIN_TOP +
      CONTINUED_TITLE_PADDING_BOTTOM +
      CONTINUED_TITLE_BORDER_BOTTOM +
      CONTINUED_TITLE_MARGIN_BOTTOM,
    continuedTitleFontSize,
    continuedTitleLineHeight,
  };
}

function getFrontGridHeight(targetPageHeight: number, narrow: boolean, medium: boolean): number {
  const mastheadAllowance = narrow ? 190 : medium ? 230 : 270;
  const bottomPadding = narrow ? 18 : 30;
  return Math.max(420, targetPageHeight - mastheadAllowance - bottomPadding);
}

function getFrontRows(columnCount: number, gap: number, gridHeight: number, rowMaxHeight: number): FrontRow[] {
  if (columnCount === 1) {
    return Array.from({ length: 6 }, (_, index) => ({
      startIndex: index,
      endIndex: index,
      height: Math.min(rowMaxHeight, Math.max(360, Math.floor((gridHeight - gap * 5) / 6))),
    }));
  }
  const first = Math.min(rowMaxHeight, Math.max(360, Math.floor(gridHeight * 0.52)));
  const second = Math.min(rowMaxHeight, Math.max(300, Math.floor(gridHeight - first - gap)));
  return [
    { startIndex: 0, endIndex: 2, height: first },
    { startIndex: 3, endIndex: 5, height: second },
  ];
}

function getFrontPageHeight(config: LayoutConfig): number {
  return Math.ceil(
    config.pageChrome.pagePaddingTop +
      config.pageChrome.mastheadHeight +
      getFrontPageGridHeight(config) +
      config.pageChrome.pagePaddingBottom,
  );
}

function getFrontPageGridHeight(config: LayoutConfig): number {
  if (config.frontRows.length === 0) return 0;
  return config.frontRows.reduce((total, row) => total + row.height, 0) + config.gap * Math.max(0, config.frontRows.length - 1);
}

function getFrontRowHeight(config: LayoutConfig, articleIndex: number): number {
  return config.frontRows.find((row) => articleIndex >= row.startIndex && articleIndex <= row.endIndex)?.height ?? 420;
}

function getBlockSpan(config: LayoutConfig, span: ResponsiveSpanPolicy | undefined): number {
  if (config.columnCount === 1) return 1;
  return clamp(span?.preferred ?? config.columnCount, span?.min ?? 1, Math.min(span?.max ?? config.columnCount, config.columnCount));
}

function getBlockWidth(config: LayoutConfig, span: ResponsiveSpanPolicy | undefined): number {
  return getSpanWidth(config, getBlockSpan(config, span));
}

function getSpanWidth(config: LayoutConfig, span: number): number {
  const safeSpan = clamp(span, 1, config.columnCount);
  const singleColumn = (config.contentWidth - config.gap * (config.columnCount - 1)) / config.columnCount;
  return singleColumn * safeSpan + config.gap * (safeSpan - 1);
}

function getStoryChromeMetrics(
  config: LayoutConfig,
  article: ArticlePublicationItem,
  articleIndex: number,
  blockWidth: number,
): StoryChromeMetrics {
  const lead = articleIndex === 0;
  const headlineFontSize = getHeadlineFontSize(config, lead);
  const headlineLineHeight = Math.ceil(headlineFontSize * (lead ? 0.96 : 1));
  const headline = measureWrappedTextBlock(article.headline, `${headlineFontSize}px Georgia, "Times New Roman", serif`, blockWidth, headlineLineHeight);
  const deckFontSize = config.columnCount === 1 ? 15 : lead ? 16 : 14;
  const deckLineHeight = Math.ceil(deckFontSize * 1.25);
  const deck = measureWrappedTextBlock(article.deck, `italic ${deckFontSize}px Georgia, "Times New Roman", serif`, blockWidth, deckLineHeight);
  const bylineFontSize = 11;
  const bylineLineHeight = 13;
  const byline = measureWrappedTextBlock(formatByline(article), `800 ${bylineFontSize}px Arial`, blockWidth, bylineLineHeight);

  return {
    borderTopHeight: lead ? 6 : 2,
    paddingTop: lead ? 12 : 10,
    labelLineHeight: 14,
    headlineFontSize,
    headlineLineHeight,
    headlineHeight: headline.height,
    headlineLineCount: headline.lineCount,
    headlineMarginTop: 5,
    headlineMarginBottom: lead ? 9 : 8,
    deckFontSize,
    deckLineHeight,
    deckHeight: deck.height,
    deckLineCount: deck.lineCount,
    deckMarginBottom: 8,
    bylineFontSize,
    bylineLineHeight,
    bylineHeight: byline.height,
    bylineLineCount: byline.lineCount,
    bylineMarginBottom: 9,
    measureChromeHeight: STORY_MEASURE_CHROME_HEIGHT,
    jumpLineHeight: 16,
    jumpPaddingTop: 8,
    jumpBorderTopHeight: 1,
  };
}

function getHeadlineFontSize(config: LayoutConfig, lead: boolean): number {
  const pageWidth = config.contentWidth + (config.columnCount < 2 ? 36 : 60);
  if (config.columnCount === 1) return clamp(pageWidth * 0.11, 27.2, 48);
  if (lead) return clamp(pageWidth * 0.034, 24.8, 59.2);
  return clamp(pageWidth * 0.021, 20, 32.8);
}

function getStoryChromeHeight(chrome: StoryChromeMetrics): number {
  return (
    chrome.borderTopHeight +
    chrome.paddingTop +
    chrome.labelLineHeight +
    chrome.headlineMarginTop +
    chrome.headlineHeight +
    chrome.headlineMarginBottom +
    chrome.deckHeight +
    chrome.deckMarginBottom +
    chrome.bylineHeight +
    chrome.bylineMarginBottom +
    chrome.measureChromeHeight
  );
}

function getStoryJumpReserveHeight(chrome: StoryChromeMetrics): number {
  return chrome.jumpBorderTopHeight + chrome.jumpPaddingTop + chrome.jumpLineHeight;
}

function getContinuationTitleMetrics(
  config: LayoutConfig,
  article: ArticlePublicationItem,
  blockWidth: number,
): { headingHeight: number; lineCount: number; totalHeight: number } {
  const heading = measureWrappedTextBlock(
    article.headline,
    `${config.pageChrome.continuedTitleFontSize}px Georgia, "Times New Roman", serif`,
    Math.min(blockWidth, 980),
    config.pageChrome.continuedTitleLineHeight,
  );
  const headingHeight = Math.max(heading.height, config.pageChrome.continuedTitleLineHeight);
  const totalHeight = Math.ceil(config.pageChrome.continuedTitleChromeHeight + headingHeight);
  return { headingHeight, lineCount: heading.lineCount, totalHeight };
}

function measureWrappedTextBlock(
  text: string,
  font: string,
  maxWidth: number,
  lineHeight: number,
): { lineCount: number; height: number } {
  const prepared = prepareWithSegments(text, font);
  let cursor = { ...EMPTY_CURSOR };
  let lineCount = 0;
  while (lineCount < 20) {
    const line = layoutNextLine(prepared, cursor, maxWidth);
    if (!line) break;
    cursor = line.end;
    lineCount += 1;
  }
  return {
    lineCount,
    height: Math.ceil(lineCount * lineHeight),
  };
}

function getLeadImageWrap(article: ArticlePublicationItem, width: number, lineHeight: number): TextObstacle | null {
  if (width < 520) return null;
  const layout = article.image.layout;
  const preferredHeight = layout?.preferredHeight ?? lineHeight * 8;
  const minHeight = layout?.minHeight ?? lineHeight * 6;
  const maxHeight = layout?.maxHeight ?? lineHeight * 12;
  return {
    x: Math.round(width * 0.58),
    y: 0,
    width: Math.round(width * 0.42),
    height: clamp(Math.round(preferredHeight), minHeight, maxHeight),
  };
}

function leadImageToFurniture(article: ArticlePublicationItem, obstacle: TextObstacle): SolvedImageFurniture {
  const aspectRatio = getImageAspectRatio(article.image);
  return {
    kind: "image",
    id: `${article.slug}-lead-photo`,
    src: article.image.src,
    alt: article.image.alt,
    credit: article.image.credit,
    templateId: "lead-wrap",
    columnStart: 0,
    columnSpan: 1,
    x: obstacle.x,
    y: obstacle.y,
    width: obstacle.width,
    height: obstacle.height,
    aspectRatio,
    objectFit: "cover",
    objectPosition: "50% 50%",
    wrapsText: true,
    preferredHeight: obstacle.height,
  };
}

function getPrepared(
  cache: PreparedTextCache,
  article: ArticlePublicationItem,
  font: string,
): PreparedTextWithSegments {
  const key = `${article.slug}:${font}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const prepared = prepareWithSegments(getPublicationItemText(article), font);
  cache.set(key, prepared);
  return prepared;
}

function layoutTextLines({
  prepared,
  cursor,
  maxHeight,
  maxWidth,
  lineHeight,
  linePaintHeight,
  obstacles,
}: {
  prepared: PreparedTextWithSegments;
  cursor: LayoutCursor;
  maxHeight: number;
  maxWidth: number;
  lineHeight: number;
  linePaintHeight: number;
  obstacles: TextObstacle[];
}): { lines: TextLine[]; cursor: LayoutCursor; hasMore: boolean } {
  const lines: TextLine[] = [];
  let current = { ...cursor };
  const maxLines = getVisibleLineCapacity(maxHeight, lineHeight, linePaintHeight);

  for (let lineIndex = 0; lineIndex < maxLines; lineIndex += 1) {
    const y = lineIndex * lineHeight;
    const slot = getAvailableSlot(maxWidth, y, linePaintHeight, obstacles);
    if (!slot) continue;
    const line = layoutNextLine(prepared, current, slot.width);
    if (!line) return { lines, cursor: current, hasMore: false };
    lines.push(toTextLine(line, slot.x, y, lineHeight, linePaintHeight));
    current = line.end;
  }

  const nextSlot = getNextAvailableSlot(maxWidth, maxLines, lineHeight, linePaintHeight, obstacles) ?? { x: 0, width: maxWidth };
  return {
    lines,
    cursor: current,
    hasMore: layoutNextLine(prepared, current, nextSlot.width) !== null,
  };
}

function getVisibleLineCapacity(maxHeight: number, lineHeight: number, linePaintHeight: number): number {
  if (maxHeight < linePaintHeight) return 0;
  return Math.floor((maxHeight - linePaintHeight) / lineHeight) + 1;
}

function getLineLimitHeight(maxLines: number, lineHeight: number, linePaintHeight: number): number {
  if (maxLines <= 0) return 0;
  return (maxLines - 1) * lineHeight + linePaintHeight;
}

function getNextAvailableSlot(
  maxWidth: number,
  startLineIndex: number,
  lineHeight: number,
  linePaintHeight: number,
  obstacles: TextObstacle[],
): { x: number; width: number } | null {
  for (let offset = 0; offset < 24; offset += 1) {
    const slot = getAvailableSlot(maxWidth, (startLineIndex + offset) * lineHeight, linePaintHeight, obstacles);
    if (slot) return slot;
  }
  return null;
}

function getAvailableSlot(
  maxWidth: number,
  y: number,
  lineHeight: number,
  obstacles: TextObstacle[],
): { x: number; width: number } | null {
  if (obstacles.length === 0) return { x: 0, width: maxWidth };
  const bandTop = y;
  const bandBottom = y + lineHeight;
  const gutter = 14;
  const intervals = obstacles
    .filter((obstacle) => bandBottom > obstacle.y && bandTop < obstacle.y + obstacle.height)
    .map((obstacle) => ({
      start: clamp(obstacle.x - gutter, 0, maxWidth),
      end: clamp(obstacle.x + obstacle.width + gutter, 0, maxWidth),
    }))
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start);

  if (intervals.length === 0) return { x: 0, width: maxWidth };

  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }

  const gaps: Array<{ x: number; width: number }> = [];
  let cursorX = 0;
  for (const interval of merged) {
    if (interval.start > cursorX) {
      gaps.push({ x: cursorX, width: interval.start - cursorX });
    }
    cursorX = Math.max(cursorX, interval.end);
  }
  if (cursorX < maxWidth) {
    gaps.push({ x: cursorX, width: maxWidth - cursorX });
  }

  const slot = gaps.reduce<{ x: number; width: number } | null>(
    (best, gap) => (!best || gap.width > best.width ? gap : best),
    null,
  );
  return slot && slot.width >= 80 ? slot : null;
}

function toTextLine(line: LayoutLine, x: number, y: number, lineHeight: number, paintHeight: number): TextLine {
  return {
    text: line.text,
    width: line.width,
    x,
    y,
    lineHeight,
    paintHeight,
  };
}

function getColumnTextObstacles(furniture: SolvedFurniture[], columnIndex: number): TextObstacle[] {
  return furniture
    .filter((item) => item.wrapsText && columnIndex >= item.columnStart && columnIndex < item.columnStart + item.columnSpan)
    .map((item) => ({
      x: 0,
      y: item.y,
      width: Number.POSITIVE_INFINITY,
      height: item.height,
    }));
}

function getColumnWhitespace(columns: TextLine[][], textHeight: number, furniture: SolvedFurniture[]): number {
  return columns.reduce(
    (total, column, columnIndex) =>
      total + Math.max(0, textHeight - getLinesHeight(column) - getColumnObstacleHeight(furniture, columnIndex, textHeight)),
    0,
  );
}

function getColumnObstacleHeight(furniture: SolvedFurniture[], columnIndex: number, textHeight: number): number {
  const intervals = furniture
    .filter((item) => item.wrapsText && columnIndex >= item.columnStart && columnIndex < item.columnStart + item.columnSpan)
    .map((item) => ({
      start: clamp(item.y, 0, textHeight),
      end: clamp(item.y + item.height, 0, textHeight),
    }))
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged.reduce((total, interval) => total + interval.end - interval.start, 0);
}

function getDeadColumnCount(columns: TextLine[][], textHeight: number, furniture: SolvedFurniture[]): number {
  return columns.reduce((count, column, columnIndex) => {
    if (column.length > 0) return count;
    const obstacleHeight = getColumnObstacleHeight(furniture, columnIndex, textHeight);
    return obstacleHeight >= Math.min(96, textHeight * 0.18) ? count : count + 1;
  }, 0);
}

function getLinesHeight(lines: TextLine[]): number {
  return lines.length === 0 ? 0 : Math.max(...lines.map((line) => line.y + line.paintHeight));
}

function getFurnitureBottom(furniture: SolvedFurniture[]): number {
  return furniture.reduce((bottom, item) => Math.max(bottom, item.y + item.height), 0);
}

function getSpanCandidates(span: ResponsiveSpanPolicy, columnCount: number): number[] {
  const min = Math.min(span.min, columnCount);
  const max = Math.min(span.max, columnCount);
  const preferred = clamp(span.preferred, min, max);
  const candidates = [preferred, min, max];
  return Array.from(new Set(candidates)).sort((left, right) => (
    Math.abs(left - preferred) - Math.abs(right - preferred) || right - left
  ));
}

function resolveAnchor(anchor: ResponsivePlacementAnchor): "left" | "right" | "center" | "inline" {
  if (anchor === "outer") return "right";
  if (anchor === "inner") return "left";
  if (anchor === "inline") return "left";
  return anchor;
}

function getColumnStart(anchor: "left" | "right" | "center" | "inline", span: number, columnCount: number): number {
  if (anchor === "right") return Math.max(0, columnCount - span);
  if (anchor === "center") return Math.max(0, Math.floor((columnCount - span) / 2));
  return 0;
}

function getFurnitureY(
  verticalAnchor: ResponsiveVerticalPlacement,
  height: number,
  textHeight: number,
  config: LayoutConfig,
): number {
  if (verticalAnchor === "top") return 0;
  const minY = config.lineHeight * 2;
  const maxY = Math.max(0, textHeight - height);
  const ratio = getVerticalAnchorRatio(verticalAnchor);
  return clamp(Math.round(textHeight * ratio - height / 2), Math.min(minY, maxY), maxY);
}

function getVerticalAnchorRatio(verticalAnchor: ResponsiveVerticalPlacement): number {
  if (verticalAnchor === "top") return 0.12;
  if (verticalAnchor === "upperThird") return 0.32;
  if (verticalAnchor === "lowerThird") return 0.66;
  return 0.5;
}

function getPullQuoteMetrics(
  text: string,
  width: number,
  config: LayoutConfig,
): { height: number; fontSize: number; lineHeight: number } {
  const narrow = config.columnCount === 1;
  const fontSize = narrow ? 20 : 22;
  const lineHeight = Math.round(fontSize * 1.12);
  const charsPerLine = Math.max(12, Math.floor(width / (fontSize * 0.52)));
  const lineCount = Math.ceil(text.length / charsPerLine);
  const height = clamp(
    Math.ceil(lineCount * lineHeight + PULL_QUOTE_VERTICAL_PADDING),
    narrow ? 104 : 108,
    narrow ? 180 : 168,
  );
  return { height, fontSize, lineHeight };
}

function getPullQuoteY({
  x,
  width,
  height,
  textHeight,
  anchorRatio,
  image,
  config,
}: {
  x: number;
  width: number;
  height: number;
  textHeight: number;
  anchorRatio: number;
  image: SolvedImageFurniture | null;
  config: LayoutConfig;
}): number | null {
  const minY = config.lineHeight * 2;
  const maxY = textHeight - height;
  if (maxY < minY) return null;
  const preferredY = clamp(Math.round(textHeight * anchorRatio - height / 2), minY, maxY);
  const preferredRect = { x, y: preferredY, width, height };
  if (!image || !rectsOverlap(preferredRect, image, FURNITURE_COLLISION_GUTTER)) return preferredY;
  const candidateYs = [
    image.y + image.height + FURNITURE_COLLISION_GUTTER,
    image.y - height - FURNITURE_COLLISION_GUTTER,
  ]
    .filter((candidateY) => candidateY >= minY && candidateY <= maxY)
    .sort((a, b) => Math.abs(a - preferredY) - Math.abs(b - preferredY));
  return candidateYs.find((candidateY) => !rectsOverlap({ x, y: candidateY, width, height }, image, FURNITURE_COLLISION_GUTTER)) ?? null;
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  gutter = 0,
): boolean {
  return (
    a.x < b.x + b.width + gutter &&
    a.x + a.width + gutter > b.x &&
    a.y < b.y + b.height + gutter &&
    a.y + a.height + gutter > b.y
  );
}

function getImageAspectRatio(asset: Pick<ArticleImageAsset, "layout">): number {
  return asset.layout?.aspectRatio ?? 1.5;
}

function formatContinuationJumpLabel(article: ArticlePublicationItem, pageNumber: number): string {
  return `SEE ${getShortSlug(article) ?? "MORE"} ON ${formatSectionPage(pageNumber)}`;
}

function formatContinuationSourceLabel(article: ArticlePublicationItem, sourcePageNumber: number): string {
  const shortSlug = getShortSlug(article);
  const source = `FROM ${formatSectionPage(sourcePageNumber)}`;
  return shortSlug ? `${shortSlug} ${source}` : source;
}

function getShortSlug(article: ArticlePublicationItem): string | null {
  const shortSlug = article.shortSlug?.trim().toUpperCase();
  return shortSlug || null;
}

function formatSectionPage(pageNumber: number): string {
  return `A${pageNumber}`;
}

function formatByline(article: ArticlePublicationItem): string {
  return `${article.byline} / ${article.dateline}`.toUpperCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
