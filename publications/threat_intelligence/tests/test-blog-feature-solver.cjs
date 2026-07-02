#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

require.extensions[".ts"] = function loadTs(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};

const {
  createThreatIntelligenceRhythm,
  reserveRhythmRows,
  snapToNearestRhythm,
} = require("../../../lib/blog-rhythm.ts");

const solverSource = read("lib/blog-feature-solver.ts");
const shellSource = read("components/presentation-shell.tsx");
const themeSource = read("publications/threat_intelligence/theme.css");

assert.ok(solverSource.includes("layoutTextLines"), "featured solver should use obstacle-aware Pretext");
assert.ok(solverSource.includes('mode: "obstacle"'), "featured solver should expose obstacle mode");
assert.ok(shellSource.includes("solveFeaturedItem"), "presentation shell should call featured solver");
assert.ok(shellSource.includes("useRhythmOverlay"), "blog shell should expose rhythm overlay toggle");
assert.ok(shellSource.includes("data-rhythm-overlay"), "blog shell should set rhythm overlay attribute");
assert.ok(themeSource.includes("--ti-row-height"), "TI theme should expose row-height token");
assert.ok(themeSource.includes("--feature-image-height"), "TI theme should consume solver image height");

const rhythm = createThreatIntelligenceRhythm();
assert.equal(rhythm.rowHeight, 16);
assert.equal(rhythm.paintHeight, 18);
assert.equal(snapToNearestRhythm(30, rhythm), 32);
assert.equal(reserveRhythmRows(30, rhythm), 32);

console.log("blog feature solver static checks passed");
