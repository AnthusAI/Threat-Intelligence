import type { Article, ArticleVideoAsset } from "@/lib/articles";
import type { VideoScriptRef, VideoScriptTargetKind } from "@/lib/video-script";
import seedContent from "../seed/seed-edition-content.json";
import seedVideoScripts from "./seed-video-scripts.json";

type SeedVideoScriptEntry = {
  videomlSlug: string;
  targetKind: VideoScriptTargetKind;
  dsl: string;
};

type SeedEditionContent = {
  title: string;
  video?: Omit<ArticleVideoAsset, "type">;
  articles: Article[];
};

type SeedVideoCatalogEntry = {
  storyKey: string;
  slug: string;
  headline: string;
  video: ArticleVideoAsset;
  videoScript: VideoScriptRef;
};

const EDITION_OVERVIEW_SLUG = "edition-overview";

const LEAD_VIDEO_SLUGS = [
  "the-balance-of-power-is-shifting",
  "how-our-newsroom-learns",
  "audit-aws-exposure-before-attackers-do",
  "audit-azure-blast-radius-before-attackers-do",
  "treat-openai-accounts-like-production-infrastructure",
  "how-to-play-games-securely",
] as const;

const STORY_KEYS: Record<string, string> = {
  [EDITION_OVERVIEW_SLUG]: "EditionOverview",
  "the-balance-of-power-is-shifting": "BalanceOfPower",
  "how-our-newsroom-learns": "NewsroomLearns",
  "audit-aws-exposure-before-attackers-do": "AuditAwsExposure",
  "audit-azure-blast-radius-before-attackers-do": "AuditAzureBlastRadius",
  "treat-openai-accounts-like-production-infrastructure": "TreatOpenAiAccounts",
  "how-to-play-games-securely": "PlayGamesSecurely",
};

const seed = seedContent as unknown as SeedEditionContent;
const scripts = seedVideoScripts.scripts as Record<string, SeedVideoScriptEntry>;

function toVideoAsset(video: Omit<ArticleVideoAsset, "type">): ArticleVideoAsset {
  return { type: "video", ...video };
}

function buildVideoScript(targetSlug: string, script: SeedVideoScriptEntry): VideoScriptRef {
  return {
    slug: script.videomlSlug,
    dsl: script.dsl,
    targetKind: script.targetKind,
  };
}

function requireScript(targetSlug: string): SeedVideoScriptEntry {
  const script = scripts[targetSlug];
  if (!script) {
    throw new Error(`Missing VideoML script for '${targetSlug}'. Run npm run videoml:export-seed-scripts.`);
  }
  return script;
}

function buildEditionOverviewEntry(): SeedVideoCatalogEntry {
  if (!seed.video) {
    throw new Error("Seed edition is missing top-level video metadata.");
  }
  const slug = EDITION_OVERVIEW_SLUG;
  return {
    storyKey: STORY_KEYS[slug],
    slug,
    headline: seed.title,
    video: toVideoAsset(seed.video),
    videoScript: buildVideoScript(slug, requireScript(slug)),
  };
}

function buildArticleEntry(article: Article): SeedVideoCatalogEntry {
  if (!article.video) {
    throw new Error(`Article '${article.slug}' is missing video metadata.`);
  }
  return {
    storyKey: STORY_KEYS[article.slug],
    slug: article.slug,
    headline: article.headline,
    video: article.video.type === "video" ? article.video : toVideoAsset(article.video),
    videoScript: buildVideoScript(article.slug, requireScript(article.slug)),
  };
}

const articlesBySlug = new Map(seed.articles.map((article) => [article.slug, article]));

export const TI_SEED_VIDEO_CATALOG: SeedVideoCatalogEntry[] = [
  buildEditionOverviewEntry(),
  ...LEAD_VIDEO_SLUGS.map((slug) => {
    const article = articlesBySlug.get(slug);
    if (!article) {
      throw new Error(`Seed article '${slug}' not found.`);
    }
    return buildArticleEntry(article);
  }),
];

export type { SeedVideoCatalogEntry };
