import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { addToUserGroup, createAndSignUpUser, signInUser } from "@aws-amplify/seed";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { signOut } from "aws-amplify/auth";
import { uploadData } from "aws-amplify/storage";
import YAML from "yaml";
import type { Schema } from "../data/resource";
import type { Article, ArticleImageAsset } from "../../lib/articles";
import * as amplifyServerRuntimeModule from "../../lib/amplify-server-runtime";
import { getSeedEditionConfig, seedEditionArticles } from "./seed-edition-content";
import { getArticleImageAssets } from "../../lib/articles";

const amplifyServerRuntime = getRuntimeModule(amplifyServerRuntimeModule);
const { getAmplifyServerRuntime } = amplifyServerRuntime as typeof import("../../lib/amplify-server-runtime");

const EDITOR_GROUP = "editor";
const ADMIN_GROUP = "admin";
const NEWSROOM_SECTIONS_CONFIG_PATH = path.join(process.cwd(), "corpora", "papyrus-newsroom-sections.yml");
const PUBLICATION_DOCTRINE_CONFIG_PATH = path.join(process.cwd(), "corpora", "papyrus-publication-doctrine.yml");
const REQUIRED_PROCEDURES_CONFIG_PATH = path.join(process.cwd(), "corpora", "papyrus-required-procedures.json");
const NEWSROOM_SECTION_TYPES = new Set(["canonical", "floating", "rotating"]);

type DataClient = ReturnType<typeof generateClient<Schema>>;
type NewsroomSectionSeed = {
  id: string;
  title: string;
  shortTitle: string;
  type: "canonical" | "floating" | "rotating";
  editorialMission: string;
  editorialPolicy: string;
  enabled: boolean;
  sortOrder: number;
  defaultArticleTypes: string[];
  defaultPageBudget: number | null;
  assignmentGuidance: string | null;
  killCriteria: string | null;
  visualGuidance: string | null;
};

type PublicationDoctrineSeed = {
  kind: "mission" | "policy";
  body: string[];
};

type ProcedureSeed = {
  key: string;
  title: string;
  category: string;
  description: string;
  versionLabel: string;
  tactusSource: string;
  parameterSchema: Record<string, unknown>;
  defaults: Record<string, unknown>;
};

const REQUIRED_CLI_PROCEDURE_KEYS = loadRequiredCliProcedureKeys();
const PROCEDURE_SOURCE_DIR = path.join(process.cwd(), "procedures", "newsroom");

function loadProcedureSeedSource(filename: string): string {
  const sourcePath = path.join(PROCEDURE_SOURCE_DIR, filename);
  const source = fs.readFileSync(sourcePath, "utf8").trimEnd();
  return `${source}\n`;
}

