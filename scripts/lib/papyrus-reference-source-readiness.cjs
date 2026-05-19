const fs = require("node:fs");
const path = require("node:path");

const SOURCE_READINESS_STATES = Object.freeze({
  URL_ONLY: "url_only",
  ACCESSIONED: "accessioned",
  EXTRACTABLE: "extractable",
  EXTRACTED: "extracted",
  BLOCKED: "blocked",
});

const SOURCE_TEXT_STATES = Object.freeze({
  TEXT_READY: "text_ready",
  SNAPSHOT_EXTRACTED: "snapshot_extracted",
  MISSING_TEXT: "missing_text",
  NOT_APPLICABLE: "not_applicable",
});

const EXTRACTABLE_MEDIA_TYPES = new Set([
  "application/pdf",
  "text/html",
  "text/markdown",
  "text/plain",
  "application/xhtml+xml",
  "application/json",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "video/mp4",
  "video/webm",
]);

function sourceStoragePathForReference(reference, attachments = []) {
  if (hasCorpusStoragePath(reference?.storagePath)) return reference.storagePath;
  const sourceAttachment = attachments
    .filter((attachment) => attachment.referenceLineageId === reference?.lineageId)
    .find((attachment) => attachment.role === "source" && hasCorpusStoragePath(attachment.storagePath));
  return sourceAttachment?.storagePath ?? null;
}

function sourceMediaTypeForReference(reference, attachments = []) {
  if (reference?.mediaType) return reference.mediaType;
  const sourceAttachment = attachments
    .filter((attachment) => attachment.referenceLineageId === reference?.lineageId)
    .find((attachment) => attachment.role === "source" && attachment.mediaType);
  return sourceAttachment?.mediaType ?? null;
}

function textStoragePathForReference(reference, attachments = []) {
  const expectedPath = stableExtractedTextStoragePathForReference(reference);
  const textAttachment = attachments
    .filter((attachment) => attachment.referenceLineageId === reference?.lineageId)
    .find((attachment) => (
      attachment.role === "extracted_text"
      && attachment.filename === "text.txt"
      && hasCorpusStoragePath(attachment.storagePath)
      && (!expectedPath || attachment.storagePath.endsWith(expectedPath))
    ));
  return textAttachment?.storagePath ?? null;
}

function stableExtractedTextRelativePath(itemId) {
  if (!itemId) return null;
  return path.posix.join("imports", encodeURIComponent(String(itemId)), "text.txt");
}

function stableExtractedTextStoragePath(corpusPath, itemId) {
  const relativePath = stableExtractedTextRelativePath(itemId);
  if (!corpusPath || !relativePath) return null;
  return `${String(corpusPath).replace(/\/+$/g, "")}/${relativePath}`;
}

function stableExtractedTextLocalPath(corpusPath, itemId) {
  const relativePath = stableExtractedTextRelativePath(itemId);
  if (!corpusPath || !relativePath) return null;
  return path.join(path.resolve(corpusPath), ...relativePath.split("/"));
}

function stableExtractedTextStoragePathForReference(reference) {
  return stableExtractedTextRelativePath(reference?.externalItemId);
}

function hasCorpusStoragePath(value) {
  return typeof value === "string" && value.startsWith("corpora/");
}

function isExtractableMediaType(mediaType) {
  if (!mediaType) return true;
  const normalized = String(mediaType).split(";", 1)[0].trim().toLowerCase();
  return EXTRACTABLE_MEDIA_TYPES.has(normalized)
    || normalized.startsWith("text/")
    || normalized.startsWith("audio/");
}

function buildExtractionIndex(corpusPath) {
  const itemIds = new Set();
  const textByItemId = new Map();
  const root = corpusPath ? path.resolve(corpusPath) : null;
  if (!root) return { itemIds, textByItemId, snapshotIds: [] };
  const extractedRoot = path.join(root, "extracted", "pipeline");
  if (!fs.existsSync(extractedRoot)) return { itemIds, textByItemId, snapshotIds: [] };
  const snapshotIds = fs.readdirSync(extractedRoot)
    .filter((entry) => fs.statSync(path.join(extractedRoot, entry)).isDirectory())
    .sort();
  for (const snapshotId of snapshotIds) {
    const textDir = path.join(extractedRoot, snapshotId, "text");
    if (!fs.existsSync(textDir)) continue;
    for (const filename of fs.readdirSync(textDir)) {
      if (!filename.endsWith(".txt")) continue;
      const itemId = filename.slice(0, -4);
      itemIds.add(itemId);
      textByItemId.set(itemId, {
        snapshotId,
        localPath: path.join(textDir, filename),
      });
    }
  }
  return { itemIds, textByItemId, snapshotIds };
}

