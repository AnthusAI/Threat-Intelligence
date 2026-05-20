const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_QUERY_TERMS = [
  "llm multi-agent collaboration",
  "multi-agent debate llm",
  "agentic workflow orchestration",
  "generative agents social simulation",
  "collaborative content generation agents",
  "taxonomy expansion llm agents",
];

const PAPER_HOST_PATTERNS = [
  /(^|\.)arxiv\.org$/i,
  /(^|\.)aclanthology\.org$/i,
  /(^|\.)openreview\.net$/i,
  /(^|\.)neurips\.cc$/i,
  /(^|\.)proceedings\.neurips\.cc$/i,
  /(^|\.)dl\.acm\.org$/i,
  /(^|\.)doi\.org$/i,
  /(^|\.)semanticscholar\.org$/i,
  /(^|\.)ijcai\.org$/i,
  /(^|\.)nature\.com$/i,
  /(^|\.)science\.org$/i,
  /(^|\.)sciencedirect\.com$/i,
  /(^|\.)frontiersin\.org$/i,
  /(^|\.)pmc\.ncbi\.nlm\.nih\.gov$/i,
  /(^|\.)aclweb\.org$/i,
];

const REPO_HOST_PATTERNS = [
  /(^|\.)github\.com$/i,
  /(^|\.)gitlab\.com$/i,
  /(^|\.)huggingface\.co$/i,
];

const LOW_SIGNAL_HOST_PATTERNS = [
  /(^|\.)medium\.com$/i,
  /(^|\.)reddit\.com$/i,
  /(^|\.)towardsdatascience\.com$/i,
];

const TECHNICAL_DOC_HOST_PATTERNS = [
  /(^|\.)microsoft\.github\.io$/i,
  /(^|\.)readthedocs\.io$/i,
  /(^|\.)docs\.aws\.amazon\.com$/i,
  /(^|\.)learn\.microsoft\.com$/i,
  /(^|\.)developer\./i,
];

const TOPIC_KEYWORDS = [
  "agent",
  "multi-agent",
  "collaboration",
  "workflow",
  "orchestration",
  "debate",
  "simulation",
  "society",
  "taxonomy",
  "ontology",
  "knowledge graph",
  "graphrag",
  "collective",
  "reasoning",
  "curation",
];

function hashShort(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toInt(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function normalizeUrl(rawUrl) {
  const text = normalizeText(rawUrl);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^utm_/i.test(key) || key === "source" || key === "ref") parsed.searchParams.delete(key);
    }
    let normalized = parsed.toString();
    normalized = normalized.replace(/\/+$/, "");
    return normalized;
  } catch {
    return text;
  }
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function pathFromUrl(url) {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function extractArxivId(url, title = "") {
  const sources = [normalizeText(url), normalizeText(title)];
  for (const source of sources) {
    if (!source) continue;
    const match = source.match(/arxiv\.org\/(?:abs|pdf|html)\/([0-9]{4}\.[0-9]{4,5})(?:v\d+)?/i)
      ?? source.match(/\barxiv:\s*([0-9]{4}\.[0-9]{4,5})(?:v\d+)?/i);
    if (match) return match[1];
  }
  return null;
}

function extractDoi(url, title = "") {
  const candidates = [normalizeText(url), normalizeText(title)];
  for (const text of candidates) {
    if (!text) continue;
    const match = text.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i);
    if (match) return match[0].toLowerCase();
  }
  return null;
}

