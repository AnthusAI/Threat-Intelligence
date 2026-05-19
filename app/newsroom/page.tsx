import { NewsDeskPage } from "../../components/news-desk-page";

export const dynamic = "force-dynamic";

type NewsDeskRootPageProps = {
  searchParams?: Promise<{
    demo?: string | string[];
    section?: string | string[];
    tab?: string | string[];
    panel?: string | string[];
    reference?: string | string[];
    category?: string | string[];
    node?: string | string[];
    assignment?: string | string[];
    message?: string | string[];
    user?: string | string[];
    item?: string | string[];
  }>;
};

export default function NewsDeskRootPage({ searchParams }: NewsDeskRootPageProps) {
  return <NewsDeskPage searchParams={searchParams} />;
}
