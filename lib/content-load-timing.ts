type ContentLoadMetadata = Record<string, string | number | boolean | null | undefined>;

export function isContentLoadTimingEnabled(): boolean {
  return process.env.PAPYRUS_CONTENT_LOAD_TIMING === "1";
}

export async function withContentLoadTiming<T>(
  label: string,
  metadata: ContentLoadMetadata,
  work: () => Promise<T>,
): Promise<T> {
  if (!isContentLoadTimingEnabled()) {
    return work();
  }

  const started = performance.now();
  try {
    return await work();
  } finally {
    const elapsedMs = Math.round(performance.now() - started);
    console.info(`[papyrus-content-load] ${label} ${JSON.stringify({ ...metadata, ms: elapsedMs })}`);
  }
}
