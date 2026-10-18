import { redirect, notFound } from "next/navigation";
import { getEditionDatePath, parseEditionSectionRoute } from "@anthusai/papyrus/lib/edition-routes";
import { createDeskAnchorId } from "@/publication/redesign/edition-front-page-model";

export const revalidate = 60;

type EditionSectionRedirectProps = {
  params: Promise<{ year: string; month: string; day: string; sectionKey: string }>;
};

export default async function EditionSectionRedirect({ params }: EditionSectionRedirectProps) {
  const parsedRoute = parseEditionSectionRoute(await params);
  if (!parsedRoute) notFound();
  redirect(`${getEditionDatePath(parsedRoute.editionDate)}#${createDeskAnchorId(parsedRoute.sectionKey)}`);
}
