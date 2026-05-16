import type { EditionContent, EditionRouteSummary } from "./content-types";

export const ARCHIVE_BATCH_SIZE = 12;
export const ARCHIVE_PREVIEW_WIDTH = 1280;
export const ARCHIVE_PREVIEW_HEIGHT = 900;

export type ArchiveEditionPreview = {
  edition: EditionRouteSummary;
  content: EditionContent;
  href: string;
};

export type ArchiveEditionsResponse = {
  previews: ArchiveEditionPreview[];
  nextCursor?: string | null;
};
