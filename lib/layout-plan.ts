export const FRONT_TEASER_GRID_TEMPLATE_ID = "front.teaserGrid" as const;

export const MEDIA_PLACEMENT_TEMPLATE_IDS = [
  "rightColumnInset",
  "rightTwoColumnInset",
  "centerTwoColumnInset",
  "leftColumnInset",
  "wideTopBand",
] as const;

export const PULL_QUOTE_TEMPLATE_IDS = [
  "none",
  "rightRailMid",
  "leftRailMid",
  "centerTwoColumnBreak",
  "inlineMobileBreak",
] as const;

export type FrontPageTemplateId = typeof FRONT_TEASER_GRID_TEMPLATE_ID;
export type MediaPlacementTemplateId = (typeof MEDIA_PLACEMENT_TEMPLATE_IDS)[number];
export type PullQuoteTemplateId = (typeof PULL_QUOTE_TEMPLATE_IDS)[number];
export type PlannedPageKind = "singleContinuation" | "dualContinuation" | "photoContinuation";
export type PlannedSectionRole = "primary" | "top" | "bottom";

export type EditionLayoutPlan = {
  version: 1;
  frontPage: {
    pageNumber: 1;
    recipeId: string;
    templateId: FrontPageTemplateId;
    articleIds: string[];
    cutPolicies: Array<{
      articleId: string;
      maxBodyLines: number;
      continuationPageNumber: number;
    }>;
  };
  pages: Array<{
    pageNumber: number;
    recipeId: string;
    kind: PlannedPageKind;
    sections: Array<{
      articleId: string;
      role: PlannedSectionRole;
      mediaTemplateIds?: MediaPlacementTemplateId[];
      pullQuoteTemplateIds?: PullQuoteTemplateId[];
    }>;
    splitVariants?: number[];
  }>;
};

const PLANNED_PAGE_KINDS: PlannedPageKind[] = ["singleContinuation", "dualContinuation", "photoContinuation"];
const PLANNED_SECTION_ROLES: PlannedSectionRole[] = ["primary", "top", "bottom"];

export function createDefaultEditionLayoutPlan(articleIds: string[]): EditionLayoutPlan {
  const availableArticleIds = new Set(articleIds);
  const plannedPages: EditionLayoutPlan["pages"] = [
    {
      pageNumber: 2,
      recipeId: "photo-harbor-grid",
      kind: "photoContinuation",
      sections: [
        {
          articleId: "harbor-grid",
          role: "primary",
          mediaTemplateIds: ["centerTwoColumnInset", "rightColumnInset", "leftColumnInset", "wideTopBand"],
          pullQuoteTemplateIds: ["centerTwoColumnBreak", "rightRailMid", "leftRailMid"],
        },
      ],
    },
    {
      pageNumber: 3,
      recipeId: "shared-schools-reading-market-hall",
      kind: "dualContinuation",
      sections: [
        {
          articleId: "schools-reading-lab",
          role: "top",
          mediaTemplateIds: ["rightTwoColumnInset", "rightColumnInset", "leftColumnInset", "centerTwoColumnInset"],
          pullQuoteTemplateIds: ["leftRailMid", "rightRailMid", "centerTwoColumnBreak"],
        },
        {
          articleId: "market-hall",
          role: "bottom",
          mediaTemplateIds: ["leftColumnInset", "rightColumnInset", "centerTwoColumnInset"],
          pullQuoteTemplateIds: ["rightRailMid", "leftRailMid", "centerTwoColumnBreak"],
        },
      ],
      splitVariants: [0.5, 0.55, 0.45],
    },
  ];
  const pages = plannedPages.filter((page) => page.sections.every((section) => availableArticleIds.has(section.articleId)));

  return {
    version: 1,
    frontPage: {
      pageNumber: 1,
      recipeId: "front-page",
      templateId: FRONT_TEASER_GRID_TEMPLATE_ID,
      articleIds,
      cutPolicies: [
        { articleId: "harbor-grid", maxBodyLines: 22, continuationPageNumber: 2 },
        { articleId: "schools-reading-lab", maxBodyLines: 16, continuationPageNumber: 3 },
        { articleId: "market-hall", maxBodyLines: 14, continuationPageNumber: 3 },
      ].filter((policy) => availableArticleIds.has(policy.articleId)),
    },
    pages,
  };
}

export function normalizeEditionLayoutPlan(
  value: unknown,
  label = "Edition.layoutPlan",
): EditionLayoutPlan | undefined {
  const parsed = parseMaybeJson(value, label);
  if (parsed === undefined || parsed === null) return undefined;
  const record = requireRecord(parsed, label);

  if (record.version !== 1) {
    throw new Error(`${label}.version must be 1`);
  }

  const frontPageRecord = requireRecord(record.frontPage, `${label}.frontPage`);
  const pages = requireArray(record.pages, `${label}.pages`).map((page, index) =>
    normalizePage(page, `${label}.pages[${index}]`),
  );

  return {
    version: 1,
    frontPage: {
      pageNumber: requireLiteralNumber(frontPageRecord.pageNumber, 1, `${label}.frontPage.pageNumber`),
      recipeId: requireString(frontPageRecord.recipeId, `${label}.frontPage.recipeId`),
      templateId: requireLiteralString(
        frontPageRecord.templateId,
        FRONT_TEASER_GRID_TEMPLATE_ID,
        `${label}.frontPage.templateId`,
      ),
      articleIds: requireStringArray(frontPageRecord.articleIds, `${label}.frontPage.articleIds`),
      cutPolicies: requireArray(frontPageRecord.cutPolicies, `${label}.frontPage.cutPolicies`).map((policy, index) =>
        normalizeCutPolicy(policy, `${label}.frontPage.cutPolicies[${index}]`),
      ),
    },
    pages,
  };
}

