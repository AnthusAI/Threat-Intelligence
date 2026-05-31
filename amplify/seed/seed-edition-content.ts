import type { Article } from "../../lib/articles";
import seedEditionContent from "./seed-edition-content.json";

type SeedHouseAd = {
  id: string;
  pageNumber: number;
  label: string;
  presetId?: "ad.region" | "ad.fullPage";
};

type SeedEditionContent = {
  id: string;
  slug: string;
  title: string;
  description: string;
  publishDate: string;
  suppressNewsDeskAppendix?: boolean;
  houseAds?: SeedHouseAd[];
  articles: Article[];
};

const seedContent = seedEditionContent as SeedEditionContent;

export const seedEditionArticles: Article[] = seedContent.articles;

export type SeedEditionConfig = {
  id: string;
  slug: string;
  title: string;
  description: string;
  publishDate: string;
  publishedAt: string;
  metadata: Record<string, unknown>;
  articleOrder: string[];
  layoutPlan: unknown;
};

export function getSeedEditionConfig(): SeedEditionConfig {
  const publishDate = seedContent.publishDate;
  const itemIds = seedEditionArticles.map((article) => article.slug);
  return {
    id: seedContent.id,
    slug: seedContent.slug,
    title: seedContent.title,
    description: seedContent.description,
    publishDate,
    publishedAt: `${publishDate}T12:00:00.000Z`,
    metadata: {
      source: "fixture-seed",
      suppressNewsDeskAppendix: seedContent.suppressNewsDeskAppendix === true,
    },
    articleOrder: itemIds,
    layoutPlan: applySeedHouseAds(createSeedEditionLayoutPlan(itemIds), seedContent.houseAds),
  };
}

function applySeedHouseAds(layoutPlan: ReturnType<typeof createSeedEditionLayoutPlan>, houseAds: SeedHouseAd[] | undefined) {
  if (!houseAds?.length) return layoutPlan;
  for (const ad of houseAds) {
    const page = layoutPlan.pages.find((entry) => entry.pageNumber === ad.pageNumber);
    const region = page?.regions?.[0];
    if (!region) continue;
    (region.blocks as Array<Record<string, unknown>>).push({
      id: ad.id,
      type: "adBlock",
      presetId: ad.presetId ?? "ad.region",
      required: false,
      label: ad.label,
    });
  }
  return layoutPlan;
}

