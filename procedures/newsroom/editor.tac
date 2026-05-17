-- Papyrus automated newsroom editor procedure.
--
-- Dry-run only: this procedure returns assignment Item, EditionItem, and
-- downstream reporter dispatch plans but does not write to GraphQL.

local done = require("tactus.tools.done")

Toolset "plugin" {
    type = "plugin",
    paths = {"./procedures/newsroom/tools"}
}

newsroom_editor = Agent {
    provider = "openai",
    model = "gpt-4o-mini",
    system_prompt = [[
You are the Papyrus newsroom editor agent.

Goal:
- Dispatch article assignments for one edition.
- Use Papyrus GraphQL read tools to understand the edition and recent published articles.
- Use Biblicus tools to understand the configured corpus and evidence.
- Use section targets to dispatch more assignments than final slots at a bounded ratio.
- Use build_assignment_dispatch_plan for the assignment list.

Rules:
- This is dry-run only. Never claim records were written.
- Assignment records must use Item.type = "assignment" and Item.status = "dispatched".
- Default to an overassignment ratio of 3/2 unless the input says otherwise.
- Return one reporter dispatch input for each assignment Item so downstream reporter agents can run independently.
- Avoid repeating recent published article angles.
- Return structured data with assignments, dry-run record plans, reporter dispatches, reviewer load, and a concise summary.
]],
    tools = {"plugin", done},
    output = {
        edition_id = field.string{required = true},
        corpus_key = field.string{required = true},
        dry_run = field.boolean{required = true},
        assignment_ratio = field.string{required = true},
        section_targets = field.array{required = true},
        assignments = field.array{required = true},
        record_plans = field.array{required = true},
        reporter_dispatches = field.array{required = true},
        reviewer_load = field.object{required = true},
        summary = field.string{required = true}
    }
}

Procedure {
    input = {
        edition_id = field.string{required = true, description = "Papyrus Edition.id to plan assignments for"},
        corpus_key = field.string{default = "AI-ML-research", description = "Papyrus steering corpus key"},
        section_targets_json = field.string{default = "", description = "JSON object or array of section article targets"},
        assignment_ratio = field.string{default = "1.5", description = "Assignment-to-final-slot ratio. Default 3/2."},
        max_assignments = field.integer{default = 3, description = "Fallback final-slot target when section_targets_json is empty"},
        recent_days = field.integer{default = 30, description = "Published article lookback window"}
    },
    output = {
        edition_id = field.string{required = true},
        corpus_key = field.string{required = true},
        dry_run = field.boolean{required = true},
        assignment_ratio = field.string{required = true},
        section_targets = field.array{required = true},
        assignments = field.array{required = true},
        record_plans = field.array{required = true},
        reporter_dispatches = field.array{required = true},
        reviewer_load = field.object{required = true},
        summary = field.string{required = true}
    },
    function(input)
        local section_targets_json = input.section_targets_json
        if section_targets_json == "" then
            section_targets_json = string.format([[
[{"section":"News","target_articles":%d}]
]], input.max_assignments)
        end
        local message = string.format([[
Create assignment dispatch plans for edition %s using corpus %s.

Section targets JSON:
%s

Assignment ratio:
%s

Required tool flow:
1. papyrus_get_edition(edition_id)
2. papyrus_list_edition_items(edition_id)
3. papyrus_list_recent_published_articles(recent_days)
4. biblicus_steering_artifacts(corpus_key)
5. biblicus_topic_context or biblicus_query for evidence
6. Propose candidate assignments for each section, with a few extra candidates only if needed.
7. Call build_assignment_dispatch_plan once with edition_id, corpus_key, section_targets_json, assignment_ratio, and assignments_json.

Return dry_run=true, assignment_ratio, section_targets, assignments, record_plans,
reporter_dispatches, reviewer_load, and a concise summary.
]], input.edition_id, input.corpus_key, section_targets_json, input.assignment_ratio)

        local result = newsroom_editor({message = message})
        return result.output
    end
}

Specification([[
Feature: Newsroom editor procedure
  The editor creates dry-run assignment dispatch plans without live writes.

  Scenario: Editor returns assignment plans
    Given the procedure has started
    And the input edition_id is "edition-2026-05-16"
    And the input corpus_key is "AI-ML-research"
    And the input section_targets_json is "[{\"section\":\"Research\",\"target_articles\":1}]"
    And the input assignment_ratio is "1.5"
    And the input recent_days is 14
    And the agent "newsroom_editor" calls tool "papyrus_get_edition" with args {"edition_id": "edition-2026-05-16"}
    And the agent "newsroom_editor" calls tool "papyrus_list_edition_items" with args {"edition_id": "edition-2026-05-16"}
    And the agent "newsroom_editor" calls tool "papyrus_list_recent_published_articles" with args {"recent_days": 14}
    And the agent "newsroom_editor" calls tool "biblicus_steering_artifacts" with args {"corpus_key": "AI-ML-research"}
    And the agent "newsroom_editor" calls tool "build_assignment_dispatch_plan" with args {"edition_id": "edition-2026-05-16", "corpus_key": "AI-ML-research", "section_targets_json": "[{\"section\":\"Research\",\"target_articles\":1}]", "assignment_ratio": "1.5", "assignments_json": "[{\"section\":\"Research\",\"title\":\"AI Agents Enter the Lab\",\"slug\":\"ai-agents-enter-the-lab\",\"brief\":\"Explain how agentic systems are changing research workflows.\",\"angle\":\"Focus on practical scientific workflow changes.\",\"category_key\":\"automated-scientific-discovery\",\"evidence_item_ids\":[\"research-001\"]},{\"section\":\"Research\",\"title\":\"Lab Agents Need Editors\",\"slug\":\"lab-agents-need-editors\",\"brief\":\"Explain the quality-control angle.\",\"angle\":\"Focus on assignment review.\",\"category_key\":\"automated-scientific-discovery\",\"evidence_item_ids\":[\"research-002\"]}]"}
    And the agent "newsroom_editor" returns data {"edition_id":"edition-2026-05-16","corpus_key":"AI-ML-research","dry_run":True,"assignment_ratio":"1.5","section_targets":[{"section":"Research","targetArticles":1,"dispatchCount":2}],"assignments":[{"title":"AI Agents Enter the Lab","slug":"ai-agents-enter-the-lab","type":"assignment"}],"record_plans":[{"dryRun":True,"lifecycle":"assignment-dispatch","records":[{"modelName":"Item","action":"create","input":{"type":"assignment","status":"dispatched","typeStatus":"assignment#dispatched"}}]}],"reporter_dispatches":[{"procedure":"procedures/newsroom/reporter.tac","assignmentItemId":"assignment-abc123"}],"reviewer_load":{"targetArticleCount":1,"dispatchedAssignmentCount":2,"assignmentRatio":1.5},"summary":"Created two dry-run assignment dispatch plans for one planned Research slot."}
    When the procedure runs
    Then the procedure should complete successfully
    And the output dry_run should be true
    And the output assignment_ratio should be "1.5"
    And the output assignments should exist
    And the output record_plans should exist
    And the output reporter_dispatches should exist
]])
