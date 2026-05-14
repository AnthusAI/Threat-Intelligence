import {
  layoutNextLine,
  prepareWithSegments,
  type LayoutCursor,
  type LayoutLine,
  type PreparedTextWithSegments,
} from "@chenglou/pretext";
import { type Article, type ArticleImageAsset, getArticleImageAssets, getArticleText } from "./articles";
import {
  createDefaultEditionLayoutPlan,
  type EditionLayoutPlan,
  type MediaPlacementTemplateId,
  type PullQuoteTemplateId,
  validateEditionLayoutPlanForArticles,
} from "./layout-plan";

export type { MediaPlacementTemplateId, PullQuoteTemplateId } from "./layout-plan";

export type TextLine = {
  text: string;
  width: number;
  x: number;
  y: number;
  lineHeight: number;
  paintHeight: number;
};

export type FrontBlock = {
  blockId: string;
  article: Article;
  pageNumber: number | null;
  span: number;
  slotHeight: number;
  rowHeight: number;
  bodySlotHeight: number;
  chromeHeight: number;
  jumpReserveHeight: number;
  chrome: StoryChromeMetrics;
  lines: TextLine[];
  imageWrap: ImageWrap | null;
  hasMore: boolean;
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

export type ContinuationPage = {
  id: string;
  recipeId: string;
  pageNumber: number;
  kind: PlannedPage["kind"];
  height: number;
  sections: ContinuationSection[];
  hasMore: boolean;
};

export type ContinuationSection = {
  id: string;
  article: Article;
  blockId: string;
  textHeight: number;
  titleHeight: number;
  titleLineCount: number;
  columns: TextLine[][];
  furniture: ContinuationFurniture[];
  image: ContinuationImage | null;
  pullQuote: ContinuationPullQuote | null;
  textRange: PlacedTextRange;
  hasMore: boolean;
};

export type ContinuationFurniture = ContinuationImage | ContinuationPullQuote;

export type ContinuationImage = {
  kind: "image";
  id: string;
  src: string;
  alt: string;
  credit: string;
  templateId: MediaPlacementTemplateId;
  columnStartStrategy: MediaColumnStartStrategy;
  columnStart: number;
  columnSpan: number;
  verticalAnchor: "top";
  aspectRatio: number;
  aspectRatioPolicy: "preserve" | "cropAllowed";
  objectFit: "contain" | "cover";
  objectPosition: string;
  x: number;
  y: number;
  width: number;
  height: number;
  layoutHeight: number;
  wrapsText: boolean;
  preferredHeight: number;
};

export type ContinuationPullQuote = {
  kind: "pullQuote";
  id: string;
  text: string;
  templateId: PullQuoteTemplateId;
  columnStartStrategy: MediaColumnStartStrategy;
  columnStart: number;
  columnSpan: number;
  x: number;
  y: number;
  width: number;
  height: number;
  wrapsText: boolean;
  fontSize: number;
  lineHeight: number;
  fallbackPenalty: number;
};

export type NewspaperLayout = {
  columnCount: number;
  contentWidth: number;
  gap: number;
  pageHeight: number;
  frontPageHeight: number;
  pageHeights: Record<number, number>;
  pageChrome: PageChromeMetrics;
  recipes: PageRecipe[];
  pages: PlacedPage[];
  textRanges: PlacedTextRange[];
  frontBlocks: FrontBlock[];
  continuationPages: ContinuationPage[];
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

export type ImageWrap = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TextObstacle = ImageWrap;

export type PlacedTextRange = {
  articleId: string;
  pageId: string;
  blockId: string;
  startCursor: LayoutCursor;
  endCursor: LayoutCursor;
  exhausted: boolean;
};

export type ArticleFlow = {
  article: Article;
  currentCursor: LayoutCursor;
  placedRanges: PlacedTextRange[];
};

export type PageRecipe = {
  id: string;
  name: string;
  kind: "front" | "continuation" | "section";
  blocks: LayoutBlock[];
};

export type EditionPlan = {
  frontPage: {
    pageNumber: 1;
    recipeId: string;
    templateId: "front.teaserGrid";
    articleIds: string[];
    cutPolicies: FrontCutPolicy[];
  };
  pages: PlannedPage[];
};

export type PlannedPage = {
  pageNumber: number;
  recipeId: string;
  kind: "singleContinuation" | "dualContinuation" | "photoContinuation";
  sections: PlannedContinuationSection[];
  splitVariants?: number[];
};

export type PlannedContinuationSection = {
  articleId: string;
  role: "primary" | "top" | "bottom";
  mediaTemplateIds?: MediaPlacementTemplateId[];
  pullQuoteTemplateIds?: PullQuoteTemplateId[];
};

export type FrontCutPolicy = {
  articleId: string;
  maxLines: number;
  continuationPageNumber: number;
};

export type LayoutBlock =
  | TeaserGridBlock
  | ContinuedArticleBlock
  | ImageWrapArticleBlock
  | TailStackBlock
  | PhotoFeatureBlock
  | PullQuoteBlock;

export type TeaserGridBlock = {
  id: string;
  kind: "teaserGrid";
  articleIds: string[];
};

export type ContinuedArticleBlock = {
  id: string;
  kind: "continuedArticle";
  articleId: string;
};

export type ImageWrapArticleBlock = {
  id: string;
  kind: "imageWrapArticle";
  articleId: string;
  image: ElasticImageSpec;
};

export type TailStackBlock = {
  id: string;
  kind: "tailStack";
  articleIds: string[];
};

export type PhotoFeatureBlock = {
  id: string;
  kind: "photoFeature";
  articleId: string;
  image: ElasticImageSpec;
};

export type PullQuoteBlock = {
  id: string;
  kind: "pullQuote";
  articleId: string;
  quote: string;
};

export type ElasticImageSpec = {
  minHeight: number;
  preferredHeight: number;
  maxHeight: number;
  crop: "cover" | "contain";
  wrapsText: boolean;
};

export type BlockResult = {
  blockId: string;
  kind: LayoutBlock["kind"];
  usedHeight: number;
  score: number;
  textRanges: PlacedTextRange[];
};

export type PlacedPage = {
  id: string;
  pageNumber: number;
  recipeId: string;
  height: number;
  blocks: BlockResult[];
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

const EMPTY_CURSOR: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };

const ARTICLE_SPANS = [2, 1, 1, 2, 1, 1];
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
const STORY_CHROME_TOKENS = {
  storyPaddingTop: 10,
  labelFontSize: 11.52,
  labelLineHeight: 14,
  headlineMarginTop: 5,
  headlineMarginBottom: 8,
  deckFontSize: 16,
  deckLineHeight: 20,
  deckMarginBottom: 8,
  bylineFontSize: 11.2,
  bylineLineHeight: 14,
  bylineMarginBottom: 9,
  jumpLineHeight: 14,
  jumpPaddingTop: 8,
  jumpBorderTopHeight: 1,
} as const;

type PreparedTextCache = Map<string, PreparedTextWithSegments>;

type InternalBlockResult = BlockResult & {
  frontBlocks?: FrontBlock[];
  continuationPage?: ContinuationPage;
  hasMore?: boolean;
};

type PlannedContinuationResult = {
  page: ContinuationPage;
  blocks: BlockResult[];
  textRanges: PlacedTextRange[];
};

type ContinuationSectionCandidate = {
  section: ContinuationSection;
  blockResult: BlockResult;
  whitespace: number;
  allocatedHeight?: number;
};

export type MediaColumnStartStrategy = "left" | "right" | "center" | "explicit";

type MediaTemplateContext = {
  mode: "single" | "shared";
  role: PlannedContinuationSection["role"];
};

type PhotoContinuationVariant = {
  id: string;
  templateId: MediaPlacementTemplateId | "noImage";
  columnStartStrategy: MediaColumnStartStrategy;
  columnSpan: number;
  aspectRatioPolicy: "preserve" | "cropAllowed";
  wrapsText: boolean;
  fallbackPenalty: number;
};

type PullQuotePlacementVariant = {
  id: string;
  templateId: PullQuoteTemplateId;
  columnStartStrategy: MediaColumnStartStrategy;
  columnSpan: number;
  anchorRatio: number;
  fallbackPenalty: number;
};

type FurnitureRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function buildNewspaperLayout(
  articles: Article[],
  pageWidth: number,
  viewportHeight: number,
  layoutPlan?: EditionLayoutPlan,
): NewspaperLayout {
  const config = getLayoutConfig(pageWidth, viewportHeight);
  const editionPlan = createEditionPlan(articles, layoutPlan);
  const prepared: PreparedTextCache = new Map();
  const flows = createArticleFlows(articles);
  const recipes: PageRecipe[] = [];
  const pages: PlacedPage[] = [];
  const textRanges: PlacedTextRange[] = [];
  const frontRecipe = createFrontPageRecipe(editionPlan);
  recipes.push(frontRecipe);

  const frontResult = solveTeaserGridBlock(
    frontRecipe.blocks[0] as TeaserGridBlock,
    flows,
    prepared,
    config,
    editionPlan.frontPage.pageNumber,
    editionPlan.frontPage.cutPolicies,
  );
  const frontBlocks = frontResult.frontBlocks ?? [];
  const frontPageHeight = getFrontPageHeight(config);
  pages.push({
    id: "page-1",
    pageNumber: 1,
    recipeId: frontRecipe.id,
    height: frontPageHeight,
    blocks: [frontResult],
  });
  textRanges.push(...frontResult.textRanges);

  const continuationPages: ContinuationPage[] = [];
  for (const plannedPage of editionPlan.pages) {
    const recipe = createPlannedContinuationPageRecipe(plannedPage, articles);
    recipes.push(recipe);
    const result = solvePlannedContinuationPage(plannedPage, flows, prepared, config);
    continuationPages.push(result.page);
    pages.push({
      id: result.page.id,
      pageNumber: result.page.pageNumber,
      recipeId: recipe.id,
      height: result.page.height,
      blocks: result.blocks,
    });
    textRanges.push(...result.textRanges);
  }

  const pageHeights: Record<number, number> = {};
  for (const page of pages) {
    pageHeights[page.pageNumber] = page.height;
  }
  const maxPageHeight = Math.max(...pages.map((page) => page.height), frontPageHeight);

  return {
    columnCount: config.columnCount,
    contentWidth: config.contentWidth,
    gap: config.gap,
    pageHeight: maxPageHeight,
    frontPageHeight,
    pageHeights,
    pageChrome: config.pageChrome,
    recipes,
    pages,
    textRanges,
    frontBlocks,
    continuationPages,
  };
}

function createArticleFlows(articles: Article[]): Map<string, ArticleFlow> {
  return new Map(
    articles.map((article) => [
      article.slug,
      {
        article,
        currentCursor: { ...EMPTY_CURSOR },
        placedRanges: [],
      },
    ]),
  );
}

function createFrontPageRecipe(editionPlan: EditionPlan): PageRecipe {
  return {
    id: editionPlan.frontPage.recipeId,
    name: "Front Page Teaser Grid",
    kind: "front",
    blocks: [
      {
        id: "front-teaser-grid",
        kind: "teaserGrid",
        articleIds: editionPlan.frontPage.articleIds,
      },
    ],
  };
}

function createEditionPlan(articles: Article[], layoutPlan?: EditionLayoutPlan): EditionPlan {
  const articleIds = articles.map((article) => article.slug);
  const normalizedLayoutPlan = layoutPlan
    ? validateEditionLayoutPlanForArticles(layoutPlan, articleIds)
    : createDefaultEditionLayoutPlan(articleIds);
  return {
    frontPage: {
      pageNumber: normalizedLayoutPlan.frontPage.pageNumber,
      recipeId: normalizedLayoutPlan.frontPage.recipeId,
      templateId: normalizedLayoutPlan.frontPage.templateId,
      articleIds: normalizedLayoutPlan.frontPage.articleIds,
      cutPolicies: normalizedLayoutPlan.frontPage.cutPolicies.map((policy) => ({
        articleId: policy.articleId,
        maxLines: policy.maxBodyLines,
        continuationPageNumber: policy.continuationPageNumber,
      })),
    },
    pages: normalizedLayoutPlan.pages.map((page) => ({
      pageNumber: page.pageNumber,
      recipeId: page.recipeId,
      kind: page.kind,
      sections: page.sections.map((section) => ({
        articleId: section.articleId,
        role: section.role,
        mediaTemplateIds: section.mediaTemplateIds,
        pullQuoteTemplateIds: section.pullQuoteTemplateIds,
      })),
      splitVariants: page.splitVariants,
    })),
  };
}

function createPlannedContinuationPageRecipe(plannedPage: PlannedPage, articles: Article[]): PageRecipe {
  const articlesById = new Map(articles.map((article) => [article.slug, article]));
  const names = plannedPage.sections
    .map((section) => articlesById.get(section.articleId)?.headline ?? section.articleId)
    .join(" / ");

  return {
    id: plannedPage.recipeId,
    name: `Planned Continuation: ${names}`,
    kind: "continuation",
    blocks: plannedPage.sections.map((section) => ({
        id: `continued-${section.articleId}-page-${plannedPage.pageNumber}`,
        kind: "continuedArticle",
        articleId: section.articleId,
      })),
  };
}

function solveTeaserGridBlock(
  block: TeaserGridBlock,
  flows: Map<string, ArticleFlow>,
  prepared: PreparedTextCache,
  config: LayoutConfig,
  pageNumber: number,
  cutPolicies: FrontCutPolicy[],
): InternalBlockResult {
  const frontBlocks: FrontBlock[] = [];
  const textRanges: PlacedTextRange[] = [];
  const cutPoliciesByArticleId = new Map(cutPolicies.map((policy) => [policy.articleId, policy]));
  let whitespace = 0;

  for (let articleIndex = 0; articleIndex < block.articleIds.length; articleIndex += 1) {
    const articleId = block.articleIds[articleIndex];
    const flow = getRequiredFlow(flows, articleId);
    const span = Math.min(ARTICLE_SPANS[articleIndex] ?? 1, config.columnCount);
    const blockWidth = getSpanWidth(config, span);
    const preparedText = getPrepared(prepared, flow.article, config.frontBodyFont);
    const imageWrap = articleIndex === 0 ? getLeadImageWrap(flow.article, blockWidth, config.lineHeight) : null;
    const rowHeight = getFrontRowHeight(config, articleIndex);
    const chrome = getStoryChromeMetrics(config, flow.article, articleIndex, blockWidth);
    const chromeHeight = getStoryChromeHeight(chrome);
    const jumpReserveHeight = getStoryJumpReserveHeight(chrome);
    const bodySlotHeight = Math.max(0, rowHeight - chromeHeight - jumpReserveHeight);
    const cutPolicy = cutPoliciesByArticleId.get(flow.article.slug);
    const maxHeight = cutPolicy
      ? Math.min(bodySlotHeight, getLineLimitHeight(cutPolicy.maxLines, config.lineHeight, config.linePaintHeight))
      : bodySlotHeight;
    const startCursor = { ...flow.currentCursor };
    const preview = layoutTextLines({
      prepared: preparedText,
      cursor: startCursor,
      maxHeight,
      maxWidth: blockWidth,
      lineHeight: config.lineHeight,
      linePaintHeight: config.linePaintHeight,
      obstacles: imageWrap ? [imageWrap] : [],
    });
    const range = placeTextRange({
      flow,
      pageId: pageIdFor(pageNumber),
      blockId: `${block.id}-${flow.article.slug}`,
      startCursor,
      endCursor: preview.cursor,
      exhausted: !preview.hasMore,
    });
    textRanges.push(range);
    whitespace += getRemainingTextSpace(bodySlotHeight, preview.lines);

    frontBlocks.push({
      blockId: range.blockId,
      article: flow.article,
      pageNumber: preview.hasMore && cutPolicy ? cutPolicy.continuationPageNumber : null,
      span,
      slotHeight: bodySlotHeight,
      rowHeight,
      bodySlotHeight,
      chromeHeight,
      jumpReserveHeight,
      chrome,
      lines: preview.lines,
      imageWrap,
      hasMore: preview.hasMore,
    });
  }

  return {
    blockId: block.id,
    kind: block.kind,
    usedHeight: Math.max(...frontBlocks.map((frontBlock) => frontBlock.rowHeight), 0),
    score: scoreWhitespace(whitespace),
    textRanges,
    frontBlocks,
  };
}

function solvePlannedContinuationPage(
  plannedPage: PlannedPage,
  flows: Map<string, ArticleFlow>,
  prepared: PreparedTextCache,
  config: LayoutConfig,
): PlannedContinuationResult {
  const result = (() => {
    if (plannedPage.kind === "dualContinuation") {
      return solveDualContinuationPage(plannedPage, flows, prepared, config);
    }
    if (plannedPage.kind === "photoContinuation") {
      return solvePhotoContinuationPage(plannedPage, flows, prepared, config);
    }
    return solveSingleContinuationPage(plannedPage, flows, prepared, config);
  })();

  for (const section of result.page.sections) {
    commitTextRange(getRequiredFlow(flows, section.article.slug), section.textRange);
  }

  return result;
}

function solveSingleContinuationPage(
  plannedPage: PlannedPage,
  flows: Map<string, ArticleFlow>,
  prepared: PreparedTextCache,
  config: LayoutConfig,
): PlannedContinuationResult {
  const plannedSection = plannedPage.sections[0];
  const candidate = solveContinuationSectionCandidate({
    plannedPage,
    plannedSection,
    flows,
    prepared,
    config,
    textHeight: config.continuationHeight,
    shrinkToContent: true,
  });
  const page = createContinuationPage(plannedPage, [candidate.section], config);

  return {
    page,
    blocks: [candidate.blockResult],
    textRanges: [candidate.section.textRange],
  };
}

function solvePhotoContinuationPage(
  plannedPage: PlannedPage,
  flows: Map<string, ArticleFlow>,
  prepared: PreparedTextCache,
  config: LayoutConfig,
): PlannedContinuationResult {
  const plannedSection = plannedPage.sections[0];
  const flow = getRequiredFlow(flows, plannedSection.articleId);
  const asset = getPreferredContinuationImage(flow.article);
  const variants = getPhotoContinuationVariants(asset, config, { mode: "single", role: plannedSection.role }, plannedSection);
  const pullQuoteVariants = getPullQuoteVariants(flow.article, config, { mode: "single", role: plannedSection.role }, plannedSection);
  let bestResult: PlannedContinuationResult | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const variant of variants) {
    const image = asset ? createContinuationImage(asset, variant, config) : null;
    const maxTextHeight = Math.max(
      config.linePaintHeight,
      config.continuationHeight - getContinuationImageLayoutHeight(image),
    );
    for (const textHeight of getPhotoContinuationTextHeightVariants(maxTextHeight, image, config)) {
      for (const pullQuoteVariant of pullQuoteVariants) {
        const pullQuote = createContinuationPullQuote(flow.article, pullQuoteVariant, config, textHeight, image);
        if (pullQuoteVariant.templateId !== "none" && !pullQuote) continue;

        const candidate = solveContinuationSectionCandidate({
          plannedPage,
          plannedSection,
          flows,
          prepared,
          config,
          textHeight,
          shrinkToContent: true,
          image,
          pullQuote,
        });
        const page = createContinuationPage(plannedPage, [candidate.section], config);
        const score = scorePhotoContinuationVariant({
          config,
          candidate,
          page,
          image,
          variant,
        });

        if (score > bestScore) {
          bestResult = {
            page,
            blocks: [
              {
                ...candidate.blockResult,
                kind: image ? "photoFeature" : "continuedArticle",
                score,
              },
            ],
            textRanges: [candidate.section.textRange],
          };
          bestScore = score;
        }
      }
    }
  }

  if (!bestResult) throw new Error(`No photo continuation variant solved for page ${plannedPage.pageNumber}`);
  return bestResult;
}

function solveDualContinuationPage(
  plannedPage: PlannedPage,
  flows: Map<string, ArticleFlow>,
  prepared: PreparedTextCache,
  config: LayoutConfig,
): PlannedContinuationResult {
  const splitVariants = plannedPage.splitVariants ?? [0.5];
  let bestResult: PlannedContinuationResult | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const split of splitVariants) {
    const firstHeight = Math.floor(config.continuationHeight * split);
    const secondHeight = config.continuationHeight - firstHeight;
    const candidates = plannedPage.sections.map((plannedSection, sectionIndex) => (
      solveDualContinuationSectionCandidate({
        plannedPage,
        plannedSection,
        flows,
        prepared,
        config,
        allocatedHeight: sectionIndex === 0 ? firstHeight : secondHeight,
      })
    ));
    const whitespace = candidates.reduce((total, candidate) => total + candidate.whitespace, 0);
    const allocationWhitespace = candidates.reduce((total, candidate) => (
      total + Math.max(0, (candidate.allocatedHeight ?? 0) - candidate.section.textHeight - getContinuationImageLayoutHeight(candidate.section.image))
    ), 0);
    const imbalance = candidates.length === 2
      ? Math.abs(candidates[0].section.textHeight - candidates[1].section.textHeight)
      : 0;
    const imageBonus = candidates.reduce((total, candidate) => total + (candidate.section.image ? 650 : 0), 0);
    const score = 20_000 + imageBonus - whitespace - allocationWhitespace * 1.4 - imbalance * 0.2;

    if (score > bestScore) {
      const page = createContinuationPage(plannedPage, candidates.map((candidate) => candidate.section), config);
      bestResult = {
        page,
        blocks: candidates.map((candidate) => candidate.blockResult),
        textRanges: candidates.map((candidate) => candidate.section.textRange),
      };
      bestScore = score;
    }
  }

  if (!bestResult) throw new Error(`No continuation variant solved for page ${plannedPage.pageNumber}`);
  return bestResult;
}

