import { type Article, articles, editionDate } from "./articles";
import type { EditionContent } from "./content-types";
import { createDefaultEditionLayoutPlan } from "./layout-plan";
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
    if (article.slug === "harbor-grid" || article.slug === "schools-reading-lab" || article.slug === "market-hall") {
      return {
        ...article,
        pullQuotes: [],
      };
    }

    return article;
  });
}

function cloneArticles(source: Article[]): Article[] {
  return source.map(cloneArticle);
}