function referenceHasExtractedText(reference, extractionIndex) {
  if (!reference?.externalItemId || !extractionIndex?.itemIds) return false;
  return extractionIndex.itemIds.has(reference.externalItemId);
}

function referenceSourceReadiness(reference, attachments = [], extractionIndex = null) {
  const storagePath = sourceStoragePathForReference(reference, attachments);
  const textStoragePath = textStoragePathForReference(reference, attachments);
  const mediaType = sourceMediaTypeForReference(reference, attachments);
  const hasSourceUri = Boolean(reference?.sourceUri);
  const hasExtractionSnapshot = referenceHasExtractedText(reference, extractionIndex);
  const extracted = Boolean(textStoragePath);
  const extractable = isExtractableMediaType(mediaType);
  const textState = textStoragePath
    ? SOURCE_TEXT_STATES.TEXT_READY
    : hasExtractionSnapshot
      ? SOURCE_TEXT_STATES.SNAPSHOT_EXTRACTED
      : storagePath && extractable
        ? SOURCE_TEXT_STATES.MISSING_TEXT
        : SOURCE_TEXT_STATES.NOT_APPLICABLE;

  if (extracted) {
    return {
      state: SOURCE_READINESS_STATES.EXTRACTED,
      reason: "stable_text_attachment_found",
      storagePath,
      textStoragePath,
      mediaType,
      extracted: true,
      extractable,
      hasExtractionSnapshot,
      textState,
    };
  }
  if (storagePath && extractable) {
    return {
      state: SOURCE_READINESS_STATES.EXTRACTABLE,
      reason: hasExtractionSnapshot ? "snapshot_extracted_missing_stable_text" : "corpus_source_available",
      storagePath,
      textStoragePath,
      mediaType,
      extracted: false,
      extractable: true,
      hasExtractionSnapshot,
      textState,
    };
  }
  if (storagePath) {
    return {
      state: SOURCE_READINESS_STATES.ACCESSIONED,
      reason: "unsupported_or_unknown_extractor",
      storagePath,
      textStoragePath,
      mediaType,
      extracted: false,
      extractable: false,
      hasExtractionSnapshot,
      textState,
    };
  }
  if (hasSourceUri) {
    return {
      state: SOURCE_READINESS_STATES.URL_ONLY,
      reason: "missing_corpus_storage_path",
      storagePath: null,
      textStoragePath,
      mediaType,
      extracted: false,
      extractable: false,
      hasExtractionSnapshot,
      textState,
    };
  }
  return {
    state: SOURCE_READINESS_STATES.BLOCKED,
    reason: "missing_source_material",
    storagePath: null,
    textStoragePath,
    mediaType,
    extracted: false,
    extractable: false,
    hasExtractionSnapshot,
    textState,
  };
}

function buildReferenceSourceStatusRows({
  references = [],
  attachments = [],
  corpusId,
  curationStatus = "all",
  extractionIndex = null,
} = {}) {
  return references
    .filter((reference) => !corpusId || reference.corpusId === corpusId)
    .filter((reference) => reference.versionState === "current")
    .filter((reference) => curationStatus === "all" || reference.curationStatus === curationStatus)
    .map((reference) => {
      const readiness = referenceSourceReadiness(reference, attachments, extractionIndex);
      return {
        reference,
        readiness,
        state: readiness.state,
        reason: readiness.reason,
      };
    })
    .sort((left, right) => (
      String(left.state).localeCompare(String(right.state))
      || String(left.reference.curationStatus ?? "").localeCompare(String(right.reference.curationStatus ?? ""))
      || String(left.reference.externalItemId ?? left.reference.id).localeCompare(String(right.reference.externalItemId ?? right.reference.id))
    ));
}

module.exports = {
  EXTRACTABLE_MEDIA_TYPES,
  SOURCE_READINESS_STATES,
  SOURCE_TEXT_STATES,
  buildExtractionIndex,
  buildReferenceSourceStatusRows,
  hasCorpusStoragePath,
  isExtractableMediaType,
  referenceHasExtractedText,
  referenceSourceReadiness,
  sourceMediaTypeForReference,
  sourceStoragePathForReference,
  stableExtractedTextLocalPath,
  stableExtractedTextRelativePath,
  stableExtractedTextStoragePath,
  textStoragePathForReference,
};