export function validateEditionLayoutPlanForArticles(
  layoutPlan: EditionLayoutPlan,
  articleIds: string[],
  label = "Edition.layoutPlan",
): EditionLayoutPlan {
  const availableArticleIds = new Set(articleIds);
  const plannedPageNumbers = new Set(layoutPlan.pages.map((page) => page.pageNumber));
  const seenPageNumbers = new Set<number>();

  for (const articleId of layoutPlan.frontPage.articleIds) {
    requireKnownArticle(articleId, availableArticleIds, `${label}.frontPage.articleIds`);
  }
  for (const policy of layoutPlan.frontPage.cutPolicies) {
    requireKnownArticle(policy.articleId, availableArticleIds, `${label}.frontPage.cutPolicies`);
    if (!plannedPageNumbers.has(policy.continuationPageNumber)) {
      throw new Error(
        `${label}.frontPage.cutPolicies for ${policy.articleId} points to missing page ${policy.continuationPageNumber}`,
      );
    }
  }

  for (const page of layoutPlan.pages) {
    if (page.pageNumber <= 1) {
      throw new Error(`${label}.pages pageNumber must be greater than 1`);
    }
    if (seenPageNumbers.has(page.pageNumber)) {
      throw new Error(`${label}.pages contains duplicate pageNumber ${page.pageNumber}`);
    }
    seenPageNumbers.add(page.pageNumber);
    validatePageSections(page, availableArticleIds, label);
  }

  return layoutPlan;
}

function normalizePage(value: unknown, label: string): EditionLayoutPlan["pages"][number] {
  const record = requireRecord(value, label);
  const kind = requireOneOf(record.kind, PLANNED_PAGE_KINDS, `${label}.kind`);
  const page = {
    pageNumber: requirePositiveInteger(record.pageNumber, `${label}.pageNumber`),
    recipeId: requireString(record.recipeId, `${label}.recipeId`),
    kind,
    sections: requireArray(record.sections, `${label}.sections`).map((section, index) =>
      normalizeSection(section, `${label}.sections[${index}]`),
    ),
    splitVariants:
      record.splitVariants === undefined
        ? undefined
        : requireArray(record.splitVariants, `${label}.splitVariants`).map((candidate, index) =>
            requireSplitVariant(candidate, `${label}.splitVariants[${index}]`),
          ),
  };

  return page;
}

function normalizeSection(value: unknown, label: string): EditionLayoutPlan["pages"][number]["sections"][number] {
  const record = requireRecord(value, label);
  return {
    articleId: requireString(record.articleId, `${label}.articleId`),
    role: requireOneOf(record.role, PLANNED_SECTION_ROLES, `${label}.role`),
    mediaTemplateIds:
      record.mediaTemplateIds === undefined
        ? undefined
        : requireTemplateArray(
            record.mediaTemplateIds,
            MEDIA_PLACEMENT_TEMPLATE_IDS,
            `${label}.mediaTemplateIds`,
          ),
    pullQuoteTemplateIds:
      record.pullQuoteTemplateIds === undefined
        ? undefined
        : requireTemplateArray(
            record.pullQuoteTemplateIds,
            PULL_QUOTE_TEMPLATE_IDS,
            `${label}.pullQuoteTemplateIds`,
          ),
  };
}

function normalizeCutPolicy(value: unknown, label: string): EditionLayoutPlan["frontPage"]["cutPolicies"][number] {
  const record = requireRecord(value, label);
  return {
    articleId: requireString(record.articleId, `${label}.articleId`),
    maxBodyLines: requirePositiveInteger(record.maxBodyLines, `${label}.maxBodyLines`),
    continuationPageNumber: requirePositiveInteger(record.continuationPageNumber, `${label}.continuationPageNumber`),
  };
}

function validatePageSections(
  page: EditionLayoutPlan["pages"][number],
  availableArticleIds: Set<string>,
  label: string,
) {
  if ((page.kind === "singleContinuation" || page.kind === "photoContinuation") && page.sections.length !== 1) {
    throw new Error(`${label}.pages page ${page.pageNumber} with kind ${page.kind} must have exactly one section`);
  }
  if (page.kind === "dualContinuation" && page.sections.length !== 2) {
    throw new Error(`${label}.pages page ${page.pageNumber} with kind dualContinuation must have exactly two sections`);
  }

  for (const section of page.sections) {
    requireKnownArticle(section.articleId, availableArticleIds, `${label}.pages[${page.pageNumber}].sections`);
  }
}

function parseMaybeJson(value: unknown, label: string): unknown {
  if (typeof value !== "string") return value;
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((item, index) => requireString(item, `${label}[${index}]`));
}

function requireLiteralNumber<T extends number>(value: unknown, expected: T, label: string): T {
  if (value !== expected) throw new Error(`${label} must be ${expected}`);
  return expected;
}

function requireLiteralString<T extends string>(value: unknown, expected: T, label: string): T {
  if (value !== expected) throw new Error(`${label} must be ${expected}`);
  return expected;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Number(value);
}

function requireSplitVariant(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new Error(`${label} must be a number between 0 and 1`);
  }
  return value;
}

function requireOneOf<const T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${label} must be one of ${allowed.join(", ")}`);
  }
  return value;
}

function requireTemplateArray<const T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number][] {
  return requireArray(value, label).map((item, index) => requireOneOf(item, allowed, `${label}[${index}]`));
}

function requireKnownArticle(articleId: string, availableArticleIds: Set<string>, label: string) {
  if (!availableArticleIds.has(articleId)) {
    throw new Error(`${label} references missing article ${articleId}`);
  }
}