function createSeedEditionLayoutPlan(itemIds: string[]) {
  const featuredFrontItemIds = [
    "papyrus-reader-contract",
    "papyrus-introduction",
    "papyrus-agent-workflow",
    "papyrus-data-ownership",
  ];
  const frontItemIds = itemIds.length < 3
    ? itemIds
    : featuredFrontItemIds.filter((itemId) => itemIds.includes(itemId));
  return {
    pages: [
      {
        id: "page-1",
        pageNumber: 1,
        presetId: "front.mosaic",
        grid: { columns: { min: 1, preferred: 6, max: 6 } },
        regions: [
          {
            id: "front-page-news",
            type: "fullPage",
            localGrid: { columns: { min: 1, preferred: 6, max: 6 } },
            responsiveLayouts: getSeedFrontResponsiveLayouts(),
            blocks: frontItemIds.map((itemId, index) => ({
              id: `front-${itemId}`,
              type: "articleFrame",
              presetId: "front.teaser",
              itemId,
              flowKey: itemId,
              startCursor: "beginning",
              role: index === 1 ? "feature" : index === 0 || index === 2 ? "rail" : "standard",
              editorialPriority: index === 1 ? "primary" : index === 0 || index === 2 ? "secondary" : "tertiary",
              typography: { headlineScale: index === 1 ? "feature" : "standard" },
              span: { min: 1, preferred: [1, 4, 1, 2, 2, 2][index] ?? 1, max: [1, 4, 1, 2, 2, 2][index] ?? 1 },
              localGrid: index === 1 ? { columns: { min: 1, preferred: 4, max: 4 } } : undefined,
              media: index === 1
                ? [
                    {
                      required: true,
                      assetRole: "lead",
                      placement: {
                        anchor: "right",
                        span: { min: 1, preferred: 1, max: 1 },
                        vertical: "top",
                        collapse: "inline",
                        crop: "preserve",
                        wrapsText: true,
                      },
                    },
                  ]
                : [],
              composition: index === 1
                ? {
                    title: [
                      {
                        slot: "label",
                        placement: {
                          columnStart: 1,
                          span: { min: 1, preferred: 2, max: 2 },
                          vertical: "top",
                          collapse: "inline",
                          crop: "preserve",
                          wrapsText: false,
                        },
                      },
                      {
                        slot: "headline",
                        placement: {
                          columnStart: 1,
                          span: { min: 1, preferred: 3, max: 3 },
                          spanOverrides: { "3": 2 },
                          vertical: "top",
                          collapse: "inline",
                          crop: "preserve",
                          wrapsText: false,
                        },
                      },
                    ],
                    lead: [
                      {
                        slot: "deck",
                        placement: {
                          columnStart: 1,
                          span: { min: 1, preferred: 3, max: 3 },
                          spanOverrides: { "3": 2 },
                          vertical: "top",
                          collapse: "inline",
                          crop: "preserve",
                          wrapsText: true,
                        },
                      },
                      {
                        slot: "byline",
                        placement: {
                          columnStart: 1,
                          span: { min: 1, preferred: 3, max: 3 },
                          spanOverrides: { "3": 2 },
                          vertical: "top",
                          collapse: "inline",
                          crop: "preserve",
                          wrapsText: true,
                        },
                      },
                      {
                        slot: "media",
                        mediaIndex: 0,
                        placement: {
                          anchor: "right",
                          span: { min: 1, preferred: 1, max: 1 },
                          vertical: "top",
                          collapse: "inline",
                          crop: "preserve",
                          wrapsText: true,
                        },
                      },
                    ],
                  }
                : undefined,
              cutPolicy: getSeedCutPolicy(itemId),
            })),
          },
        ],
      },
      {
        id: "page-2",
        pageNumber: 2,
        presetId: "page.regionStack",
        grid: { columns: { min: 1, preferred: 6, max: 6 } },
        regions: [
          {
            id: "papyrus-reader-contract-continuation",
            type: "stack",
            role: "top",
            size: { ratio: 0.5 },
            blocks: [
              createSeedContinuationBlock("papyrus-reader-contract", 2, {
                required: true,
                anchor: "center",
                span: { min: 1, preferred: 2, max: 3 },
                vertical: "upperThird",
              }),
            ],
          },
          {
            id: "papyrus-data-ownership-continuation",
            type: "stack",
            role: "bottom",
            size: { ratio: 0.5 },
            blocks: [
              createSeedContinuationBlock("papyrus-data-ownership", 2, {
                required: false,
                anchor: "right",
                span: { min: 1, preferred: 2, max: 2 },
                vertical: "top",
              }),
            ],
          },
        ],
      },
      {
        id: "page-3",
        pageNumber: 3,
        presetId: "page.regionStack",
        grid: { columns: { min: 1, preferred: 6, max: 6 } },
        regions: [
          {
            id: "papyrus-introduction-tail",
            type: "stack",
            role: "top",
            size: { ratio: 0.5 },
            blocks: [
              createSeedContinuationBlock("papyrus-introduction", 3, {
                required: false,
                anchor: "right",
                span: { min: 1, preferred: 2, max: 2 },
                vertical: "top",
              }),
            ],
          },
          {
            id: "papyrus-workflow-tail",
            type: "stack",
            role: "bottom",
            size: { ratio: 0.5 },
            blocks: [
              createSeedContinuationBlock("papyrus-agent-workflow", 3, {
                required: false,
                anchor: "center",
                span: { min: 2, preferred: 2, max: 2 },
                vertical: "top",
              }),
            ],
          },
        ],
      },
      {
        id: "page-4",
        pageNumber: 4,
        presetId: "page.regionStack",
        grid: { columns: { min: 1, preferred: 6, max: 6 } },
        regions: [
          {
            id: "newsroom-how-to-first-install",
            type: "stack",
            role: "top",
            size: { ratio: 0.5 },
            blocks: [
              createSeedPageArticleBlock("papyrus-first-install", 4, {
                required: false,
                anchor: "right",
                span: { min: 1, preferred: 2, max: 2 },
                vertical: "top",
              }),
            ],
          },
          {
            id: "newsroom-how-to-dispatch-research",
            type: "stack",
            role: "bottom",
            size: { ratio: 0.5 },
            blocks: [
              createSeedPageArticleBlock("howto-dispatch-research-agents", 4, {
                required: false,
                anchor: "center",
                span: { min: 1, preferred: 2, max: 3 },
                vertical: "upperThird",
              }),
            ],
          },
        ],
      },
      {
        id: "page-5",
        pageNumber: 5,
        presetId: "page.regionStack",
        grid: { columns: { min: 1, preferred: 6, max: 6 } },
        regions: [
          {
            id: "newsroom-how-to-curate-references",
            type: "stack",
            role: "top",
            size: { ratio: 0.5 },
            blocks: [
              createSeedPageArticleBlock("howto-curate-references", 5, {
                required: false,
                anchor: "right",
                span: { min: 1, preferred: 2, max: 2 },
                vertical: "top",
              }),
            ],
          },
          {
            id: "newsroom-how-to-register-source-material",
            type: "stack",
            role: "bottom",
            size: { ratio: 0.5 },
            blocks: [
              createSeedPageArticleBlock("howto-register-source-material", 5, {
                required: false,
                anchor: "center",
                span: { min: 1, preferred: 2, max: 3 },
                vertical: "upperThird",
              }),
            ],
          },
        ],
      },
      {
        id: "page-6",
        pageNumber: 6,
        presetId: "page.regionStack",
        grid: { columns: { min: 1, preferred: 6, max: 6 } },
        regions: [
          {
            id: "newsroom-how-to-maintain-reference-quality",
            type: "stack",
            role: "top",
            size: { ratio: 0.5 },
            blocks: [
              createSeedPageArticleBlock("howto-maintain-reference-quality", 6, {
                required: false,
                anchor: "right",
                span: { min: 1, preferred: 2, max: 2 },
                vertical: "top",
              }),
            ],
          },
          {
            id: "papyrus-steering-and-curation-guide",
            type: "stack",
            role: "bottom",
            size: { ratio: 0.5 },
            blocks: [
              createSeedPageArticleBlock("papyrus-steering-and-curation", 6, {
                required: false,
                anchor: "center",
                span: { min: 1, preferred: 2, max: 3 },
                vertical: "upperThird",
              }),
            ],
          },
        ],
      },
      {
        id: "page-7",
        pageNumber: 7,
        presetId: "page.regionStack",
        grid: { columns: { min: 1, preferred: 6, max: 6 } },
        regions: [
          {
            id: "papyrus-operating-modes-guide",
            type: "stack",
            role: "top",
            size: { ratio: 0.5 },
            blocks: [
              createSeedPageArticleBlock("papyrus-operating-modes", 7, {
                required: false,
                anchor: "right",
                span: { min: 1, preferred: 2, max: 2 },
                vertical: "top",
              }),
            ],
          },
          {
            id: "papyrus-reference-governance-guide",
            type: "stack",
            role: "bottom",
            size: { ratio: 0.5 },
            blocks: [
              createSeedPageArticleBlock("papyrus-reference-governance", 7, {
                required: false,
                anchor: "center",
                span: { min: 1, preferred: 2, max: 3 },
                vertical: "upperThird",
              }),
            ],
          },
        ],
      },
    ],
  };
}