function classifySourceKind(candidate) {
  const url = candidate.source_uri;
  const host = hostFromUrl(url);
  const pathname = pathFromUrl(url);
  const title = `${candidate.title ?? ""}`.toLowerCase();
  if (!url) return "index";
  if (REPO_HOST_PATTERNS.some((pattern) => pattern.test(host))) return "repo";
  if (/\/(paper|abs|article|pdf)\//.test(pathname) || pathname.endsWith(".pdf")) return "paper";
  if (PAPER_HOST_PATTERNS.some((pattern) => pattern.test(host))) return "paper";
  if (TECHNICAL_DOC_HOST_PATTERNS.some((pattern) => pattern.test(host)) || pathname.includes("/docs/")) return "doc";
  if (pathname.includes("/blog") || title.includes("blog")) return "blog";
  return "index";
}

function inferYear(candidate, nowYear) {
  const explicit = toInt(candidate.year);
  if (explicit && explicit > 1900 && explicit <= nowYear + 1) return explicit;
  const dates = [candidate.published_at, candidate.updated_at, candidate.retrieved_at];
  for (const raw of dates) {
    const text = normalizeText(raw);
    if (!text) continue;
    const parsedYear = toInt(text.slice(0, 4));
    if (parsedYear && parsedYear > 1900 && parsedYear <= nowYear + 1) return parsedYear;
  }
  const inTitle = normalizeText(candidate.title).match(/\b(19|20)\d{2}\b/);
  const fromTitle = inTitle ? toInt(inTitle[0]) : null;
  if (fromTitle && fromTitle > 1900 && fromTitle <= nowYear + 1) return fromTitle;
  return null;
}

function looksPaper(candidate) {
  if (candidate.source_kind === "paper") return true;
  const url = candidate.source_uri ?? "";
  const path = pathFromUrl(url);
  return path.endsWith(".pdf");
}

function keywordHits(text) {
  const lower = (text ?? "").toLowerCase();
  return TOPIC_KEYWORDS.filter((token) => lower.includes(token)).length;
}

function scoreCandidate(candidate, options) {
  const {
    fromYear,
    toYear,
    paperSourceBoost = 25,
    citationBoost = 20,
  } = options;
  const title = candidate.title ?? "";
  const host = hostFromUrl(candidate.source_uri ?? "");
  const sourceKind = candidate.source_kind;
  const year = candidate.year;
  const citationCount = candidate.citation_count ?? 0;
  const hitCount = keywordHits(`${title} ${candidate.query_terms?.join(" ") ?? ""}`);
  let score = 0;
  if (sourceKind === "paper") score += 50;
  if (sourceKind === "repo") score += 20;
  if (sourceKind === "doc") score += 15;
  if (sourceKind === "blog") score -= 8;
  if (sourceKind === "index") score -= 12;
  if (PAPER_HOST_PATTERNS.some((pattern) => pattern.test(host))) score += paperSourceBoost;
  if (candidate.discovered_via === "citation") score += citationBoost;
  if (candidate.discovered_via === "feed") score += 8;
  if (year && year >= fromYear && year <= toYear) score += 20;
  if (year && year < fromYear) score += citationCount >= 2 ? 4 : -18;
  if (year && year > toYear) score -= 8;
  score += Math.min(18, hitCount * 4);
  score += Math.min(12, citationCount * 2);
  if (LOW_SIGNAL_HOST_PATTERNS.some((pattern) => pattern.test(host))) score -= 20;
  if (looksPaper(candidate) && sourceKind !== "paper") score += 8;
  return score;
}

function confidenceTier(score) {
  if (score >= 85) return "high";
  if (score >= 55) return "medium";
  return "low";
}

function routeCorpus(candidate) {
  const sourceKind = candidate.source_kind;
  if (sourceKind === "paper") return "AI-ML-research";
  const technical = sourceKind === "repo" || sourceKind === "doc";
  const methodHeavy = keywordHits(candidate.title ?? "") >= 2;
  if (technical && methodHeavy && candidate.confidence_tier === "high") return "AI-ML-research";
  return "AI-ML-journalism";
}

function canonicalKey(candidate) {
  if (candidate.doi) return `doi:${candidate.doi}`;
  const normalizedUrl = normalizeUrl(candidate.source_uri ?? "");
  const doi = extractDoi(normalizedUrl, candidate.title ?? "");
  const arxivId = extractArxivId(normalizedUrl, candidate.title ?? "");
  if (doi) return `doi:${doi}`;
  if (arxivId) return `arxiv:${arxivId}`;
  return `url:${normalizedUrl ?? hashShort(candidate.title ?? "")}`;
}

function mergeProvenance(target, source) {
  const discoveredVia = new Set([target.discovered_via, source.discovered_via].filter(Boolean));
  const queryTerms = new Set([...(target.query_terms ?? []), ...(source.query_terms ?? [])]);
  const anchorTitles = new Set([target.anchor_title, source.anchor_title].filter(Boolean));
  target.discovered_via = discoveredVia.has("citation")
    ? "citation"
    : discoveredVia.has("feed")
      ? "feed"
      : "manual";
  target.query_terms = [...queryTerms].sort();
  target.anchor_title = [...anchorTitles][0] ?? null;
  target.anchor_source_uri = target.anchor_source_uri ?? source.anchor_source_uri ?? null;
  if (!target.citation_context && source.citation_context) target.citation_context = source.citation_context;
  target.citation_count = Math.max(target.citation_count ?? 0, source.citation_count ?? 0);
}

async function fetchJson(url, errors, contextLabel) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "papyrus-discovery/1.0",
        "Accept": "application/json, text/plain;q=0.9, */*;q=0.8",
      },
    });
    if (!response.ok) {
      errors.push({
        source: contextLabel,
        url,
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }
    return await response.json();
  } catch (error) {
    errors.push({
      source: contextLabel,
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function findCorpusCatalogPath(corpusPath) {
  const candidates = [
    path.join(corpusPath, "metadata", "catalog.json"),
    path.join(corpusPath, "catalog.json"),
    path.join(corpusPath, "imports", "catalog.json"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function readCatalogItems(corpusPath) {
  const catalogPath = findCorpusCatalogPath(corpusPath);
  if (!catalogPath) return { catalogPath: null, items: [] };
  const raw = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  const items = Array.isArray(raw.items)
    ? raw.items
    : raw.items && typeof raw.items === "object"
      ? Object.values(raw.items)
      : Array.isArray(raw.records)
        ? raw.records
        : raw.records && typeof raw.records === "object"
          ? Object.values(raw.records)
          : [];
  return { catalogPath, items };
}

function pickAnchors({ items, runId, fromYear, toYear, limit }) {
  const nowYear = new Date().getUTCFullYear();
  const prepared = [];
  for (const item of items) {
    const sourceUri = normalizeUrl(item.source_uri ?? item.sourceUri ?? item.url ?? item.uri);
    if (!sourceUri) continue;
    const title = normalizeText(item.title ?? item.metadata?.title ?? item.id);
    if (!title) continue;
    const year = inferYear({
      year: item.year ?? item.metadata?.year,
      title,
      published_at: item.published_at ?? item.publishedAt ?? item.dates?.published_at ?? item.dates?.publishedAt,
      updated_at: item.updated_at ?? item.updatedAt ?? item.dates?.updated_at ?? item.dates?.updatedAt,
      retrieved_at: item.retrieved_at ?? item.retrievedAt ?? item.dates?.retrieved_at ?? item.dates?.retrievedAt,
    }, nowYear);
    const sourceKind = classifySourceKind({ source_uri: sourceUri, title });
    if (sourceKind !== "paper") continue;
    const inWindow = year !== null && year >= fromYear && year <= toYear;
    if (!inWindow) continue;
    prepared.push({
      id: `anchor-${hashShort(`${sourceUri}|${title}`)}`,
      run_id: runId,
      item_id: normalizeText(item.item_id ?? item.externalItemId ?? item.id) || `anchor-item-${hashShort(sourceUri)}`,
      title,
      source_uri: sourceUri,
      year,
      source_kind: sourceKind,
      route_corpus: "AI-ML-research",
      discovered_via: "manual",
      media_type: normalizeText(item.media_type ?? item.mediaType) || (sourceUri.includes(".pdf") ? "application/pdf" : "text/html"),
      doi: extractDoi(
        item.metadata?.doi
        ?? item.metadata?.source_doi
        ?? sourceUri
        ?? "",
        title,
      ),
      metadata: {
        doi: extractDoi(
          item.metadata?.doi
          ?? item.metadata?.source_doi
          ?? sourceUri
          ?? "",
          title,
        ),
        topic_tags: ["anchor", "collaborative-agent-research"],
        discovery_run_id: runId,
      },
    });
  }
  prepared.sort((left, right) => {
    if ((right.year ?? 0) !== (left.year ?? 0)) return (right.year ?? 0) - (left.year ?? 0);
    return left.title.localeCompare(right.title);
  });
  return prepared.slice(0, limit);
}

function mapOpenAlexWorkToCandidate(work, context = {}) {
  const sourceUri = normalizeUrl(work?.primary_location?.landing_page_url ?? work?.ids?.doi ?? work?.ids?.openalex ?? "");
  const title = normalizeText(work?.title);
  if (!sourceUri || !title) return null;
  const publishedDate = normalizeText(work?.publication_date);
  const doi = extractDoi(work?.doi ?? work?.ids?.doi ?? "", sourceUri);
  const arxivId = extractArxivId(work?.ids?.arxiv ?? sourceUri, title);
  return {
    title,
    source_uri: sourceUri,
    media_type: sourceUri.endsWith(".pdf") ? "application/pdf" : "text/html",
    year: toInt(work?.publication_year),
    source_kind: "paper",
    discovered_via: context.discovered_via ?? "citation",
    anchor_source_uri: context.anchor_source_uri ?? null,
    anchor_title: context.anchor_title ?? null,
    citation_context: context.citation_context ?? null,
    query_terms: context.query_terms ?? [],
    citation_count: toInt(work?.cited_by_count) ?? 0,
    doi,
    arxiv_id: arxivId,
    metadata: {
      openalex_id: work?.id ?? null,
      doi,
      arxiv_id: arxivId,
      discovery_run_id: context.discovery_run_id ?? null,
      topic_tags: ["collaborative-agents", "citation-led-discovery"],
    },
    published_at: publishedDate || null,
    updated_at: null,
    retrieved_at: new Date().toISOString(),
  };
}

async function discoverFromOpenAlexCitations({ anchors, citationsPerAnchor, runId, errors }) {
  const candidates = [];
  for (const anchor of anchors) {
    let matched = null;
    if (anchor.doi) {
      const doiSearchUrl = `https://api.openalex.org/works?per-page=1&filter=doi:${encodeURIComponent(anchor.doi)}`;
      const doiPayload = await fetchJson(doiSearchUrl, errors, "openalex-doi-search");
      matched = asArray(doiPayload?.results)[0] ?? null;
    }
    if (!matched) {
      const searchUrl = `https://api.openalex.org/works?per-page=1&search=${encodeURIComponent(anchor.title)}`;
      const searchPayload = await fetchJson(searchUrl, errors, "openalex-title-search");
      matched = asArray(searchPayload?.results)[0] ?? null;
    }
    if (!matched) continue;

    const referencedWorks = asArray(matched.referenced_works).slice(0, citationsPerAnchor);
    for (const workId of referencedWorks) {
      const url = `https://api.openalex.org/works/${encodeURIComponent(workId.replace("https://openalex.org/", ""))}`;
      const work = await fetchJson(url, errors, "openalex-work");
      if (!work) continue;
      const mapped = mapOpenAlexWorkToCandidate(work, {
        discovered_via: "citation",
        anchor_source_uri: anchor.source_uri,
        anchor_title: anchor.title,
        query_terms: ["openalex", "references", "citation-chain"],
        discovery_run_id: runId,
      });
      if (mapped) candidates.push(mapped);
    }
  }
  return candidates;
}

async function discoverFromOpenAlexFeeds({ queryTerms, feedLimit, runId, errors }) {
  const candidates = [];
  for (const query of queryTerms) {
    const url = `https://api.openalex.org/works?per-page=${Math.min(feedLimit, 40)}&search=${encodeURIComponent(query)}&sort=publication_date:desc`;
    const payload = await fetchJson(url, errors, "openalex-feed");
    const rows = asArray(payload?.results);
    for (const work of rows) {
      const mapped = mapOpenAlexWorkToCandidate(work, {
        discovered_via: "feed",
        query_terms: [query, "openalex"],
        discovery_run_id: runId,
      });
      if (mapped) candidates.push(mapped);
    }
  }
  return candidates;
}

function parseArxivFeed(xmlText) {
  const entries = [];
  const blocks = xmlText.split("<entry>").slice(1);
  for (const block of blocks) {
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
    const idMatch = block.match(/<id>([\s\S]*?)<\/id>/i);
    const publishedMatch = block.match(/<published>([\s\S]*?)<\/published>/i);
    const updatedMatch = block.match(/<updated>([\s\S]*?)<\/updated>/i);
    const title = normalizeText(titleMatch ? titleMatch[1].replace(/\s+/g, " ") : "");
    const sourceUri = normalizeUrl(idMatch ? idMatch[1] : "");
    if (!title || !sourceUri) continue;
    entries.push({
      title,
      source_uri: sourceUri,
      media_type: "text/html",
      year: toInt((publishedMatch?.[1] ?? "").slice(0, 4)),
      source_kind: "paper",
      discovered_via: "feed",
      anchor_source_uri: null,
      anchor_title: null,
      citation_context: null,
      query_terms: ["arxiv-feed"],
      citation_count: 0,
      metadata: {
        discovery_run_id: null,
        topic_tags: ["arxiv", "collaborative-agents"],
      },
      published_at: normalizeText(publishedMatch?.[1] ?? ""),
      updated_at: normalizeText(updatedMatch?.[1] ?? ""),
      retrieved_at: new Date().toISOString(),
    });
  }
  return entries;
}

async function discoverFromArxivFeeds({ queryTerms, feedLimit, runId, errors }) {
  const candidates = [];
  for (const query of queryTerms) {
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${Math.min(feedLimit, 40)}&sortBy=submittedDate&sortOrder=descending`;
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "papyrus-discovery/1.0",
          "Accept": "application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
        },
      });
      if (!response.ok) {
        errors.push({ source: "arxiv-feed", url, status: response.status, statusText: response.statusText });
        continue;
      }
      const xml = await response.text();
      const parsed = parseArxivFeed(xml);
      for (const candidate of parsed) {
        candidate.query_terms = [query, "arxiv"];
        candidate.metadata.discovery_run_id = runId;
        candidates.push(candidate);
      }
    } catch (error) {
      errors.push({
        source: "arxiv-feed",
        url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return candidates;
}

async function discoverFromHuggingFacePapers({ feedLimit, runId, errors }) {
  const url = "https://huggingface.co/api/daily_papers";
  const payload = await fetchJson(url, errors, "huggingface-papers");
  const rows = asArray(payload).slice(0, Math.max(feedLimit, 20));
  const candidates = [];
  for (const row of rows) {
    const title = normalizeText(row.title ?? row.paper?.title);
    const paperUrl = normalizeUrl(row.url ?? row.paper?.url ?? row.paper?.paper_url ?? "");
    if (!title || !paperUrl) continue;
    candidates.push({
      title,
      source_uri: paperUrl,
      media_type: paperUrl.endsWith(".pdf") ? "application/pdf" : "text/html",
      year: toInt((row.published_at ?? "").slice(0, 4)),
      source_kind: classifySourceKind({ source_uri: paperUrl, title }),
      discovered_via: "feed",
      anchor_source_uri: null,
      anchor_title: null,
      citation_context: null,
      query_terms: ["huggingface", "daily_papers"],
      citation_count: 0,
      metadata: {
        discovery_run_id: runId,
        topic_tags: ["huggingface", "paper-feed"],
      },
      published_at: normalizeText(row.published_at),
      updated_at: normalizeText(row.updated_at),
      retrieved_at: new Date().toISOString(),
    });
  }
  return candidates;
}

function ensureCandidateDefaults(candidate, context) {
  const nowYear = new Date().getUTCFullYear();
  const sourceUri = normalizeUrl(candidate.source_uri ?? "");
  const title = normalizeText(candidate.title ?? "");
  if (!sourceUri || !title) return null;
  const year = inferYear(candidate, nowYear);
  const source_kind = classifySourceKind({ source_uri: sourceUri, title });
  const queryTerms = [...new Set(asArray(candidate.query_terms).map((entry) => normalizeText(entry)).filter(Boolean))];
  return {
    id: null,
    item_id: null,
    title,
    source_uri: sourceUri,
    media_type: normalizeText(candidate.media_type) || (sourceUri.endsWith(".pdf") ? "application/pdf" : "text/html"),
    year,
    source_kind,
    route_corpus: null,
    confidence_tier: null,
    score: 0,
    discovered_via: candidate.discovered_via ?? "manual",
    anchor_source_uri: normalizeUrl(candidate.anchor_source_uri ?? "") || null,
    anchor_title: normalizeText(candidate.anchor_title ?? "") || null,
    citation_context: normalizeText(candidate.citation_context ?? "") || null,
    query_terms: queryTerms,
    citation_count: toInt(candidate.citation_count) ?? 0,
    metadata: {
      ingestion_rationale: null,
      doi: candidate.doi ?? extractDoi(sourceUri, title),
      arxiv_id: candidate.arxiv_id ?? extractArxivId(sourceUri, title),
      discovery_run_id: context.runId,
      topic_tags: asArray(candidate.metadata?.topic_tags).filter((entry) => typeof entry === "string" && entry.trim()).slice(0, 12),
      ...(candidate.metadata && typeof candidate.metadata === "object" ? candidate.metadata : {}),
    },
    published_at: candidate.published_at ?? null,
    updated_at: candidate.updated_at ?? null,
    retrieved_at: candidate.retrieved_at ?? new Date().toISOString(),
  };
}

function materializeCandidate(candidate, options) {
  const scored = { ...candidate };
  scored.score = scoreCandidate(scored, options);
  scored.confidence_tier = confidenceTier(scored.score);
  scored.route_corpus = routeCorpus(scored);
  const canonical = canonicalKey(scored);
  const stableId = `candidate-${hashShort(canonical)}`;
  scored.id = stableId;
  scored.item_id = stableId;
  const yearClause = scored.year ? ` (${scored.year})` : "";
  const routeClause = scored.route_corpus === "AI-ML-research" ? "research corpus" : "journalism corpus";
  scored.metadata.ingestion_rationale = `${scored.title}${yearClause} is a ${scored.source_kind} discovered via ${scored.discovered_via} for collaborative agent research and is staged for ${routeClause}.`;
  scored.metadata.topic_tags = [...new Set([...(scored.metadata.topic_tags ?? []), "collaborative-agents", "citation-led-discovery"])];
  scored.doi = scored.metadata.doi ?? null;
  scored.arxiv_id = scored.metadata.arxiv_id ?? null;
  return scored;
}

function dedupeCandidates(scoredCandidates) {
  const byKey = new Map();
  for (const candidate of scoredCandidates) {
    const key = canonicalKey(candidate);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...candidate });
      continue;
    }
    if (candidate.score > existing.score) {
      const next = { ...candidate };
      mergeProvenance(next, existing);
      byKey.set(key, next);
      continue;
    }
    mergeProvenance(existing, candidate);
    if ((candidate.year ?? 0) > (existing.year ?? 0)) existing.year = candidate.year;
  }
  return [...byKey.values()];
}

function passesPrimaryFilter(candidate, options) {
  if (candidate.year && candidate.year > options.toYear) return false;
  const inWindow = candidate.year && candidate.year >= options.fromYear && candidate.year <= options.toYear;
  const olderButCited = candidate.year && candidate.year < options.fromYear && (candidate.citation_count ?? 0) >= 2;
  const highConfidenceException = candidate.confidence_tier === "high" && candidate.source_kind !== "blog";
  const lowSignal = LOW_SIGNAL_HOST_PATTERNS.some((pattern) => pattern.test(hostFromUrl(candidate.source_uri)));
  if (lowSignal && candidate.confidence_tier !== "high") return false;
  return inWindow || olderButCited || highConfidenceException;
}

function sortCandidates(candidates) {
  return [...candidates].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if ((right.year ?? 0) !== (left.year ?? 0)) return (right.year ?? 0) - (left.year ?? 0);
    return left.title.localeCompare(right.title);
  });
}

function toIntakeItem(candidate, runId) {
  return {
    id: candidate.id,
    item_id: candidate.item_id,
    title: candidate.title,
    source_uri: candidate.source_uri,
    media_type: candidate.media_type,
    year: candidate.year,
    source_kind: candidate.source_kind,
    route_corpus: candidate.route_corpus,
    confidence_tier: candidate.confidence_tier,
    score: candidate.score,
    discovered_via: candidate.discovered_via,
    anchor_source_uri: candidate.anchor_source_uri,
    anchor_title: candidate.anchor_title,
    citation_context: candidate.citation_context,
    query_terms: candidate.query_terms,
    doi: candidate.doi ?? null,
    arxiv_id: candidate.arxiv_id ?? null,
    ingestion_rationale: candidate.metadata?.ingestion_rationale ?? null,
    metadata: {
      ...(candidate.metadata ?? {}),
      discovery_run_id: runId,
      topic_tags: candidate.metadata?.topic_tags ?? [],
      ingestion_rationale: candidate.metadata?.ingestion_rationale ?? null,
    },
    dates: {
      published_at: candidate.published_at ?? null,
      updated_at: candidate.updated_at ?? null,
      retrieved_at: candidate.retrieved_at ?? new Date().toISOString(),
    },
  };
}

function summarize(candidates, anchors, errors, runId) {
  const by = (selector) => {
    const counts = {};
    for (const candidate of candidates) {
      const key = selector(candidate) ?? "unknown";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  };
  return {
    discovery_run_id: runId,
    generated_at: new Date().toISOString(),
    totals: {
      anchors: anchors.length,
      candidates: candidates.length,
      high: candidates.filter((entry) => entry.confidence_tier === "high").length,
      medium: candidates.filter((entry) => entry.confidence_tier === "medium").length,
      low: candidates.filter((entry) => entry.confidence_tier === "low").length,
      errors: errors.length,
    },
    counts_by_source_kind: by((entry) => entry.source_kind),
    counts_by_host: by((entry) => hostFromUrl(entry.source_uri)),
    counts_by_year: by((entry) => entry.year ?? "unknown"),
    counts_by_route_corpus: by((entry) => entry.route_corpus),
    counts_by_confidence_tier: by((entry) => entry.confidence_tier),
    counts_by_discovered_via: by((entry) => entry.discovered_via),
    errors: errors.slice(0, 200),
  };
}

function writeJson(filepath, value) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonl(filepath, rows) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  fs.writeFileSync(filepath, body ? `${body}\n` : "", "utf8");
}

async function runCitationLedDiscovery(options = {}) {
  const runId = options.runId ?? `citation-discovery-${new Date().toISOString().replace(/[^0-9A-Za-z]+/g, "-").replace(/^-|-$/g, "")}`;
  const runDir = path.join(process.cwd(), ".papyrus-runs", runId);
  const fromYear = toInt(options.fromYear) ?? 2023;
  const toYear = toInt(options.toYear) ?? 2026;
  const anchorLimit = toInt(options.anchorLimit) ?? 40;
  const citationsPerAnchor = toInt(options.citationsPerAnchor) ?? 12;
  const feedLimit = toInt(options.feedLimit) ?? 20;
  const queryTerms = (options.queryTerms?.length ? options.queryTerms : DEFAULT_QUERY_TERMS).map((entry) => normalizeText(entry)).filter(Boolean);

  const anchorCorpusPath = options.anchorCorpusPath;
  const { catalogPath, items } = readCatalogItems(anchorCorpusPath);
  if (!catalogPath) throw new Error(`No local catalog.json found for anchor corpus path: ${anchorCorpusPath}`);

  const anchors = pickAnchors({
    items,
    runId,
    fromYear,
    toYear,
    limit: anchorLimit,
  });
  if (!anchors.length) {
    throw new Error(`No anchor papers found in ${catalogPath} for ${fromYear}-${toYear}.`);
  }

  const errors = [];
  const citationCandidates = await discoverFromOpenAlexCitations({
    anchors,
    citationsPerAnchor,
    runId,
    errors,
  });
  const openAlexFeedCandidates = await discoverFromOpenAlexFeeds({
    queryTerms,
    feedLimit,
    runId,
    errors,
  });
  const arxivFeedCandidates = await discoverFromArxivFeeds({
    queryTerms,
    feedLimit,
    runId,
    errors,
  });
  const huggingFaceCandidates = await discoverFromHuggingFacePapers({
    feedLimit,
    runId,
    errors,
  });

  const rawCandidates = [
    ...citationCandidates,
    ...openAlexFeedCandidates,
    ...arxivFeedCandidates,
    ...huggingFaceCandidates,
  ]
    .map((candidate) => ensureCandidateDefaults(candidate, { runId }))
    .filter(Boolean);

  const scoredCandidates = rawCandidates.map((candidate) => materializeCandidate(candidate, {
    fromYear,
    toYear,
  }));
  const deduped = dedupeCandidates(scoredCandidates);
  const filtered = sortCandidates(deduped.filter((candidate) => passesPrimaryFilter(candidate, { fromYear, toYear })));
  const rankedCatalogItems = filtered.map((candidate) => toIntakeItem(candidate, runId));
  const report = summarize(filtered, anchors, errors, runId);

  const files = {
    anchors: path.join(runDir, "anchors.json"),
    raw: path.join(runDir, "discovery-candidates.raw.jsonl"),
    scored: path.join(runDir, "discovery-candidates.scored.jsonl"),
    rankedCatalog: path.join(runDir, "ranked-intake-catalog.json"),
    report: path.join(runDir, "discovery-report.json"),
  };

  writeJson(files.anchors, {
    discovery_run_id: runId,
    generated_at: new Date().toISOString(),
    anchor_corpus_path: anchorCorpusPath,
    anchor_catalog_path: catalogPath,
    count: anchors.length,
    anchors,
  });
  writeJsonl(files.raw, rawCandidates);
  writeJsonl(files.scored, sortCandidates(scoredCandidates));
  writeJson(files.rankedCatalog, {
    schema_version: 1,
    discovery_run_id: runId,
    generated_at: new Date().toISOString(),
    filters: {
      from_year: fromYear,
      to_year: toYear,
      anchor_limit: anchorLimit,
      citations_per_anchor: citationsPerAnchor,
      feed_limit: feedLimit,
      query_terms: queryTerms,
    },
    items: rankedCatalogItems,
  });
  writeJson(files.report, report);

  return {
    runId,
    runDir,
    files,
    report,
    anchorsCount: anchors.length,
    rawCount: rawCandidates.length,
    scoredCount: scoredCandidates.length,
    rankedCount: rankedCatalogItems.length,
  };
}

module.exports = {
  DEFAULT_QUERY_TERMS,
  runCitationLedDiscovery,
};
