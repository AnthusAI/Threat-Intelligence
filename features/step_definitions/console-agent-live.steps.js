const assert = require("node:assert/strict");
const { Given, When, Then } = require("@cucumber/cucumber");
const { runScenario } = require("../../scripts/console-agent-smoke.cjs");

Given("live console agent tests are enabled", function () {
  assert.equal(
    process.env.PAPYRUS_LIVE_AGENT_BDD,
    "1",
    "Set PAPYRUS_LIVE_AGENT_BDD=1 to run live LLM/AppSync console-agent BDD tests.",
  );
});

When("I run the live console agent smoke scenario {string}", async function (scenario) {
  this.liveConsoleAgentSmokeResult = await runScenario(scenario, {
    keep: process.env.PAPYRUS_LIVE_AGENT_KEEP === "1",
  });
});

Then("the live console agent smoke scenario should pass", function () {
  assert.equal(this.liveConsoleAgentSmokeResult?.ok, true);
});

Then("the live console agent smoke result should include tool call {string}", function (toolCall) {
  assert.ok(
    this.liveConsoleAgentSmokeResult?.apiCalls?.includes(toolCall),
    `Expected ${toolCall}; saw ${(this.liveConsoleAgentSmokeResult?.apiCalls || []).join(", ")}`,
  );
});

Then("the live console agent smoke result should include exactly {int} assignment", function (count) {
  assert.equal(this.liveConsoleAgentSmokeResult?.assignmentIds?.length || 0, count);
});
