-- Papyrus automated newsroom reporter procedure.
--
-- Dry-run only: live Assignments produce draft/article plans without mutating
-- workflow state; legacy assignment Items still use the compatibility item plan.

local done = require("tactus.tools.done")

Toolset "papyrus" {
    type = "plugin",
    paths = {"./procedures/newsroom/tactus_tools"}
}

newsroom_reporter = Agent {
    provider = "openai",
    model = "gpt-5.4-mini",
    system_prompt = [[
You are the Papyrus newsroom reporter agent.

Goal:
- Turn one live Assignment or legacy assignment Item into a draft article record plan.
- If assignment_json is absent, read either a live Assignment context or a legacy assignment Item.
- When live Assignment context is available, build and use the budgeted Papyrus agent context pack.
- Use execute_tactus as your only tool for Papyrus, Biblicus, Tactus stdlib web research, context, and dry-run plan work.
- Inside execute_tactus, compose Papyrus APIs with short Tactus snippets.
- If drafting needs fresh source verification, require tactus.web inside the
  snippet and use provider="openai" with web.search or web.synthesize. Treat web
  results as evidence inputs only; do not write GraphQL records from web search.

Rules:
- This is dry-run only. Never claim records were written.
- Live Assignment inputs are workflow records; do not claim, complete, or mutate them unless a separate lifecycle action is requested.
- Legacy assignment Item inputs may still normalize to Item.type = "assignment" and mark that compatibility Item drafted in the plan.
- Create a separate draft article Item with Item.type = "article" and Item.status = "draft".
- When live context is available, read and apply its section doctrine, topic-scope context, recent section memory, and accepted evidence before drafting.
- Treat only current accepted references as publishable evidence. Pending
  prospects and rejected scope memory are private curation/training context, not
  source support for reader-facing claims.
- Return structured draft data and the dry-run update plan.
]],
    tools = {"papyrus", done},
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
        assignment_item_id = field.string{default = "", description = "Papyrus Assignment.id or legacy assignment Item.id"},
        assignment_json = field.string{default = "", description = "Inline Assignment or assignment Item JSON for deterministic tests or offline runs"},
        corpus_key = field.string{default = "AI-ML-research", description = "Papyrus steering corpus key"},
        context_profile = field.string{default = "", description = "Optional live context profile override"},
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
1. Call execute_tactus with one short Tactus snippet.
2. In that snippet, use assignment_context, assignment_agent_context, and assignment_context_to_item for live Assignment queue work when possible.
3. Use item_get only when live Assignment context is unavailable.
4. Use biblicus_query or biblicus_topic_context for evidence.
5. When fresh source verification is needed, use local web = require("tactus.web") and call web.search or web.synthesize inside execute_tactus.
6. Use plan_draft_update to build the dry-run assignment update and article draft plan.

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
    And the agent "newsroom_reporter" calls tool "execute_tactus" with args {"tactus": "local item = item_get{ id = \"assignment-abc123\" }; local evidence = biblicus_query{ corpus_key = \"AI-ML-research\", query = \"AI Agents Enter the Lab\", max_total_items = 5 }; return { item = item, evidence = evidence }"}
    And the agent "newsroom_reporter" returns data {"assignment_item_id":"assignment-abc123","dry_run":True,"draft_status":"draft","draft_record_plan":{"dryRun":True,"lifecycle":"draft","records":[{"modelName":"Item","action":"update","input":{"id":"assignment-abc123","type":"assignment","status":"drafted","typeStatus":"assignment#drafted"}},{"modelName":"Item","action":"create","input":{"type":"article","status":"draft","typeStatus":"article#draft"}}]},"summary":"Created one dry-run draft article plan."}
    When the procedure runs
    Then the procedure should complete successfully
    And the output dry_run should be true
    And the output draft_status should be draft
    And the output draft_record_plan should exist

  Scenario: Reporter accepts a live Assignment context
    Given the procedure has started
    And the input assignment_item_id is "assignment-live-123"
    And the input corpus_key is "AI-ML-research"
    And the input context_profile is "reporting"
    And the agent "newsroom_reporter" calls tool "execute_tactus" with args {"tactus": "local context = assignment_context{ id = \"assignment-live-123\" }; local pack = assignment_agent_context{ id = \"assignment-live-123\", context_profile = \"reporting\" }; local item = assignment_context_to_item{ assignment_context = context.assignment_context }; return { context = context, pack = pack, item = item }"}
    And the agent "newsroom_reporter" returns data {"assignment_item_id":"assignment-live-123","dry_run":True,"draft_status":"draft","draft_record_plan":{"dryRun":True,"lifecycle":"draft"},"summary":"Created one dry-run draft article plan from a live assignment context."}
    When the procedure runs
    Then the procedure should complete successfully
    And the output dry_run should be true
    And the output draft_status should be draft
    And the output draft_record_plan should exist
]])
