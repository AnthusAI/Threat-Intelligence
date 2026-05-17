-- Papyrus automated newsroom editor procedure.
--
-- Dry-run only: this procedure returns Item and EditionItem record plans for
-- assignment rows but does not write to GraphQL.

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
- Propose article assignments for one edition.
- Use Papyrus GraphQL read tools to understand the edition and recent published articles.
- Use Biblicus tools to understand the configured corpus and evidence.
- Use build_assignment_record_plan for every assignment you propose.

Rules:
- This is dry-run only. Never claim records were written.
- Keep Item.type as "article" and assignment lifecycle in Item.status.
- Avoid repeating recent published article angles.
- Return structured data with assignment objects and their dry-run record plans.
]],
    tools = {"plugin", done},
    output = {
        edition_id = field.string{required = true},
        corpus_key = field.string{required = true},
        dry_run = field.boolean{required = true},
        assignments = field.array{required = true},
        record_plans = field.array{required = true},
        summary = field.string{required = true}
    }
}

Procedure {
    input = {
        edition_id = field.string{required = true, description = "Papyrus Edition.id to plan assignments for"},
        corpus_key = field.string{default = "AI-ML-research", description = "Papyrus steering corpus key"},
        max_assignments = field.integer{default = 3, description = "Maximum assignment plans to return"},
        recent_days = field.integer{default = 30, description = "Published article lookback window"}
    },
    output = {
        edition_id = field.string{required = true},
        corpus_key = field.string{required = true},
        dry_run = field.boolean{required = true},
        assignments = field.array{required = true},
        record_plans = field.array{required = true},
        summary = field.string{required = true}
    },
    function(input)
        local message = string.format([[
Create up to %d assignment record plans for edition %s using corpus %s.

Required tool flow:
1. papyrus_get_edition(edition_id)
2. papyrus_list_edition_items(edition_id)
3. papyrus_list_recent_published_articles(recent_days)
4. biblicus_steering_artifacts(corpus_key)
5. biblicus_topic_context or biblicus_query for evidence
6. build_assignment_record_plan for each proposed assignment

Return dry_run=true, assignments, record_plans, and a concise summary.
]], input.max_assignments, input.edition_id, input.corpus_key)

        local result = newsroom_editor({message = message})
        return result.output
    end
}

Specification([[
Feature: Newsroom editor procedure
  The editor creates dry-run assignment record plans without live writes.

  Scenario: Editor returns assignment plans
    Given the procedure has started
    And the input edition_id is "edition-2026-05-16"
    And the input corpus_key is "AI-ML-research"
    And the input max_assignments is 1
    And the input recent_days is 14
    And the agent "newsroom_editor" calls tool "papyrus_get_edition" with args {"edition_id": "edition-2026-05-16"}
    And the agent "newsroom_editor" calls tool "papyrus_list_recent_published_articles" with args {"recent_days": 14}
    And the agent "newsroom_editor" calls tool "biblicus_steering_artifacts" with args {"corpus_key": "AI-ML-research"}
    And the agent "newsroom_editor" calls tool "build_assignment_record_plan" with args {"edition_id": "edition-2026-05-16", "corpus_key": "AI-ML-research", "placement_index": 1, "assignment_json": "{\"title\":\"AI Agents Enter the Lab\",\"slug\":\"ai-agents-enter-the-lab\",\"brief\":\"Explain how agentic systems are changing research workflows.\",\"angle\":\"Focus on practical scientific workflow changes.\",\"topic_uid\":\"automated-scientific-discovery\",\"evidence_item_ids\":[\"research-001\"]}"}
    And the agent "newsroom_editor" returns data {"edition_id":"edition-2026-05-16","corpus_key":"AI-ML-research","dry_run":True,"assignments":[{"title":"AI Agents Enter the Lab","slug":"ai-agents-enter-the-lab"}],"record_plans":[{"dryRun":True,"lifecycle":"assignment","records":[{"modelName":"Item","action":"create","input":{"type":"article","status":"assignment","typeStatus":"article#assignment"}}]}],"summary":"Created one dry-run assignment plan."}
    When the procedure runs
    Then the procedure should complete successfully
    And the output dry_run should be true
    And the output assignments should exist
    And the output record_plans should exist
]])
