#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = function loadTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  module._compile(output, filename);
};

const {
  applyAssignmentItemUpdates,
  applyAssignmentVersionPlan,
  buildAssignmentDesk,
  buildAssignmentManualVersionPlan,
  buildCullItemUpdate,
  buildRestoreItemUpdate,
  getCullingReason,
} = require("../lib/news-desk-assignments.ts");

const now = "2026-05-16T15:00:00.000Z";
const actorLabel = "editor@example.com";

const edition = {
  id: "edition-1",
  slug: "edition-1",
  title: "Assignment Issue",
  status: "planning",
  editionDate: "2026-05-16",
  publishedAt: null,
};

const assignment = {
  id: "assignment-1",
  type: "assignment",
  status: "dispatched",
  typeStatus: "assignment#dispatched",
  slug: "agent-lab",
  section: "Research",
  sectionStatus: "research#dispatched",
  title: "Agent Lab",
  editorial: {
    newsroom: {
      assignment: {
        brief: "Report the agent lab story.",
        angle: "Focus on evidence.",
        targetArticleSlots: 1,
        evidenceItemIds: ["research-001"],
      },
    },
  },
};

const draftArticle = {
  id: "article-draft-1",
  type: "article",
  status: "draft",
  typeStatus: "article#draft",
  slug: "agent-lab-draft",
  section: "Research",
  sectionStatus: "research#draft",
  title: "Agent Lab Draft",
  editorial: {
    newsroom: {
      assignmentItemId: "assignment-1",
    },
  },
};

const editionItem = {
  id: "edition-item-1",
  editionId: "edition-1",
  itemId: "assignment-1",
  placementKey: "assignment:agent-lab",
  sortKey: "assignment:0001:agent-lab",
};

{
  const update = buildCullItemUpdate(assignment, { actorLabel, now, reason: "Too thin" });
  assert.equal(update.status, "culled");
  assert.equal(update.typeStatus, "assignment#culled");
  assert.equal(update.sectionStatus, "research#culled");
  assert.equal(update.editorial.newsroom.culling.status, "culled");
  assert.equal(update.editorial.newsroom.culling.source, "manual-news-desk");
  assert.equal(update.editorial.newsroom.culling.culledAt, now);
  assert.equal(update.editorial.newsroom.culling.culledBy, actorLabel);
  assert.equal(update.editorial.newsroom.culling.reason, "Too thin");
  assert.equal(update.editorial.newsroom.culling.previousStatus, "dispatched");
  assert.equal(update.editorial.newsroom.culling.previousTypeStatus, "assignment#dispatched");
  assert.equal(update.editorial.newsroom.culling.previousSectionStatus, "research#dispatched");
}

