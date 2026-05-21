const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const DEFAULT_NEWSROOM_SECTIONS_PATH = path.join(__dirname, "..", "..", "corpora", "papyrus-newsroom-sections.yml");
const SECTION_TYPES = new Set(["canonical", "floating", "rotating"]);

let newsroomSectionSeedCache = null;

function loadNewsroomSectionSeeds(filepath = DEFAULT_NEWSROOM_SECTIONS_PATH) {
  if (newsroomSectionSeedCache && newsroomSectionSeedCache.filepath === filepath) return newsroomSectionSeedCache.sections;
  const parsed = YAML.parse(fs.readFileSync(filepath, "utf8"));
  if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.sections)) {
    throw new Error(`Invalid newsroom section seed file: ${filepath}`);
  }
  const sections = parsed.sections.map((entry, index) => normalizeNewsroomSectionSeed(entry, index, filepath));
  newsroomSectionSeedCache = { filepath, sections };
  return sections;
}

function buildNewsroomSectionRecords(sections, { now = new Date().toISOString() } = {}) {
  return sections.map((section) => ({
    modelName: "NewsroomSection",
    expected: {
      id: section.id,
      title: section.title,
      shortTitle: section.shortTitle,
      type: section.type,
      editorialMission: section.editorialMission,
      editorialPolicy: section.editorialPolicy,
      enabled: section.enabled,
      enabledStatus: section.enabled ? "enabled" : "disabled",
      sortOrder: section.sortOrder,
      defaultArticleTypes: section.defaultArticleTypes,
      defaultPageBudget: section.defaultPageBudget,
      assignmentGuidance: section.assignmentGuidance,
      killCriteria: section.killCriteria,
      visualGuidance: section.visualGuidance,
      createdAt: section.createdAt ?? now,
      updatedAt: now,
    },
  }));
}

function normalizeNewsroomSectionSeed(entry, index, filepath) {
  const id = String(entry.id ?? "").trim();
  if (!id) throw new Error(`Newsroom section at index ${index} in ${filepath} is missing id.`);
  const title = requiredText(entry.title, `title for section ${id} in ${filepath}`);
  const rawType = String(entry.type ?? "").trim().toLowerCase();
  const type = rawType === "rotating" ? "floating" : rawType;
  if (!SECTION_TYPES.has(type)) {
    throw new Error(`Newsroom section ${id} in ${filepath} has unsupported type '${entry.type}'.`);
  }
  return {
    id,
    title,
    shortTitle: requiredText(entry.shortTitle, `shortTitle for section ${id} in ${filepath}`),
    type,
    editorialMission: requiredText(entry.editorialMission, `editorialMission for section ${id} in ${filepath}`),
    editorialPolicy: requiredText(entry.editorialPolicy, `editorialPolicy for section ${id} in ${filepath}`),
    enabled: typeof entry.enabled === "boolean" ? entry.enabled : true,
    sortOrder: positiveInteger(entry.sortOrder, index + 1),
    defaultArticleTypes: normalizeStringList(entry.defaultArticleTypes),
    defaultPageBudget: optionalInteger(entry.defaultPageBudget),
    assignmentGuidance: optionalText(entry.assignmentGuidance),
    killCriteria: optionalText(entry.killCriteria),
    visualGuidance: optionalText(entry.visualGuidance),
    createdAt: optionalText(entry.createdAt),
  };
}

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`Missing ${label}.`);
  return normalized;
}

function optionalText(value) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => optionalText(entry))
    .filter(Boolean);
}

function optionalInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  DEFAULT_NEWSROOM_SECTIONS_PATH,
  buildNewsroomSectionRecords,
  loadNewsroomSectionSeeds,
};
