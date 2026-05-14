import { Newspaper } from "../components/newspaper";
import { contentRepository, getScenarioIdParam, isGraphQLContentSource } from "../lib/content-repository";
import type { EditionContent } from "../lib/content-types";
import { createDefaultEditionLayoutPlan } from "../lib/layout-plan";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams?: Promise<{
    scenario?: string | string[];
  }>;
};

export default async function Home({ searchParams }: HomePageProps) {
  const resolvedSearchParams = await searchParams;
  const scenarioId = getScenarioIdParam(resolvedSearchParams?.scenario);
  const content = await loadHomeContent(scenarioId);
  if (content.items.length === 0) return <EmptyGraphQLEdition content={content} />;
  return <Newspaper content={content} />;
}

async function loadHomeContent(scenarioId: string | null): Promise<EditionContent> {
  try {
    return await contentRepository.loadEditionContent({ scenarioId });
  } catch (error) {
    if (scenarioId || !isGraphQLContentSource()) throw error;
    return {
      id: "empty-graphql-edition",
      source: "graphql",
      title: "Papyrus",
      editionDate: new Date().toISOString().slice(0, 10),
      description: "No published GraphQL edition is available yet.",
      items: [],
      layoutPlan: createDefaultEditionLayoutPlan([]),
    };
  }
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