function solveDualContinuationSectionCandidate({
  plannedPage,
  plannedSection,
  flows,
  prepared,
  config,
  allocatedHeight,
}: {
  plannedPage: PlannedPage;
  plannedSection: PlannedContinuationSection;
  flows: Map<string, ArticleFlow>;
  prepared: PreparedTextCache;
  config: LayoutConfig;
  allocatedHeight: number;
}): ContinuationSectionCandidate {
  const flow = getRequiredFlow(flows, plannedSection.articleId);
  const asset = getPreferredContinuationImage(flow.article);
  const variants = getPhotoContinuationVariants(asset, config, { mode: "shared", role: plannedSection.role }, plannedSection);
  const pullQuoteVariants = getPullQuoteVariants(flow.article, config, { mode: "shared", role: plannedSection.role }, plannedSection);
  let bestCandidate: ContinuationSectionCandidate | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const variant of variants) {
    const image = asset ? createContinuationImage(asset, variant, config) : null;
    const maxTextHeight = Math.max(
      config.linePaintHeight,
      allocatedHeight - getContinuationImageLayoutHeight(image),
    );

    for (const textHeight of getPhotoContinuationTextHeightVariants(maxTextHeight, image, config)) {
      for (const pullQuoteVariant of pullQuoteVariants) {
        const pullQuote = createContinuationPullQuote(flow.article, pullQuoteVariant, config, textHeight, image);
        if (pullQuoteVariant.templateId !== "none" && !pullQuote) continue;

        const candidate = solveContinuationSectionCandidate({
          plannedPage,
          plannedSection,
          flows,
          prepared,
          config,
          textHeight,
          shrinkToContent: true,
          image,
          pullQuote,
        });
        const score = scoreDualContinuationSectionCandidate({
          allocatedHeight,
          candidate,
          image,
          variant,
        });

        if (score > bestScore) {
          bestCandidate = {
            ...candidate,
            allocatedHeight,
            blockResult: {
              ...candidate.blockResult,
              kind: image ? "photoFeature" : "continuedArticle",
              score,
            },
          };
          bestScore = score;
        }
      }
    }
  }

  if (!bestCandidate) {
    throw new Error(`No dual continuation section solved for ${plannedSection.articleId}`);
  }

  return bestCandidate;
}