function getSeedFrontResponsiveLayouts() {
  return [
    {
      minColumns: 6,
      maxColumns: 6,
      order: "editorialPriority",
      slots: [
        {
          editorialPriority: "secondary",
          priorityOccurrence: 1,
          columnStart: 1,
          columnSpan: 1,
          rowStart: 1,
          rowSpan: 1,
        },
        {
          editorialPriority: "primary",
          priorityOccurrence: 1,
          columnStart: 2,
          columnSpan: 4,
          rowStart: 1,
          rowSpan: 1,
        },
        {
          editorialPriority: "secondary",
          priorityOccurrence: 2,
          columnStart: 6,
          columnSpan: 1,
          rowStart: 1,
          rowSpan: 1,
        },
        {
          blockId: "front-papyrus-data-ownership",
          columnStart: 1,
          columnSpan: 6,
          rowStart: 2,
          rowSpan: 1,
        },
      ],
      overflow: { columnSpan: "full", rowSpan: 1 },
    },
    {
      minColumns: 5,
      maxColumns: 5,
      order: "editorialPriority",
      slots: [
        {
          editorialPriority: "secondary",
          priorityOccurrence: 1,
          columnStart: 1,
          columnSpan: 1,
          rowStart: 1,
          rowSpan: 1,
        },
        {
          editorialPriority: "primary",
          priorityOccurrence: 1,
          columnStart: 2,
          columnSpan: 3,
          rowStart: 1,
          rowSpan: 1,
        },
        {
          editorialPriority: "secondary",
          priorityOccurrence: 2,
          columnStart: 5,
          columnSpan: 1,
          rowStart: 1,
          rowSpan: 1,
        },
        {
          blockId: "front-papyrus-data-ownership",
          columnStart: 1,
          columnSpan: 5,
          rowStart: 2,
          rowSpan: 1,
        },
      ],
      overflow: { columnSpan: "full", rowSpan: 1 },
    },
    {
      minColumns: 4,
      maxColumns: 4,
      order: "editorialPriority",
      slots: [
        {
          editorialPriority: "primary",
          priorityOccurrence: 1,
          columnStart: 1,
          columnSpan: 4,
          rowStart: 1,
          rowSpan: 1,
        },
        {
          editorialPriority: "secondary",
          priorityOccurrence: 1,
          columnStart: 1,
          columnSpan: 2,
          rowStart: 2,
          rowSpan: 1,
        },
        {
          editorialPriority: "secondary",
          priorityOccurrence: 2,
          columnStart: 3,
          columnSpan: 2,
          rowStart: 2,
          rowSpan: 1,
        },
        {
          blockId: "front-papyrus-data-ownership",
          columnStart: 1,
          columnSpan: 4,
          rowStart: 3,
          rowSpan: 1,
        },
      ],
      overflow: { columnSpan: "full", rowSpan: 1 },
    },
    {
      minColumns: 1,
      maxColumns: 3,
      order: "editorialPriority",
      slots: [],
      overflow: { columnSpan: "full", rowSpan: 1 },
    },
  ];
}

