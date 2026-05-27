-- Papyrus ontology concept profiler procedure.
--
-- Synthesizes a contextual Concept profile from fresh relation explanations.
-- Persistence is owned by the outer Papyrus ontology CLI.

local json = require("tactus.io.json")

ontology_concept_profiler = Agent {
    provider = "openai",
    model = "gpt-5.4-mini",
    system_prompt = [[
You synthesize Papyrus ontology concept profiles.

Goal:
- Explain what one SemanticNode means across its relation-specific contextual
  explanations.
- Preserve subjectivity: distinguish contextual variants instead of forcing a
  single over-broad definition.
- Produce retrieval-friendly, dedupe-friendly, and association-discovery-friendly
  structured output.

Rules:
- Return strict structured data only.
- Do not overwrite canonical Concept identity; this is a generated profile.
- Do not recommend destructive merges. Duplicate suggestions become same_as or
  alias_of relations outside this procedure.
- Keep recommendations high-confidence and additive.
]],
    output = {
        concept_profile = field.object{required = true}
    }
}

Procedure {
    input = {
        context_json = field.object{required = true, description = "Ontology concept profile context JSON from Papyrus CLI"}
    },
    output = {
        concept_profile = field.object{required = true}
    },
    function(input)
        local context = input.context_json
        local message = string.format([[
Create a Papyrus ontology Concept profile from the supplied JSON context.

Required JSON shape for concept_profile:
{
  "meaning": "concise contextual concept explanation",
  "contextualVariants": [{"label":"variant", "meaning":"short explanation", "evidenceRelationIds":["id"]}],
  "aliases": ["alias"],
  "disambiguators": ["how to distinguish this concept"],
  "exemplarSources": ["relation-or-object-id"],
  "likelyDuplicates": [{"conceptId":"semantic-node-id", "predicate":"same_as", "confidence":0.0, "rationale":"short reason"}],
  "recommendedRelations": [{"predicate":"related_to", "targetConceptId":"semantic-node-id", "confidence":0.0, "rationale":"short reason"}],
  "confidence": 0.0,
  "model": "gpt-5.4-mini"
}

Context JSON:
%s
]], json.encode(context))
        local result = ontology_concept_profiler({message = message})
        return result.output
    end
}

Specification([[
Feature: Ontology concept profiling
  The procedure profiles one SemanticNode from fresh relation explanations.

  Scenario: Concept profiler returns a contextual profile object
    Given the procedure has started
    And the input context_json is {"concept":{"id":"semantic-node-1","displayName":"Concept"},"relationExplanations":[]}
    And the agent "ontology_concept_profiler" returns data {"concept_profile":{"meaning":"Concept is profiled from supplied ontology context.","contextualVariants":[],"aliases":[],"disambiguators":[],"exemplarSources":[],"likelyDuplicates":[],"recommendedRelations":[],"confidence":0.9,"model":"gpt-5.4-mini"}}
    When the procedure runs
    Then the procedure should complete successfully
    And the output concept_profile should exist
]])
