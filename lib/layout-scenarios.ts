import { type Article, articles, editionDate } from "./articles";
import type { EditionContent } from "./content-types";
import { createDefaultEditionLayoutPlan, type EditionLayoutPlan } from "./layout-plan";
import { articleToPublicationItem, cloneArticle } from "./publication-items";

export type LayoutScenario = EditionContent & {
  source: "scenario";
  scenarioId: string;
};

export const DEFAULT_LAYOUT_SCENARIO_ID = "current-edition";

export const layoutScenarios: LayoutScenario[] = [
  {
    id: DEFAULT_LAYOUT_SCENARIO_ID,
    source: "scenario",
    title: "Current Edition",
    editionDate,
    scenarioId: DEFAULT_LAYOUT_SCENARIO_ID,
    description: "The default Papyrus fixture edition.",
    layoutPlan: createDefaultEditionLayoutPlan(articles.map((article) => article.slug)),
    items: cloneArticles(articles).map(articleToPublicationItem),
  },
  {
    id: "shared-blank-column-pressure",
    source: "scenario",
    title: "Shared Continuation Blank Column Pressure",
    editionDate,
    scenarioId: "shared-blank-column-pressure",
    description:
      "Shorter shared continuation tails with images and pull quotes, used to prove that empty columns are repaired with solved furniture.",
    layoutPlan: createDefaultEditionLayoutPlan(articles.map((article) => article.slug)),
    items: createSharedBlankColumnPressureArticles().map(articleToPublicationItem),
  },
  {
    id: "shared-continuation-no-pull-quotes",
    source: "scenario",
    title: "Shared Continuation Without Pull Quotes",
    editionDate,
    scenarioId: "shared-continuation-no-pull-quotes",
    description:
      "The shared continuation page with editorial pull quotes removed, used to prove pull quotes are optional display furniture.",
    layoutPlan: createDefaultEditionLayoutPlan(articles.map((article) => article.slug)),
    items: createNoPullQuoteArticles().map(articleToPublicationItem),
  },
  {
    id: "front-chrome-compact",
    source: "scenario",
    title: "Front Chrome Compact Typography",
    editionDate,
    scenarioId: "front-chrome-compact",
    description:
      "Compact headline and deck line heights prove that em-authored chrome reserves enough paint space to prevent overlap.",
    layoutPlan: createCompactChromeLayoutPlan(),
    items: cloneArticles(articles).map(articleToPublicationItem),
  },
  {
    id: "furniture-sufficiency-pressure",
    source: "scenario",
    title: "Furniture Sufficiency Pressure",
    editionDate,
    scenarioId: "furniture-sufficiency-pressure",
    description:
      "Oversized image and pull-quote packages prove that the solver rejects furniture that leaves too little readable copy.",
    layoutPlan: createFurnitureSufficiencyLayoutPlan(),
    items: createFurnitureSufficiencyArticles().map(articleToPublicationItem),
  },
  {
    id: "long-image-caption",
    source: "scenario",
    title: "Long Image Caption",
    editionDate,
    scenarioId: "long-image-caption",
    description:
      "A continuation image with a long caption proves image furniture reserves enough rhythm rows for complete caption text.",
    layoutPlan: createDefaultEditionLayoutPlan(articles.map((article) => article.slug)),
    items: createLongImageCaptionArticles().map(articleToPublicationItem),
  },
  {
    id: "height-policy-fill-default",
    source: "scenario",
    title: "Height Policy Fill Default",
    editionDate,
    scenarioId: "height-policy-fill-default",
    description:
      "A page-two continuation without shrinkToContent proves stacked regions still preserve their allocated fill height by default.",
    layoutPlan: createHeightPolicyLayoutPlan({}),
    items: cloneArticles(articles).map(articleToPublicationItem),
  },
  {
    id: "height-policy-default-rows",
    source: "scenario",
    title: "Height Policy Default Rows",
    editionDate,
    scenarioId: "height-policy-default-rows",
    description:
      "A page-two continuation with block defaultRows proves an article frame can hold an editorial row target.",
    layoutPlan: createHeightPolicyLayoutPlan({ regionShrinkToContent: true, defaultRows: 64 }),
    items: cloneArticles(articles).map(articleToPublicationItem),
  },
  {
    id: "height-policy-default-rows-grow",
    source: "scenario",
    title: "Height Policy Default Rows Grow",
    editionDate,
    scenarioId: "height-policy-default-rows-grow",
    description:
      "A short article-frame row target proves exhaustive continuation text can grow beyond defaultRows.",
    layoutPlan: createHeightPolicyLayoutPlan({ regionShrinkToContent: true, defaultRows: 12 }),
    items: cloneArticles(articles).map(articleToPublicationItem),
  },
  {
    id: "height-policy-default-rows-shrink",
    source: "scenario",
    title: "Height Policy Default Rows Shrink",
    editionDate,
    scenarioId: "height-policy-default-rows-shrink",
    description:
      "A shrinkable article-frame row target proves defaultRows can be released when content solves shorter.",
    layoutPlan: createHeightPolicyLayoutPlan({ regionShrinkToContent: true, defaultRows: 64, blockShrinkToContent: true }),
    items: cloneArticles(articles).map(articleToPublicationItem),
  },
];

