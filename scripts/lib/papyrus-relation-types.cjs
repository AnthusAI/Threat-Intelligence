const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const DEFAULT_RELATION_TYPES_PATH = path.join(__dirname, "..", "..", "corpora", "papyrus-semantic-relation-types.yml");

const RELATION_DOMAINS = new Set([
  "knowledge",
  "editorial",
  "commentary",
  "workflow",
  "evidence",
  "publication",
  "ontology",
  "generic",
  "classification",
]);

let relationTypeSeedCache = null;

function loadSemanticRelationTypeSeeds(filepath = DEFAULT_RELATION_TYPES_PATH) {
  if (relationTypeSeedCache && relationTypeSeedCache.filepath === filepath) return relationTypeSeedCache.types;
  const parsed = YAML.parse(fs.readFileSync(filepath, "utf8"));
  if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.relationTypes)) {
    throw new Error(`Invalid semantic relation type seed file: ${filepath}`);
  }
  const types = parsed.relationTypes.map((entry, index) => normalizeSemanticRelationTypeSeed(entry, index, filepath));
  relationTypeSeedCache = { filepath, types };
  return types;
}

function buildSemanticRelationTypeRecords(types, { now = new Date().toISOString() } = {}) {
  return types.map((type) => ({
    modelName: "SemanticRelationType",
    expected: semanticRelationTypeRecord(type, { now }),
  }));
}

function semanticRelationTypeRecord(type, { now = new Date().toISOString() } = {}) {
  return {
    id: semanticRelationTypeIdFor(type.key),
    key: type.key,
    label: type.label,
    inverseLabel: type.inverseLabel,
    description: type.description,
    domain: type.domain,
    status: type.status,
    allowedSubjectKinds: type.allowedSubjectKinds,
    allowedObjectKinds: type.allowedObjectKinds,
    isDirectional: type.isDirectional,
    isSymmetric: type.isSymmetric,
    isTransitive: type.isTransitive,
    contextPackTags: type.contextPackTags,
    createdAt: type.createdAt ?? now,
    updatedAt: now,
    metadata: JSON.stringify(type.metadata ?? {}),
  };
}

function buildRelationTypeLookup(types = loadSemanticRelationTypeSeeds()) {
  return new Map(types.map((type) => [type.key, type]));
}

function semanticRelationTypeFieldsForPredicate(predicate, types = loadSemanticRelationTypeSeeds()) {
  const key = normalizeRelationTypeKey(predicate);
  const type = buildRelationTypeLookup(types).get(key);
  if (!type) {
    return {
      relationTypeKey: key,
      relationDomain: "generic",
    };
  }
  return {
    relationTypeId: semanticRelationTypeIdFor(type.key),
    relationTypeKey: type.key,
    relationDomain: type.domain,
  };
}

function buildSemanticRelationBackfillRecords(relations, types = loadSemanticRelationTypeSeeds()) {
  return relations.map((relation) => {
    const fields = semanticRelationTypeFieldsForPredicate(relation.relationTypeKey ?? relation.predicate, types);
    const expected = {
      id: relation.id,
      relationTypeId: fields.relationTypeId ?? null,
      relationTypeKey: fields.relationTypeKey,
      relationDomain: fields.relationDomain,
    };
    return {
      modelName: "SemanticRelation",
      expected,
      current: relation,
      unknownType: !fields.relationTypeId,
      action: relationTypeFieldsEqual(relation, expected) ? "noop" : "update",
    };
  });
}

function relationTypeFieldsEqual(relation, expected) {
  return (relation.relationTypeId ?? undefined) === (expected.relationTypeId ?? undefined)
    && (relation.relationTypeKey ?? undefined) === (expected.relationTypeKey ?? undefined)
    && (relation.relationDomain ?? undefined) === (expected.relationDomain ?? undefined);
}

function normalizeSemanticRelationTypeSeed(entry, index, filepath) {
  const key = normalizeRelationTypeKey(entry.key);
  if (!key) throw new Error(`Relation type at index ${index} in ${filepath} is missing key.`);
  const domain = String(entry.domain ?? "generic").trim();
  if (!RELATION_DOMAINS.has(domain)) {
    throw new Error(`Relation type ${key} in ${filepath} has unsupported domain ${domain}.`);
  }
  return {
    key,
    label: stringOrDefault(entry.label, key.replaceAll("_", " ")),
    inverseLabel: stringOrDefault(entry.inverseLabel, stringOrDefault(entry.label, key.replaceAll("_", " "))),
    description: stringOrDefault(entry.description, ""),
    domain,
    status: stringOrDefault(entry.status, "active"),
    allowedSubjectKinds: normalizeStringArray(entry.allowedSubjectKinds),
    allowedObjectKinds: normalizeStringArray(entry.allowedObjectKinds),
    isDirectional: Boolean(entry.isDirectional ?? true),
    isSymmetric: Boolean(entry.isSymmetric),
    isTransitive: Boolean(entry.isTransitive),
    contextPackTags: normalizeStringArray(entry.contextPackTags),
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : null,
    metadata: entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {},
  };
}

function semanticRelationTypeIdFor(key) {
  return `semantic-relation-type-${safeId(key)}`;
}

function normalizeRelationTypeKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
}

function stringOrDefault(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safeId(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 140) || hashShort(value);
}

function hashShort(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex").slice(0, 16);
}

module.exports = {
  DEFAULT_RELATION_TYPES_PATH,
  RELATION_DOMAINS,
  buildRelationTypeLookup,
  buildSemanticRelationBackfillRecords,
  buildSemanticRelationTypeRecords,
  loadSemanticRelationTypeSeeds,
  normalizeRelationTypeKey,
  semanticRelationTypeFieldsForPredicate,
  semanticRelationTypeIdFor,
};