function createSeedPageArticleBlock(
  itemId: string,
  pageNumber: number,
  media: {
    required: boolean;
    anchor: string;
    span: { min: number; preferred: number; max: number };
    vertical: string;
  },
) {
  return {
    id: `${itemId}-page-${pageNumber}-lead`,
    type: "articleFrame",
    presetId: "article.mediaInset",
    itemId,
    flowKey: itemId,
    startCursor: "beginning",
    role: "primary",
    localGrid: { columns: { min: 2, preferred: 6, max: 6 } },
    media: [
      {
        required: media.required,
        assetRole: "lead",
        placement: {
          anchor: media.anchor,
          span: media.span,
          vertical: media.vertical,
          collapse: "inline",
          crop: "preserve",
          wrapsText: true,
        },
      },
    ],
  };
}

function createSeedContinuationBlock(
  itemId: string,
  pageNumber: number,
  media: {
    required: boolean;
    anchor: string;
    span: { min: number; preferred: number; max: number };
    vertical: string;
  },
) {
  return {
    id: `${itemId}-page-${pageNumber}`,
    type: "articleFrame",
    presetId: "article.mediaInset",
    itemId,
    flowKey: itemId,
    startCursor: "current",
    role: "primary",
    localGrid: { columns: { min: 2, preferred: 6, max: 6 } },
    media: [
      {
        required: media.required,
        assetRole: "continuationInset",
        placement: {
          anchor: media.anchor,
          span: media.span,
          vertical: media.vertical,
          collapse: "inline",
          crop: "preserve",
          wrapsText: true,
        },
      },
    ],
    pullQuote: {
      required: false,
      placements: [
        {
          anchor: media.anchor === "left" ? "right" : "left",
          span: { min: 1, preferred: 1, max: 2 },
          vertical: "middle",
          collapse: "omit",
          crop: "preserve",
          wrapsText: true,
        },
      ],
    },
  };
}

function getSeedCutPolicy(itemId: string) {
  if (itemId === "papyrus-reader-contract") return { bodyDepthRows: 14, jumpTargetPage: 2 };
  if (itemId === "papyrus-introduction") return { bodyDepthRows: 14, jumpTargetPage: 3 };
  if (itemId === "papyrus-agent-workflow") return { bodyDepthRows: 14, jumpTargetPage: 3 };
  if (itemId === "papyrus-data-ownership") return { bodyDepthRows: 8, jumpTargetPage: 2 };
  return undefined;
}
