const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function buildModelPayloadAttachment({ ownerKind, ownerId, ownerLineageId = null, ownerVersionNumber = null, ownerVersionKey = null, role, sortKey = role, mediaType, filename, content, importRunId = null, now = new Date().toISOString(), status = "active" }) {
  const body = Buffer.isBuffer(content)
    ? content
    : typeof content === "string"
      ? content
      : `${JSON.stringify(content ?? {}, null, 2)}\n`;
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  const storagePath = modelPayloadStoragePath(ownerKind, ownerId, role, filename);
  return {
    attachment: {
      id: modelAttachmentId(ownerKind, ownerId, role, sortKey),
      ownerKind,
      ownerId,
      ownerLineageId,
      ownerVersionNumber,
      ownerVersionKey,
      role,
      sortKey,
      storagePath,
      filename,
      mediaType,
      byteSize: buffer.length,
      sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      etag: null,
      importRunId,
      createdAt: now,
      updatedAt: now,
      status,
    },
    body,
  };
}

function buildJsonModelPayloadAttachment(input) {
  return buildModelPayloadAttachment({
    ...input,
    mediaType: "application/json",
    filename: input.filename ?? `${safeId(input.sortKey ?? input.role)}.json`,
    content: `${JSON.stringify(input.content ?? {}, null, 2)}\n`,
  });
}

function buildTextModelPayloadAttachment(input) {
  return buildModelPayloadAttachment({
    ...input,
    mediaType: input.mediaType ?? "text/plain",
    filename: input.filename ?? `${safeId(input.sortKey ?? input.role)}.txt`,
    content: String(input.content ?? ""),
  });
}

function buildBinaryModelPayloadAttachment(input) {
  return buildModelPayloadAttachment({
    ...input,
    content: Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content ?? ""),
  });
}

function attachmentRecord(entry) {
  return { modelName: "ModelAttachment", expected: entry.attachment, attachmentBody: entry.body };
}

function stripPrivatePayloadFields(modelName, input = {}) {
  const next = { ...input };
  if (modelName === "Message") {
    delete next.body;
    delete next.metadata;
  } else if (modelName === "Reference") {
    delete next.metadata;
  } else if (modelName === "Assignment") {
    delete next.brief;
    delete next.instructions;
    delete next.metadata;
  } else if (modelName === "AssignmentEvent") {
    delete next.metadata;
  } else if (modelName === "KnowledgeRawPayload") {
    delete next.payload;
  }
  return next;
}

async function uploadAttachmentBody(attachment, body, { client = null } = {}) {
  if (!client?.createModelAttachmentUpload || !client?.completeModelAttachmentUpload) {
    throw new Error("ModelAttachment upload requires a GraphQL authoring client with upload-slot support.");
  }
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ""), "utf8");
  const slot = await client.createModelAttachmentUpload(attachment);
  const headers = normalizeUploadHeaders(slot.requiredHeaders);
  const response = await fetch(slot.uploadUrl, {
    method: slot.method ?? "PUT",
    headers,
    body: buffer,
  });
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Failed to upload ModelAttachment ${attachment.id} to ${slot.storagePath}: ${response.status} ${response.statusText}${errorBody ? ` ${errorBody.slice(0, 240)}` : ""}`);
  }
  return client.completeModelAttachmentUpload(slot.uploadId, attachment);
}

async function downloadAttachmentBuffer(attachment, { client = null, bucket = null } = {}) {
  if (!attachment?.storagePath) return null;
  if (client?.createModelAttachmentDownload) {
    const slot = await client.createModelAttachmentDownload(attachment.id);
    if (!slot?.downloadUrl) throw new Error(`ModelAttachment ${attachment.id} download slot did not include a URL.`);
    const response = await fetch(slot.downloadUrl, {
      method: slot.method ?? "GET",
      headers: normalizeUploadHeaders(slot.requiredHeaders),
    });
    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`Failed to download ModelAttachment ${attachment.id} from ${slot.storagePath}: ${response.status} ${response.statusText}${errorBody ? ` ${errorBody.slice(0, 240)}` : ""}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
  const resolvedBucket = bucket ?? storageBucketFromAmplifyOutputs();
  if (!resolvedBucket) throw new Error("Could not resolve storage bucket for ModelAttachment download. Pass --bucket or refresh amplify_outputs.json.");
  const result = spawnSync("aws", [
    "s3",
    "cp",
    `s3://${resolvedBucket}/${attachment.storagePath}`,
    "-",
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : String(result.stderr ?? "");
    const stdout = Buffer.isBuffer(result.stdout) ? result.stdout.toString("utf8") : String(result.stdout ?? "");
    throw new Error(`Failed to download ModelAttachment ${attachment.id} from s3://${resolvedBucket}/${attachment.storagePath}: ${stderr || stdout}`);
  }
  return result.stdout;
}

