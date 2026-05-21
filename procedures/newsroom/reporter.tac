-- Papyrus automated newsroom reporter procedure.
--
-- Dry-run only: live reporting Assignments produce private reporting context
-- packet payloads for editor selection. The CLI/procedure layer owns all record
-- persistence plans.

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
- Turn one live reporting Assignment into a private reporting context packet payload.
- Turn selected packet/copywriting or legacy assignment Item inputs into draft
  article plans only when the input is explicitly in that compatibility path.
- If assignment_json is absent, read either a live Assignment context or a legacy assignment Item.
- If assignment_json is present, use it as the fallback Assignment brief. Live
  context helpers may enrich the packet, but their failure must not by itself
  prevent returning a reporting_context_packet payload.
- When live Assignment context is available, build and use the budgeted Papyrus agent context pack.
- Use execute_tactus as your only tool for Papyrus, Biblicus, Tactus stdlib web research, and context.
- Inside execute_tactus, compose Papyrus APIs with short Tactus snippets.
- If drafting needs fresh source verification, require tactus.web inside the
  snippet and use provider="openai" with web.search or web.synthesize. Treat web
  results as evidence inputs only; do not write GraphQL records from web search.

Rules:
- This is dry-run only. Never claim records were written.
- Live Assignment inputs are workflow records; do not claim, complete, or mutate them unless a separate lifecycle action is requested.
- Live reporting.edition-candidate Assignments must produce a
  reporting_context_packet payload. Do not generate Papyrus persistence snippets
  or call plan_assignment_reporting_context_packet; the outer CLI writes Message,
  ModelAttachment, and SemanticRelation records deterministically.
- Include editor_recommendation, recommended_angle, risk_flags, coverage_gaps,
  open_questions, accepted_reference_ids, proposed_references, and
  copywriter_brief in the reporting payload.
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
        work_product_kind = field.string{required = true},
        item_status = field.string{required = true},
        reporting_context_packet = field.object{required = false},
        reporting_record_plan = field.object{required = false},
        draft_record_plan = field.object{required = false},
        summary = field.string{required = true}
    }
}

Procedure {
    input = {
        assignment_item_id = field.string{default = "", description = "Papyrus Assignment.id or legacy assignment Item.id"},
        assignment_json = field.string{default = "", description = "Inline Assignment or assignment Item JSON for deterministic tests or offline runs"},
        corpus_key = field.string{default = "AI-ML-research", description = "Papyrus steering corpus key"},
        context_profile = field.string{default = "", description = "Optional live context profile override"},
        max_evidence_items = field.integer{default = 5, description = "Maximum Biblicus evidence items to use"},
        source_research_assignment_id = field.string{default = "", description = "Optional source research Assignment.id for packet lineage"},
        source_research_packet_id = field.string{default = "", description = "Optional source research packet Message.id for packet lineage"},
        source_research_packet_path = field.string{default = "", description = "Optional dry-run source research packet path for operator traceability"}
    },
    output = {
        assignment_item_id = field.string{required = true},
        dry_run = field.boolean{required = true},
        work_product_kind = field.string{required = true},
        item_status = field.string{required = true},
        reporting_context_packet = field.object{required = false},
        reporting_record_plan = field.object{required = false},
        draft_record_plan = field.object{required = false},
        summary = field.string{required = true}
    },
    function(input)
        local assignment_source = input.assignment_item_id
        if input.assignment_json ~= "" then
            assignment_source = "inline assignment_json"
        end

        local message = string.format([[
Create a reporting work-product plan for %s using corpus %s.

Source research assignment id: %s
Source research packet id: %s
Source research packet path: %s

Required tool flow:
1. Call execute_tactus with one short Tactus snippet.
2. In that snippet, use assignment_context{ id = "<assignment id>" }, assignment_agent_context{ id = "<assignment id>", context_profile = "reporting" }, and assignment_context_to_item for live Assignment queue work when possible.
3. Use item_get only when live Assignment context is unavailable.
4. For live reporting.edition-candidate Assignments, return a reporting_context_packet payload only.
5. When fresh source verification is needed, use local web = require("tactus.web") and call web.search or web.synthesize inside execute_tactus.
6. Do not call Papyrus persistence planners. The outer CLI builds any record plan.
7. When source research ids are provided, include source_research_assignment_id
   and source_research_packet_id in the reporting payload so the packet plan can
   write derived_from lineage.
8. If live context helpers fail but assignment_json is present, return a packet
   from the assignment_json brief and mark the context gap in risk_flags and
   open_questions. Do not call done without returning a packet payload.

For live reporting assignments, return assignment_item_id="%s", dry_run=true, work_product_kind="reporting_context_packet", item_status="reported", reporting_context_packet, and a concise summary.
For legacy draft compatibility, return dry_run=true, work_product_kind="draft_article", item_status="draft", draft_record_plan, and a concise summary.
]], assignment_source, input.corpus_key, input.source_research_assignment_id or "", input.source_research_packet_id or "", input.source_research_packet_path or "", input.assignment_item_id or "")

        local result = newsroom_reporter({message = message})
        local output = {}
        if result ~= nil and result.output ~= nil then
            output = result.output
        end
        if output.assignment_item_id == nil or output.assignment_item_id == "" then
            output.assignment_item_id = input.assignment_item_id
        end
        if output.dry_run == nil then
            output.dry_run = true
        end
        if output.work_product_kind == nil or output.work_product_kind == "" then
            if output.reporting_context_packet ~= nil then
                output.work_product_kind = "reporting_context_packet"
            elseif output.draft_record_plan ~= nil then
                output.work_product_kind = "draft_article"
            else
                output.work_product_kind = "reporting_context_packet"
            end
        end
        if output.item_status == nil or output.item_status == "" then
            if output.work_product_kind == "draft_article" then
                output.item_status = "draft"
            else
                output.item_status = "reported"
            end
        end
        if output.summary == nil or output.summary == "" then
            if output.reporting_context_packet ~= nil then
                output.summary = "Created one dry-run reporting context packet payload."
            elseif output.draft_record_plan ~= nil then
                output.summary = "Created one dry-run draft article plan."
            else
                output.summary = "No reporting payload was returned."
            end
        end
        return output
    end
}

