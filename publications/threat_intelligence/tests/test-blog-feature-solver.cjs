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
const { getFeaturedLayoutMode } = require("../../../lib/blog-feature-solver.ts");

const solverSource = read("lib/blog-feature-solver.ts");
const shellSource = read("components/presentation-shell.tsx");
const themeSource = read("publications/threat_intelligence/theme.css");

assert.ok(solverSource.includes("layoutTextLines"), "featured solver should use obstacle-aware Pretext");
assert.ok(shellSource.includes("solveFeaturedItem"), "presentation shell should call featured solver");
assert.ok(shellSource.includes("useRhythmOverlay"), "blog shell should expose rhythm overlay toggle");
assert.ok(shellSource.includes("data-rhythm-overlay"), "blog shell should set rhythm overlay attribute");
assert.ok(themeSource.includes("--ti-row-height"), "TI theme should expose row-height token");
assert.ok(themeSource.includes("--feature-image-height"), "TI theme should consume solver image height");
assert.ok(themeSource.includes("grid-template-columns: minmax(0, 1fr) var(--feature-image-width);"), "TI theme should keep a solver-sized image rail");
assert.ok(solverSource.includes("return \"float\";"), "featured image cards should stay in float mode when an image exists");
assert.ok(solverSource.includes("Math.floor(input.viewportWidth / 3)"), "featured image width should cap at one-third of the viewport");
assert.ok(solverSource.includes("LEAD_GAP_ROWS_NARROW = 1"), "narrow phone gap should collapse to one rhythm row");
assert.ok(solverSource.includes("LEAD_GAP_ROWS = 2"), "desktop and tablet gap should collapse to two rhythm rows");
assert.ok(!themeSource.includes('.presentation-page--blog .presentation-item--blog[data-item-index="0"][data-has-image="true"] {\n    grid-template-columns: 1fr;'), "lead image cards should not collapse to a single column in TI mobile CSS");

const rhythm = createThreatIntelligenceRhythm();
assert.equal(rhythm.rowHeight, 16);
assert.equal(rhythm.paintHeight, 18);
assert.equal(snapToNearestRhythm(30, rhythm), 32);
assert.equal(reserveRhythmRows(30, rhythm), 32);

assert.equal(getFeaturedLayoutMode(1280, true), "float");
assert.equal(getFeaturedLayoutMode(900, true), "float");
assert.equal(getFeaturedLayoutMode(540, true), "float");
assert.equal(getFeaturedLayoutMode(540, false), "stacked");

console.log("blog feature solver static checks passed");
