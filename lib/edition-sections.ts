import type { EditionSection } from "./content-types";
import type { PublicationItem } from "./publication-items";

export function createEditionSectionPlan(items: PublicationItem[], explicitSections?: unknown): EditionSection[] {
  const explicit = normalizeExplicitSections(explicitSections, items);
  if (explicit.length > 0) return explicit;
  return buildEditionSectionsFromArticles(items);
}

export function buildEditionSectionsFromArticles(
  items: PublicationItem[],
  sectionSubtitles?: Record<string, string> | null,
): EditionSection[] {
  const sections = new Map<string, EditionSection>();
  for (const item of items) {
    const label = normalizeSectionLabel(item.section);
    const key = createSectionKey(label);
    const existing = sections.get(key);
    if (existing) {
      if (!existing.itemIds.includes(item.slug)) existing.itemIds.push(item.slug);
      continue;
    }
    sections.set(key, {
      key,
      label,
      description: sectionSubtitles?.[label] ?? undefined,
      itemIds: [item.slug],
    });
  }
  return [...sections.values()];
}

export function findEditionSection(sections: EditionSection[], sectionKey: string): EditionSection | undefined {
  const normalized = createSectionKey(sectionKey);
  return sections.find((section) => section.key === normalized);
}

export function getEditionSectionItems(section: EditionSection, items: PublicationItem[]): PublicationItem[] {
  const itemsBySlug = new Map(items.map((item) => [item.slug, item]));
  return section.itemIds.map((itemId) => itemsBySlug.get(itemId)).filter((item): item is PublicationItem => Boolean(item));
}

export function createSectionKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "general";
}

function normalizeExplicitSections(value: unknown, items: PublicationItem[]): EditionSection[] {
  const parsed = parseMaybeJson(value);
  const nestedPlan = readObjectValue(parsed, "sectionPlan");
  const entries = Array.isArray(parsed)
    ? parsed
    : readObjectArray(parsed, "sections")
      ?? readObjectArray(parsed, "sectionPlan")
      ?? readObjectArray(nestedPlan, "sections");
  if (!entries) return [];

  const itemSlugs = new Set(items.map((item) => item.slug));
  return entries
    .map((entry) => normalizeSectionEntry(entry, itemSlugs))
    .filter((section): section is EditionSection => Boolean(section));
}

function normalizeSectionEntry(entry: unknown, itemSlugs: Set<string>): EditionSection | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const label = normalizeSectionLabel(readString(record.label) ?? readString(record.title) ?? readString(record.name) ?? readString(record.key));
  const key = createSectionKey(readString(record.key) ?? label);
  const itemIds = readStringArray(record.itemIds ?? record.items)
    .map((itemId) => itemId.trim())
    .filter((itemId, index, all) => itemSlugs.has(itemId) && all.indexOf(itemId) === index);

  if (!itemIds.length) return null;
  return {
    key,
    label,
    description: readString(record.description) ?? readString(record.subtitle),
    itemIds,
  };
}

function normalizeSectionLabel(value: string | null | undefined): string {
  const label = value?.trim();
  return label || "General";
}

function readObjectArray(value: unknown, key: string): unknown[] | null {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as Record<string, unknown>)[key];
  return Array.isArray(candidate) ? candidate : null;
}

function readObjectValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return null;
  return (value as Record<string, unknown>)[key];
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}