const PROCEDURE_SEED_BY_KEY: Record<string, ProcedureSeed> = {
  "ingestion.reference.register": {
    key: "ingestion.reference.register",
    title: "Ingest Reference",
    category: "ingestion",
    description: "Registers one reference intake payload and dispatches immediate enrichment workflow.",
    versionLabel: "starter",
    tactusSource: loadProcedureSeedSource("ingestion_reference_register.tac"),
    parameterSchema: {
      type: "object",
      required: ["externalItemId", "sourceUri"],
      properties: {
        externalItemId: { type: "string" },
        sourceUri: { type: "string" },
        title: { type: "string" },
        corpusKey: { type: "string" },
      },
    },
    defaults: {
      corpusKey: "AI-ML-research",
    },
  },
  "newsroom.research.explorer": {
    key: "newsroom.research.explorer",
    title: "Newsroom Research Explorer",
    category: "newsroom",
    description: "Builds structured research packets for assignment-backed newsroom workflows.",
    versionLabel: "starter",
    tactusSource: loadProcedureSeedSource("research_explorer.tac"),
    parameterSchema: {
      type: "object",
      required: ["corpus_key"],
      properties: {
        assignment_item_id: { type: "string" },
        assignment_json: { type: "object" },
        corpus_key: { type: "string" },
        context_profile: { type: "string" },
        research_mode: { type: "string" },
        research_questions: { type: "string" },
        max_evidence_items: { type: "number" },
      },
    },
    defaults: {
      context_profile: "researcher",
      research_mode: "source_discovery",
      max_evidence_items: 20,
    },
  },
  "newsroom.reporting.context": {
    key: "newsroom.reporting.context",
    title: "Newsroom Reporting Context",
    category: "newsroom",
    description: "Builds structured reporting context packets from assignment-backed runs.",
    versionLabel: "starter",
    tactusSource: loadProcedureSeedSource("reporter.tac"),
    parameterSchema: {
      type: "object",
      required: ["corpus_key"],
      properties: {
        assignment_item_id: { type: "string" },
        assignment_json: { type: "object" },
        corpus_key: { type: "string" },
        context_profile: { type: "string" },
        source_research_assignment_id: { type: "string" },
        source_research_packet_id: { type: "string" },
        source_research_packet_path: { type: "string" },
      },
    },
    defaults: {
      context_profile: "reporting",
    },
  },
  "newsroom.reference.summarization": {
    key: "newsroom.reference.summarization",
    title: "Newsroom Reference Summarization",
    category: "newsroom",
    description: "Generates source-voice reference summaries for curation metadata and summary messages.",
    versionLabel: "starter",
    tactusSource: loadProcedureSeedSource("reference_summarization.tac"),
    parameterSchema: {
      type: "object",
      required: ["mode", "source_text"],
      properties: {
        mode: { type: "string" },
        source_text: { type: "string" },
        max_tokens: { type: "number" },
        reference_title: { type: "string" },
        source_uri: { type: "string" },
        known_title: { type: "string" },
        known_subtitle: { type: "string" },
        media_type: { type: "string" },
        doctrine_context_text: { type: "string" },
        model: { type: "string" },
        prompt_version: { type: "string" },
      },
    },
    defaults: {
      mode: "reference_summary",
      max_tokens: 500,
      model: "gpt-5.4-mini",
    },
  },
  "ontology.relationship-explainer": {
    key: "ontology.relationship-explainer",
    title: "Ontology Relationship Explainer",
    category: "ontology",
    description: "Generates contextual explanations for SemanticRelation rows from resolved Papyrus graph context.",
    versionLabel: "starter",
    tactusSource: loadProcedureSeedSource("ontology_relationship_explainer.tac"),
    parameterSchema: {
      type: "object",
      required: ["context_json"],
      properties: {
        context_json: { type: "object" },
      },
    },
    defaults: {},
  },
  "ontology.concept-profiler": {
    key: "ontology.concept-profiler",
    title: "Ontology Concept Profiler",
    category: "ontology",
    description: "Synthesizes generated Concept profiles from fresh relation-specific explanations.",
    versionLabel: "starter",
    tactusSource: loadProcedureSeedSource("ontology_concept_profiler.tac"),
    parameterSchema: {
      type: "object",
      required: ["context_json"],
      properties: {
        context_json: { type: "object" },
      },
    },
    defaults: {},
  },
};

const PROCEDURE_SEEDS: ProcedureSeed[] = [
  PROCEDURE_SEED_BY_KEY["ingestion.reference.register"],
  ...REQUIRED_CLI_PROCEDURE_KEYS.map((key) => {
    const seed = PROCEDURE_SEED_BY_KEY[key];
    if (!seed) throw new Error(`Missing ProcedureSeed for required CLI procedure '${key}'.`);
    return seed;
  }),
];

let cachedClient: DataClient | null = null;

function getRuntimeModule<T extends object>(module: T): T {
  return "default" in module && typeof module.default === "object" && module.default !== null ? (module.default as T) : module;
}

function getSeedClient(): DataClient {
  if (!cachedClient) cachedClient = generateClient<Schema>({ authMode: "userPool" });
  return cachedClient;
}

