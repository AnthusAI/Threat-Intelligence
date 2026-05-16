import { ArchiveShell } from "../../components/archive-shell";
import { ArchiveGrid } from "../../components/archive-grid";
import { loadArchiveEditionPreviews } from "../../lib/archive-data";
import { ARCHIVE_BATCH_SIZE } from "../../lib/archive-types";

export const dynamic = "force-dynamic";

export default async function ArchivePage() {
  const initialBatch = await loadArchiveEditionPreviews({ limit: ARCHIVE_BATCH_SIZE });

  return (
    <ArchiveShell>
      <header className="masthead archive-header" aria-labelledby="archive-title">
        <div className="masthead__rule archive-header__rule" />
        <h1 id="archive-title">
          <span>ARCHIVE</span>
        </h1>
      </header>
      <p className="archive-header__meta">Previous editions</p>
      <ArchiveGrid initialNextCursor={initialBatch.nextCursor ?? null} initialPreviews={initialBatch.previews} />
    </ArchiveShell>
  );
}
