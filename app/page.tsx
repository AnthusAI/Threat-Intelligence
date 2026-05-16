import { Newspaper } from "../components/newspaper";
import { contentRepository, getScenarioIdParam } from "../lib/content-repository";
import type { EditionContent } from "../lib/content-types";
import { getEditionDatePath } from "../lib/edition-routes";
import { createDefaultEditionLayoutPlan } from "../lib/layout-plan";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams?: Promise<{
    scenario?: string | string[];
  }>;
};

export default async function Home({ searchParams }: HomePageProps) {
  const resolvedSearchParams = await searchParams;
  const scenarioId = getScenarioIdParam(resolvedSearchParams?.scenario);
  if (!scenarioId) {
    const latestEdition = await contentRepository.getLatestPublishedEdition();
    if (latestEdition) redirect(getEditionDatePath(latestEdition.editionDate));
    return <EmptyGraphQLEdition content={createEmptyGraphQLEdition()} />;
  }

  const content = await loadHomeContent(scenarioId);
  if (content.items.length === 0) return <EmptyGraphQLEdition content={content} />;
  return <Newspaper content={content} />;
}

async function loadHomeContent(scenarioId: string | null): Promise<EditionContent> {
  try {
    return await contentRepository.loadEditionContent({ scenarioId });
  } catch (error) {
    if (scenarioId || !isMissingGraphQLEditionError(error)) throw error;
    return {
      id: "empty-graphql-edition",
      source: "graphql",
      title: "Papyrus",
      editionDate: new Date().toISOString().slice(0, 10),
      description: "No published GraphQL edition is available yet.",
      items: [],
      layoutPlan: createDefaultEditionLayoutPlan(["empty-edition-placeholder"]),
    };
  }
}

function createEmptyGraphQLEdition(): EditionContent {
  return {
    id: "empty-graphql-edition",
    source: "graphql",
    title: "Papyrus",
    editionDate: new Date().toISOString().slice(0, 10),
    description: "No published GraphQL edition is available yet.",
    items: [],
    layoutPlan: createDefaultEditionLayoutPlan(["empty-edition-placeholder"]),
  };
}

function isMissingGraphQLEditionError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("No published GraphQL edition found");
}

function EmptyGraphQLEdition({ content }: { content: EditionContent }) {
  return (
    <main className="empty-edition">
      <p className="empty-edition__kicker">{content.source}</p>
      <h1>{content.title}</h1>
      <p>{content.description ?? "No published articles are available yet."}</p>
    </main>
  );
}
