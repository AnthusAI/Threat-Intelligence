#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const input = JSON.parse(fs.readFileSync(0, "utf8"));
  const exportName = String(input.exportName || "");
  const args = Array.isArray(input.args) ? input.args : [];
  if (!exportName) {
    throw new Error("papyrus-content-cli-bridge requires exportName.");
  }
  const cli = require(path.join(__dirname, "..", "content-cli.cjs"));
  const fn = cli[exportName];
  if (typeof fn !== "function") {
    throw new Error(`Export ${exportName} was not found in content-cli.cjs.`);
  }
  const result = await fn(...args);
  process.stdout.write(`${JSON.stringify(result ?? null)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error ?? "unknown error");
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