function solveContinuationSectionCandidate({
  plannedPage,
  plannedSection,
  flows,
  prepared,
  config,
  textHeight,
  shrinkToContent,
  image = null,
  pullQuote = null,
}: {
  plannedPage: PlannedPage;
  plannedSection: PlannedContinuationSection;
  flows: Map<string, ArticleFlow>;
  prepared: PreparedTextCache;
  config: LayoutConfig;
  textHeight: number;
  shrinkToContent: boolean;
  image?: ContinuationImage | null;
  pullQuote?: ContinuationPullQuote | null;
}): ContinuationSectionCandidate {
  const flow = getRequiredFlow(flows, plannedSection.articleId);
  const preparedText = getPrepared(prepared, flow.article, config.continuationBodyFont);
  const columnWidth = getSpanWidth(config, 1);
  const furniture = getContinuationFurniture(image, pullQuote);
  const columns: TextLine[][] = [];
  const startCursor = { ...flow.currentCursor };
  let cursor = startCursor;
  let hasMore = true;

  for (let columnIndex = 0; columnIndex < config.columnCount; columnIndex += 1) {
    const result = layoutTextLines({
      prepared: preparedText,
      cursor,
      maxHeight: textHeight,
      maxWidth: columnWidth,
      lineHeight: config.lineHeight,
      linePaintHeight: config.linePaintHeight,
      obstacles: getColumnTextObstacles(furniture, columnIndex),
    });
    columns.push(result.lines);
    cursor = result.cursor;
    hasMore = result.hasMore;
    if (!hasMore) {
      while (columns.length < config.columnCount) {
        columns.push([]);
      }
      break;
    }
  }

  const range = createTextRange({
    flow,
    pageId: pageIdFor(plannedPage.pageNumber),
    blockId: continuationBlockId(plannedPage, plannedSection),
    startCursor,
    endCursor: cursor,
    exhausted: !hasMore,
  });
  const linesHeight = Math.max(...columns.map(getLinesHeight), 0);
  const minimumBodyHeight = getContinuationFurnitureBottom(furniture);
  const resolvedTextHeightWithFurniture = Math.max(
    minimumBodyHeight,
    shrinkToContent && !hasMore ? linesHeight : textHeight,
  );
  const title = getContinuationTitleMetrics(config, flow.article);
  const section: ContinuationSection = {
    id: `${pageIdFor(plannedPage.pageNumber)}-${flow.article.slug}`,
    article: flow.article,
    blockId: range.blockId,
    textHeight: resolvedTextHeightWithFurniture,
    titleHeight: title.height,
    titleLineCount: title.lineCount,
    furniture,
    image,
    pullQuote,
    textRange: range,
    columns,
    hasMore,
  };
  const whitespace = getSectionColumnWhitespace(section);

  return {
    section,
    blockResult: {
      blockId: range.blockId,
      kind: "continuedArticle",
      usedHeight: resolvedTextHeightWithFurniture + getContinuationImageLayoutHeight(image),
      score: scoreWhitespace(whitespace),
      textRanges: [range],
    },
    whitespace,
  };
}

