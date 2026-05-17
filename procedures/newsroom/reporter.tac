-- Papyrus automated newsroom reporter procedure.
--
-- Dry-run only: this procedure returns an Item update plan that advances an
-- assignment to draft but does not write to GraphQL.

local done = require("tactus.tools.done")

Toolset "plugin" {
    type = "plugin",
    paths = {"./procedures/newsroom/tools"}
}

newsroom_reporter = Agent {
    provider = "openai",
    model = "gpt-4o-mini",
    system_prompt = [[
You are the Papyrus newsroom reporter agent.

Goal:
- Turn one assignment Item into a draft article update plan.
- If assignment_json is absent, read the assignment with papyrus_get_item.
- Research the assignment with Biblicus query/context tools.
- Use build_draft_update_plan to produce the dry-run Item update.

Rules:
- This is dry-run only. Never claim records were written.
- Preserve Item.type as "article".
- Move lifecycle through Item.status from "assignment" to "draft".
- Return structured draft data and the dry-run update plan.
]],
    tools = {"plugin", done},
    output = {
        assignment_item_id = field.string{required = true},
        dry_run = field.boolean{required = true},
        draft_status = field.string{required = true},
        draft_record_plan = field.object{required = true},
        summary = field.string{required = true}
    }
}

Procedure {
    input = {
        assignment_item_id = field.string{default = "", description = "Papyrus Item.id for the assignment"},
        assignment_json = field.string{default = "", description = "Inline assignment Item JSON for deterministic tests or offline runs"},
        corpus_key = field.string{default = "AI-ML-research", description = "Papyrus steering corpus key"},
        max_evidence_items = field.integer{default = 5, description = "Maximum Biblicus evidence items to use"}
    },
    output = {
        assignment_item_id = field.string{required = true},
        dry_run = field.boolean{required = true},
        draft_status = field.string{required = true},
        draft_record_plan = field.object{required = true},
        summary = field.string{required = true}
    },
    function(input)
        local assignment_source = input.assignment_item_id
        if input.assignment_json ~= "" then
            assignment_source = "inline assignment_json"
        end

        local message = string.format([[
Create a draft update plan for %s using corpus %s.

Required tool flow:
1. If assignment_json is empty, call papyrus_get_item(assignment_item_id).
2. Use biblicus_query or biblicus_topic_context to gather evidence.
3. Call build_draft_update_plan with the assignment item and draft payload.

Return dry_run=true, draft_status="draft", draft_record_plan, and a concise summary.
]], assignment_source, input.corpus_key)

        local result = newsroom_reporter({message = message})
        return result.output
    end
}

Specification([[
Feature: Newsroom reporter procedure
  The reporter creates dry-run draft update plans from assignment Items.

  Scenario: Reporter returns a draft update plan
    Given the procedure has started
    And the input assignment_item_id is "assignment-abc123"
    And the input corpus_key is "AI-ML-research"
    And the agent "newsroom_reporter" calls tool "papyrus_get_item" with args {"item_id": "assignment-abc123"}
    And the agent "newsroom_reporter" calls tool "biblicus_query" with args {"corpus_key": "AI-ML-research", "query": "AI Agents Enter the Lab", "max_total_items": 5}
    And the agent "newsroom_reporter" calls tool "build_draft_update_plan" with args {"assignment_item_json": "{\"id\":\"assignment-abc123\",\"type\":\"article\",\"status\":\"assignment\",\"typeStatus\":\"article#assignment\",\"slug\":\"ai-agents-enter-the-lab\",\"section\":\"Research\",\"title\":\"AI Agents Enter the Lab\",\"editorial\":{\"newsroom\":{\"assignment\":{\"brief\":\"Explain research agents.\"}}}}", "draft_json": "{\"headline\":\"AI Agents Enter the Lab\",\"deck\":\"Research teams are handing more lab work to autonomous systems.\",\"body\":[\"Agentic systems are moving from demos into research workflows.\",\"The strongest evidence comes from scientific discovery and evaluation corpora.\"],\"byline\":\"Papyrus Staff\",\"evidence_item_ids\":[\"research-001\"]}"}
    And the agent "newsroom_reporter" returns data {"assignment_item_id":"assignment-abc123","dry_run":True,"draft_status":"draft","draft_record_plan":{"dryRun":True,"lifecycle":"draft","records":[{"modelName":"Item","action":"update","input":{"id":"assignment-abc123","type":"article","status":"draft","typeStatus":"article#draft"}}]},"summary":"Created one dry-run draft update plan."}
    When the procedure runs
    Then the procedure should complete successfully
    And the output dry_run should be true
    And the output draft_status should be draft
    And the output draft_record_plan should exist
]])