{
  const assignmentWithDraft = {
    ...assignment,
    editorial: {
      newsroom: {
        ...assignment.editorial.newsroom,
        draft: {
          articleItemId: draftArticle.id,
        },
      },
    },
  };
  const desk = buildAssignmentDesk([edition], [editionItem], [assignmentWithDraft, draftArticle]);
  assert.equal(desk.edition.id, edition.id);
  assert.equal(desk.candidates.length, 1);
  assert.equal(desk.candidates[0].draftItem.id, draftArticle.id);

  const assignmentCull = buildCullItemUpdate(desk.candidates[0].assignment, { actorLabel, now, reason: "Duplicate angle" });
  const draftCull = buildCullItemUpdate(desk.candidates[0].draftItem, { actorLabel, now, reason: "Duplicate angle" });
  const updatedDesk = applyAssignmentItemUpdates(desk, [assignmentCull, draftCull]);
  assert.equal(updatedDesk.candidates[0].assignment.status, "culled");
  assert.equal(updatedDesk.candidates[0].draftItem.status, "culled");
  assert.equal(updatedDesk.candidates[0].draftItem.typeStatus, "article#culled");

  const versionPlan = buildAssignmentManualVersionPlan(desk, desk.candidates[0], "cull", {
    actorLabel,
    now,
    reason: "Duplicate angle",
  });
  assert.equal(versionPlan.itemChanges.length, 2);
  const assignmentChange = versionPlan.itemChanges.find((change) => change.previousItem.id === "assignment-1");
  const draftChange = versionPlan.itemChanges.find((change) => change.previousItem.id === "article-draft-1");
  assert.ok(assignmentChange);
  assert.ok(draftChange);
  assert.ok(versionPlan.editionChange);
  assert.equal(assignmentChange.previousItemUpdate.versionState, "superseded");
  assert.equal(assignmentChange.nextItem.id, "assignment-1-v2");
  assert.equal(assignmentChange.nextItem.lineageId, "assignment-1");
  assert.equal(assignmentChange.nextItem.versionNumber, 2);
  assert.equal(assignmentChange.nextItem.previousVersionId, "assignment-1");
  assert.equal(assignmentChange.nextItem.status, "culled");
  assert.equal(assignmentChange.nextItem.versionState, "current");
  assert.equal(assignmentChange.nextItem.editorial.newsroom.draft.articleItemId, "article-draft-1-v2");
  assert.match(assignmentChange.nextItem.contentHash, /^fnv1a32:[a-f0-9]{8}$/);
  assert.equal(draftChange.nextItem.id, "article-draft-1-v2");
  assert.equal(draftChange.nextItem.editorial.newsroom.assignmentItemId, "assignment-1-v2");
  assert.equal(versionPlan.editionChange.previousEditionUpdate.versionState, "superseded");
  assert.equal(versionPlan.editionChange.nextEdition.id, "edition-1-v2");
  assert.equal(versionPlan.editionChange.nextEdition.versionNumber, 2);
  assert.equal(versionPlan.editionChange.nextEditionItems[0].editionId, "edition-1-v2");
  assert.equal(versionPlan.editionChange.nextEditionItems[0].itemId, "assignment-1-v2");

  const versionedDesk = applyAssignmentVersionPlan(desk, versionPlan);
  assert.equal(versionedDesk.edition.id, "edition-1-v2");
  assert.equal(versionedDesk.candidates[0].assignment.id, "assignment-1-v2");
  assert.equal(versionedDesk.candidates[0].assignment.status, "culled");
  assert.equal(versionedDesk.candidates[0].draftItem.id, "article-draft-1-v2");
}

{
  const assignmentWithMissingDraft = {
    ...assignment,
    id: "assignment-missing-draft",
    editorial: {
      newsroom: {
        ...assignment.editorial.newsroom,
        draft: {
          articleItemId: "missing-article",
        },
      },
    },
  };
  const desk = buildAssignmentDesk(
    [edition],
    [{ ...editionItem, id: "edition-item-missing-draft", itemId: assignmentWithMissingDraft.id }],
    [assignmentWithMissingDraft],
  );
  assert.equal(desk.candidates.length, 1);
  assert.equal(desk.candidates[0].draftItem, null);
}

{
  const culled = {
    ...assignment,
    status: "culled",
    typeStatus: "assignment#culled",
    sectionStatus: "research#culled",
    editorial: {
      newsroom: {
        ...assignment.editorial.newsroom,
        culling: {
          status: "culled",
          source: "manual-news-desk",
          culledAt: now,
          culledBy: actorLabel,
          reason: "Too narrow",
          previousStatus: "researched",
          previousTypeStatus: "assignment#researched",
          previousSectionStatus: "research#researched",
        },
      },
    },
  };
  const restore = buildRestoreItemUpdate(culled, { actorLabel, now });
  assert.equal(restore.status, "researched");
  assert.equal(restore.typeStatus, "assignment#researched");
  assert.equal(restore.sectionStatus, "research#researched");
  assert.equal(restore.editorial.newsroom.culling.status, "restored");
  assert.equal(restore.editorial.newsroom.culling.restoredAt, now);
  assert.equal(restore.editorial.newsroom.culling.restoredBy, actorLabel);
  assert.equal(getCullingReason({ ...culled, editorial: restore.editorial }), "Too narrow");
}

console.log("news-desk assignment helper tests passed");