async function downloadAttachmentBody(attachment, { client = null, bucket = null } = {}) {
  const buffer = await downloadAttachmentBuffer(attachment, { client, bucket });
  return buffer ? buffer.toString("utf8") : null;
}

function deleteAttachmentBody(attachment, { bucket = null, dryRun = false } = {}) {
  if (!attachment?.storagePath) return { deleted: false, skipped: true, storagePath: null };
  return deleteAttachmentStoragePath(attachment.storagePath, { bucket, dryRun });
}

function deleteAttachmentStoragePath(storagePath, { bucket = null, dryRun = false } = {}) {
  if (!storagePath) return { deleted: false, skipped: true, storagePath: null };
  const resolvedBucket = bucket ?? storageBucketFromAmplifyOutputs();
  if (!resolvedBucket) throw new Error("Could not resolve storage bucket for ModelAttachment delete. Pass --bucket or refresh amplify_outputs.json.");
  if (dryRun) return { deleted: false, skipped: false, storagePath, bucket: resolvedBucket, dryRun: true };
  const result = spawnSync("aws", [
    "s3",
    "rm",
    `s3://${resolvedBucket}/${storagePath}`,
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`Failed to delete ModelAttachment object s3://${resolvedBucket}/${storagePath}: ${result.stderr || result.stdout}`);
  }
  return { deleted: true, skipped: false, storagePath, bucket: resolvedBucket };
}

function deleteAttachmentStoragePaths(storagePaths, { bucket = null, dryRun = false } = {}) {
  const paths = Array.from(new Set((storagePaths ?? []).filter(Boolean).map(String)));
  if (!paths.length) return { bucket: bucket ?? storageBucketFromAmplifyOutputs(), attempted: 0, deleted: 0, chunks: 0, errors: [] };
  const resolvedBucket = bucket ?? storageBucketFromAmplifyOutputs();
  if (!resolvedBucket) throw new Error("Could not resolve storage bucket for ModelAttachment batch delete. Pass --bucket or refresh amplify_outputs.json.");
  if (dryRun) return { bucket: resolvedBucket, attempted: paths.length, deleted: 0, chunks: 0, errors: [], dryRun: true };

  let deleted = 0;
  const errors = [];
  let chunks = 0;
  for (let index = 0; index < paths.length; index += 1000) {
    chunks += 1;
    const chunk = paths.slice(index, index + 1000);
    const deletePayload = {
      Objects: chunk.map((storagePath) => ({ Key: storagePath })),
      Quiet: false,
    };
    const tempPath = path.join(os.tmpdir(), `papyrus-delete-objects-${process.pid}-${Date.now()}-${chunks}.json`);
    fs.writeFileSync(tempPath, JSON.stringify(deletePayload));
    try {
      const result = spawnSync("aws", [
        "s3api",
        "delete-objects",
        "--bucket",
        resolvedBucket,
        "--delete",
        `file://${tempPath}`,
        "--output",
        "json",
      ], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 100 * 1024 * 1024,
      });
      if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || `aws s3api delete-objects exited with ${result.status}`);
      }
      const parsed = JSON.parse(result.stdout || "{}");
      deleted += Array.isArray(parsed.Deleted) ? parsed.Deleted.length : chunk.length;
      for (const entry of parsed.Errors ?? []) {
        errors.push({
          storagePath: entry.Key ?? null,
          code: entry.Code ?? null,
          message: entry.Message ?? null,
        });
      }
    } finally {
      fs.rmSync(tempPath, { force: true });
    }
  }
  if (errors.length) {
    const preview = errors.slice(0, 3).map((entry) => `${entry.storagePath ?? "unknown"}:${entry.code ?? "error"}`).join(", ");
    throw new Error(`Failed to delete ${errors.length} ModelAttachment S3 object(s): ${preview}`);
  }
  return { bucket: resolvedBucket, attempted: paths.length, deleted, chunks, errors };
}

