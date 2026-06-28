import test from "node:test";
import assert from "node:assert/strict";

function isGuestReadableStoragePath(storagePath) {
  const normalized = storagePath.trim().replace(/^\/+/, "");
  return normalized.startsWith("media/");
}

function buildReaderMediaProxyUrl(storagePath) {
  const normalized = storagePath.trim().replace(/^\/+/, "");
  if (!isGuestReadableStoragePath(normalized)) {
    throw new Error(`Storage path is not reader-public: ${storagePath}`);
  }
  return `/api/media/${normalized.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
}

test("isGuestReadableStoragePath accepts media paths only", () => {
  assert.equal(isGuestReadableStoragePath("media/articles/example/01-lead.jpg"), true);
  assert.equal(isGuestReadableStoragePath("newsroom/payloads/example.txt"), false);
});

test("buildReaderMediaProxyUrl returns stable app-relative media URLs", () => {
  assert.equal(
    buildReaderMediaProxyUrl("media/articles/example/01-lead.jpg"),
    "/api/media/media/articles/example/01-lead.jpg",
  );
});