function createContinuationPage(
  plannedPage: PlannedPage,
  sections: ContinuationSection[],
  config: LayoutConfig,
): ContinuationPage {
  return {
    id: pageIdFor(plannedPage.pageNumber),
    recipeId: plannedPage.recipeId,
    pageNumber: plannedPage.pageNumber,
    kind: plannedPage.kind,
    height: getContinuationPageHeight(config, sections),
    sections,
    hasMore: sections.some((section) => section.hasMore),
  };
}

function getPreferredContinuationImage(article: Article): ArticleImageAsset | null {
  const assets = getArticleImageAssets(article);
  return (
    assets.find((asset) => asset.roles?.includes("continuationInset")) ??
    assets.find((asset) => asset.roles?.includes("continuation")) ??
    assets[0] ??
    null
  );
}

function getPhotoContinuationVariants(
  asset: ArticleImageAsset | null,
  config: LayoutConfig,
  context: MediaTemplateContext,
  plannedSection: PlannedContinuationSection,
): PhotoContinuationVariant[] {
  const variants: PhotoContinuationVariant[] = [];
  if (asset) {
    variants.push(...getInsetTemplateVariants(config, context));
    variants.push({
      id: "wideTopBand",
      templateId: "wideTopBand",
      columnStartStrategy: "left",
      columnSpan: config.columnCount,
      aspectRatioPolicy: "cropAllowed",
      wrapsText: true,
      fallbackPenalty: 1_200,
    });
  }

  return [
    ...applyMediaTemplatePreferences(variants, plannedSection.mediaTemplateIds),
    {
      id: "noImage",
      templateId: "noImage",
      columnStartStrategy: "left",
      columnSpan: 0,
      aspectRatioPolicy: "preserve",
      wrapsText: false,
      fallbackPenalty: 2_400,
    },
  ];
}

function getInsetTemplateVariants(config: LayoutConfig, context: MediaTemplateContext): PhotoContinuationVariant[] {
  if (config.columnCount === 1) {
    return [
      {
        id: "inlineInset",
        templateId: "leftColumnInset",
        columnStartStrategy: "left",
        columnSpan: 1,
        aspectRatioPolicy: "preserve",
        wrapsText: true,
        fallbackPenalty: 0,
      },
    ];
  }

  if (context.mode === "single") {
    return [
      ...(config.columnCount >= 4
        ? [
            {
              id: "centerTwoColumnInset",
              templateId: "centerTwoColumnInset" as const,
              columnStartStrategy: "center" as const,
              columnSpan: 2,
              aspectRatioPolicy: "preserve" as const,
              wrapsText: true,
              fallbackPenalty: 0,
            },
          ]
        : []),
      {
        id: "rightColumnInset",
        templateId: "rightColumnInset",
        columnStartStrategy: "right",
        columnSpan: 1,
        aspectRatioPolicy: "preserve",
        wrapsText: true,
        fallbackPenalty: 160,
      },
      {
        id: "leftColumnInset",
        templateId: "leftColumnInset",
        columnStartStrategy: "left",
        columnSpan: 1,
        aspectRatioPolicy: "preserve",
        wrapsText: true,
        fallbackPenalty: 260,
      },
    ];
  }

  const primaryTemplate = context.role === "bottom" ? "leftColumnInset" : "rightColumnInset";
  const secondaryTemplate = context.role === "bottom" ? "rightColumnInset" : "leftColumnInset";
  return [
    ...(context.role === "top" && config.columnCount >= 4
      ? [
          {
            id: "rightTwoColumnInset",
            templateId: "rightTwoColumnInset" as const,
            columnStartStrategy: "right" as const,
            columnSpan: 2,
            aspectRatioPolicy: "preserve" as const,
            wrapsText: true,
            fallbackPenalty: 0,
          },
        ]
      : []),
    {
      id: primaryTemplate,
      templateId: primaryTemplate,
      columnStartStrategy: context.role === "bottom" ? "left" : "right",
      columnSpan: 1,
      aspectRatioPolicy: "preserve",
      wrapsText: true,
      fallbackPenalty: context.role === "top" && config.columnCount >= 4 ? 260 : 0,
    },
    {
      id: secondaryTemplate,
      templateId: secondaryTemplate,
      columnStartStrategy: context.role === "bottom" ? "right" : "left",
      columnSpan: 1,
      aspectRatioPolicy: "preserve",
      wrapsText: true,
      fallbackPenalty: 180,
    },
    ...(config.columnCount >= 4
      ? [
          {
            id: "centerTwoColumnInset",
            templateId: "centerTwoColumnInset" as const,
            columnStartStrategy: "center" as const,
            columnSpan: 2,
            aspectRatioPolicy: "preserve" as const,
            wrapsText: true,
            fallbackPenalty: 520,
          },
        ]
      : []),
  ];
}