async function main() {
  const runtime = getAmplifyServerRuntime();
  Amplify.configure(runtime.config);
  await signInSeedEditor();
  const editionConfig = getSeedEditionConfig();

  try {
    const orderedArticles = orderArticles(seedEditionArticles, editionConfig.articleOrder);
    const editionRecord = withVersionFields({
      id: editionConfig.id,
      slug: editionConfig.slug,
      title: editionConfig.title,
      status: "published",
      editionDate: editionConfig.publishDate,
      publishedAt: editionConfig.publishedAt,
      description: editionConfig.description,
      layoutPlan: toAwsJson(editionConfig.layoutPlan),
      metadata: toAwsJson(editionConfig.metadata),
    }, {
      lineageId: editionConfig.id,
      versionCreatedAt: editionConfig.publishedAt,
      versionCreatedBy: "amplify-seed",
      changeReason: "fixture seed",
    });
    await upsert("Edition", editionRecord);
    await upsert("PublishedEdition", {
      id: publishedEditionId(editionConfig.id),
      sourceEditionId: editionRecord.id,
      editionLineageId: editionRecord.lineageId,
      versionNumber: editionRecord.versionNumber,
      slug: editionConfig.slug,
      title: editionConfig.title,
      status: "published",
      editionDate: editionConfig.publishDate,
      publishedAt: editionConfig.publishedAt,
      description: editionConfig.description,
      layoutPlan: toAwsJson(editionConfig.layoutPlan),
      metadata: toAwsJson(editionConfig.metadata),
    });
    await seedNewsroomSections(editionConfig.publishedAt);
    await seedPublicationDoctrine(editionConfig.publishedAt);
    await seedProcedureDefinitions(editionConfig.publishedAt);

    for (const [index, article] of orderedArticles.entries()) {
      await seedArticle(article, index, editionConfig);
    }

    console.log(`Seeded ${orderedArticles.length} articles into Amplify Data and Storage.`);
  } finally {
    await signOut();
  }
}

async function signInSeedEditor() {
  const password = process.env.PAPYRUS_SEED_PASSWORD ?? "PapyrusSeed1!";
  const email = process.env.PAPYRUS_SEED_EMAIL ?? "papyrus-seed-editor@example.com";
  const username = process.env.PAPYRUS_SEED_USERNAME ?? email;

  try {
    await createAndSignUpUser({
      signInAfterCreation: false,
      username,
      password,
      signInFlow: "Password",
      userAttributes: {
        email,
      },
    });
  } catch (error) {
    if (!isExpectedExistingUserError(error)) throw error;
  }

  await addToUserGroup({ username }, EDITOR_GROUP);
  await addToUserGroup({ username }, ADMIN_GROUP);
  const signedIn = await signInUser({
    username,
    password,
    signInFlow: "Password",
  });

  if (!signedIn) {
    throw new Error(`Could not sign in seed editor ${username}. Check PAPYRUS_SEED_PASSWORD.`);
  }
}

type SeedEditionConfig = ReturnType<typeof getSeedEditionConfig>;

