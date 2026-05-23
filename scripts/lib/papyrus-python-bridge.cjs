#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function readInput() {
  const text = fs.readFileSync(0, "utf8");
  return JSON.parse(text || "{}");
}

async function main() {
  const input = readInput();
  const modulePath = path.resolve(String(input.modulePath || ""));
  const exportName = String(input.exportName || "");
  const args = Array.isArray(input.args) ? input.args : [];
  if (!modulePath || !exportName) {
    throw new Error("papyrus-python-bridge requires modulePath and exportName.");
  }
  const lib = require(modulePath);
  const fn = lib[exportName];
  if (typeof fn !== "function") {
    throw new Error(`Export ${exportName} was not found in ${modulePath}.`);
  }
  const result = await fn(...args);
  process.stdout.write(`${JSON.stringify(result ?? null)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error ?? "unknown error");
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
