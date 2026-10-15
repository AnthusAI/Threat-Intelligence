Feature: Full organizer CMS rollout
  Scenario: Preserve publication content and authoring workflows
    Given the publication uses its existing authenticated main backend
    When the organizer CMS frontend is released
    Then taxonomy, concepts, knowledge search, curation and administration remain available
    And the original private editing actions retain their permissions
    And the public Threat Intelligence reader retains its brand and layout
    And no synthetic gateway or classifier is activated

  Scenario: A frontend update preserves authentication
    Given the existing Cognito domain and callback allowlist are working
    When the existing hosting pipeline builds the new frontend
    Then it generates main backend outputs without deploying backend changes
    And retired legacy applications are excluded from this rollout
