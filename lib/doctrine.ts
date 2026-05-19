export const DOCTRINE_ITEM_TYPE = "doctrine";
export const DOCTRINE_ITEM_STATUS = "private";
export const DOCTRINE_ITEM_TYPE_STATUS = "doctrine#private";

export type DoctrineKind = "mission" | "policy";
export type DoctrineScope = "publication" | "category";

export type DoctrineDefinition = {
  kind: DoctrineKind;
  label: string;
  slug: string;
  id: string;
  lineageId: string;
};

export type DoctrineCategory = {
  categorySetId: string;
  categoryKey: string;
  displayName: string;
  shortTitle?: string | null;
  rank?: number | null;
  depth?: number | null;
  lineageId?: string | null;
  id?: string | null;
};

export const DOCTRINE_DEFINITIONS: DoctrineDefinition[] = [
  {
    kind: "mission",
    label: "Editorial Mission",
    slug: "editorial-doctrine-mission",
    id: "item-editorial-doctrine-mission-v1",
    lineageId: "item-editorial-doctrine-mission",
  },
  {
    kind: "policy",
    label: "Editorial Policy",
    slug: "editorial-doctrine-policy",
    id: "item-editorial-doctrine-policy-v1",
    lineageId: "item-editorial-doctrine-policy",
  },
];

export const DOCTRINE_DEFINITION_BY_KIND = new Map(
  DOCTRINE_DEFINITIONS.map((definition) => [definition.kind, definition]),
);

export function buildCategoryDoctrineDefinition(category: DoctrineCategory, kind: DoctrineKind): DoctrineDefinition {
  const safeCategoryKey = safeDoctrineKey(category.categoryKey);
  const categoryLineageId = category.lineageId ?? category.id ?? category.categoryKey;
  const safeCategoryLineageId = safeDoctrineKey(categoryLineageId);
  const label = kind === "mission" ? "Category Mission" : "Category Policies";
  return {
    kind,
    label,
    slug: `desk-doctrine-${safeCategoryKey}-${kind}`,
    id: `item-desk-doctrine-${safeCategoryLineageId}-${kind}-v1`,
    lineageId: `item-desk-doctrine-${safeCategoryLineageId}-${kind}`,
  };
}

export function getCategoryDoctrineDefinitions(category: DoctrineCategory): DoctrineDefinition[] {
  return [
    buildCategoryDoctrineDefinition(category, "mission"),
    buildCategoryDoctrineDefinition(category, "policy"),
  ];
}

export function categoryDoctrineEditorialValue(category: DoctrineCategory, kind: DoctrineKind): string {
  return JSON.stringify({
    scope: "category",
    kind,
    categorySetId: category.categorySetId,
    categoryLineageId: category.lineageId ?? category.id ?? category.categoryKey,
    categoryKey: category.categoryKey,
    categoryDepth: category.depth ?? null,
  });
}

export function buildDeskDoctrineDefinition(category: DoctrineCategory, kind: DoctrineKind): DoctrineDefinition {
  return buildCategoryDoctrineDefinition(category, kind);
}

export function getDeskDoctrineDefinitions(category: DoctrineCategory): DoctrineDefinition[] {
  return getCategoryDoctrineDefinitions(category);
}

export function deskDoctrineEditorialValue(category: DoctrineCategory, kind: DoctrineKind): string {
  return categoryDoctrineEditorialValue(category, kind);
}

export function isDeskDoctrineSlug(slug: string | null | undefined): boolean {
  return typeof slug === "string" && slug.startsWith("desk-doctrine-");
}

export function doctrineBodyToText(body: Array<string | null> | null | undefined): string {
  return compactDoctrineParagraphs(body).join("\n\n");
}

export function doctrineTextToBody(text: string): string[] {
  return normalizeDoctrineText(text)
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export function doctrineEditorialValue(kind: DoctrineKind): string {
  return JSON.stringify({ kind });
}

function safeDoctrineKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "topic";
}

function normalizeDoctrineText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

function compactDoctrineParagraphs(body: Array<string | null> | null | undefined): string[] {
  return (body ?? [])
    .map((paragraph) => (typeof paragraph === "string" ? paragraph.trim() : ""))
    .filter(Boolean);
}
