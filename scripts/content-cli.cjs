#!/usr/bin/env node

const {
  decodeJwtClaims,
  getGraphQLEndpoint,
  getJwtToken,
  isJwtExpired,
  loadDotEnv,
} = require("./lib/papyrus-env.cjs");
const {
  buildAcceptedTopicSetPayload,
  buildSteeringConfigRecords,
  buildProjectionImportRecords,
  buildSteeringImportRecords,
  curationCorpusId,
  loadJsonFile,
  loadSteeringBundleFromBiblicus,
  writeJsonFile,
} = require("./lib/papyrus-curation.cjs");
const {
  findCorpusConfigByPath,
  loadSteeringConfig,
  requireCorpusConfig,
  requireSteeringConfig,
  resolveClassifierForCorpus,
} = require("./lib/papyrus-steering-config.cjs");
const { PapyrusGraphQLAuthoringClient } = require("./lib/papyrus-graphql-authoring.cjs");
const { getArticleImageAssets, getMarkdownArticle, loadEditionConfig, loadMarkdownArticles } = require("./lib/papyrus-markdown.cjs");

async function main() {
  loadDotEnv();

  const args = process.argv.slice(2);
  const [group, command, value] = args;
  if (group !== "content" && group !== "curation") {
    printUsage();
    process.exitCode = 1;
    return;
  }

  switch (`${group}:${command}`) {
    case "content:inspect":
      await inspect();
      return;
    case "content:list":
      if (value !== "articles") {
        printUsage();
        process.exitCode = 1;
        return;
      }
      await listArticles();
      return;
    case "content:sync":
      await handleSync(value, process.argv[5]);
      return;
    case "content:diff":
      await handleDiff(value, process.argv[5]);
      return;
    case "content:delete":
      await handleDelete(value, args.slice(3));
      return;
    case "curation:import-steering":
      await importSteering(args.slice(2));
      return;
    case "curation:import-config":
      await importSteeringConfig(args.slice(2));
      return;
    case "curation:export-topic-set":
      await exportTopicSet(args.slice(2));
      return;
    case "curation:import-projection":
      await importProjection(args.slice(2));
      return;
    default:
      printUsage();
      process.exitCode = 1;
  }
}

function createAuthoringClient() {
  const endpoint = getGraphQLEndpoint();
  const token = getJwtToken();
  const claims = decodeJwtClaims(token);
  validateAuthoringClaims(claims);
  return {
    endpoint,
    auth: {
      claims,
      source: "PAPYRUS_GRAPHQL_JWT",
      token,
    },
    client: new PapyrusGraphQLAuthoringClient({ endpoint, authToken: token }),
  };
}

async function inspect() {
  const { endpoint, auth, client } = createAuthoringClient();
  const groups = getClaimValues(auth.claims, "groups").concat(getClaimValues(auth.claims, "cognito:groups"));
  const roles = getClaimValues(auth.claims, "roles");
  const scope = auth.claims.scope ?? auth.claims.scp ?? "";

  await client.inspectReachability();

  console.log(`GraphQL endpoint: ${endpoint}`);
  console.log(`Auth source: ${auth.source}`);
  console.log(`JWT issuer: ${auth.claims.iss ?? "unknown"}`);
  console.log(`JWT subject: ${auth.claims.sub ?? "unknown"}`);
  console.log(`JWT audience: ${formatClaim(auth.claims.aud)}`);
  console.log(`JWT expires: ${auth.claims.exp ? new Date(auth.claims.exp * 1000).toISOString() : "unknown"}`);
  console.log(`JWT groups: ${groups.join(", ") || "none"}`);
  console.log(`JWT roles: ${roles.join(", ") || "none"}`);
  console.log(`JWT scope: ${formatClaim(scope)}`);
  console.log("GraphQL reachability: ok");
}

async function listArticles() {
  const { client } = createAuthoringClient();
  const articles = await client.listPublishedArticles();
  for (const article of articles) {
    console.log(`${article.slug}\t${article.headline ?? article.title ?? article.id}`);
  }
}

async function handleSync(subject, slug) {
  const { client } = createAuthoringClient();
  if (subject === "article" && slug) {
    const result = await syncSingleArticle(client, slug);
    printSyncSummary(result);
    return;
  }
  if (subject === "edition" && slug) {
    const result = await syncEdition(client, slug);
    printSyncSummary(result);
    return;
  }
  printUsage();
  process.exitCode = 1;
}

