-- Papyrus automated newsroom researcher procedure.
--
-- Dry-run only: this procedure returns an Item update plan that attaches
-- research to an assignment but does not write to GraphQL.

local done = require("tactus.tools.done")

Toolset "papyrus" {
    type = "plugin",
    paths = {"./procedures/newsroom/tactus_tools"}
}

newsroom_researcher = Agent {
    provider = "openai",
    model = "gpt-5.4-mini",
    system_prompt = [[
You are the Papyrus newsroom researcher agent.

Goal:
- Build an evidence-backed research packet for one assignment Item.
- If assignment_json is absent, read either a live Assignment context or a legacy assignment Item.
- When live Assignment context is available, build and use the budgeted Papyrus agent context pack.
- Use execute_tactus as your only tool for Papyrus, Biblicus, context, and dry-run plan work.
- Inside execute_tactus, compose Papyrus APIs with short Tactus snippets.

Rules:
- This is dry-run only. Never claim records were written.
- Assignment input records must normalize to Item.type = "assignment" before the dry-run update is built.
- Keep the assignment Item as the input row and advance Item.status to "researched".
- Store research handoff details in editorial.newsroom.research.
- When live context is available, read and apply its doctrine section, focus-category section, desk-memory section, and fresh-evidence section.
- Apply doctrine in this order when context is available: publication mission
  and policies, root desk mission and policies, assignment brief, focus-category
  metadata, desk memory, then fresh evidence instructions.
- Treat publication doctrine as the global editorial constitution and desk
  doctrine as the local beat standard. If doctrine and assignment instructions
  conflict, surface the conflict in openQuestions or coverageGaps.
- Do not quote private doctrine, curation notes, or unpublished assignment
  material into reader-facing prose. Use doctrine to guide judgment, source
  selection, coverage gaps, and recommendedAngle.
- Return doctrine_context, comparison_findings, and rubric_assessments when the research packet needs to explain why evidence did or did not meet the live doctrine standard.
- Return structured research data and the dry-run update plan.
]],
    tools = {"papyrus", done},
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
        context_profile = field.string{default = "", description = "Optional live context profile override"},
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
1. Call execute_tactus with one short Tactus snippet.
2. In that snippet, use assignment_context, assignment_agent_context, and assignment_context_to_item for live Assignment queue work when possible.
3. Fall back to item_get only when live Assignment context is unavailable.
4. Use biblicus_steering_artifacts, biblicus_query, biblicus_topic_context, or biblicus_topic_trends for evidence.
5. Use plan_research_update to build the dry-run research update plan.

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
    And the input context_profile is "analysis"
    And the input max_evidence_items is 2
    And the input research_questions is "What concrete lab workflow examples support this?"
    And the agent "newsroom_researcher" calls tool "execute_tactus" with args {"tactus": "local item = item_get{ id = \"assignment-abc123\" }; local steering = biblicus_steering_artifacts{ corpus_key = \"AI-ML-research\" }; return { item = item, steering = steering }"}
    And the agent "newsroom_researcher" returns data {"assignment_item_id":"assignment-abc123","corpus_key":"AI-ML-research","dry_run":True,"item_status":"researched","research_packet":{"summary":"Evidence supports a practical research-workflow angle.","evidence_item_ids":["research-001"]},"research_record_plan":{"dryRun":True,"lifecycle":"assignment-research","records":[{"modelName":"Item","action":"update","input":{"id":"assignment-abc123","type":"assignment","status":"researched","typeStatus":"assignment#researched"}}]},"summary":"Created one dry-run research update plan."}
    When the procedure runs
    Then the procedure should complete successfully
    And the output dry_run should be true
    And the output item_status should be researched
    And the output research_record_plan should exist

  Scenario: Researcher accepts a live Assignment context
    Given the procedure has started
    And the input assignment_item_id is "assignment-live-123"
    And the input corpus_key is "AI-ML-research"
    And the input context_profile is "reporting"
    And the agent "newsroom_researcher" calls tool "execute_tactus" with args {"tactus": "local context = assignment_context{ id = \"assignment-live-123\" }; local pack = assignment_agent_context{ id = \"assignment-live-123\", context_profile = \"reporting\" }; local item = assignment_context_to_item{ assignment_context = context.assignment_context }; return { context = context, pack = pack, item = item }"}
    And the agent "newsroom_researcher" returns data {"assignment_item_id":"assignment-live-123","corpus_key":"AI-ML-research","dry_run":True,"item_status":"researched","research_packet":{"summary":"Live assignment context normalized correctly."},"research_record_plan":{"dryRun":True,"lifecycle":"assignment-research"},"summary":"Created one dry-run research update plan from a live assignment context."}
    When the procedure runs
    Then the procedure should complete successfully
    And the output dry_run should be true
    And the output item_status should be researched
    And the output research_record_plan should exist
]])
