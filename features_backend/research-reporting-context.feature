@backend @newsroom @context
Feature: Research and Reporting Context Contracts
  As a newsroom operator
  I need doctrine and knowledge-first context behavior to stay enforceable
  So research/reporting runs are auditable and desk-aligned.

  Scenario: News desk policy seeds journalistic-source preference
    Given the newsroom sections seed file
    When I read the section with id "news"
    Then its editorial policy prefers journalistic and official sources over academic papers as the default

  Scenario: Research and reporting procedures require broad internal orientation before optional web checks
    Given the seeded newsroom procedure sources
    Then the research explorer procedure requires one broad knowledge_query before web search
    And the reporter procedure requires one broad knowledge_query before optional web checks

  Scenario: Cloud procedure traces include model-call message history and execute_tactus call traces
    Given sample cloud procedure stdout with one LLM payload and one execute_tactus call
    When I build llm-context trace artifacts
    Then the summary includes one llm call and one execute_tactus call
    And llm-context calls.jsonl exists with one record
    And llm-context execute_tactus_calls.jsonl exists with one record

