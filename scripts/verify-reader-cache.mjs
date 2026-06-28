#!/usr/bin/env node

const baseUrl = (process.env.PAPYRUS_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const editionPath = process.argv[2];

if (!editionPath) {
  console.error("Usage: node scripts/verify-reader-cache.mjs </2026/june/28>");
  process.exit(1);
}

async function fetchEdition(path) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      accept: "text/html",
    },
  });
  const elapsedMs = Math.round(performance.now() - started);
  const cacheStatus = response.headers.get("x-nextjs-cache") ?? response.headers.get("x-vercel-cache") ?? "unknown";
  return {
    ok: response.ok,
    status: response.status,
    cacheStatus,
    elapsedMs,
  };
}

async function main() {
  console.log(`Verifying reader cache for ${baseUrl}${editionPath}`);
  const cold = await fetchEdition(editionPath);
  const warm = await fetchEdition(editionPath);

  console.log(JSON.stringify({ pass: 1, ...cold }, null, 2));
  console.log(JSON.stringify({ pass: 2, ...warm }, null, 2));

  if (!cold.ok || !warm.ok) {
    console.error("One or both requests failed.");
    process.exit(1);
  }

  if (warm.elapsedMs >= cold.elapsedMs) {
    console.log("Warm request was not faster than cold request. Check deployment cache headers and ISR config.");
  } else {
    console.log(`Warm request improved by ${cold.elapsedMs - warm.elapsedMs}ms.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
