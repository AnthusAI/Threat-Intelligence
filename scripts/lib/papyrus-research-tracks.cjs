const fs = require("node:fs");
const path = require("node:path");

const RESEARCH_TRACKS_DIR = path.resolve(__dirname, "..", "..", "procedures", "newsroom", "tracks");

function listResearchTracks(options = {}) {
  const tracksDir = options.tracksDir ? path.resolve(options.tracksDir) : RESEARCH_TRACKS_DIR;
  if (!fs.existsSync(tracksDir)) return [];
  return fs.readdirSync(tracksDir)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => loadResearchTrack(path.basename(entry, ".json"), { tracksDir }));
}

function loadResearchTrack(trackKey, options = {}) {
  const normalizedKey = safeTrackKey(trackKey);
  const tracksDir = options.tracksDir ? path.resolve(options.tracksDir) : RESEARCH_TRACKS_DIR;
  const filepath = path.join(tracksDir, `${normalizedKey}.json`);
  if (!fs.existsSync(filepath)) throw new Error(`Unknown research track: ${normalizedKey}`);
  const payload = JSON.parse(fs.readFileSync(filepath, "utf8"));
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Research track must be a JSON object: ${filepath}`);
  }
  if (safeTrackKey(payload.key ?? normalizedKey) !== normalizedKey) {
    throw new Error(`Research track key mismatch for ${filepath}`);
  }
  if (!Array.isArray(payload.assignmentTemplates) || !payload.assignmentTemplates.length) {
    throw new Error(`Research track ${normalizedKey} must define assignmentTemplates.`);
  }
  return {
    ...payload,
    key: normalizedKey,
    filepath,
  };
}

function resolveResearchTrackTemplates(track, trackLenses) {
  const requested = normalizeTrackLensList(trackLenses);
  if (!requested.length) return track.assignmentTemplates.map(assertTemplateShape);

  const templateByLens = new Map(track.assignmentTemplates.map((template) => [safeTrackKey(template.lens), assertTemplateShape(template)]));
  return requested.map((lens) => {
    const template = templateByLens.get(lens);
    if (!template) throw new Error(`Unknown research lens '${lens}' for track ${track.key}.`);
    return template;
  });
}

function normalizeTrackLensList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(safeTrackKey).filter(Boolean);
  return String(value)
    .split(",")
    .map((entry) => safeTrackKey(entry))
    .filter(Boolean);
}

function assertTemplateShape(template) {
  if (!template || typeof template !== "object" || Array.isArray(template)) {
    throw new Error("Research track assignment template must be an object.");
  }
  const lens = safeTrackKey(template.lens);
  if (!lens) throw new Error("Research track assignment template must define lens.");
  return {
    ...template,
    lens,
    expectedEvidenceClasses: normalizeStringArray(template.expectedEvidenceClasses),
    comparisonQuestions: normalizeStringArray(template.comparisonQuestions),
  };
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function safeTrackKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

module.exports = {
  RESEARCH_TRACKS_DIR,
  listResearchTracks,
  loadResearchTrack,
  normalizeTrackLensList,
  resolveResearchTrackTemplates,
};
