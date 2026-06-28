import { notFound, redirect } from "next/navigation";
import { PresentationShell, type PresentationTarget } from "../../../../components/presentation-shell";
import { loadCachedEditionContent } from "../../../../lib/cached-content-repository";
import { parseEditionDateRoute } from "../../../../lib/edition-routes";
import { DEFAULT_LAYOUT_SCENARIO_ID, getLayoutScenario } from "../../../../lib/layout-scenarios";
import { SITE_BRAND } from "../../../../lib/site-brand";
import type { EditionPresentationFormat } from "../../../../lib/content-types";
import threatIntelligenceSeedContent from "../../../../amplify/seed/profiles/threat-intelligence/seed-edition-content.json";

type EditionRoutePageProps = {
  year: string;
  month: string;
  day: string;
  initialPageNumber?: number;
  lockedPresentation?: EditionPresentationFormat;
  target?: PresentationTarget;
};

export async function EditionRoutePage({
  year,
  month,
  day,
  initialPageNumber = 1,
  lockedPresentation,
  target = { kind: "edition" },
}: EditionRoutePageProps) {
  const route = parseEditionDateRoute({ year, month, day });
  if (!route) notFound();
  if (!route.isCanonical) redirect(route.canonicalPath);

  try {
    const content = SITE_BRAND.id === "threat-intelligence" && route.editionDate === threatIntelligenceSeedContent.publishDate
      ? getLayoutScenario(DEFAULT_LAYOUT_SCENARIO_ID)
      : await loadCachedEditionContent({
        editionDate: route.editionDate,
      });
    if (initialPageNumber < 1 || initialPageNumber > content.layoutPlan.pages.length) notFound();
    if (target.kind === "section" && !content.sections.some((section) => section.key === target.sectionKey)) notFound();
    return (
      <PresentationShell
        content={content}
        editionBasePath={route.canonicalPath}
        initialPageNumber={initialPageNumber}
        lockedPresentation={lockedPresentation}
        target={target}
      />
    );
  } catch (error) {
    if (isMissingGraphQLEditionError(error)) notFound();
    throw error;
  }
}

function isMissingGraphQLEditionError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("No published GraphQL edition found");
}
