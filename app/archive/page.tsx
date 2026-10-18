import { ARCHIVE_METADATA, ArchiveRoute } from "@/publication/redesign/routes/archive-and-settings-routes";

export const revalidate = 60;

export const metadata = ARCHIVE_METADATA;

type ArchivePageProps = { searchParams: Promise<{ cursor?: string | string[] }> };

export default async function ArchivePage({ searchParams }: ArchivePageProps) {
  const { cursor } = await searchParams;
  return <ArchiveRoute cursor={Array.isArray(cursor) ? cursor[0] : cursor} />;
}
