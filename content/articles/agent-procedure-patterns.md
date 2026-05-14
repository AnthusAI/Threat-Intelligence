---
slug: agent-procedure-patterns
shortSlug: AGENTS
section: AI/ML
byline: Papyrus Staff
dateline: NEWSROOM
image:
  src: /agent-procedure-continuum.svg
  alt: A chart mapping AI systems from predictability to agency and from low to high consequence
  credit: Papyrus chart
  layout:
    minHeight: 120
    preferredHeight: 180
    maxHeight: 220
    aspectRatio: 1.3333
    crop: contain
    wrapsText: true
pullQuotes:
  - The harness is becoming the product.
  - The practical question is no longer whether an agent can act, but where it is allowed to improvise.
---

# The Next Agent Breakthrough Is a Checklist

## Developers are learning that reliable agents need less freedom, not more: state machines, scoped tools, policy gates, and step-by-step procedure.

The most interesting argument on Hacker News this week was not about a new frontier model. It was about how much freedom an AI agent should be allowed to have. Across demos, comments, and tool launches, builders kept circling the same answer: the practical breakthrough is not giving agents a bigger sandbox, but putting them inside a procedure.

That marks a quiet reversal in the agent story. The first wave of agent demos sold autonomy: ask for an outcome and let the model decide what to do. The newer work is more cautious and more useful. It treats agency as a dial, not a switch.

At one end of the dial are scripts, workflow engines, and RPA jobs: predictable, auditable, and brittle when reality changes. At the other end are open-ended agents that can plan, browse, call tools, edit files, and recover from surprises, but may also wander, repeat themselves, or take unsafe actions. The emerging middle ground is bounded agency: a model can improvise, but only inside states, allowed tools, review gates, and traceable transitions.

The Statewright project drew attention because it says that part out loud. Its author argues that agentic problem solving becomes more reliable when the problem is made smaller instead of the model larger. A planning state can get read-only tools. An implementation state can get edit tools. A testing state can get test commands. The model cannot skip the workflow because the workflow is enforced outside the prompt.

That pattern is showing up elsewhere. A tiny tool-calling model such as Needle suggests that many agent steps are not grand acts of reasoning at all. They are tool selection, argument extraction, and structured output. If that is true, then a smaller model inside a well-designed harness may beat a larger model asked to keep the whole job in its head.

Browser-workflow builders are making a similar move. Instead of asking one long-running agent to remember a whole instruction chain, they decompose the job into explicit steps and hand each step to a smaller sub-agent. The model solves the current task. The procedure carries the intent.

The same idea appears on the safety side. Runtime authorization layers put a policy engine between a proposed tool call and execution. The model can suggest writing a file, triggering a payment, or touching production data, but another layer decides whether that action is allowed, denied, rewritten, or escalated to a human.

This is not a retreat from agency. It is a way to spend agency where it has value. Deterministic code is better at remembering phase boundaries, counting retries, enforcing allowed tools, and recording what happened. Models are better at reading messy evidence, choosing among ambiguous next steps, and producing useful text or code inside a constrained frame.

The continuum matters because different jobs tolerate different kinds of surprise. A shopping-list assistant can be loose. A coding agent that can push a branch needs more guardrails. A mainframe agent working around financial systems needs a narrow lane, logged transitions, and a clear way to stop.

That may change what the word agent means in products. The important interface may not be a chat box. It may be a task board, a state graph, a policy file, a sandbox, an approval queue, or a run history that shows why the system moved from one phase to the next.

For teams trying to ship these systems, the lesson is pragmatic. Start with the procedure that a careful human would follow. Decide which steps are deterministic, which steps need judgment, which actions require approval, and which failures should trigger a retry. Then put the model where uncertainty actually lives.

The future agent may not look like a free-roaming assistant. It may look more like a worker with a checklist, a badge, a supervisor, and a locked tool cabinet. The harness is becoming the product.