async function seedArticle(article: Article, index: number, editionConfig: SeedEditionConfig) {
  const itemId = `item-${article.slug}`;
  const sectionSlug = slugify(article.section);
  const tagId = `tag-${sectionSlug}`;
  const sortKey = `${String(index + 1).padStart(3, "0")}#${article.slug}`;

  const itemRecord = withVersionFields({
    id: itemId,
    type: "article",
    status: "published",
    typeStatus: "article#published",
    slug: article.slug,
    shortSlug: article.shortSlug,
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
    layout: toAwsJson({ source: "fixture" }),
    editorial: toAwsJson({}),
  }, {
    lineageId: itemId,
    versionCreatedAt: editionConfig.publishedAt,
    versionCreatedBy: "amplify-seed",
    changeReason: "fixture seed",
  });
  await upsert("Item", itemRecord);
  await upsert("PublishedItem", {
    id: publishedItemId(itemId),
    sourceItemId: itemRecord.id,
    itemLineageId: itemRecord.lineageId,
    versionNumber: itemRecord.versionNumber,
    type: "article",
    status: "published",
    typeStatus: "article#published",
    slug: article.slug,
    shortSlug: article.shortSlug,
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
    layout: toAwsJson({ source: "fixture" }),
    editorial: toAwsJson({}),
  });

  await upsert("Tag", {
    id: tagId,
    slug: sectionSlug,
    label: article.section,
    type: "section",
  });

  await upsert("ItemTag", {
    id: `item-tag-${article.slug}-${sectionSlug}`,
    itemId,
    tagId,
    itemType: "article",
    itemStatus: "published",
    tagSlug: sectionSlug,
    publishedAt: editionConfig.publishedAt,
  });

  await upsert("EditionItem", {
    id: `${editionConfig.id}-${article.slug}`,
    editionId: editionConfig.id,
    editionLineageId: editionConfig.id,
    itemId,
    itemLineageId: itemId,
    placementKey: `front:${index + 1}`,
    sortKey,
    pageNumber: 1,
    priority: index + 1,
    metadata: toAwsJson({}),
  });
  await upsert("PublishedEditionItem", {
    id: `${publishedEditionId(editionConfig.id)}-${article.slug}`,
    publishedEditionId: publishedEditionId(editionConfig.id),
    publishedItemId: publishedItemId(itemId),
    sourceEditionItemId: `${editionConfig.id}-${article.slug}`,
    sourceEditionId: editionConfig.id,
    sourceItemId: itemId,
    editionLineageId: editionConfig.id,
    itemLineageId: itemId,
    placementKey: `front:${index + 1}`,
    sortKey,
    pageNumber: 1,
    priority: index + 1,
    metadata: toAwsJson({}),
  });

  const imageAssets = getArticleImageAssets(article);
  for (const [assetIndex, asset] of imageAssets.entries()) {
    const uploaded = await uploadSeedImage(article, asset, assetIndex);
    const mediaId = `media-${article.slug}-${assetIndex}`;
    const mediaSortKey = `${String(assetIndex + 1).padStart(3, "0")}#${asset.id}`;
    await upsert("MediaAsset", {
      id: mediaId,
      itemId,
      type: "image",
      role: (asset.roles ?? ["lead", "continuation", "continuationInset"]).join(","),
      sortKey: mediaSortKey,
      storagePath: uploaded.storagePath,
      externalUrl: asset.src,
      alt: asset.alt,
      caption: asset.caption ?? asset.credit,
      credit: asset.credit,
      width: uploaded.width,
      height: uploaded.height,
      aspectRatio: asset.layout?.aspectRatio,
      focalX: asset.layout?.focalPoint?.x,
      focalY: asset.layout?.focalPoint?.y,
      minHeight: asset.layout?.minHeight,
      preferredHeight: asset.layout?.preferredHeight,
      maxHeight: asset.layout?.maxHeight,
      crop: asset.layout?.crop,
      wrapsText: asset.layout?.wrapsText,
      metadata: toAwsJson(getMediaMetadata(asset)),
    });
    await upsert("PublishedMediaAsset", {
      id: `published-${mediaId}`,
      sourceMediaAssetId: mediaId,
      publishedItemId: publishedItemId(itemId),
      sourceItemId: itemId,
      itemLineageId: itemId,
      type: "image",
      role: (asset.roles ?? ["lead", "continuation", "continuationInset"]).join(","),
      sortKey: mediaSortKey,
      storagePath: uploaded.storagePath,
      externalUrl: asset.src,
      alt: asset.alt,
      caption: asset.caption ?? asset.credit,
      credit: asset.credit,
      width: uploaded.width,
      height: uploaded.height,
      aspectRatio: asset.layout?.aspectRatio,
      focalX: asset.layout?.focalPoint?.x,
      focalY: asset.layout?.focalPoint?.y,
      minHeight: asset.layout?.minHeight,
      preferredHeight: asset.layout?.preferredHeight,
      maxHeight: asset.layout?.maxHeight,
      crop: asset.layout?.crop,
      wrapsText: asset.layout?.wrapsText,
      metadata: toAwsJson(getMediaMetadata(asset)),
    });
  }
}

