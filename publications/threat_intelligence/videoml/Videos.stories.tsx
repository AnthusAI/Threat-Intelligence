import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { ArticleVideoFigure } from "@/components/article-video";
import { TI_SEED_VIDEO_CATALOG, type SeedVideoCatalogEntry } from "./seed-video-catalog";

const meta: Meta = {
  title: "Threat Intelligence/Videos",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "VideoML preview mode for Threat Intelligence seed videos. Each video has a dark default story and a paired (Light) story for light-mode preview before rendering. Narration audio syncs when local seed MP4s exist under public/seed-art/threat-intelligence/videos/ (generate via poetry run papyrus videos seed).",
      },
    },
  },
};

export default meta;
type Story = StoryObj;

type PreviewTheme = "dark" | "light";

function VideoPreviewStory({ headline, slug, video, videoScript }: SeedVideoCatalogEntry) {
  return (
    <div className="presentation-page presentation-page--blog mx-auto max-w-5xl p-8">
      <h1 className="mb-6 font-mono text-sm">{headline}</h1>
      <div className="article-page__hero-video">
        <ArticleVideoFigure slug={slug} video={video} videoScript={videoScript} />
      </div>
    </div>
  );
}

function createVideoStory(entry: SeedVideoCatalogEntry, theme: PreviewTheme): Story {
  const suffix = theme === "light" ? " (Light)" : "";
  return {
    name: `${entry.headline}${suffix}`,
    parameters: { papyrusTheme: theme },
    render: () => <VideoPreviewStory {...entry} />,
  };
}

const catalogByStoryKey = Object.fromEntries(
  TI_SEED_VIDEO_CATALOG.map((entry) => [entry.storyKey, entry]),
) as Record<string, SeedVideoCatalogEntry>;

export const EditionOverview = createVideoStory(catalogByStoryKey.EditionOverview, "dark");
export const EditionOverviewLight = createVideoStory(catalogByStoryKey.EditionOverview, "light");
export const BalanceOfPower = createVideoStory(catalogByStoryKey.BalanceOfPower, "dark");
export const BalanceOfPowerLight = createVideoStory(catalogByStoryKey.BalanceOfPower, "light");
export const NewsroomLearns = createVideoStory(catalogByStoryKey.NewsroomLearns, "dark");
export const NewsroomLearnsLight = createVideoStory(catalogByStoryKey.NewsroomLearns, "light");
export const AuditAwsExposure = createVideoStory(catalogByStoryKey.AuditAwsExposure, "dark");
export const AuditAwsExposureLight = createVideoStory(catalogByStoryKey.AuditAwsExposure, "light");
export const AuditAzureBlastRadius = createVideoStory(catalogByStoryKey.AuditAzureBlastRadius, "dark");
export const AuditAzureBlastRadiusLight = createVideoStory(catalogByStoryKey.AuditAzureBlastRadius, "light");
export const TreatOpenAiAccounts = createVideoStory(catalogByStoryKey.TreatOpenAiAccounts, "dark");
export const TreatOpenAiAccountsLight = createVideoStory(catalogByStoryKey.TreatOpenAiAccounts, "light");
export const PlayGamesSecurely = createVideoStory(catalogByStoryKey.PlayGamesSecurely, "dark");
export const PlayGamesSecurelyLight = createVideoStory(catalogByStoryKey.PlayGamesSecurely, "light");