export function getLayoutScenario(id: string | null | undefined): LayoutScenario {
  return layoutScenarios.find((scenario) => scenario.id === id) ?? layoutScenarios[0];
}

function createSharedBlankColumnPressureArticles(): Article[] {
  return cloneArticles(articles).map((article) => {
    if (article.slug === "schools-reading-lab") {
      return {
        ...article,
        body: [
          article.body[0],
          article.body[1],
          article.body[2],
          article.body[3],
          "The test edition keeps this continuation deliberately tight. It should still spend empty column space with a solved image or pull quote instead of leaving a bare newspaper column.",
        ],
      };
    }

    if (article.slug === "market-hall") {
      return {
        ...article,
        body: [
          article.body[0],
          article.body[1],
          article.body[2],
          "Editors marked this tail as short on purpose. The layout should react by choosing furniture that covers otherwise blank column space without overlapping live copy.",
        ],
      };
    }

    return article;
  });
}

function createNoPullQuoteArticles(): Article[] {
  return cloneArticles(articles).map((article) => {
    if (article.slug === "agent-procedure-patterns" || article.slug === "schools-reading-lab" || article.slug === "market-hall") {
      return {
        ...article,
        pullQuotes: [],
      };
    }

    return article;
  });
}

function createFurnitureSufficiencyArticles(): Article[] {
  return cloneArticles(articles).map((article) => {
    if (article.slug === "schools-reading-lab") {
      return {
        ...article,
        pullQuotes: [],
        image: {
          ...article.image,
          layout: {
            ...article.image.layout,
            minHeight: 120,
            preferredHeight: 900,
            maxHeight: 900,
            aspectRatio: 0.2,
            crop: "contain",
            wrapsText: true,
          },
        },
        body: [
          article.body[0],
          article.body[1],
          "This pressure edition leaves only a compact continuation tail, so an oversized photo package must yield to readable copy.",
        ],
      };
    }

    if (article.slug === "market-hall") {
      return {
        ...article,
        pullQuotes: [
          "The economics depend on sharing, but a display quote that consumes a wide block of columns should not be admitted when it leaves only a few rows of live article copy around it. If the quote keeps expanding across the continuation, the solver should treat that furniture as editorially too expensive for this compact tail.",
        ],
        body: [
          article.body[0],
          article.body[1],
          "The hall still opens before dawn, but the continuation in this scenario is deliberately compact so the solver has to prefer readable copy over oversized furniture.",
        ],
      };
    }

    return article;
  });
}

function createLongImageCaptionArticles(): Article[] {
  return cloneArticles(articles).map((article) => {
    if (article.slug !== "market-hall") return article;
    return {
      ...article,
      image: {
        ...article.image,
        caption:
          "The renovated market hall combines prep kitchens, storefront counters, shared cold storage, and a public retail counter where small producers can test packaging and pricing before committing to wholesale runs.",
      },
    };
  });
}