function applyMediaTemplatePreferences(
  variants: PhotoContinuationVariant[],
  preferredTemplateIds: MediaPlacementTemplateId[] | undefined,
): PhotoContinuationVariant[] {
  if (!preferredTemplateIds?.length) return variants;
  const preferenceOrder = new Map(preferredTemplateIds.map((templateId, index) => [templateId, index]));

  return variants
    .map((variant, originalIndex) => ({
      variant,
      originalIndex,
      preferenceIndex: preferenceOrder.get(variant.templateId as MediaPlacementTemplateId),
    }))
    .sort((left, right) => (
      (left.preferenceIndex ?? Number.MAX_SAFE_INTEGER) - (right.preferenceIndex ?? Number.MAX_SAFE_INTEGER) ||
      left.originalIndex - right.originalIndex
    ))
    .map(({ variant, preferenceIndex }) => ({
      ...variant,
      fallbackPenalty: preferenceIndex === undefined ? variant.fallbackPenalty + 900 : preferenceIndex * 90,
    }));
}

function getPullQuoteVariants(
  article: Article,
  config: LayoutConfig,
  context: MediaTemplateContext,
  plannedSection: PlannedContinuationSection,
): PullQuotePlacementVariant[] {
  const none = getNoPullQuoteVariant();
  if (!article.pullQuotes?.[0]) return [none];

  if (config.columnCount === 1) {
    return applyPullQuoteTemplatePreferences([
      none,
      {
        id: "inlineMobileBreak",
        templateId: "inlineMobileBreak",
        columnStartStrategy: "left",
        columnSpan: 1,
        anchorRatio: 0.38,
        fallbackPenalty: 80,
      },
    ], plannedSection.pullQuoteTemplateIds);
  }

  const leftRail: PullQuotePlacementVariant = {
    id: "leftRailMid",
    templateId: "leftRailMid",
    columnStartStrategy: "left",
    columnSpan: 1,
    anchorRatio: 0.48,
    fallbackPenalty: context.mode === "shared" && context.role === "top" ? 0 : 120,
  };
  const rightRail: PullQuotePlacementVariant = {
    id: "rightRailMid",
    templateId: "rightRailMid",
    columnStartStrategy: "right",
    columnSpan: 1,
    anchorRatio: 0.48,
    fallbackPenalty: context.mode === "shared" && context.role === "bottom" ? 0 : 120,
  };
  const centerBreak: PullQuotePlacementVariant = {
    id: "centerTwoColumnBreak",
    templateId: "centerTwoColumnBreak",
    columnStartStrategy: "center",
    columnSpan: 2,
    anchorRatio: 0.5,
    fallbackPenalty: context.mode === "single" ? 40 : 220,
  };

  if (context.mode === "single") {
    return applyPullQuoteTemplatePreferences([
      none,
      ...(config.columnCount >= 4 ? [centerBreak] : []),
      rightRail,
      leftRail,
    ], plannedSection.pullQuoteTemplateIds);
  }

  return applyPullQuoteTemplatePreferences([
    none,
    context.role === "bottom" ? rightRail : leftRail,
    context.role === "bottom" ? leftRail : rightRail,
    ...(config.columnCount >= 4 ? [centerBreak] : []),
  ], plannedSection.pullQuoteTemplateIds);
}

function applyPullQuoteTemplatePreferences(
  variants: PullQuotePlacementVariant[],
  preferredTemplateIds: PullQuoteTemplateId[] | undefined,
): PullQuotePlacementVariant[] {
  if (!preferredTemplateIds?.length) return variants;
  const preferenceOrder = new Map(preferredTemplateIds.map((templateId, index) => [templateId, index]));

  return variants
    .map((variant, originalIndex) => ({
      variant,
      originalIndex,
      preferenceIndex: preferenceOrder.get(variant.templateId),
    }))
    .sort((left, right) => {
      if (left.variant.templateId === "none") return right.variant.templateId === "none" ? 0 : -1;
      if (right.variant.templateId === "none") return 1;
      return (
        (left.preferenceIndex ?? Number.MAX_SAFE_INTEGER) - (right.preferenceIndex ?? Number.MAX_SAFE_INTEGER) ||
        left.originalIndex - right.originalIndex
      );
    })
    .map(({ variant, preferenceIndex }) => {
      if (variant.templateId === "none") return variant;
      return {
        ...variant,
        fallbackPenalty: preferenceIndex === undefined ? variant.fallbackPenalty + 700 : preferenceIndex * 80,
      };
    });
}

function getNoPullQuoteVariant(): PullQuotePlacementVariant {
  return {
    id: "none",
    templateId: "none",
    columnStartStrategy: "left",
    columnSpan: 0,
    anchorRatio: 0,
    fallbackPenalty: 0,
  };
}

function createContinuationImage(
  asset: ArticleImageAsset,
  variant: PhotoContinuationVariant,
  config: LayoutConfig,
): ContinuationImage | null {
  if (variant.templateId === "noImage") return null;

  const columnSpan = clamp(variant.columnSpan, 1, config.columnCount);
  const columnStart = getMediaColumnStart(config, variant.columnStartStrategy, columnSpan);
  const columnWidth = getSpanWidth(config, 1);
  const width = getSpanWidth(config, columnSpan);
  const x = Math.round(columnStart * (columnWidth + config.gap));
  const aspectRatio = getImageAspectRatio(asset);
  const preferredHeight = getContinuationPhotoPreferredHeight(asset, width);
  const height = getContinuationPhotoHeight(asset, width, variant.aspectRatioPolicy);
  const focalPoint = asset.layout?.focalPoint ?? { x: 0.5, y: 0.5 };

  return {
    kind: "image",
    id: `${asset.id}-${variant.id}`,
    src: asset.src,
    alt: asset.alt,
    credit: asset.credit,
    templateId: variant.templateId,
    columnStartStrategy: variant.columnStartStrategy,
    columnStart,
    columnSpan,
    verticalAnchor: "top",
    aspectRatio,
    aspectRatioPolicy: variant.aspectRatioPolicy,
    objectFit: variant.aspectRatioPolicy === "cropAllowed" ? "cover" : "contain",
    objectPosition: `${Math.round(focalPoint.x * 100)}% ${Math.round(focalPoint.y * 100)}%`,
    x,
    y: 0,
    width: Math.round(width),
    height,
    layoutHeight: 0,
    wrapsText: variant.wrapsText,
    preferredHeight,
  };
}

