import { Newspaper } from "../components/newspaper";
import { contentRepository, getScenarioIdParam } from "../lib/content-repository";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams?: Promise<{
    scenario?: string | string[];
  }>;
};

export default async function Home({ searchParams }: HomePageProps) {
  const resolvedSearchParams = await searchParams;
  const scenarioId = getScenarioIdParam(resolvedSearchParams?.scenario);
  const content = await contentRepository.loadEditionContent({ scenarioId });
  return <Newspaper content={content} />;
}
