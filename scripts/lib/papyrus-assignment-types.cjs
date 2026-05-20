const ASSIGNMENT_TYPE_POLICIES = {
  "analysis.reindex": {
    assignmentTypeKey: "analysis.reindex",
    handlerKey: "analysis.reindex",
    claimPolicy: "exclusive",
    defaultClaimTtlSeconds: 6 * 60 * 60,
    workProductPolicy: "assignment-events-and-messages",
    description: "Runs explicit Biblicus re-index command plans for generated analysis outputs.",
  },
  "curation.reference-intake": {
    assignmentTypeKey: "curation.reference-intake",
    handlerKey: "curation.reference-intake",
    claimPolicy: "exclusive",
    defaultClaimTtlSeconds: 60 * 60,
    workProductPolicy: "reference-curation-decision",
    description: "Reviews pending reference prospects and records accept/reject/archive decisions.",
  },
  "reference.corpus-accession": {
    assignmentTypeKey: "reference.corpus-accession",
    handlerKey: "reference.corpus-accession",
    claimPolicy: "exclusive",
    defaultClaimTtlSeconds: 60 * 60,
    workProductPolicy: "reference-attachment-and-corpus-file",
    description: "Materializes URL-only reference prospects into durable Biblicus corpus source files.",
  },
  "reference.text-extraction": {
    assignmentTypeKey: "reference.text-extraction",
    handlerKey: "reference.text-extraction",
    claimPolicy: "exclusive",
    defaultClaimTtlSeconds: 2 * 60 * 60,
    workProductPolicy: "reference-extracted-text-attachment",
    description: "Runs Biblicus extraction for accessioned source materials and registers extracted text artifacts.",
  },
  "reference.doi-backfill": {
    assignmentTypeKey: "reference.doi-backfill",
    handlerKey: "reference.doi-backfill",
    claimPolicy: "exclusive",
    defaultClaimTtlSeconds: 2 * 60 * 60,
    workProductPolicy: "reference-identifier-enrichment",
    description: "Backfills DOI semantic identifiers for current references and persists DOI provenance.",
  },
  "reference.identifier-backfill": {
    assignmentTypeKey: "reference.identifier-backfill",
    handlerKey: "reference.identifier-backfill",
    claimPolicy: "exclusive",
    defaultClaimTtlSeconds: 4 * 60 * 60,
    workProductPolicy: "reference-identifier-enrichment",
    description: "Backfills semantic identifiers for current references and persists identifier provenance.",
  },
  "reference.summary-generation": {
    assignmentTypeKey: "reference.summary-generation",
    handlerKey: "reference.summary-generation",
    claimPolicy: "exclusive",
    defaultClaimTtlSeconds: 60 * 60,
    workProductPolicy: "reference-summary-message",
    description: "Generates budgeted private summary Messages for current references.",
  },
  "reference.quality-assessment": {
    assignmentTypeKey: "reference.quality-assessment",
    handlerKey: "reference.quality-assessment",
    claimPolicy: "exclusive",
    defaultClaimTtlSeconds: 60 * 60,
    workProductPolicy: "reference-quality-rating",
    description: "Assesses and records accepted one-to-five-star Reference quality ratings.",
  },
  "research.edition-candidate": {
    assignmentTypeKey: "research.edition-candidate",
    handlerKey: "newsroom.research",
    claimPolicy: "optional",
    defaultClaimTtlSeconds: 2 * 60 * 60,
    workProductPolicy: "research-packet-message",
    description: "Produces assignment-linked research packets for edition planning.",
  },
};

const DEFAULT_ASSIGNMENT_TYPE_POLICY = {
  assignmentTypeKey: "unknown",
  handlerKey: "manual",
  claimPolicy: "optional",
  defaultClaimTtlSeconds: null,
  workProductPolicy: "assignment-events-and-messages",
  description: "Generic assignment work without a specialized handler policy.",
};

function getAssignmentTypePolicy(assignmentTypeKey) {
  const key = typeof assignmentTypeKey === "string" ? assignmentTypeKey.trim() : "";
  const policy = ASSIGNMENT_TYPE_POLICIES[key];
  if (policy) return { ...policy };
  return { ...DEFAULT_ASSIGNMENT_TYPE_POLICY, assignmentTypeKey: key || "unknown" };
}

module.exports = {
  ASSIGNMENT_TYPE_POLICIES,
  DEFAULT_ASSIGNMENT_TYPE_POLICY,
  getAssignmentTypePolicy,
};