function getMediaColumnStart(
  config: LayoutConfig,
  strategy: MediaColumnStartStrategy,
  columnSpan: number,
): number {
  if (strategy === "right") return Math.max(0, config.columnCount - columnSpan);
  if (strategy === "center") return Math.max(0, Math.floor((config.columnCount - columnSpan) / 2));
  return 0;
}

function getImageAspectRatio(asset: ArticleImageAsset): number {
  return asset.layout?.aspectRatio ?? 1.5;
}

function getContinuationPhotoPreferredHeight(asset: ArticleImageAsset, width: number): number {
  return Math.round(width / getImageAspectRatio(asset));
}

function getContinuationPhotoHeight(
  asset: ArticleImageAsset,
  width: number,
  policy: ContinuationImage["aspectRatioPolicy"],
): number {
  const preferredHeight = getContinuationPhotoPreferredHeight(asset, width);
  const minHeight = asset.layout?.minHeight ?? 140;
  const maxHeight = asset.layout?.maxHeight ?? 420;
  return policy === "cropAllowed" ? clamp(preferredHeight, minHeight, maxHeight) : preferredHeight;
}

function createContinuationPullQuote(
  article: Article,
  variant: PullQuotePlacementVariant,
  config: LayoutConfig,
  textHeight: number,
  image: ContinuationImage | null,
): ContinuationPullQuote | null {
  const text = article.pullQuotes?.[0];
  if (variant.templateId === "none" || !text) return null;
  if (variant.templateId === "centerTwoColumnBreak" && config.columnCount < 4) return null;
  if (variant.templateId === "inlineMobileBreak" && config.columnCount !== 1) return null;

  const columnSpan = clamp(variant.columnSpan, 1, config.columnCount);
  const columnStart = getMediaColumnStart(config, variant.columnStartStrategy, columnSpan);
  const columnWidth = getSpanWidth(config, 1);
  const width = Math.round(getSpanWidth(config, columnSpan));
  const x = Math.round(columnStart * (columnWidth + config.gap));
  const metrics = getPullQuoteMetrics(text, width, config);
  const y = getPullQuoteY({
    x,
    width,
    height: metrics.height,
    textHeight,
    anchorRatio: variant.anchorRatio,
    image,
    config,
  });
  if (y === null) return null;

  return {
    kind: "pullQuote",
    id: `${article.slug}-pullquote-${variant.id}`,
    text,
    templateId: variant.templateId,
    columnStartStrategy: variant.columnStartStrategy,
    columnStart,
    columnSpan,
    x,
    y,
    width,
    height: metrics.height,
    wrapsText: true,
    fontSize: metrics.fontSize,
    lineHeight: metrics.lineHeight,
    fallbackPenalty: variant.fallbackPenalty,
  };
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
  image: ContinuationImage | null;
  config: LayoutConfig;
}): number | null {
  const minY = config.lineHeight * 2;
  const maxY = textHeight - height;
  if (maxY < minY) return null;

  const preferredY = clamp(Math.round(textHeight * anchorRatio - height / 2), minY, maxY);
  const preferredRect = { x, y: preferredY, width, height };
  if (!image || !rectsOverlap(preferredRect, image, FURNITURE_COLLISION_GUTTER)) {
    return preferredY;
  }

  const candidateYs = [
    image.y + image.height + FURNITURE_COLLISION_GUTTER,
    image.y - height - FURNITURE_COLLISION_GUTTER,
  ]
    .filter((candidateY) => candidateY >= minY && candidateY <= maxY)
    .sort((a, b) => Math.abs(a - preferredY) - Math.abs(b - preferredY));

  for (const candidateY of candidateYs) {
    if (!rectsOverlap({ x, y: candidateY, width, height }, image, FURNITURE_COLLISION_GUTTER)) {
      return Math.round(candidateY);
    }
  }

  return null;
}

function getPhotoContinuationTextHeightVariants(
  maxTextHeight: number,
  image: ContinuationImage | null,
  config: LayoutConfig,
): number[] {
  const minimumHeight = Math.max(config.linePaintHeight, getContinuationImageBottom(image));
  const ceilingHeight = Math.max(minimumHeight, maxTextHeight);
  if (config.columnCount === 1) return [ceilingHeight];

  const candidates = [
    ceilingHeight,
    760,
    620,
    480,
    360,
    280,
  ].map((height) => clamp(Math.round(height), minimumHeight, ceilingHeight));

  return Array.from(new Set(candidates)).sort((a, b) => b - a);
}

function scorePhotoContinuationVariant({
  config,
  candidate,
  page,
  image,
  variant,
}: {
  config: LayoutConfig;
  candidate: ContinuationSectionCandidate;
  page: ContinuationPage;
  image: ContinuationImage | null;
  variant: PhotoContinuationVariant;
}): number {
  const targetPageHeight = getSingleContinuationTargetPageHeight(config, candidate.section);
  const underfill = Math.max(0, targetPageHeight - page.height);
  const overshoot = Math.max(0, page.height - targetPageHeight);
  const columnWhitespace = getSectionColumnWhitespace(candidate.section);
  const imagePreferencePenalty = image ? Math.abs(image.height - image.preferredHeight) * 0.35 : 0;
  const imageBonus = image ? 1_500 : 0;
  const pullQuoteBonus = getPullQuoteScoreBonus(candidate.section, 260);
  const pullQuotePenalty = getPullQuoteScorePenalty(candidate.section);
  const templatePenalty = image ? getImageTemplateScorePenalty(image) : 0;

  return (
    50_000 +
    imageBonus +
    pullQuoteBonus -
    underfill * 0.65 -
    overshoot * 0.7 -
    candidate.whitespace * 1.2 -
    columnWhitespace * 0.85 -
    imagePreferencePenalty -
    pullQuotePenalty -
    templatePenalty -
    variant.fallbackPenalty
  );
}

function scoreDualContinuationSectionCandidate({
  allocatedHeight,
  candidate,
  image,
  variant,
}: {
  allocatedHeight: number;
  candidate: ContinuationSectionCandidate;
  image: ContinuationImage | null;
  variant: PhotoContinuationVariant;
}): number {
  const usedHeight = candidate.section.textHeight + getContinuationImageLayoutHeight(image);
  const underfill = Math.max(0, allocatedHeight - usedHeight);
  const overshoot = Math.max(0, usedHeight - allocatedHeight);
  const imagePreferencePenalty = image ? Math.abs(image.height - image.preferredHeight) * 0.3 : 0;
  const imageBonus = image ? 1_200 : 0;
  const pullQuoteBonus = getPullQuoteScoreBonus(candidate.section, 220);
  const pullQuotePenalty = getPullQuoteScorePenalty(candidate.section);
  const templatePenalty = image ? getImageTemplateScorePenalty(image) : 0;

  return (
    40_000 +
    imageBonus +
    pullQuoteBonus -
    underfill * 2.2 -
    overshoot * 1.5 -
    candidate.whitespace -
    getSectionColumnWhitespace(candidate.section) -
    imagePreferencePenalty -
    pullQuotePenalty -
    templatePenalty -
    variant.fallbackPenalty
  );
}

function getSectionColumnWhitespace(section: ContinuationSection): number {
  return getColumnWhitespace(section.columns, section.textHeight, section.furniture);
}

function getColumnWhitespace(
  columns: TextLine[][],
  textHeight: number,
  furniture: ContinuationFurniture[],
): number {
  return columns.reduce(
    (total, column, columnIndex) => (
      total +
      Math.max(
        0,
        textHeight -
          getLinesHeight(column) -
          getColumnObstacleHeight(furniture, columnIndex, textHeight),
      )
    ),
    0,
  );
}

