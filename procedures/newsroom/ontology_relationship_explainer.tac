-- Papyrus ontology relationship explainer procedure.
--
-- Generates source-specific meaning for one SemanticRelation. Persistence is
-- owned by the outer Papyrus ontology CLI, which stores the output as a
-- SemanticRelation ModelAttachment and audit Message.

local json = require("tactus.io.json")

ontology_relationship_explainer = Agent {
    provider = "openai",
    model = "gpt-5.4-mini",
    system_prompt = [[
You explain ontology relationships for Papyrus.

Goal:
- Explain what one SemanticRelation means in the context of its subject, object,
  surrounding graph, available source metadata, Messages, and attachments.
- Keep the explanation grounded in the supplied context only.
- Treat the explanation as contextual, not universal truth.

Rules:
- Return strict structured data only.
- Do not invent source text, citations, identifiers, or evidence spans.
- Use concise source-facing language useful for retrieval and future concept
  profiling.
- Confidence should reflect contextual support, not whether the relation exists.
- Candidate associations must be additive suggestions only.
]],
    output = {
        relation_explanation = field.object{required = true}
    }
}

Procedure {
    input = {
        context_json = field.object{required = true, description = "Ontology relation context JSON from Papyrus CLI"}
    },
    output = {
        relation_explanation = field.object{required = true}
    },
    function(input)
        local context = input.context_json
        local message = string.format([[
Explain this Papyrus ontology relation from the supplied JSON context.

Required JSON shape for relation_explanation:
{
  "meaning": "1-3 sentence contextual explanation",
  "evidence": [{"source":"field/message/attachment/relation", "text":"short evidence note", "objectId":"optional"}],
  "ambiguity": ["short caveat"],
  "confidence": 0.0,
  "candidateAssociations": [{"predicate":"related_to", "targetConceptId":"semantic-node-id", "confidence":0.0, "rationale":"short reason"}],
  "model": "gpt-5.4-mini"
}

Context JSON:
%s
]], json.encode(context))
        local result = ontology_relationship_explainer({message = message})
        return result.output
    end
}

Specification([[
Feature: Ontology relationship explanation
  The procedure explains one SemanticRelation from supplied Papyrus context.

  Scenario: Relationship explainer returns a contextual meaning object
    Given the procedure has started
    And the input context_json is {"relation":{"id":"semantic-relation-1","predicate":"mentions"},"subject":{"record":{"title":"Reference"}},"object":{"record":{"displayName":"Concept"}}}
    And the agent "ontology_relationship_explainer" returns data {"relation_explanation":{"meaning":"Reference mentions Concept in context.","evidence":[],"ambiguity":[],"confidence":0.9,"candidateAssociations":[],"model":"gpt-5.4-mini"}}
    When the procedure runs
    Then the procedure should complete successfully
    And the output relation_explanation should exist
]])
