@live-agent
Feature: Live console agent behavior
  Live AppSync and LLM smoke tests for the Papyrus console responder.

  Background:
    Given live console agent tests are enabled

  Scenario: The console agent responds to hello
    When I run the live console agent smoke scenario "hello"
    Then the live console agent smoke scenario should pass

  Scenario: The console agent discovers resource documentation progressively
    When I run the live console agent smoke scenario "docs-progressive"
    Then the live console agent smoke scenario should pass
    And the live console agent smoke result should include tool call "papyrus.docs.list"
    And the live console agent smoke result should include tool call "papyrus.docs.get"

  Scenario: The console agent creates a research Assignment
    When I run the live console agent smoke scenario "create-research-assignment"
    Then the live console agent smoke scenario should pass
    And the live console agent smoke result should include tool call "papyrus.Assignment.create"
    And the live console agent smoke result should include exactly 1 assignment