async function handleDiff(subject, slug) {
  const { client } = createAuthoringClient();
  if (subject !== "edition" || !slug) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const result = await diffEdition(client, slug);
  printDiffSummary(result);
}

async function handleDelete(subject, flags) {
  if (subject !== "all" || !flags.includes("--yes")) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const { client } = createAuthoringClient();
  const result = await deleteAllContent(client);
  printDeleteSummary(result);
}

async function importSteering(flags) {
  const options = parseOptions(flags);
  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const resolvedCorpus = resolveSteeringImportCorpus(steeringConfig, options);
  const bundle = options.bundle
    ? loadJsonFile(options.bundle)
    : loadSteeringBundleFromBiblicus({
        corpus: resolvedCorpus.corpusPath,
        classifier: resolvedCorpus.classifierId,
        topicGovernanceSnapshot: options["topic-governance-snapshot"],
      });
  const { client } = createAuthoringClient();
  const plan = buildSteeringImportRecords(bundle, {
    classifierId: resolvedCorpus.classifierId,
    corpusConfig: resolvedCorpus.corpusConfig,
  });
  const changes = await buildRecordChanges(client, plan.records);
  await applyRecordChanges(client, changes);
  printCurationImportSummary("steering", plan.importRunId, changes);
}

async function importSteeringConfig(flags) {
  const options = parseOptions(flags);
  const steeringConfig = requireSteeringConfig({ configPath: options.config });
  const { client } = createAuthoringClient();
  const records = buildSteeringConfigRecords(steeringConfig);
  const changes = await buildSteeringConfigRecordChanges(client, records);
  await applyRecordChanges(client, changes);
  printCurationImportSummary("config", "steering-config", changes);
}

async function importProjection(flags) {
  const options = parseOptions(flags);
  if (!options.bundle) throw new Error("curation import-projection requires --bundle.");
  const payload = loadJsonFile(options.bundle);
  const steeringConfig = loadSteeringConfig({ configPath: options.config });
  const resolvedProjection = resolveProjectionImportCorpora(steeringConfig, options);
  const { client } = createAuthoringClient();
  const plan = buildProjectionImportRecords(payload, {
    authorityCorpusConfig: resolvedProjection.authorityCorpus,
    authorityCorpusId: resolvedProjection.authorityCorpusId,
    targetCorpusConfig: resolvedProjection.targetCorpus,
    targetCorpusId: resolvedProjection.targetCorpusId,
    classifierId: resolvedProjection.classifierId,
  });
  const changes = await buildRecordChanges(client, plan.records);
  await applyRecordChanges(client, changes);
  printCurationImportSummary("projection", plan.importRunId, changes);
}

async function exportTopicSet(flags) {
  const options = parseOptions(flags);
  const topicSetId = options["topic-set"];
  if (!topicSetId) throw new Error("curation export-topic-set requires --topic-set.");
  if (!options.output) throw new Error("curation export-topic-set requires --output.");
  const { client } = createAuthoringClient();
  const topicSet = await client.getRecord("CurationTopicSet", topicSetId);
  if (!topicSet) throw new Error(`CurationTopicSet ${topicSetId} was not found.`);
  const topics = (await client.listRecords("CurationTopic"))
    .filter((topic) => topic.topicSetId === topicSetId && topic.status !== "deprecated");
  writeJsonFile(options.output, buildAcceptedTopicSetPayload(topicSet, topics));
  console.log(`export\ttopic-set\t${topicSetId}\t${options.output}\t${topics.length} topics`);
}

async function deleteAllContent(client) {
  const deleteOrder = ["MediaAsset", "ItemTag", "EditionItem", "Item", "Tag", "Edition"];
  const result = [];

  for (const modelName of deleteOrder) {
    const records = await client.listRecords(modelName);
    for (const record of records) {
      await client.deleteRecord(modelName, record.id);
    }
    result.push({ modelName, deleted: records.length });
  }

  return result;
}

async function buildRecordChanges(client, records) {
  const changes = [];
  for (const record of records) {
    changes.push(await buildRecordChange(client, record.modelName, record.expected));
  }
  return changes;
}

