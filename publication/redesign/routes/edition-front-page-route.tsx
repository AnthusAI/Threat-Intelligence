import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { loadCachedEditionContent } from "@anthusai/papyrus/lib/cached-content-repository";
import { parseEditionDateRoute } from "@anthusai/papyrus/lib/edition-routes";
import { siteServesNextReaderRoutes } from "@anthusai/papyrus/lib/reader-static-params";
import { buildEditionFrontPageModel, formatLongEditionDate } from "../edition-front-page-model";
import { EditionFrontPage, describeEditionFooterLine } from "../edition-front-page";
import { buildDeskLinks, toFrontPageSourceEdition } from "../edition-navigation";
import { loadNewestPublishedPosts } from "../posts/published-post-repository";
import { PUBLICATION_NAME, PUBLICATION_TAGLINE } from "../publication-identity";
import { ReaderSiteShell } from "../reader-site-shell";

export type EditionDateRouteParameters = { year: string; month: string; day: string };

function isMissingPublishedEditionError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("No published GraphQL edition found");
}

export async function loadEditionContentForRoute(routeParameters: EditionDateRouteParameters) {
  if (!siteServesNextReaderRoutes()) notFound();
  const parsedRoute = parseEditionDateRoute(routeParameters);
  if (!parsedRoute) notFound();
  if (!parsedRoute.isCanonical) redirect(parsedRoute.canonicalPath);
  try {
    const content = await loadCachedEditionContent({ editionDate: parsedRoute.editionDate });
    return { content, editionBasePath: parsedRoute.canonicalPath };
  } catch (error) {
    if (isMissingPublishedEditionError(error)) notFound();
    throw error;
  }
}

export async function generateEditionFrontPageMetadata(routeParameters: EditionDateRouteParameters): Promise<Metadata> {
  const parsedRoute = parseEditionDateRoute(routeParameters);
  if (!parsedRoute) return {};
  return {
    title: `${PUBLICATION_NAME}, ${formatLongEditionDate(parsedRoute.editionDate)}`,
    description: PUBLICATION_TAGLINE,
  };
}

export async function EditionFrontPageRoute({ routeParameters }: { routeParameters: EditionDateRouteParameters }) {
  const { content, editionBasePath } = await loadEditionContentForRoute(routeParameters);
  const posts = await loadNewestPublishedPosts();
  const model = buildEditionFrontPageModel({
    edition: toFrontPageSourceEdition(content),
    editionBasePath,
    posts,
    now: new Date(),
  });
  const footerLine = describeEditionFooterLine(model);
  return (
    <ReaderSiteShell
      deskLinks={buildDeskLinks(model.desks, editionBasePath, true)}
      editionLineLeft={footerLine.left}
      editionLineRight={footerLine.right}
      homeHref="/"
    >
      <EditionFrontPage model={model} />
    </ReaderSiteShell>
  );
}
