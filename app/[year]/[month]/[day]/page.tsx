import { generateEditionDateStaticParams } from "@anthusai/papyrus/lib/reader-static-params";
import {
  EditionFrontPageRoute,
  generateEditionFrontPageMetadata,
  type EditionDateRouteParameters,
} from "@/publication/redesign/routes/edition-front-page-route";

export const revalidate = 60;

export async function generateStaticParams() {
  return generateEditionDateStaticParams();
}

type EditionFrontPageProps = { params: Promise<EditionDateRouteParameters> };

export async function generateMetadata({ params }: EditionFrontPageProps) {
  return generateEditionFrontPageMetadata(await params);
}

export default async function EditionFrontPage({ params }: EditionFrontPageProps) {
  return <EditionFrontPageRoute routeParameters={await params} />;
}