async function buildSteeringConfigRecordChanges(client, records) {
  const changes = [];
  for (const record of records) {
    const current = await client.getRecord(record.modelName, record.expected.id);
    if (!current) {
      changes.push({ ...record, current, action: "create" });
      continue;
    }
    const action = current.name === record.expected.name && current.role === record.expected.role ? "noop" : "update";
    changes.push({
      modelName: record.modelName,
      expected: action === "update"
        ? {
            id: record.expected.id,
            name: record.expected.name,
            role: record.expected.role,
            updatedAt: record.expected.updatedAt,
          }
        : record.expected,
      current,
      action,
    });
  }
  return changes;
}

async function syncSingleArticle(client, slug) {
  const editionConfig = loadEditionConfig();
  const article = getMarkdownArticle(slug);
  if (!article) {
    throw new Error(`Could not find local Markdown article ${slug}.`);
  }

  const diff = await buildArticleDiff(client, article, editionConfig, editionConfig.articleOrder.indexOf(article.slug));
  await applyRecordChanges(client, diff.records);
  return diff;
}

async function syncEdition(client, editionSlug) {
  const diff = await diffEdition(client, editionSlug);
  await applyRecordChanges(client, diff.records);
  return diff;
}

async function diffEdition(client, editionSlug) {
  const editionConfig = loadEditionConfig();
  if (editionSlug !== editionConfig.slug) {
    throw new Error(`Local editorial config only defines edition ${editionConfig.slug}.`);
  }

  const articles = loadMarkdownArticles();
  const records = [];
  records.push(await buildEditionRecordChange(client, editionConfig));

  for (const [index, article] of articles.entries()) {
    const articleChanges = await buildArticleDiff(client, article, editionConfig, index);
    records.push(...articleChanges.records);
  }

  return { editionSlug, records };
}

async function buildArticleDiff(client, article, editionConfig, index) {
  const records = [];
  const itemId = `item-${article.slug}`;
  const sectionSlug = slugify(article.section);
  const tagId = `tag-${sectionSlug}`;
  const articleOrderIndex = index + 1;

  const itemRecord = {
    id: itemId,
    type: "article",
    status: "published",
    typeStatus: "article#published",
    slug: article.slug,
    shortSlug: article.shortSlug ?? null,
    section: article.section,
    sectionStatus: `${sectionSlug}#published`,
    title: article.headline,
    headline: article.headline,
    deck: article.deck,
    body: article.body,
    byline: article.byline,
    dateline: article.dateline,
    publishedAt: editionConfig.publishedAt,
    editionDate: editionConfig.publishDate,
    sortTitle: article.headline,
    pullQuotes: article.pullQuotes ?? [],
    layout: toAwsJson({ source: "markdown" }),
    editorial: toAwsJson({}),
  };
  records.push(await buildRecordChange(client, "Item", itemRecord));

  const tagRecord = {
    id: tagId,
    slug: sectionSlug,
    label: article.section,
    type: "section",
  };
  records.push(await buildRecordChange(client, "Tag", tagRecord));

  const itemTagRecord = {
    id: `item-tag-${article.slug}-${sectionSlug}`,
    itemId,
    tagId,
    itemType: "article",
    itemStatus: "published",
    tagSlug: sectionSlug,
    publishedAt: editionConfig.publishedAt,
  };
  records.push(await buildRecordChange(client, "ItemTag", itemTagRecord));

  for (const [assetIndex, asset] of getArticleImageAssets(article).entries()) {
    if (!/^https?:\/\//.test(asset.src)) {
      throw new Error(`Media asset ${asset.id} for ${article.slug} must use an external URL for JWT CLI sync.`);
    }

    const mediaRecord = {
      id: `media-${article.slug}-${assetIndex}`,
      itemId,
      type: "image",
      role: (asset.roles ?? ["lead", "continuation", "continuationInset"]).join(","),
      sortKey: `${String(assetIndex + 1).padStart(3, "0")}#${asset.id}`,
      storagePath: null,
      externalUrl: asset.src,
      alt: asset.alt,
      caption: asset.credit,
      credit: asset.credit,
      width: asset.layout ? Math.round(asset.layout.aspectRatio * asset.layout.preferredHeight) : null,
      height: asset.layout?.preferredHeight ?? null,
      aspectRatio: asset.layout?.aspectRatio ?? null,
      focalX: asset.layout?.focalPoint?.x ?? null,
      focalY: asset.layout?.focalPoint?.y ?? null,
      minHeight: asset.layout?.minHeight ?? null,
      preferredHeight: asset.layout?.preferredHeight ?? null,
      maxHeight: asset.layout?.maxHeight ?? null,
      crop: asset.layout?.crop ?? null,
      wrapsText: asset.layout?.wrapsText ?? null,
      metadata: toAwsJson({ sourceUrl: asset.src }),
    };
    records.push(await buildRecordChange(client, "MediaAsset", mediaRecord));
  }

  if (editionConfig.articleOrder.includes(article.slug)) {
    const editionItemRecord = {
      id: `${editionConfig.id}-${article.slug}`,
      editionId: editionConfig.id,
      itemId,
      placementKey: `front:${articleOrderIndex}`,
      sortKey: `${String(articleOrderIndex).padStart(3, "0")}#${article.slug}`,
      pageNumber: 1,
      priority: articleOrderIndex,
      metadata: toAwsJson({}),
    };
    records.push(await buildRecordChange(client, "EditionItem", editionItemRecord));
  }

  return { articleSlug: article.slug, records };
}

