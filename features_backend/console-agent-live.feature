@live-agent
Feature: Live console agent behavior
  Live AppSync and LLM behavior specs for the Papyrus console responder.

  Background:
    Given live console agent tests are enabled

  Scenario: The console agent responds to hello
    When I run the live console agent smoke scenario "hello"
    Then the live console agent response should include "hello"
    And the live console agent smoke result should include no structured errors
    And the live console agent smoke result should include no tool calls
    And the live console agent smoke result should default to model "gpt-5-nano"

  Scenario: The console agent discovers resource documentation progressively
    When I run the live console agent smoke scenario "docs-progressive"
    Then the live console agent smoke result should include tool call "papyrus.docs.list"
    And the live console agent smoke result should include tool call "papyrus.docs.get"
    And the live console agent smoke result should include tool calls in order "papyrus.docs.list" then "papyrus.docs.get"
    And the live console agent response should include "Assignment"
    And the live console agent smoke result should include no structured errors
    And the live console agent smoke result should default to model "gpt-5-nano"

  Scenario: The console agent creates a research Assignment
    When I run the live console agent smoke scenario "create-research-assignment"
    Then the live console agent smoke result should include tool call "papyrus.Assignment.create"
    And the live console agent smoke result should include exactly 1 assignment
    And the live console agent response should match regex "^assignment[-_][A-Za-z0-9_-]+$"
    And the live console agent smoke result should include no structured errors
    And the live console agent smoke result should default to model "gpt-5-nano"

  Scenario: The console agent can list prefixed Assignments
    When I run the live console agent smoke scenario "list-research-assignments"
    Then the live console agent smoke result should include tool call "papyrus.Assignment.create"
    And the live console agent smoke result should include tool call "papyrus.Assignment.list"
    And the live console agent smoke result should include tool calls in order "papyrus.Assignment.create" then "papyrus.Assignment.list"
    And the live console agent smoke result should include exactly 1 assignment
    And the live console agent response should match regex "^assignment[-_][A-Za-z0-9_-]+$"
    And the live console agent smoke result should include no structured errors
    And the live console agent smoke result should default to model "gpt-5-nano"

  Scenario: The console agent can fetch Assignment info
    When I run the live console agent smoke scenario "get-research-assignment"
    Then the live console agent smoke result should include tool call "papyrus.Assignment.create"
    And the live console agent smoke result should include tool call "papyrus.Assignment.get"
    And the live console agent smoke result should include tool calls in order "papyrus.Assignment.create" then "papyrus.Assignment.get"
    And the live console agent smoke result should include exactly 1 assignment
    And the live console agent response should match regex "^assignment[-_][A-Za-z0-9_-]+$"
    And the live console agent smoke result should include no structured errors
    And the live console agent smoke result should default to model "gpt-5-nano"

  Scenario: The console agent can update Assignment status
    When I run the live console agent smoke scenario "update-research-assignment"
    Then the live console agent smoke result should include tool call "papyrus.Assignment.update"
    And the live console agent smoke result should include exactly 1 assignment
    And the live console agent smoke result should include no structured errors
    And the live console agent smoke result should default to model "gpt-5-nano"

  Scenario: The console agent returns structured error shape for invalid Assignment input
    When I run the live console agent smoke scenario "invalid-assignment-input"
    Then the live console agent smoke result should include tool call "papyrus.Assignment.create"
    And the live console agent smoke result should include a structured error
    And the live console agent response should equal "invalid-input-tested"
    And the live console agent smoke result should default to model "gpt-5-nano"

  Scenario: The console agent can discuss a specific Reference from corpus
    When I run the live console agent smoke scenario "discuss-reference"
    Then the live console agent smoke result should include tool call "papyrus.reference.list"
    And the live console agent smoke result should include tool call "papyrus.reference.get"
    And the live console agent smoke result should include tool calls in order "papyrus.reference.list" then "papyrus.reference.get"
    And the live console agent smoke result should include no structured errors
    And the live console agent response should equal "reference-discussion-tested"
    And the live console agent smoke result should default to model "gpt-5-nano"

  Scenario: The console agent can rate Reference quality
    When I run the live console agent smoke scenario "rate-reference-quality"
    Then the live console agent smoke result should include tool call "papyrus.reference.list"
    And the live console agent smoke result should include tool call "papyrus.reference.quality_set"
    And the live console agent smoke result should include tool call "papyrus.reference.quality_get"
    And the live console agent smoke result should include tool calls in order "papyrus.reference.list" then "papyrus.reference.quality_set"
    And the live console agent smoke result should include no structured errors
    And the live console agent response should equal "reference-quality-tested"
    And the live console agent smoke result should default to model "gpt-5-nano"

  Scenario: The console agent can run Reference summary curation
    When I run the live console agent smoke scenario "curate-reference-summary"
    Then the live console agent smoke result should include tool call "papyrus.reference.list"
    And the live console agent smoke result should include tool call "papyrus.reference.summarize"
    And the live console agent smoke result should include tool calls in order "papyrus.reference.list" then "papyrus.reference.summarize"
    And the live console agent smoke result should include no structured errors
    And the live console agent response should equal "reference-summary-tested"
    And the live console agent smoke result should default to model "gpt-5-nano"
