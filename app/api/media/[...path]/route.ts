import { NextResponse } from "next/server";
import { isGuestReadableStoragePath, signStorageUrl } from "../../../../lib/reader-storage-url";

export const dynamic = "force-dynamic";

type MediaRouteContext = {
  params: Promise<{
    path: string[];
  }>;
};

export async function GET(_request: Request, context: MediaRouteContext) {
  const { path } = await context.params;
  const storagePath = path.map((segment) => decodeURIComponent(segment)).join("/");
  if (!isGuestReadableStoragePath(storagePath)) {
    return NextResponse.json({ error: "Forbidden storage path." }, { status: 403 });
  }

  const signedUrl = await signStorageUrl(storagePath);
  return NextResponse.redirect(signedUrl, 307);
}