function getImageTemplateScorePenalty(image: ContinuationImage): number {
  if (image.templateId === "wideTopBand") return 520;
  if (image.templateId === "centerTwoColumnInset") return 0;
  if (image.templateId === "rightTwoColumnInset") return 0;
  return 80;
}

function getSingleContinuationTargetPageHeight(config: LayoutConfig, section: ContinuationSection): number {
  return Math.ceil(
    config.pageChrome.pagePaddingTop +
    config.pageChrome.insideHeaderHeight +
    config.pageChrome.continuedTitleChromeHeight +
    section.titleHeight +
    config.continuationHeight +
    config.pageChrome.pagePaddingBottom,
  );
}

function getContinuationImageLayoutHeight(image: ContinuationImage | null): number {
  return image?.layoutHeight ?? 0;
}

function getContinuationFurnitureBottom(furniture: ContinuationFurniture[]): number {
  return furniture.reduce((bottom, item) => Math.max(bottom, item.y + item.height), 0);
}

function getContinuationImageBottom(image: ContinuationImage | null): number {
  return image ? image.y + image.height : 0;
}

function getColumnObstacleHeight(
  furniture: ContinuationFurniture[],
  columnIndex: number,
  textHeight: number,
): number {
  const intervals = furniture
    .filter((item) => item.wrapsText && isColumnOccupiedByFurniture(item, columnIndex))
    .map((item) => ({
      start: clamp(item.y, 0, textHeight),
      end: clamp(item.y + item.height, 0, textHeight),
    }))
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }

  return merged.reduce((total, interval) => total + interval.end - interval.start, 0);
}

function getColumnTextObstacles(furniture: ContinuationFurniture[], columnIndex: number): TextObstacle[] {
  return furniture
    .filter((item) => item.wrapsText && isColumnOccupiedByFurniture(item, columnIndex))
    .map((item) => ({
      x: 0,
      y: item.y,
      width: Number.POSITIVE_INFINITY,
      height: item.height,
    }));
}

function isColumnOccupiedByFurniture(furniture: ContinuationFurniture, columnIndex: number): boolean {
  return columnIndex >= furniture.columnStart && columnIndex < furniture.columnStart + furniture.columnSpan;
}

function getContinuationFurniture(
  image: ContinuationImage | null,
  pullQuote: ContinuationPullQuote | null,
): ContinuationFurniture[] {
  return [image, pullQuote].filter((item): item is ContinuationFurniture => item !== null);
}

function continuationBlockId(plannedPage: PlannedPage, plannedSection: PlannedContinuationSection): string {
  return `continued-${plannedSection.articleId}-page-${plannedPage.pageNumber}`;
}

function getPullQuoteScoreBonus(section: ContinuationSection, baseBonus: number): number {
  if (!section.pullQuote) return 0;
  return section.hasMore ? Math.floor(baseBonus * 0.25) : baseBonus;
}

function getPullQuoteScorePenalty(section: ContinuationSection): number {
  const pullQuote = section.pullQuote;
  if (!pullQuote) return 0;
  const overflowPenalty = section.hasMore ? 1_600 : 0;
  const templatePenalty = pullQuote.templateId === "centerTwoColumnBreak"
    ? 90
    : pullQuote.templateId === "inlineMobileBreak"
      ? 140
      : 0;
  return overflowPenalty + templatePenalty + pullQuote.fallbackPenalty;
}

