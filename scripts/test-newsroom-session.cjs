#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

registerTypeScriptRequire();

const {
  beginAccessCheck,
  beginDeskLoad,
  createInitialNewsDeskShellState,
  patchDashboard,
  resolveDashboardReady,
  resolveSignedOut,
} = require("../lib/news-desk-session.ts");

const initial = createInitialNewsDeskShellState();
assert.equal(initial.phase, "checkingAccess");
assert.equal(initial.dashboard, null);

const signedOut = resolveSignedOut(initial, { status: "signedOut", label: "Signed out" });
assert.equal(signedOut.phase, "signedOut");
assert.equal(signedOut.dashboard, null);

const readyAuth = { status: "signedIn", label: "editor@example.com" };
const loadingDesk = beginDeskLoad(initial, readyAuth);
assert.equal(loadingDesk.phase, "loadingDesk");
assert.equal(loadingDesk.auth.label, "editor@example.com");

const dashboard = createDashboard();
const ready = resolveDashboardReady(loadingDesk, dashboard, readyAuth, "2026-05-17T21:00:00.000Z");
assert.equal(ready.phase, "ready");
assert.equal(ready.dashboard?.references.length, 1);
assert.equal(ready.lastRefreshedAt, "2026-05-17T21:00:00.000Z");

const refreshing = beginAccessCheck(ready);
assert.equal(refreshing.phase, "refreshing");
assert.equal(refreshing.dashboard?.references[0].id, "reference-1");

const patched = patchDashboard(
  ready,
  (current) => ({
    ...current,
    assignments: [{ ...current.assignments[0], status: "claimed" }],
  }),
  "2026-05-17T21:05:00.000Z",
);
assert.equal(patched.phase, "ready");
assert.equal(patched.dashboard?.assignments[0].status, "claimed");
assert.equal(patched.dashboard?.references[0].id, "reference-1");
assert.equal(patched.lastRefreshedAt, "2026-05-17T21:05:00.000Z");

const invalidated = resolveSignedOut(ready, { status: "signedOut", label: "Signed out" });
assert.equal(invalidated.phase, "signedOut");
assert.equal(invalidated.dashboard, null);

console.log("newsroom session tests passed");

function createDashboard() {
  return {
    canonicalCorpusId: "corpus-1",
    canonicalCategorySetId: "category-set-1",
    canManageUsers: true,
    userDirectory: [{ userSub: "user-1", email: "editor@example.com", activeRoles: ["admin"] }],
    corpora: [{ id: "corpus-1", name: "Canonical Demo Corpus" }],
    importRuns: [{ id: "import-1", corpusId: "corpus-1", importedAt: "2026-05-17T20:59:00.000Z" }],
    categorySets: [{ id: "category-set-1", corpusId: "corpus-1", displayName: "Category Set" }],
    categorys: [{ id: "category-1", categoryKey: "category.one", categorySetId: "category-set-1", displayName: "Category One", status: "accepted" }],
    categoryTrees: [{ id: "category-set-1", corpusId: "corpus-1", displayName: "Category Set", status: "accepted" }],
    categoryNodes: [{ id: "category-1", categoryKey: "category.one", categorySetId: "category-set-1", parentCategoryKey: null, displayName: "Category One", status: "accepted" }],
    proposals: [{ id: "proposal-1", status: "proposed", title: "Proposal" }],
    artifacts: [{ id: "artifact-1", createdAt: "2026-05-17T20:58:00.000Z" }],
    references: [{ id: "reference-1", importedAt: "2026-05-17T20:57:00.000Z" }],
    referenceAttachments: [{ id: "attachment-1", sortKey: "attachment-1" }],
    semanticNodes: [{ id: "semantic-node-1", nodeKey: "node.one", displayName: "Node One" }],
    knowledgeComments: [{ id: "comment-1", createdAt: "2026-05-17T20:56:00.000Z" }],
    semanticRelations: [{ id: "relation-1", score: 1 }],
    assignments: [{ id: "assignment-1", queueKey: "queue-1", status: "open" }],
    assignmentEvents: [{ id: "assignment-event-1", createdAt: "2026-05-17T20:55:00.000Z" }],
    doctrineRecords: [{ id: "doctrine-1", slug: "editorial-doctrine-mission" }],
    loadError: null,
  };
}

function registerTypeScriptRequire() {
  if (require.extensions[".ts"]) return;
  require.extensions[".ts"] = (module, filename) => {
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
}