async function seedNewsroomSections(importedAt: string) {
  const sections = loadNewsroomSectionSeeds();
  for (const section of sections) {
    await upsert("NewsroomSection", {
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
      createdAt: importedAt,
      updatedAt: importedAt,
    });
  }
}

async function seedPublicationDoctrine(importedAt: string) {
  const doctrine = loadPublicationDoctrineSeeds();
  for (const entry of doctrine) {
    const details =
      entry.kind === "mission"
        ? {
            id: "item-editorial-doctrine-mission-v1",
            lineageId: "item-editorial-doctrine-mission",
            slug: "editorial-doctrine-mission",
            title: "Editorial Mission",
          }
        : {
            id: "item-editorial-doctrine-policy-v1",
            lineageId: "item-editorial-doctrine-policy",
            slug: "editorial-doctrine-policy",
            title: "Editorial Policy",
          };
    await upsert("Item", {
      id: details.id,
      lineageId: details.lineageId,
      versionNumber: 1,
      versionState: "current",
      versionCreatedAt: importedAt,
      versionCreatedBy: "amplify-seed",
      type: "doctrine",
      status: "private",
      typeStatus: "doctrine#private",
      slug: details.slug,
      title: details.title,
      body: entry.body,
      updatedAt: importedAt,
    });
  }
}

async function seedProcedureDefinitions(importedAt: string) {
  for (const seed of PROCEDURE_SEEDS) {
    const procedureId = `procedure-definition-${safeProcedureId(seed.key)}`;
    const versionId = `procedure-version-${safeProcedureId(seed.key)}-1`;
    await upsert("ProcedureDefinition", {
      id: procedureId,
      procedureKey: seed.key,
      title: seed.title,
      category: seed.category,
      description: seed.description,
      enabled: true,
      enabledStatus: "enabled",
      currentVersionId: versionId,
      createdBy: "amplify-seed",
      createdAt: importedAt,
      updatedBy: "amplify-seed",
      updatedAt: importedAt,
      newsroomFeedKey: "procedures",
    });
    await upsert("ProcedureVersion", {
      id: versionId,
      procedureId,
      procedureKey: seed.key,
      versionNumber: 1,
      status: "published",
      isCurrent: true,
      label: seed.versionLabel,
      tactusSource: seed.tactusSource,
      parameterSchema: toAwsJson(seed.parameterSchema),
      defaults: toAwsJson(seed.defaults),
      changelog: "Seeded starter procedure.",
      createdBy: "amplify-seed",
      createdAt: importedAt,
      updatedBy: "amplify-seed",
      updatedAt: importedAt,
    });
  }
}

function safeProcedureId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "procedure";
}

function loadRequiredCliProcedureKeys(configPath = REQUIRED_PROCEDURES_CONFIG_PATH): string[] {
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    requiredCliProcedures?: Record<string, unknown>;
  };
  const map = parsed?.requiredCliProcedures;
  if (!map || typeof map !== "object") {
    throw new Error(`Invalid required procedures config file: ${configPath}`);
  }
  const keys = Array.from(new Set(Object.values(map).map((value) => String(value ?? "").trim()).filter(Boolean)));
  if (!keys.length) {
    throw new Error(`No required CLI procedure keys were configured in ${configPath}.`);
  }
  return keys;
}

function loadNewsroomSectionSeeds(configPath = NEWSROOM_SECTIONS_CONFIG_PATH): NewsroomSectionSeed[] {
  const parsed = YAML.parse(fs.readFileSync(configPath, "utf8")) as {
    schemaVersion?: number;
    sections?: Array<Record<string, unknown>>;
  };
  if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.sections)) {
    throw new Error(`Invalid newsroom section seed file: ${configPath}`);
  }
  return parsed.sections.map((entry, index) => normalizeNewsroomSectionSeed(entry, index, configPath));
}