function rectsOverlap(a: FurnitureRect, b: FurnitureRect, gutter = 0): boolean {
  return (
    a.x < b.x + b.width + gutter &&
    a.x + a.width + gutter > b.x &&
    a.y < b.y + b.height + gutter &&
    a.y + a.height + gutter > b.y
  );
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

function placeTextRange({
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
  const range = createTextRange({
    flow,
    pageId,
    blockId,
    startCursor,
    endCursor,
    exhausted,
  });
  commitTextRange(flow, range);
  return range;
}

function getRequiredFlow(flows: Map<string, ArticleFlow>, articleId: string): ArticleFlow {
  const flow = flows.get(articleId);
  if (!flow) throw new Error(`Article flow not found: ${articleId}`);
  return flow;
}

function pageIdFor(pageNumber: number): string {
  return `page-${pageNumber}`;
}

function isCursorAtStart(cursor: LayoutCursor): boolean {
  return cursor.segmentIndex === EMPTY_CURSOR.segmentIndex && cursor.graphemeIndex === EMPTY_CURSOR.graphemeIndex;
}

function getRemainingTextSpace(slotHeight: number, lines: TextLine[]): number {
  if (lines.length === 0) return slotHeight;
  const lastLine = lines[lines.length - 1];
  return Math.max(0, slotHeight - (lastLine.y + lastLine.paintHeight));
}

function getLinesHeight(lines: TextLine[]): number {
  if (lines.length === 0) return 0;
  const lastLine = lines[lines.length - 1];
  return lastLine.y + lastLine.paintHeight;
}

function scoreWhitespace(whitespace: number): number {
  return Math.max(0, 10_000 - whitespace);
}

function getLayoutConfig(pageWidth: number, viewportHeight: number): LayoutConfig {
  const narrow = pageWidth < 720;
  const medium = pageWidth >= 720 && pageWidth < 1040;
  const columnCount = narrow ? 1 : medium ? 2 : 4;
  const gap = narrow ? 14 : 18;
  const sideMargin = narrow ? 18 : 30;
  const contentWidth = Math.max(280, pageWidth - sideMargin * 2);
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
    : clamp(pageWidth * 0.13, 64, 140.8);
  const mastheadTitleLineHeight = mastheadTitleFontSize * 0.84;
  const mastheadMetaLineHeight = 15;
  const mastheadMetaGap = narrow ? 5 : 0;
  const mastheadMetaLines = narrow ? 3 : 1;
  const mastheadMetaHeight =
    MASTHEAD_META_BORDER_TOP +
    MASTHEAD_META_PADDING_TOP +
    mastheadMetaLines * mastheadMetaLineHeight +
    Math.max(0, mastheadMetaLines - 1) * mastheadMetaGap;
  const mastheadHeight =
    MASTHEAD_RULE_HEIGHT +
    MASTHEAD_RULE_MARGIN_BOTTOM +
    mastheadKickerLineHeight +
    MASTHEAD_TITLE_MARGIN_TOP +
    mastheadTitleLineHeight +
    MASTHEAD_TITLE_MARGIN_BOTTOM +
    mastheadMetaHeight +
    MASTHEAD_PADDING_BOTTOM +
    MASTHEAD_BORDER_BOTTOM +
    MASTHEAD_MARGIN_BOTTOM;
  const insideHeaderLines = narrow ? 3 : 1;
  const insideHeaderHeight =
    insideHeaderLines * mastheadMetaLineHeight +
    Math.max(0, insideHeaderLines - 1) * mastheadMetaGap +
    INSIDE_HEADER_PADDING_BOTTOM +
    INSIDE_HEADER_BORDER_BOTTOM +
    INSIDE_HEADER_MARGIN_BOTTOM;
  const continuedTitleFontSize = clamp(pageWidth * 0.04, 28.8, 70.4);
  const continuedTitleLineHeight = continuedTitleFontSize * 0.94;
  const continuedTitleChromeHeight =
    CONTINUED_TITLE_KICKER_LINE_HEIGHT +
    CONTINUED_TITLE_HEADING_MARGIN_TOP +
    CONTINUED_TITLE_PADDING_BOTTOM +
    CONTINUED_TITLE_BORDER_BOTTOM +
    CONTINUED_TITLE_MARGIN_BOTTOM;
  const continuedTitleHeight = continuedTitleChromeHeight + continuedTitleLineHeight;

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
    insideHeaderHeight: Math.ceil(insideHeaderHeight),
    continuedTitleHeight: Math.ceil(continuedTitleHeight),
    continuedTitleChromeHeight: Math.ceil(continuedTitleChromeHeight),
    continuedTitleFontSize,
    continuedTitleLineHeight,
  };
}

function getFrontGridHeight(pageHeight: number, narrow: boolean, medium: boolean): number {
  const mastheadAndPageChrome = narrow ? 430 : medium ? 360 : 370;
  return Math.max(narrow ? 820 : 980, pageHeight - mastheadAndPageChrome);
}

function getFrontRows(columnCount: number, gap: number, frontGridHeight: number, maxRowHeight: number): FrontRow[] {
  const rows: FrontRow[] = [];
  let articleIndex = 0;
  while (articleIndex < ARTICLE_SPANS.length) {
    const startIndex = articleIndex;
    let occupiedColumns = 0;
    while (articleIndex < ARTICLE_SPANS.length) {
      const span = Math.min(ARTICLE_SPANS[articleIndex] ?? 1, columnCount);
      if (occupiedColumns > 0 && occupiedColumns + span > columnCount) break;
      occupiedColumns += span;
      articleIndex += 1;
      if (occupiedColumns >= columnCount) break;
    }
    rows.push({ startIndex, endIndex: articleIndex - 1, height: 0 });
  }

  const availableRowsHeight = frontGridHeight - gap * Math.max(0, rows.length - 1);
  const baseRowHeight = Math.floor(availableRowsHeight / Math.max(1, rows.length));
  return rows.map((row, rowIndex) => ({
    ...row,
    height: Math.min(
      maxRowHeight,
      rowIndex === rows.length - 1
        ? availableRowsHeight - baseRowHeight * (rows.length - 1)
        : baseRowHeight,
    ),
  }));
}

function getFrontRowHeight(config: LayoutConfig, articleIndex: number): number {
  const row = config.frontRows.find((candidate) => articleIndex >= candidate.startIndex && articleIndex <= candidate.endIndex);
  return row?.height ?? 260;
}

function getFrontPageHeight(config: LayoutConfig): number {
  return Math.ceil(
    config.pageChrome.pagePaddingTop +
    config.pageChrome.mastheadHeight +
    getFrontGridSolvedHeight(config) +
    config.pageChrome.pagePaddingBottom,
  );
}

function getFrontGridSolvedHeight(config: LayoutConfig): number {
  const rowHeight = config.frontRows.reduce((total, row) => total + row.height, 0);
  return rowHeight + config.gap * Math.max(0, config.frontRows.length - 1);
}

function getContinuationPageHeight(config: LayoutConfig, sections: ContinuationSection[]): number {
  const sectionsHeight = sections.reduce(
    (total, section, sectionIndex) => (
      total +
      (sectionIndex === 0 ? 0 : CONTINUATION_SECTION_SEPARATOR_HEIGHT) +
      config.pageChrome.continuedTitleChromeHeight +
      section.titleHeight +
      getContinuationImageLayoutHeight(section.image) +
      section.textHeight
    ),
    0,
  );

  return Math.ceil(
    config.pageChrome.pagePaddingTop +
    config.pageChrome.insideHeaderHeight +
    sectionsHeight +
    config.pageChrome.pagePaddingBottom,
  );
}

function getContinuationTitleMetrics(config: LayoutConfig, article: Article): { lineCount: number; height: number } {
  return measureWrappedTextBlock(
    article.headline,
    `700 ${config.pageChrome.continuedTitleFontSize}px Georgia, "Times New Roman", serif`,
    Math.min(config.contentWidth, 980),
    config.pageChrome.continuedTitleLineHeight,
  );
}

function getStoryChromeMetrics(
  config: LayoutConfig,
  article: Article,
  articleIndex: number,
  blockWidth: number,
): StoryChromeMetrics {
  const lead = articleIndex === 0;
  const headlineFontSize = getHeadlineFontSize(config, lead);
  const headlineLineHeight = headlineFontSize * (lead ? 0.93 : 1);
  const headlineFont = `700 ${headlineFontSize}px Georgia, "Times New Roman", serif`;
  const deckFont = `italic ${STORY_CHROME_TOKENS.deckFontSize}px Georgia, "Times New Roman", serif`;
  const bylineFont =
    `800 ${STORY_CHROME_TOKENS.bylineFontSize}px Arial, Helvetica, sans-serif`;
  const headline = measureWrappedTextBlock(article.headline, headlineFont, blockWidth, headlineLineHeight);
  const deck = measureWrappedTextBlock(article.deck, deckFont, blockWidth, STORY_CHROME_TOKENS.deckLineHeight);
  const byline = measureWrappedTextBlock(formatByline(article), bylineFont, blockWidth, STORY_CHROME_TOKENS.bylineLineHeight);

  return {
    borderTopHeight: lead ? 6 : 2,
    paddingTop: STORY_CHROME_TOKENS.storyPaddingTop,
    labelLineHeight: STORY_CHROME_TOKENS.labelLineHeight,
    headlineFontSize,
    headlineLineHeight,
    headlineHeight: headline.height,
    headlineLineCount: headline.lineCount,
    headlineMarginTop: STORY_CHROME_TOKENS.headlineMarginTop,
    headlineMarginBottom: STORY_CHROME_TOKENS.headlineMarginBottom,
    deckFontSize: STORY_CHROME_TOKENS.deckFontSize,
    deckLineHeight: STORY_CHROME_TOKENS.deckLineHeight,
    deckHeight: deck.height,
    deckLineCount: deck.lineCount,
    deckMarginBottom: STORY_CHROME_TOKENS.deckMarginBottom,
    bylineFontSize: STORY_CHROME_TOKENS.bylineFontSize,
    bylineLineHeight: STORY_CHROME_TOKENS.bylineLineHeight,
    bylineHeight: byline.height,
    bylineLineCount: byline.lineCount,
    bylineMarginBottom: STORY_CHROME_TOKENS.bylineMarginBottom,
    measureChromeHeight: STORY_MEASURE_CHROME_HEIGHT,
    jumpLineHeight: STORY_CHROME_TOKENS.jumpLineHeight,
    jumpPaddingTop: STORY_CHROME_TOKENS.jumpPaddingTop,
    jumpBorderTopHeight: STORY_CHROME_TOKENS.jumpBorderTopHeight,
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

function formatByline(article: Article): string {
  return `${article.byline} / ${article.dateline}`.toUpperCase();
}

function getSpanWidth(config: LayoutConfig, span: number): number {
  const singleColumn = (config.contentWidth - config.gap * (config.columnCount - 1)) / config.columnCount;
  return singleColumn * span + config.gap * (span - 1);
}

function getLeadImageWrap(article: Article, width: number, lineHeight: number): ImageWrap | null {
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getPrepared(
  cache: Map<string, PreparedTextWithSegments>,
  article: Article,
  font: string,
): PreparedTextWithSegments {
  const key = `${article.slug}:${font}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const prepared = prepareWithSegments(getArticleText(article), font);
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
    const slot = getAvailableSlot(maxWidth, y, lineHeight, obstacles);
    if (!slot) continue;
    const line = layoutNextLine(prepared, current, slot.width);
    if (!line) return { lines, cursor: current, hasMore: false };
    lines.push(toTextLine(line, slot.x, y, lineHeight, linePaintHeight));
    current = line.end;
  }

  const nextSlot = getNextAvailableSlot(maxWidth, maxLines, lineHeight, obstacles) ?? { x: 0, width: maxWidth };
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
  obstacles: TextObstacle[],
): { x: number; width: number } | null {
  for (let offset = 0; offset < 24; offset += 1) {
    const slot = getAvailableSlot(maxWidth, (startLineIndex + offset) * lineHeight, lineHeight, obstacles);
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
