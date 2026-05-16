import { NextResponse } from "next/server";
import { loadArchiveEditionPreviews, clampArchiveLimit } from "../../../../lib/archive-data";
import { ARCHIVE_BATCH_SIZE } from "../../../../lib/archive-types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const requestedLimit = Number(url.searchParams.get("limit") ?? ARCHIVE_BATCH_SIZE);
  const payload = await loadArchiveEditionPreviews({
    limit: clampArchiveLimit(requestedLimit),
    nextToken: cursor,
  });

  return NextResponse.json(payload);
}
