---
name: edition-planning
description: Use this skill when creating a dated Papyrus edition, planning edition slots, dispatching surplus research assignments, overassigning candidate work, or preparing edition-candidate selection workflows.
---

# Edition Planning Skill

Use this skill when an agent needs to create or prepare a dated Papyrus edition
record and dispatch private research work ontologically associated with that
edition.

The goal is not to publish every assignment. The goal is to over-dispatch
well-scoped lane work so editors can choose the best outputs for the available
publication slots.

## Read First

- `AGENTS.md`: project rules, data boundaries, auth lanes, and layout
  invariants.
- `README.md`: current Newsroom and production workflow overview.
- `skills/category-steering/SKILL.md`: category, taxonomy, graph, JWT, and S3
  curation-cycle workflow.
- `skills/reference-intake/SKILL.md`: how new source materials become
  cloud-visible references.
- `skills/researcher-doctrine/SKILL.md`: how researchers apply publication
  doctrine, desk doctrine, assignment briefs, and evidence context.
- `amplify/data/resource.ts`: `Assignment`, `AssignmentEvent`,
  `SemanticRelation`, `Edition`, `Item`, and related auth rules.
- `scripts/content-cli.cjs`: current authoring commands. Do not invent CLI
  commands that are not present.

If the edition depends on fresh corpus evidence, run the reference-intake and
category-steering workflows first. Edition planning should consume current
reference/category/graph state, not guess from stale local files.

## Core Rules

- Assignments are first-class private `Assignment` records. Do not create
  `Item` rows with `type: "assignment"`.
- Edition planning includes creating or updating the dated private `Edition`
  record. Do not treat the edition as only a date string in assignment metadata.
- Assignment events are append-only audit records. Lifecycle changes should use
  protected actions or the JWT authoring lane and write `AssignmentEvent` rows.
- Research assignments are not reader-facing content. Do not attach assignments
  directly to `EditionItem` rows.
- Publishable reader content is created later as draft or published `Item`
  records, then selected into an `Edition` through `EditionItem`.
- Dispatch more assignments than publication slots, then cull/select. The
  default overassignment ratio is `3/2`, so dispatch
  `ceil(publicationSlots * 1.5)` assignments per section unless an editor
  specifies another ratio.
- Dispatch by Newsroom desk plus publication lane, not by individual reference.
  References are evidence for the assignment. They are not the primary planning
  unit.
- Default active lanes are `reporting`, `analysis`, and `briefs`. `Opinion` can
  exist as a semantic concept, but it is opt-in through publication or desk
  policy and should not be dispatched by default.
- Preserve weaker candidates for review and audit. Do not delete assignment
  records just because they are not selected for publication.
- Keep Papyrus publication-neutral. Edition plans, queues, and assignments
  should use configured categories, desks, corpora, doctrine, and references,
  not hard-coded pilot subject matter.

## Current Safe Workflow

1. Choose the edition identity:
   - `editionDate`, usually `YYYY-MM-DD`;
   - edition slug, usually derived from the date unless the publication already
     has a convention;
   - optional edition lineage/id if updating an existing edition record.
2. Create or update the private dated `Edition` planning record through the
   current editor/admin or JWT authoring lane. The edition record is the
   ontological anchor for the assignment batch, even before any reader-facing
   `EditionItem` placements exist.
3. Define desk/lane targets:
   - root canonical category as the Newsroom desk;
   - lane key, usually `reporting`, `analysis`, or `briefs`;
   - intended publication slot count for the desk/lane;
   - desired evidence or source freshness;
   - any editor constraints.
4. Confirm knowledge state is current:
   - new source materials are synced to S3 and imported as `Reference` rows;
   - accepted categories and taxonomy state are current;
   - category/reference relations and semantic graph context are imported;
   - steering feedback has been applied before generating new proposals.
5. Score candidate bundles for each `desk + lane`:
   - freshness;
   - evidence density;
   - source diversity;
   - category confidence;
   - graph relevance;
   - coverage gap;
   - desk-policy fit;
   - duplicate-work penalty.
6. Compute assignment counts per desk/lane:
   - default `dispatchCount = ceil(publicationSlots * 1.5)`;
   - lower the count only when an editor explicitly wants less surplus;
   - cap broad searches to avoid flooding reviewers.
7. Create or plan private `Assignment` rows. If the current CLI cannot create
   the exact assignment rows, stop with a clear handoff instead of creating
   surrogate `Item` rows.
8. Link each assignment to the `Edition` record, its desk category, lane concept,
   and its evidence with `SemanticRelation` rows. Metadata helps filtering, but
   the semantic links are what make the edition-assignment graph navigable.
9. Researchers consume the assignments using `skills/researcher-doctrine/SKILL.md`
   and return private research packets.
10. Editors select the strongest outputs. Only selected drafts become
   reader-facing article `Item` records and `EditionItem` placements.

## Assignment Contract

For edition-candidate research, use:

- `assignmentTypeKey`: `research.edition-candidate`
- `queueKey`: `edition:<editionSlug>:desk:<rootCategoryKey>:lane:<laneKey>`
- `queueStatusKey`: `<queueKey>#<status>` when the model requires it
- `status`: start with the current open/dispatched status expected by the
  protected action or authoring tool
