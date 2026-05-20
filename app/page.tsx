import { PresentationShell } from "../components/presentation-shell";
import { contentRepository, getScenarioIdParam } from "../lib/content-repository";
import type { EditionContent } from "../lib/content-types";
import { createEditionSectionPlan } from "../lib/edition-sections";
import { getEditionDatePath } from "../lib/edition-routes";
import { normalizeEditionLayoutPlan } from "../lib/layout-plan";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams?: Promise<{
    scenario?: string | string[];
    code?: string | string[];
    state?: string | string[];
    error?: string | string[];
  }>;
};

export default async function Home({ searchParams }: HomePageProps) {
  const resolvedSearchParams = await searchParams;
  const scenarioId = getScenarioIdParam(resolvedSearchParams?.scenario);
  if (!scenarioId) {
    if (hasOAuthRedirectParams(resolvedSearchParams)) {
      const content = await loadLatestGraphQLEdition();
      if (!content || content.items.length === 0) return <PresentationShell content={createEmptyGraphQLEdition()} />;
      return <PresentationShell content={content} editionBasePath={getEditionDatePath(content.editionDate)} />;
    }

    const latestEdition = await contentRepository.getLatestPublishedEdition();
    if (latestEdition) redirect(getEditionDatePath(latestEdition.editionDate));
    return <PresentationShell content={createEmptyGraphQLEdition()} />;
  }

  const content = await loadHomeContent(scenarioId);
  if (content.items.length === 0) return <PresentationShell content={createEmptyGraphQLEdition()} />;
  return <PresentationShell content={content} />;
}

async function loadLatestGraphQLEdition(): Promise<EditionContent | null> {
  const latestEdition = await contentRepository.getLatestPublishedEdition();
  if (!latestEdition) return null;
  return contentRepository.loadEditionContent({ editionDate: latestEdition.editionDate });
}

async function loadHomeContent(scenarioId: string | null): Promise<EditionContent> {
  try {
    return await contentRepository.loadEditionContent({ scenarioId });
  } catch (error) {
    if (scenarioId || !isMissingGraphQLEditionError(error)) throw error;
    return createEmptyGraphQLEdition();
  }
}

function createEmptyGraphQLEdition(): EditionContent {
  const placeholderSlug = "empty-edition-placeholder";
  const items: EditionContent["items"] = [
    {
      type: "article",
      slug: placeholderSlug,
      shortSlug: "EMPTY",
      section: "Newsroom",
      headline: "No Published Edition Yet",
      deck: "No published GraphQL edition is available yet.",
      byline: "Papyrus",
      dateline: "SANDBOX",
      image: {
        src: "/papyrus-plant-placeholder.png",
        alt: "A black papyrus plant silhouette",
        credit: "",
        layout: {
          minHeight: 120,
          preferredHeight: 180,
          maxHeight: 260,
          aspectRatio: 1.5,
          crop: "contain",
          wrapsText: true,
        },
      },
      body: [
        "This sandbox does not have any published edition records yet. Papyrus is showing the production newspaper shell with placeholder source material so operators can verify the publication shape before content is loaded.",
        "Open the Newsroom to inspect the empty operational skeleton, confirm that counts start at zero, and watch records appear as the GraphQL database is seeded or imported.",
      ],
    },
  ];

  return {
    id: "empty-graphql-edition",
    source: "graphql",
    title: "Papyrus",
    editionDate: new Date().toISOString().slice(0, 10),
    description: "No published GraphQL edition is available yet.",
    items,
    sections: createEditionSectionPlan(items),
    layoutPlan: normalizeEditionLayoutPlan({
      pages: [
        {
          id: "page-1",
          pageNumber: 1,
          presetId: "front.mosaic",
          grid: { columns: { min: 1, preferred: 6, max: 6 } },
          regions: [
            {
              id: "empty-front-page",
              type: "fullPage",
              localGrid: { columns: { min: 1, preferred: 6, max: 6 } },
              blocks: [
                {
                  id: "empty-edition-placeholder-front",
                  type: "articleFrame",
                  presetId: "front.teaser",
                  itemId: placeholderSlug,
                  flowKey: placeholderSlug,
                  startCursor: "beginning",
                  role: "primary",
                  editorialPriority: "primary",
                  typography: { headlineScale: "feature" },
                  span: { min: 1, preferred: 6, max: 6 },
                  localGrid: { columns: { min: 1, preferred: 6, max: 6 } },
                  media: [],
                },
              ],
            },
          ],
        },
      ],
    }, "EmptyGraphQLEdition.layoutPlan"),
  };
}

function isMissingGraphQLEditionError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("No published GraphQL edition found");
}

function hasOAuthRedirectParams(searchParams: Awaited<HomePageProps["searchParams"]>): boolean {
  return hasParam(searchParams?.error) || (hasParam(searchParams?.code) && hasParam(searchParams?.state));
}

function hasParam(value: string | string[] | null | undefined): boolean {
  if (Array.isArray(value)) return value.some(Boolean);
  return Boolean(value);
}
