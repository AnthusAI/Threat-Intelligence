const REFERENCE_CURATION_STATUSES = new Set(["pending", "accepted", "rejected", "archived"]);
const REFERENCE_REJECTION_REASON_CODES = new Set([
  "out_of_scope",
  "policy_exclusion",
  "duplicate",
  "low_quality",
  "unavailable",
  "provenance",
  "other",
]);
const SCOPE_TRAINING_NEGATIVE_REASON_CODES = new Set(["out_of_scope", "policy_exclusion"]);

function normalizeReferenceCurationStatus(value, defaultStatus = "pending") {
  const normalized = normalizePolicyToken(value ?? defaultStatus);
  if (normalized === "accepted" || normalized === "accept" || normalized === "ready" || normalized === "trusted") return "accepted";
  if (normalized === "rejected" || normalized === "reject" || normalized === "discarded") return "rejected";
  if (normalized === "archived" || normalized === "archive") return "archived";
  return "pending";
}

function referenceCurationStatusForAction(action) {
  const normalized = normalizePolicyToken(action);
  if (normalized === "accept") return "accepted";
  if (normalized === "reject") return "rejected";
  if (normalized === "archive") return "archived";
  if (normalized === "reopen") return "pending";
  throw new Error(`Unsupported reference curation action ${action}.`);
}

function normalizeReferenceRejectionReasonCode(value, { required = false } = {}) {
  const normalized = normalizePolicyToken(value);
  if (!normalized) {
    if (required) throw new Error("--reason-code is required for rejected references.");
    return null;
  }
  if (!REFERENCE_REJECTION_REASON_CODES.has(normalized)) {
    throw new Error(`Unsupported reference rejection reason code '${value}'. Use one of: ${Array.from(REFERENCE_REJECTION_REASON_CODES).join(", ")}.`);
  }
  return normalized;
}

function isEvidenceEligibleReference(reference) {
  if (!reference || typeof reference !== "object") return false;
  return reference.versionState === "current"
    && normalizeReferenceCurationStatus(reference.curationStatus, "pending") === "accepted";
}

function referenceReasonCode(reference, messages = []) {
  const metadataReason = reasonCodeFromMetadata(reference?.metadata);
  if (metadataReason) return metadataReason;
  const sortedMessages = [...messages].sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")));
  for (const message of sortedMessages) {
    const reason = reasonCodeFromMetadata(message?.metadata);
    if (reason) return reason;
  }
  return null;
}

function scopeTrainingLabelForReference(reference, messages = []) {
  if (!reference || reference.versionState !== "current") return null;
  const status = normalizeReferenceCurationStatus(reference.curationStatus, "pending");
  if (status === "accepted") return "positive";
  if (status !== "rejected") return null;
  const reasonCode = referenceReasonCode(reference, messages);
  return reasonCode && SCOPE_TRAINING_NEGATIVE_REASON_CODES.has(reasonCode) ? "negative" : null;
}

function reasonCodeFromMetadata(metadata) {
  const parsed = parseMetadataObject(metadata);
  return normalizeReferenceRejectionReasonCode(
    parsed.reasonCode
      ?? parsed.reason_code
      ?? parsed.curationReasonCode
      ?? parsed.curation_reason_code
      ?? parsed.rejectionReasonCode
      ?? parsed.rejection_reason_code,
  );
}

function parseMetadataObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizePolicyToken(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

module.exports = {
  REFERENCE_CURATION_STATUSES,
  REFERENCE_REJECTION_REASON_CODES,
  SCOPE_TRAINING_NEGATIVE_REASON_CODES,
  isEvidenceEligibleReference,
  normalizeReferenceCurationStatus,
  normalizeReferenceRejectionReasonCode,
  referenceCurationStatusForAction,
  referenceReasonCode,
  scopeTrainingLabelForReference,
};