- `title`: concise private task title
- `brief`: editor-readable assignment summary
- `instructions`: researcher-facing work instructions
- `priority`: deterministic from section priority and candidate rank
- `assigneeType`, `assigneeId`, `assigneeKey`: set only when dispatching to a
  specific human, agent, or procedure

Store edition association and planning context in `Assignment.metadata`:

```json
{
  "editionDate": "2026-05-18",
  "editionSlug": "edition-2026-05-18",
  "editionId": "optional-existing-edition-id",
  "editionLineageId": "optional-edition-lineage-id",
  "laneKey": "reporting",
  "laneLabel": "Reporting",
  "laneNodeKey": "editorial.form.reporting",
  "rootCategoryKey": "category-key",
  "rootCategoryLineageId": "category-lineage-id",
  "sectionKey": "technology",
  "publicationSlots": 4,
  "dispatchCount": 6,
  "overassignmentRatio": 1.5,
  "candidateRank": 1,
  "opportunityScore": 72,
  "scoreBreakdown": {
    "freshness": 20,
    "evidenceDensity": 15,
    "sourceDiversity": 10,
    "categoryConfidence": 8,
    "graphRelevance": 4,
    "coverageGap": 10,
    "deskPolicyFit": 10,
    "duplicateWorkPenalty": 5
  },
  "candidateAngle": "Report a fresh evidence-led candidate story.",
  "referenceLineageIds": ["reference-lineage-id"],
  "semanticNodeLineageIds": ["semantic-node-lineage-id"],
  "policyRationale": "Why this assignment fits the publication and desk policy.",
  "expectedOutput": "Research packet for editor review, not reader copy."
}
```

Use stable ids in metadata. Do not key work from display names, short titles,
or generated slugs when a stable id exists.

For desk-backed research assignments, store the live context contract in
metadata or equivalent private assignment fields:

- `deskCategoryKey`
- `deskCategoryLineageId`
- `focusCategoryKey`
- `focusCategoryLineageId`
- `focusCategoryTitle`
- `contextProfile`
- `contextTokenBudget`
- `contextSources`

Compatibility aliases such as `researchTrackKey` and `researchLens` may still
be present during migration, but they are not canonical.

The current automated-publication desk workflow is documented in
[`docs/automated-publication-research-workflow.md`](/Users/ryan/Projects/Papyrus/docs/automated-publication-research-workflow.md).

## Semantic Links

Use `SemanticRelation` rows to make assignment context navigable:

- `planned_for_edition`: assignment to the dated `Edition` record that caused
  the work.
- `requests_work_on`: assignment to the target `Category`, `Reference`,
  `SemanticNode`, `SemanticRelation`, or `Item`.
- `targets_lane`: assignment to the editorial-form `SemanticNode`, such as
  `editorial.form.reporting`, `editorial.form.analysis`, or
  `editorial.form.briefs`.
- `uses_evidence`: assignment to references or comments that support the task.
- `uses_signal`: assignment to graph concepts or relations that influenced the
  opportunity score.
- `derived_from`: assignment to a proposal, comment, category, or research
  signal that caused the work.
- `produces`: assignment to a later draft or published `Item`, once it exists.

Prefer exact lineage/version ids where the model supports them. Do not depend
on display names for joins.

## Future Edition CLI

The desired command family is planned, not currently guaranteed to exist:

```bash
npm run content -- editions plan \
  --date YYYY-MM-DD \
  --slots <edition-slots.yml> \
  --dry-run

npm run content -- editions dispatch-research \
  --date YYYY-MM-DD \
  --ratio 1.5 \
  --dry-run

npm run content -- editions dispatch-research \
  --date YYYY-MM-DD \
  --ratio 1.5 \
  --apply
```

Target behavior for that future CLI:

- create or update the dated private `Edition` planning record;
- compute desk/lane dispatch counts from planned publication slots;
- create or update `Assignment` rows without duplicating active work;
- link assignments to the `Edition`, root desk category, lane concept,
  references, and graph signals with `SemanticRelation`;
- append `AssignmentEvent` audit rows;
- emit a verification report with counts by desk, lane, queue, and target type.

Until that CLI exists, use the currently implemented protected actions and JWT
authoring tools. If they cannot create the needed rows, report the missing
tooling explicitly.

## Verification

After planning or dispatching edition assignments:

- list the expected queues with the current assignment CLI, for example:

  ```bash
  npm run content -- assignments list \
    --queue edition:<editionSlug>:<sectionKey> \
    --status open
  ```

- verify `/newsroom/assignments` shows the private queue for editor/admin users;
- verify assignment context includes edition date, edition slug, section key,
  lane key, slot count, dispatch count, category context, and score breakdown;
- verify every assignment has a `planned_for_edition` `SemanticRelation` to the
  dated `Edition`;
- verify every assignment has `requests_work_on` for the root desk category and
  `targets_lane` for the lane semantic concept;
- verify evidence and target links are present through `SemanticRelation`;
- verify no `Item` rows were created with `type: "assignment"`;
- verify no assignment was attached directly to reader-facing `EditionItem`.

## Handoff

Report:

- edition date and slug;
- section slot counts and dispatch counts;
- assignment ids and queues created or planned;
- target categories, references, and semantic nodes used;
- any missing category/reference freshness prerequisites;
- whether the work is only planned, dry-run, or actually written through the
  editor/admin or JWT-authoring lane.
