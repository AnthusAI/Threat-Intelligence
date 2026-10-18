import { getCachedLatestPublishedEdition, loadCachedEditionContent } from "@anthusai/papyrus/lib/cached-content-repository";
import type { EditionContent } from "@anthusai/papyrus/lib/content-types";
import { getEditionDatePath } from "@anthusai/papyrus/lib/edition-routes";
import { buildEditionDesks, type FrontPageDesk, type FrontPageSourceEdition } from "./edition-front-page-model";
import type { SiteNavigationLink } from "./site-header";

export type EditionNavigation = {
  editionBasePath: string;
  editionDate: string;
  deskLinks: SiteNavigationLink[];
  desks: FrontPageDesk[];
};

export function toFrontPageSourceEdition(content: EditionContent): FrontPageSourceEdition {
  return content as unknown as FrontPageSourceEdition;
}

export function deskLinkTarget(desk: FrontPageDesk): string {
  return desk.containsEditionLead && desk.articlesAfterLead.length === 0 ? "edition-lead" : desk.anchorId;
}

export function buildDeskLinks(desks: FrontPageDesk[], editionBasePath: string, linksStayOnPage: boolean): SiteNavigationLink[] {
  return desks.map((desk) => ({
    label: desk.name,
    href: `${linksStayOnPage ? "" : editionBasePath}#${deskLinkTarget(desk)}`,
  }));
}

export function buildEditionNavigation(content: EditionContent, linksStayOnPage = false): EditionNavigation {
  const editionBasePath = getEditionDatePath(content.editionDate);
  const desks = buildEditionDesks(toFrontPageSourceEdition(content), editionBasePath);
  return {
    editionBasePath,
    editionDate: content.editionDate,
    deskLinks: buildDeskLinks(desks, editionBasePath, linksStayOnPage),
    desks,
  };
}

export async function loadLatestEditionNavigation(): Promise<EditionNavigation | null> {
  try {
    const latestEdition = await getCachedLatestPublishedEdition();
    if (!latestEdition) return null;
    const content = await loadCachedEditionContent({ editionDate: latestEdition.editionDate });
    return buildEditionNavigation(content);
  } catch (error) {
    console.warn("Latest edition navigation is unavailable.", error);
    return null;
  }
}
