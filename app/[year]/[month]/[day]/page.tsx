import { EditionRoutePage } from "./edition-route-page";

export const dynamic = "force-dynamic";

type DateEditionPageProps = {
  params: Promise<{
    year: string;
    month: string;
    day: string;
  }>;
};

export default async function DateEditionPage({ params }: DateEditionPageProps) {
  const { year, month, day } = await params;
  return <EditionRoutePage day={day} month={month} year={year} />;
}