function listAttachmentStoragePaths({ bucket = null, prefix = "newsroom/payloads/" } = {}) {
  const resolvedBucket = bucket ?? storageBucketFromAmplifyOutputs();
  if (!resolvedBucket) throw new Error("Could not resolve storage bucket for ModelAttachment listing. Pass --bucket or refresh amplify_outputs.json.");
  const keys = [];
  let continuationToken = null;
  do {
    const args = [
      "s3api",
      "list-objects-v2",
      "--bucket",
      resolvedBucket,
      "--prefix",
      prefix,
      "--output",
      "json",
    ];
    if (continuationToken) args.push("--continuation-token", continuationToken);
    const result = spawnSync("aws", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 100 * 1024 * 1024,
    });
    if (result.status !== 0) {
      throw new Error(`Failed to list ModelAttachment objects in s3://${resolvedBucket}/${prefix}: ${result.stderr || result.stdout}`);
    }
    const parsed = JSON.parse(result.stdout || "{}");
    for (const entry of parsed.Contents ?? []) {
      if (entry?.Key) keys.push(entry.Key);
    }
    continuationToken = parsed.IsTruncated ? parsed.NextContinuationToken : null;
  } while (continuationToken);
  return { bucket: resolvedBucket, prefix, keys };
}

function storageBucketFromAmplifyOutputs(filepath = "amplify_outputs.json") {
  const fullPath = path.resolve(filepath);
  if (!fs.existsSync(fullPath)) return null;
  const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  return parsed.storage?.bucket_name ?? parsed.storage?.bucketName ?? null;
}

function modelPayloadStoragePath(ownerKind, ownerId, role, filename) {
  return `newsroom/payloads/${safeId(ownerKind)}/${safeId(ownerId)}/${safeId(role)}/${filename}`;
}

function modelAttachmentId(ownerKind, ownerId, role, sortKey) {
  return `model-attachment-${safeId(ownerKind)}-${safeId(ownerId)}-${safeId(role)}-${safeId(sortKey)}`;
}

function safeId(value) {
  const raw = String(value ?? "payload").trim();
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "payload";
  if (normalized.length <= 80) return normalized;
  const digest = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
  return `${normalized.slice(0, 67).replace(/-+$/g, "")}-${digest}`;
}

function normalizeUploadHeaders(value) {
  const parsed = typeof value === "string" ? safeJson(value) : value;
  const headers = {};
  for (const [key, entry] of Object.entries(parsed && typeof parsed === "object" ? parsed : {})) {
    if (entry !== undefined && entry !== null) headers[key] = String(entry);
  }
  return headers;
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

module.exports = {
  attachmentRecord,
  buildBinaryModelPayloadAttachment,
  buildJsonModelPayloadAttachment,
  buildModelPayloadAttachment,
  buildTextModelPayloadAttachment,
  deleteAttachmentBody,
  deleteAttachmentStoragePath,
  deleteAttachmentStoragePaths,
  downloadAttachmentBody,
  downloadAttachmentBuffer,
  listAttachmentStoragePaths,
  modelAttachmentId,
  modelPayloadStoragePath,
  stripPrivatePayloadFields,
  uploadAttachmentBody,
};