function createHeightPolicyLayoutPlan({
  regionShrinkToContent,
  defaultRows,
  blockShrinkToContent = false,
}: {
  regionShrinkToContent?: boolean;
  defaultRows?: number;
  blockShrinkToContent?: boolean;
}): EditionLayoutPlan {
  const plan = cloneLayoutPlan(createDefaultEditionLayoutPlan(articles.map((article) => article.slug)));
  const region = findPlanRegion(plan, "harbor-continuation");
  if (region) {
    if (regionShrinkToContent === undefined) {
      delete region.size;
    } else {
      region.size = { ...(region.size ?? {}), shrinkToContent: regionShrinkToContent };
    }
  }

  const block = findPlanBlock(plan, "agent-procedure-patterns-page-2");
  if (block?.type === "articleFrame" && defaultRows !== undefined) {
    block.size = {
      defaultRows,
      shrinkToContent: blockShrinkToContent,
    };
  }

  return plan;
}

function cloneArticles(source: Article[]): Article[] {
  return source.map(cloneArticle);
}

function createCompactChromeLayoutPlan(): EditionLayoutPlan {
  const plan = cloneLayoutPlan(createDefaultEditionLayoutPlan(articles.map((article) => article.slug)));
  const frontPage = plan.pages.find((page) => page.pageNumber === 1);
  const frontBlocks = frontPage?.regions.flatMap((region) => region.blocks) ?? [];
  for (const block of frontBlocks) {
    if (block.type !== "articleFrame") continue;
    block.chrome = {
      headline: {
        lineHeight: "0.72em",
        paintHeight: "1.14em",
        marginAfter: "0.32em",
      },
      deck: {
        lineHeight: "0.9em",
        paintHeight: "1.12em",
        minHeight: "2.8em",
      },
      byline: {
        lineHeight: "0.95em",
        paintHeight: "1.1em",
      },
    };
  }
  return plan;
}

function createFurnitureSufficiencyLayoutPlan(): EditionLayoutPlan {
  const plan = cloneLayoutPlan(createDefaultEditionLayoutPlan(articles.map((article) => article.slug)));
  const frontSchoolsBlock = findPlanBlock(plan, "front-schools-reading-lab");
  if (frontSchoolsBlock?.type === "articleFrame") {
    frontSchoolsBlock.cutPolicy = { maxBodyLines: 4, jumpTargetPage: 3 };
  }

  const frontMarketBlock = findPlanBlock(plan, "front-market-hall");
  if (frontMarketBlock?.type === "articleFrame") {
    frontMarketBlock.cutPolicy = { maxBodyLines: 4, jumpTargetPage: 3 };
  }

  const schoolsBlock = findPlanBlock(plan, "schools-reading-lab-page-3");
  if (schoolsBlock?.type === "articleFrame") {
    schoolsBlock.localGrid = { columns: { min: 2, preferred: 4, max: 4 } };
    schoolsBlock.media[0].placement.crop = "cropAllowed";
    schoolsBlock.media[0].placement.anchor = "center";
    schoolsBlock.media[0].placement.span = { min: 4, preferred: 4, max: 4 };
  }

  const marketBlock = findPlanBlock(plan, "market-hall-page-3");
  if (marketBlock?.type === "articleFrame") {
    marketBlock.media = [];
    marketBlock.pullQuote = {
      required: false,
      placements: [
        {
          anchor: "center",
          span: { min: 2, preferred: 2, max: 2 },
          vertical: "middle",
          collapse: "omit",
          crop: "preserve",
          wrapsText: true,
        },
      ],
    };
  }

  return plan;
}

function findPlanBlock(plan: EditionLayoutPlan, blockId: string): EditionLayoutPlan["pages"][number]["regions"][number]["blocks"][number] | undefined {
  return plan.pages.flatMap((page) => page.regions).flatMap((region) => region.blocks).find((block) => block.id === blockId);
}

function findPlanRegion(plan: EditionLayoutPlan, regionId: string): EditionLayoutPlan["pages"][number]["regions"][number] | undefined {
  return plan.pages.flatMap((page) => page.regions).find((region) => region.id === regionId);
}

function cloneLayoutPlan(plan: EditionLayoutPlan): EditionLayoutPlan {
  return JSON.parse(JSON.stringify(plan)) as EditionLayoutPlan;
}