function loadPublicationDoctrineSeeds(configPath = PUBLICATION_DOCTRINE_CONFIG_PATH): PublicationDoctrineSeed[] {
  const parsed = YAML.parse(fs.readFileSync(configPath, "utf8")) as {
    schemaVersion?: number;
    doctrine?: Array<Record<string, unknown>>;
  };
  if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.doctrine)) {
    throw new Error(`Invalid publication doctrine seed file: ${configPath}`);
  }
  const entries = parsed.doctrine.map((entry, index) => normalizePublicationDoctrineSeed(entry, index, configPath));
  const byKind = new Map(entries.map((entry) => [entry.kind, entry]));
  for (const kind of ["mission", "policy"] as const) {
    if (!byKind.has(kind)) {
      throw new Error(`Publication doctrine seed file ${configPath} is missing kind '${kind}'.`);
    }
  }
  return [byKind.get("mission")!, byKind.get("policy")!];
}

function normalizeNewsroomSectionSeed(entry: Record<string, unknown>, index: number, configPath: string): NewsroomSectionSeed {
  const id = String(entry.id ?? "").trim();
  if (!id) throw new Error(`Newsroom section at index ${index} in ${configPath} is missing id.`);
  const title = requiredText(entry.title, `title for section ${id}`);
  const rawTypeValue = String(entry.type ?? "").trim().toLowerCase();
  if (!NEWSROOM_SECTION_TYPES.has(rawTypeValue)) {
    throw new Error(`Newsroom section ${id} in ${configPath} has unsupported type '${String(entry.type ?? "")}'.`);
  }
  const typeValue = rawTypeValue === "rotating" ? "floating" : rawTypeValue;
  return {
    id,
    title,
    shortTitle: requiredText(entry.shortTitle, `shortTitle for section ${id}`),
    type: typeValue as NewsroomSectionSeed["type"],
    editorialMission: requiredText(entry.editorialMission, `editorialMission for section ${id}`),
    editorialPolicy: requiredText(entry.editorialPolicy, `editorialPolicy for section ${id}`),
    enabled: typeof entry.enabled === "boolean" ? entry.enabled : true,
    sortOrder: positiveInteger(entry.sortOrder, index + 1),
    defaultArticleTypes: normalizeStringList(entry.defaultArticleTypes),
    defaultPageBudget: optionalInteger(entry.defaultPageBudget),
    assignmentGuidance: optionalText(entry.assignmentGuidance),
    killCriteria: optionalText(entry.killCriteria),
    visualGuidance: optionalText(entry.visualGuidance),
  };
}

function normalizePublicationDoctrineSeed(
  entry: Record<string, unknown>,
  index: number,
  configPath: string,
): PublicationDoctrineSeed {
  const kindValue = String(entry.kind ?? "").trim().toLowerCase();
  if (kindValue !== "mission" && kindValue !== "policy") {
    throw new Error(
      `Publication doctrine entry at index ${index} in ${configPath} has unsupported kind '${String(entry.kind ?? "")}'.`,
    );
  }
  const body = normalizeStringList(entry.body);
  if (!body.length) {
    throw new Error(`Publication doctrine entry '${kindValue}' in ${configPath} requires non-empty body.`);
  }
  return {
    kind: kindValue,
    body,
  };
}

function requiredText(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`Missing ${label} in ${path.basename(NEWSROOM_SECTIONS_CONFIG_PATH)}.`);
  return normalized;
}

function optionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => optionalText(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function optionalInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function uploadSeedImage(article: Article, asset: ArticleImageAsset, index: number) {
  const payload = await loadImagePayload(asset.src);
  const extension = getImageExtension(payload.contentType, asset.src);
  const storagePath = `media/articles/${article.slug}/${String(index + 1).padStart(2, "0")}-${asset.id}.${extension}`;

  await uploadData({
    path: storagePath,
    data: payload.data,
    options: {
      contentType: payload.contentType,
      cacheControl: "public, max-age=31536000, immutable",
    },
  }).result;

  return {
    storagePath,
    width: asset.layout ? Math.round(asset.layout.aspectRatio * asset.layout.preferredHeight) : undefined,
    height: asset.layout?.preferredHeight,
  };
}

async function loadImagePayload(src: string): Promise<{ data: Uint8Array; contentType: string }> {
  if (/^https?:\/\//.test(src)) {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`Could not fetch image ${src}: ${response.status} ${response.statusText}`);
    return {
      data: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "image/jpeg",
    };
  }

  const filepath =
    path.isAbsolute(src) && fs.existsSync(src)
      ? src
      : path.join(process.cwd(), src.startsWith("/") ? path.join("public", src.slice(1)) : src);
  return {
    data: fs.readFileSync(filepath),
    contentType: getContentTypeFromFilename(filepath),
  };
}

async function upsert(modelName: keyof DataClient["models"], record: Record<string, unknown>) {
  const model = (getSeedClient().models as Record<string, unknown>)[String(modelName)] as {
    get(input: { id: string }, options: { authMode: "userPool" }): Promise<{ data?: unknown; errors?: unknown[] }>;
    create(input: Record<string, unknown>, options: { authMode: "userPool" }): Promise<{ errors?: unknown[] }>;
    update(input: Record<string, unknown>, options: { authMode: "userPool" }): Promise<{ errors?: unknown[] }>;
  };
  const current = await model.get({ id: String(record.id) }, { authMode: "userPool" });
  assertNoGraphQLErrors(current.errors);

  const response = current.data
    ? await model.update(record, { authMode: "userPool" })
    : await model.create(record, { authMode: "userPool" });
  assertNoGraphQLErrors(response.errors);
}

function orderArticles(source: Article[], articleOrder: string[]): Article[] {
  return [...source].sort((left, right) => {
    const leftIndex = articleOrder.indexOf(left.slug);
    const rightIndex = articleOrder.indexOf(right.slug);
    const leftRank = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const rightRank = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
    return leftRank - rightRank || left.slug.localeCompare(right.slug);
  });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function getImageExtension(contentType: string, src: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("svg")) return "svg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";

  const match = new URL(src, "file:///").pathname.match(/\.([a-z0-9]+)$/i);
  return match?.[1] ?? "jpg";
}

function getContentTypeFromFilename(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/jpeg";
}

function isExpectedExistingUserError(error: unknown): boolean {
  const text = `${(error as { name?: string }).name ?? ""} ${(error as { message?: string }).message ?? ""}`;
  return text.includes("UsernameExists") || text.includes("already exists");
}

function assertNoGraphQLErrors(errors: unknown[] | null | undefined): void {
  if (!errors?.length) return;
  throw new Error(`Amplify seed GraphQL request failed: ${JSON.stringify(errors)}`);
}

function toAwsJson(value: unknown): string {
  return JSON.stringify(value);
}

function getMediaMetadata(asset: ArticleImageAsset): Record<string, unknown> {
  return {
    sourceUrl: asset.src,
    ...(asset.layout?.inlineFloat ? { inlineFloat: asset.layout.inlineFloat } : {}),
  };
}

function withVersionFields<T extends Record<string, unknown>>(
  record: T,
  options: {
    lineageId: string;
    versionCreatedAt: string;
    versionCreatedBy: string;
    changeReason: string;
  },
): T & {
  lineageId: string;
  versionNumber: number;
  previousVersionId: null;
  versionState: string;
  versionCreatedAt: string;
  versionCreatedBy: string;
  changeReason: string;
  contentHash: string;
} {
  const versioned = {
    ...record,
    lineageId: options.lineageId,
    versionNumber: 1,
    previousVersionId: null,
    versionState: "current",
    versionCreatedAt: options.versionCreatedAt,
    versionCreatedBy: options.versionCreatedBy,
    changeReason: options.changeReason,
  };
  return {
    ...versioned,
    contentHash: contentHashFor(versioned),
  };
}

function contentHashFor(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

function publishedEditionId(editionId: string): string {
  return `published-${editionId}`;
}

function publishedItemId(itemId: string): string {
  return `published-${itemId}`;
}

await main();