Specification([[
Feature: Newsroom reporter procedure
  The reporter creates private reporting packet payloads for live reporting Assignments and keeps legacy draft planning compatible.

  Scenario: Reporter returns a legacy draft update plan
    Given the procedure has started
    And the input assignment_item_id is "assignment-abc123"
    And the input corpus_key is "AI-ML-research"
    And the agent "newsroom_reporter" calls tool "execute_tactus" with args {"tactus": "local item = item_get{ id = \"assignment-abc123\" }; local evidence = biblicus_query{ corpus_key = \"AI-ML-research\", query = \"AI Agents Enter the Lab\", max_total_items = 5 }; return { item = item, evidence = evidence }"}
    And the agent "newsroom_reporter" returns data {"assignment_item_id":"assignment-abc123","dry_run":True,"work_product_kind":"draft_article","item_status":"draft","draft_record_plan":{"dryRun":True,"lifecycle":"draft","records":[{"modelName":"Item","action":"update","input":{"id":"assignment-abc123","type":"assignment","status":"drafted","typeStatus":"assignment#drafted"}},{"modelName":"Item","action":"create","input":{"type":"article","status":"draft","typeStatus":"article#draft"}}]},"summary":"Created one dry-run draft article plan."}
    When the procedure runs
    Then the procedure should complete successfully
    And the output dry_run should be true
    And the output item_status should be draft
    And the output draft_record_plan should exist

  Scenario: Reporter accepts a live reporting Assignment context
    Given the procedure has started
    And the input assignment_item_id is "assignment-live-123"
    And the input corpus_key is "AI-ML-research"
    And the input context_profile is "reporting"
    And the agent "newsroom_reporter" calls tool "execute_tactus" with args {"tactus": "local context = assignment_context{ id = \"assignment-live-123\" }; local pack = assignment_agent_context{ id = \"assignment-live-123\", context_profile = \"reporting\" }; return { assignment = context.assignment_context.assignment, context = pack }"}
    And the agent "newsroom_reporter" returns data {"assignment_item_id":"assignment-live-123","dry_run":True,"work_product_kind":"reporting_context_packet","item_status":"reported","reporting_context_packet":{"summary":"Reporting context ready.","editor_recommendation":"hold","recommended_angle":"Reader impact.","risk_flags":["Verify one claim."],"coverage_gaps":["Need second source."],"open_questions":["Who is affected?"],"accepted_reference_ids":[],"proposed_references":[],"copywriter_brief":"Use the packet after editor selection."},"summary":"Created one dry-run reporting context packet payload from a live assignment context."}
    When the procedure runs
    Then the procedure should complete successfully
    And the output dry_run should be true
    And the output item_status should be reported
    And the output reporting_context_packet should exist
]])