async function buildEditionRecordChange(client, editionConfig) {
  return buildRecordChange(client, "Edition", {
    id: editionConfig.id,
    slug: editionConfig.slug,
    title: editionConfig.title,
    status: "published",
    editionDate: editionConfig.publishDate,
    publishedAt: editionConfig.publishedAt || `${editionConfig.publishDate}T12:00:00.000Z`,
    description: editionConfig.description,
    layoutPlan: toAwsJson(editionConfig.layoutPlan),
    metadata: toAwsJson({ source: "markdown-sync" }),
  });
}

async function buildRecordChange(client, modelName, expected) {
  const current = await client.getRecord(modelName, expected.id);
  const action = !current ? "create" : recordsEqual(current, expected) ? "noop" : "update";
  return { modelName, expected, current, action };
}

async function applyRecordChanges(client, records) {
  for (const record of records) {
    if (record.action === "noop") continue;
    await client.upsert(record.modelName, record.expected);
  }
}

function printDiffSummary(result) {
  console.log(`Edition: ${result.editionSlug}`);
  for (const record of result.records) {
    console.log(`${record.action}\t${record.modelName}\t${record.expected.id}`);
  }
}

function printSyncSummary(result) {
  for (const record of result.records) {
    console.log(`${record.action}\t${record.modelName}\t${record.expected.id}`);
  }
}

function printDeleteSummary(result) {
  for (const record of result) {
    console.log(`delete\t${record.modelName}\t${record.deleted}`);
  }
}

function printCurationImportSummary(kind, importRunId, changes) {
  console.log(`Import: ${kind}`);
  console.log(`Run: ${importRunId}`);
  for (const record of changes) {
    console.log(`${record.action}\t${record.modelName}\t${record.expected.id}`);
  }
}

function recordsEqual(left, right) {
  return stableStringify(normalizeRecord(left)) === stableStringify(normalizeRecord(right));
}

const AWS_JSON_FIELDS = new Set(["layout", "editorial", "metadata", "layoutPlan", "payload"]);

function normalizeRecord(record, keyName = "") {
  if (Array.isArray(record)) return record.map(normalizeRecord);
  if (typeof record === "string" && AWS_JSON_FIELDS.has(keyName)) {
    return normalizeRecord(parseAwsJson(record), keyName);
  }
  if (!record || typeof record !== "object") return record;

  const normalized = {};
  for (const key of Object.keys(record).sort()) {
    if (record[key] === undefined || record[key] === null) continue;
    normalized[key] = normalizeRecord(record[key], key);
  }
  return normalized;
}

function stableStringify(value) {
  return JSON.stringify(value);
}

function toAwsJson(value) {
  return JSON.stringify(value);
}

function parseAwsJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function printUsage() {
  console.log("Usage:");
  console.log("  npm run content -- content inspect");
  console.log("  npm run content -- content list articles");
  console.log("  npm run content -- content diff edition <edition-slug>");
  console.log("  npm run content -- content sync article <slug>");
  console.log("  npm run content -- content sync edition <edition-slug>");
  console.log("  npm run content -- content delete all --yes");
  console.log("  npm run content -- curation import-steering --bundle <steering-export.json>");
  console.log("  npm run content -- curation import-steering --corpus <path> --classifier <classifier-id>");
  console.log("  npm run content -- curation import-steering --config <steering.yml> --corpus-key <key>");
  console.log("  npm run content -- curation import-config --config <steering.yml>");
  console.log("  npm run content -- curation export-topic-set --topic-set <id> --output <accepted-topic-set.json>");
  console.log("  npm run content -- curation import-projection --bundle <projection.json>");
  console.log("  npm run content -- curation import-projection --config <steering.yml> --target-corpus-key <key> --authority-corpus-key <key> --bundle <projection.json>");
}

