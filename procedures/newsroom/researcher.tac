-- Papyrus automated newsroom researcher procedure.
--
-- Dry-run only: this procedure returns an Item update plan that attaches
-- research to an assignment but does not write to GraphQL.

local done = require("tactus.tools.done")

Toolset "plugin" {
    type = "plugin",
    paths = {"./procedures/newsroom/tools"}
}

newsroom_researcher = Agent {
    provider = "openai",
    model = "gpt-4o-mini",
    system_prompt = [[
You are the Papyrus newsroom researcher agent.

Goal:
- Build an evidence-backed research packet for one assignment Item.
- If assignment_json is absent, read the assignment with papyrus_get_item.
- Use Biblicus steering, topic, trend, and query tools to gather relevant evidence.
- Use build_research_update_plan to produce the dry-run Item update.

Rules:
- This is dry-run only. Never claim records were written.
- Assignment input records must use Item.type = "assignment".
- Keep the assignment Item as the input row and advance Item.status to "researched".
- Store research handoff details in editorial.newsroom.research.
- Return structured research data and the dry-run update plan.
]],
    tools = {"plugin", done},
    output = {
        assignment_item_id = field.string{required = true},
        corpus_key = field.string{required = true},
        dry_run = field.boolean{required = true},
        item_status = field.string{required = true},
        research_packet = field.object{required = true},
        research_record_plan = field.object{required = true},
        summary = field.string{required = true}
    }
}

Procedure {
    input = {
        assignment_item_id = field.string{default = "", description = "Papyrus Item.id for the assignment"},
        assignment_json = field.string{default = "", description = "Inline assignment Item JSON for deterministic tests or offline runs"},
        corpus_key = field.string{default = "AI-ML-research", description = "Papyrus steering corpus key"},
        research_questions = field.string{default = "", description = "Optional editor/reporter research questions"},
        max_evidence_items = field.integer{default = 8, description = "Maximum Biblicus evidence items to use"}
    },
    output = {
        assignment_item_id = field.string{required = true},
        corpus_key = field.string{required = true},
        dry_run = field.boolean{required = true},
        item_status = field.string{required = true},
        research_packet = field.object{required = true},
        research_record_plan = field.object{required = true},
        summary = field.string{required = true}
    },
    function(input)
        local assignment_source = input.assignment_item_id
        if input.assignment_json ~= "" then
            assignment_source = "inline assignment_json"
        end

        local message = string.format([[
Create a research packet and dry-run update plan for %s using corpus %s.

Research questions:
%s

Required tool flow:
1. If assignment_json is empty, call papyrus_get_item(assignment_item_id).
2. Call biblicus_steering_artifacts(corpus_key).
3. Use biblicus_query plus biblicus_topic_context or biblicus_topic_trends to gather evidence.
4. Call build_research_update_plan with the assignment item and research packet.

Use at most %d evidence items. Return dry_run=true, item_status="researched",
research_packet, research_record_plan, and a concise summary.
]], assignment_source, input.corpus_key, input.research_questions, input.max_evidence_items)

        local result = newsroom_researcher({message = message})
        return result.output
    end
}

Specification([[
Feature: Newsroom researcher procedure
  The researcher creates dry-run research update plans for assignment Items.

  Scenario: Researcher returns a research update plan
    Given the procedure has started
    And the input assignment_item_id is "assignment-abc123"
    And the input corpus_key is "AI-ML-research"
    And the input max_evidence_items is 2
    And the input research_questions is "What concrete lab workflow examples support this?"
    And the agent "newsroom_researcher" calls tool "papyrus_get_item" with args {"item_id": "assignment-abc123"}
    And the agent "newsroom_researcher" calls tool "biblicus_steering_artifacts" with args {"corpus_key": "AI-ML-research"}
    And the agent "newsroom_researcher" calls tool "biblicus_query" with args {"corpus_key": "AI-ML-research", "query": "AI Agents Enter the Lab concrete lab workflow examples", "max_total_items": 2}
    And the agent "newsroom_researcher" calls tool "build_research_update_plan" with args {"assignment_item_json": "{\"id\":\"assignment-abc123\",\"type\":\"assignment\",\"status\":\"dispatched\",\"typeStatus\":\"assignment#dispatched\",\"slug\":\"ai-agents-enter-the-lab\",\"section\":\"Research\",\"title\":\"AI Agents Enter the Lab\",\"editorial\":{\"newsroom\":{\"assignment\":{\"brief\":\"Explain research agents.\"}}}}", "research_json": "{\"summary\":\"Evidence supports a practical research-workflow angle.\",\"corpus_key\":\"AI-ML-research\",\"category_key\":\"automated-scientific-discovery\",\"evidence_item_ids\":[\"research-001\"],\"queries\":[\"AI Agents Enter the Lab concrete lab workflow examples\"],\"source_snapshots\":[{\"itemId\":\"research-001\",\"title\":\"Lab agents\"}],\"research_notes\":[\"Tie the story to concrete workflow changes.\"],\"open_questions\":[\"Which examples are strongest for the edition?\"],\"coverage_gaps\":[\"Need one skeptical source.\"],\"recommended_angle\":\"Focus on lab workflow delegation.\"}"}
    And the agent "newsroom_researcher" returns data {"assignment_item_id":"assignment-abc123","corpus_key":"AI-ML-research","dry_run":True,"item_status":"researched","research_packet":{"summary":"Evidence supports a practical research-workflow angle.","evidence_item_ids":["research-001"]},"research_record_plan":{"dryRun":True,"lifecycle":"assignment-research","records":[{"modelName":"Item","action":"update","input":{"id":"assignment-abc123","type":"assignment","status":"researched","typeStatus":"assignment#researched"}}]},"summary":"Created one dry-run research update plan."}
    When the procedure runs
    Then the procedure should complete successfully
    And the output dry_run should be true
    And the output item_status should be researched
    And the output research_record_plan should exist
]])
