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
  const textAttachment = selectExtractedTextAttachment(reference, attachments);
  return textAttachment?.storagePath ?? null;
}

function extractedTextAttachmentsForReference(reference, attachments = []) {
  return attachments
    .filter((attachment) => attachment.referenceLineageId === reference?.lineageId)
    .filter((attachment) => (
      attachment.role === "extracted_text"
      && hasCorpusStoragePath(attachment.storagePath)
      && isBiblicusExtractionSnapshotTextPath(attachment.storagePath, reference?.externalItemId)
    ));
}

function selectExtractedTextAttachment(reference, attachments = []) {
  return extractedTextAttachmentsForReference(reference, attachments)
    .sort(compareReferenceAttachmentsByFreshness)
    .at(0) ?? null;
}

function compareReferenceAttachmentsByFreshness(left, right) {
  return String(right.importedAt ?? "").localeCompare(String(left.importedAt ?? ""))
    || String(right.id ?? "").localeCompare(String(left.id ?? ""));
}

function isBiblicusExtractionSnapshotTextPath(storagePath, itemId = null) {
  if (!hasCorpusStoragePath(storagePath)) return false;
  const normalized = String(storagePath).split(path.sep).join("/");
  const expectedSuffix = itemId ? `/${String(itemId)}.txt` : ".txt";
  return normalized.includes("/extracted/pipeline/")
    && normalized.includes("/text/")
    && normalized.endsWith(expectedSuffix);
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
  const textByStoragePath = new Map();
  const root = corpusPath ? path.resolve(corpusPath) : null;
  if (!root) return { itemIds, textByItemId, textByStoragePath, snapshotIds: [] };
  const extractedRoot = path.join(root, "extracted", "pipeline");
  if (!fs.existsSync(extractedRoot)) return { itemIds, textByItemId, textByStoragePath, snapshotIds: [] };
  const snapshots = fs.readdirSync(extractedRoot)
    .filter((entry) => fs.statSync(path.join(extractedRoot, entry)).isDirectory())
    .map((snapshotId) => extractionSnapshotEntry({ root, extractedRoot, snapshotId }))
    .filter(Boolean)
    .sort(compareExtractionSnapshotEntries);
  for (const snapshot of snapshots) {
    for (const item of snapshot.items) {
      if (!item.itemId || !item.localPath || !item.storagePath) continue;
      itemIds.add(item.itemId);
      textByItemId.set(item.itemId, item);
      textByStoragePath.set(item.storagePath, item);
    }
  }
  return { itemIds, textByItemId, textByStoragePath, snapshotIds: snapshots.map((entry) => entry.snapshotId) };
}

function extractionSnapshotEntry({ root, extractedRoot, snapshotId }) {
  const snapshotDir = path.join(extractedRoot, snapshotId);
  const manifestPath = path.join(snapshotDir, "manifest.json");
  const manifest = readJsonIfExists(manifestPath);
  const configuration = manifest?.configuration ?? {};
  const extractorId = configuration.extractor_id ?? "pipeline";
  const createdAt = manifest?.created_at ?? null;
  const items = [];
  if (Array.isArray(manifest?.items)) {
    for (const item of manifest.items) {
      if (item?.status !== "extracted" || !item.final_text_relpath) continue;
      const localPath = path.join(snapshotDir, ...String(item.final_text_relpath).split("/"));
      if (!fs.existsSync(localPath)) continue;
      const storagePath = corpusStoragePath(root, localPath);
      if (!storagePath) continue;
      const finalStage = Array.isArray(item.stage_results)
        ? item.stage_results.find((stage) => stage.stage_index === item.final_stage_index)
        : null;
      items.push({
        itemId: item.item_id,
        snapshotId,
        extractorId,
        localPath,
        storagePath,
        manifestPath,
        finalTextRelpath: item.final_text_relpath,
        finalMetadataRelpath: item.final_metadata_relpath ?? null,
        configurationId: configuration.configuration_id ?? null,
        configurationName: configuration.name ?? null,
        finalProducerExtractorId: item.final_producer_extractor_id ?? null,
        finalStageExtractorId: item.final_stage_extractor_id ?? null,
        finalStageIndex: item.final_stage_index ?? null,
        finalSourceStageIndex: item.final_source_stage_index ?? null,
        textCharacters: finalStage?.text_characters ?? null,
        status: item.status,
        errorType: item.error_type ?? null,
        errorMessage: item.error_message ?? null,
        createdAt,
      });
    }
  } else {
    const textDir = path.join(snapshotDir, "text");
    if (!fs.existsSync(textDir)) return null;
    for (const filename of fs.readdirSync(textDir)) {
      if (!filename.endsWith(".txt")) continue;
      const localPath = path.join(textDir, filename);
      const storagePath = corpusStoragePath(root, localPath);
      if (!storagePath) continue;
      items.push({
        itemId: filename.slice(0, -4),
        snapshotId,
        extractorId,
        localPath,
        storagePath,
        manifestPath: fs.existsSync(manifestPath) ? manifestPath : null,
        finalTextRelpath: `text/${filename}`,
        finalMetadataRelpath: null,
        configurationId: configuration.configuration_id ?? null,
        configurationName: configuration.name ?? null,
        finalProducerExtractorId: null,
        finalStageExtractorId: null,
        finalStageIndex: null,
        finalSourceStageIndex: null,
        textCharacters: null,
        status: "extracted",
        errorType: null,
        errorMessage: null,
        createdAt,
      });
    }
  }
  return { snapshotId, createdAt, items };
}

function compareExtractionSnapshotEntries(left, right) {
  return String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? ""))
    || String(left.snapshotId).localeCompare(String(right.snapshotId));
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function corpusStoragePath(root, localPath) {
  const relativePath = path.relative(path.resolve(root), localPath).split(path.sep).join("/");
  if (!relativePath || relativePath.startsWith("..")) return null;
  return `${path.basename(path.resolve(root))}/${relativePath}`.startsWith("corpora/")
    ? `${path.basename(path.resolve(root))}/${relativePath}`
    : `corpora/${path.basename(path.resolve(root))}/${relativePath}`;
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
  const textAttachmentExists = Boolean(textStoragePath);
  const textAttachmentPresentInIndex = !textStoragePath
    || !extractionIndex?.textByStoragePath
    || extractionIndex.textByStoragePath.has(textStoragePath);
  const extracted = textAttachmentExists && textAttachmentPresentInIndex;
  const extractable = isExtractableMediaType(mediaType);
  const textState = extracted
    ? SOURCE_TEXT_STATES.TEXT_READY
    : hasExtractionSnapshot
      ? SOURCE_TEXT_STATES.SNAPSHOT_EXTRACTED
      : storagePath && extractable
        ? SOURCE_TEXT_STATES.MISSING_TEXT
        : SOURCE_TEXT_STATES.NOT_APPLICABLE;

  if (extracted) {
    return {
      state: SOURCE_READINESS_STATES.EXTRACTED,
      reason: "extracted_text_snapshot_attachment_found",
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
      reason: hasExtractionSnapshot ? "snapshot_extracted_missing_attachment" : "corpus_source_available",
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
  isBiblicusExtractionSnapshotTextPath,
  selectExtractedTextAttachment,
  referenceHasExtractedText,
  referenceSourceReadiness,
  sourceMediaTypeForReference,
  sourceStoragePathForReference,
  textStoragePathForReference,
};