function resolveSteeringImportCorpus(config, options) {
  if (options["corpus-key"]) {
    const requiredConfig = config ?? requireSteeringConfig({ configPath: options.config });
    const corpusConfig = requireCorpusConfig(requiredConfig, options["corpus-key"], "--corpus-key");
    return {
      corpusConfig,
      corpusPath: options.corpus ?? corpusConfig.path,
      classifierId: resolveClassifierForCorpus(requiredConfig, corpusConfig, options.classifier),
    };
  }

  const corpusConfig = findCorpusConfigByPath(config, options.corpus);
  return {
    corpusConfig,
    corpusPath: options.corpus,
    classifierId: options.classifier ?? (corpusConfig && config ? resolveClassifierForCorpus(config, corpusConfig, undefined) : undefined),
  };
}

function resolveProjectionImportCorpora(config, options) {
  let targetCorpus = null;
  let authorityCorpus = null;
  if (options["target-corpus-key"]) {
    const requiredConfig = config ?? requireSteeringConfig({ configPath: options.config });
    targetCorpus = requireCorpusConfig(requiredConfig, options["target-corpus-key"], "--target-corpus-key");
    const authorityKey = options["authority-corpus-key"] ?? targetCorpus.canonicalProjection?.authorityCorpusKey;
    if (authorityKey) authorityCorpus = requireCorpusConfig(requiredConfig, authorityKey, "--authority-corpus-key");
    const classifierId = options.classifier ?? targetCorpus.canonicalProjection?.classifierId ?? requiredConfig.canonicalTopicSet.classifierId;
    return {
      targetCorpus,
      authorityCorpus,
      targetCorpusId: options["target-corpus-id"] ?? curationCorpusId(targetCorpus),
      authorityCorpusId: options["authority-corpus-id"] ?? (authorityCorpus ? curationCorpusId(authorityCorpus) : undefined),
      classifierId,
    };
  }
  if (options["authority-corpus-key"]) {
    const requiredConfig = config ?? requireSteeringConfig({ configPath: options.config });
    authorityCorpus = requireCorpusConfig(requiredConfig, options["authority-corpus-key"], "--authority-corpus-key");
  }
  return {
    targetCorpus,
    authorityCorpus,
    targetCorpusId: options["target-corpus-id"],
    authorityCorpusId: options["authority-corpus-id"] ?? (authorityCorpus ? curationCorpusId(authorityCorpus) : undefined),
    classifierId: options.classifier,
  };
}

function parseOptions(flags) {
  const options = {};
  for (let index = 0; index < flags.length; index += 1) {
    const token = flags[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument ${token}.`);
    const key = token.slice(2);
    const next = flags[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return options;
}

function validateAuthoringClaims(claims) {
  if (isJwtExpired(claims)) {
    throw new Error("PAPYRUS_GRAPHQL_JWT is expired.");
  }

  const claimName = process.env.PAPYRUS_JWT_AUTHORING_CLAIM;
  const expectedValue = process.env.PAPYRUS_JWT_AUTHORING_VALUE;
  if (!claimName && !expectedValue) return;
  if (!claimName || !expectedValue) {
    throw new Error("PAPYRUS_JWT_AUTHORING_CLAIM and PAPYRUS_JWT_AUTHORING_VALUE must be set together.");
  }

  const values = getClaimValues(claims, claimName);
  if (!values.includes(expectedValue)) {
    throw new Error(`PAPYRUS_GRAPHQL_JWT does not include ${expectedValue} in claim ${claimName}.`);
  }
}

function getClaimValues(claims, name) {
  const value = claims[name];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(/[,\s]+/).filter(Boolean);
  if (value === undefined || value === null) return [];
  return [String(value)];
}

function formatClaim(value) {
  if (Array.isArray(value)) return value.join(", ") || "none";
  if (value === undefined || value === null || value === "") return "none";
  return String(value);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
