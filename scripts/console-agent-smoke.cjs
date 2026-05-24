#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const CONSOLE_THREAD_ANCHOR_KEY = "site#papyrus";
const CONSOLE_NEWSROOM_FEED_KEY = "consoleChat";
const CONSOLE_MESSAGE_KIND = "console_chat_turn";
const CONSOLE_MESSAGE_DOMAIN = "conversation";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadEnvFile(path.join(ROOT, ".env.local"));
loadEnvFile(path.join(ROOT, ".env"));

function endpointFromOutputs() {
  const outputsPath = path.join(ROOT, "amplify_outputs.json");
  if (!fs.existsSync(outputsPath)) return "";
  const outputs = JSON.parse(fs.readFileSync(outputsPath, "utf8"));
  return outputs?.data?.url || outputs?.data?.aws_appsync_graphqlEndpoint || "";
}

function requiredEnv(name, fallback = "") {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`Missing ${name}. Set it in the environment or .env.`);
  return value;
}

const GRAPHQL_ENDPOINT = requiredEnv("PAPYRUS_GRAPHQL_ENDPOINT", endpointFromOutputs());
const GRAPHQL_JWT = requiredEnv("PAPYRUS_GRAPHQL_JWT");

function authHeader() {
  return `PapyrusJwt ${String(GRAPHQL_JWT).replace(/^Bearer\s+/i, "").trim()}`;
}

async function graphql(query, variables = {}, field = "") {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: authHeader(),
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errors?.length) {
    const detail = JSON.stringify(payload);
    throw new Error(`GraphQL ${field || "request"} failed: ${response.status} ${response.statusText} ${detail}`);
  }
  return field ? payload.data?.[field] : payload.data;
}

const SCHEMA_INTROSPECTION = `
  query ConsoleAgentSmokeSchema {
    queryType: __type(name: "Query") { fields { name } }
    messageType: __type(name: "Message") { fields { name } }
    createMessageInputType: __type(name: "CreateMessageInput") { inputFields { name } }
  }
`;

const MESSAGE_FIELD_CANDIDATES = [
  "id",
  "threadId",
  "parentMessageId",
  "sequenceNumber",
  "role",
  "messageKind",
  "messageType",
  "content",
  "summary",
  "responseStatus",
  "responseOwner",
  "responseStartedAt",
  "responseCompletedAt",
  "responseError",
  "messageDomain",
  "source",
  "importRunId",
  "authorLabel",
  "newsroomFeedKey",
  "metadata",
  "body",
  "createdAt",
  "updatedAt",
];

let schemaCache = null;

function nameSet(value, key = "fields") {
  return new Set((value?.[key] || []).map((entry) => entry.name).filter(Boolean));
}

async function schema() {
  if (schemaCache) return schemaCache;
  const data = await graphql(SCHEMA_INTROSPECTION);
  schemaCache = {
    queryFields: nameSet(data.queryType),
    messageFields: nameSet(data.messageType),
    createMessageInputFields: nameSet(data.createMessageInputType, "inputFields"),
  };
  return schemaCache;
}

function chooseMessageSelection(fields) {
  const selected = MESSAGE_FIELD_CANDIDATES.filter((field) => fields.has(field));
  if (!selected.includes("id")) selected.unshift("id");
  if (fields.has("createdAt") && !selected.includes("createdAt")) selected.push("createdAt");
  return selected.join("\n      ");
}

function sanitizeInput(input, fields) {
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (fields.has(key) && value !== undefined) out[key] = value;
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function createThread(runId) {
  const now = nowIso();
  const input = {
    id: `thread-console-smoke-${runId}`,
    threadKind: "console",
    status: "active",
    title: `Agent smoke ${runId}`,
    summary: "Live console agent smoke test",
    primaryAnchorKind: "site",
    primaryAnchorId: "papyrus",
    primaryAnchorLineageId: "papyrus",
    primaryAnchorKey: CONSOLE_THREAD_ANCHOR_KEY,
    createdByLabel: "agent-smoke",
    messageCount: 0,
    metadata: JSON.stringify({ smokeRunId: runId }),
    createdAt: now,
    updatedAt: now,
    newsroomFeedKey: CONSOLE_NEWSROOM_FEED_KEY,
  };
  const query = `
    mutation CreateThread($input: CreateMessageThreadInput!) {
      createMessageThread(input: $input) { id createdAt updatedAt }
    }
  `;
  await graphql(query, { input }, "createMessageThread");
  return input;
}

async function createUserMessage(thread, prompt, runId) {
  const snap = await schema();
  const now = nowIso();
  const input = {
    id: id("message-console-user-smoke"),
    threadId: thread.id,
    parentMessageId: null,
    sequenceNumber: 1,
    role: "USER",
    messageKind: CONSOLE_MESSAGE_KIND,
    messageDomain: CONSOLE_MESSAGE_DOMAIN,
    messageType: "MESSAGE",
    content: prompt,
    body: prompt,
    status: "active",
    summary: prompt.slice(0, 180),
    source: "console",
    authorLabel: "Agent Smoke",
    semanticLayer: "working_memory",
    searchVisibility: "private",
    responseTarget: "cloud",
    responseStatus: "PENDING",
    metadata: JSON.stringify({ threadId: thread.id, sequenceNumber: 1, role: "USER", smokeRunId: runId }),
    createdAt: now,
    updatedAt: now,
    newsroomFeedKey: CONSOLE_NEWSROOM_FEED_KEY,
  };
  const selection = chooseMessageSelection(snap.messageFields);
  const query = `
    mutation CreateMessage($input: CreateMessageInput!) {
      createMessage(input: $input) {
        ${selection}
      }
    }
  `;
  await graphql(query, { input: sanitizeInput(input, snap.createMessageInputFields) }, "createMessage");
  return input;
}

async function listMessages(threadId) {
  const snap = await schema();
  const selection = chooseMessageSelection(snap.messageFields);
  const attempts = [];
  if (snap.queryFields.has("listMessagesByThreadAndSequence")) {
    attempts.push({
      field: "listMessagesByThreadAndSequence",
      args: "threadId: $threadId, limit: $limit, nextToken: $nextToken",
      vars: "($threadId: ID!, $limit: Int, $nextToken: String)",
      variables: { threadId, limit: 500 },
      scoped: true,
    });
  }
  if (snap.queryFields.has("listMessagesByThreadAndCreatedAt")) {
    attempts.push({
      field: "listMessagesByThreadAndCreatedAt",
      args: "threadId: $threadId, limit: $limit, nextToken: $nextToken",
      vars: "($threadId: ID!, $limit: Int, $nextToken: String)",
      variables: { threadId, limit: 500 },
      scoped: true,
    });
  }
  if (snap.queryFields.has("listMessagesByNewsroomFeedAndCreatedAt")) {
    attempts.push({
      field: "listMessagesByNewsroomFeedAndCreatedAt",
      args: "newsroomFeedKey: $newsroomFeedKey, limit: $limit, nextToken: $nextToken",
      vars: "($newsroomFeedKey: String!, $limit: Int, $nextToken: String)",
      variables: { newsroomFeedKey: CONSOLE_NEWSROOM_FEED_KEY, limit: 500 },
    });
  }
  if (snap.queryFields.has("listMessages")) {
    attempts.push({
      field: "listMessages",
      args: "limit: $limit, nextToken: $nextToken",
      vars: "($limit: Int, $nextToken: String)",
      variables: { limit: 500 },
    });
  }
  for (const attempt of attempts) {
    const query = `
      query ListMessages${attempt.vars} {
        ${attempt.field}(${attempt.args}) {
          items { ${selection} }
          nextToken
        }
      }
    `;
    const items = [];
    let nextToken = null;
    do {
      const connection = await graphql(query, { ...attempt.variables, nextToken }, attempt.field);
      items.push(...(connection?.items || []).filter(Boolean));
      nextToken = connection?.nextToken || null;
    } while (nextToken);
    return (attempt.scoped ? items : items.filter((item) => {
      if (item.threadId) return item.threadId === threadId;
      try {
        return JSON.parse(item.metadata || "{}").threadId === threadId;
      } catch {
        return false;
      }
    })).sort((left, right) => (Number(left.sequenceNumber || 0) - Number(right.sequenceNumber || 0)) || String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
  }
  throw new Error("No listMessages query is available in the GraphQL schema.");
}

function messageContent(message) {
  if (message.content) return String(message.content);
  if (message.body) return String(message.body);
  try {
    return String(JSON.parse(message.metadata || "{}").content || "");
  } catch {
    return "";
  }
}

function messageRole(message) {
  if (message.role) return String(message.role);
  try {
    return String(JSON.parse(message.metadata || "{}").role || "");
  } catch {
    return "";
  }
}

async function waitForAssistant(threadId, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let lastMessages = [];
  while (Date.now() < deadline) {
    lastMessages = await listMessages(threadId);
    const assistant = lastMessages
      .filter((message) => messageRole(message) === "ASSISTANT" || String(message.id || "").includes("assistant"))
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))
      .at(-1);
    if (assistant?.responseStatus === "FAILED") {
      throw new Error(`Assistant failed: ${assistant.responseError || messageContent(assistant)}`);
    }
    if (assistant?.responseStatus === "COMPLETED" && messageContent(assistant).trim()) {
      return { assistant, messages: lastMessages };
    }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  throw new Error(`Timed out waiting for assistant. Last messages: ${JSON.stringify(lastMessages)}`);
}

function extractToolApiCalls(messages) {
  const calls = [];
  for (const message of messages) {
    if (message.messageKind !== "console_tool_result") continue;
    try {
      const parsed = JSON.parse(messageContent(message));
      for (const call of parsed.api_calls || []) calls.push(call);
      if (parsed.value?.api_calls) calls.push(...parsed.value.api_calls);
    } catch {
      // Ignore non-JSON tool text.
    }
  }
  return calls;
}

function collectCreatedAssignmentIds(value, run) {
  if (!value || typeof value !== "object") return;
  const assignmentId = value.assignmentId || value.assignment?.id;
  const eventId = value.event?.id;
  if (assignmentId) run.assignmentIds.push(String(assignmentId));
  if (eventId) run.assignmentEventIds.push(String(eventId));
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === "object") collectCreatedAssignmentIds(nested, run);
  }
}

async function deleteRecord(model, idValue) {
  if (!idValue) return;
  const query = `
    mutation Delete${model}($input: Delete${model}Input!) {
      delete${model}(input: $input) { id }
    }
  `;
  try {
    await graphql(query, { input: { id: idValue } }, `delete${model}`);
  } catch {
    // Cleanup must not mask the scenario result.
  }
}

async function cleanup(run) {
  if (run.keep) return;
  for (const eventId of run.assignmentEventIds || []) await deleteRecord("AssignmentEvent", eventId);
  for (const assignmentId of run.assignmentIds || []) await deleteRecord("Assignment", assignmentId);
  const messages = run.thread?.id ? await listMessages(run.thread.id).catch(() => []) : [];
  for (const message of messages) await deleteRecord("Message", message.id);
  if (run.thread?.id) await deleteRecord("MessageThread", run.thread.id);
}

function scenarioPrompt(name, runId) {
  if (name === "hello") return "Say hello in one short sentence.";
  if (name === "docs-progressive") {
    return [
      "Use execute_tactus to inspect Papyrus docs progressively. This is a live integration test: a natural-language answer without tool calls is a failure.",
      "First call exactly: docs_list{ namespace = \"resources\" }.",
      "Then call exactly: docs_get{ id = \"resources.Assignment\" }.",
      "Only after both tool calls succeed, reply with one sentence describing the Assignment resource.",
    ].join("\n");
  }
  if (name === "create-research-assignment") {
    return [
      "Use execute_tactus to create exactly one research Assignment. Do not answer until the Assignment.create tool call has succeeded.",
      "This is a live integration test: a natural-language response without an execute_tactus tool call is a failure.",
      "If you inspect docs first, continue immediately afterward and perform the write.",
      "The required Tactus snippet is:",
      `return Assignment.create{ type = "research", title = "Live smoke research assignment ${runId}", summary = "Smoke-test assignment created by the console agent.", sectionKey = "technology", researchMode = "source_discovery", importRunId = "${runId}", apply = true }`,
      "After the tool result succeeds, reply with only the created assignment id.",
    ].join("\n");
  }
  throw new Error(`Unknown scenario: ${name}`);
}

function assertScenario(name, result, run) {
  const content = messageContent(result.assistant).trim();
  if (!content) throw new Error("Assistant response is empty.");
  const apiCalls = extractToolApiCalls(result.messages);
  if (name === "docs-progressive") {
    if (!apiCalls.includes("papyrus.docs.list") || !apiCalls.includes("papyrus.docs.get")) {
      throw new Error(`Expected docs_list and docs_get tool calls. Saw: ${apiCalls.join(", ")}. Assistant said: ${content}`);
    }
  }
  if (name === "create-research-assignment") {
    if (!apiCalls.includes("papyrus.Assignment.create")) {
      throw new Error(`Expected Assignment.create tool call. Saw: ${apiCalls.join(", ")}. Assistant said: ${content}`);
    }
    for (const message of result.messages) {
      if (message.messageKind !== "console_tool_result") continue;
      try {
        const parsed = JSON.parse(messageContent(message));
        collectCreatedAssignmentIds(parsed, run);
      } catch {
        // Ignore.
      }
    }
    run.assignmentIds = [...new Set(run.assignmentIds)];
    run.assignmentEventIds = [...new Set(run.assignmentEventIds)];
    if (run.assignmentIds.length !== 1) {
      throw new Error(`Expected exactly one created Assignment, found ${run.assignmentIds.length}. Assistant said: ${content}`);
    }
  }
  return { content, apiCalls };
}

async function runScenario(name, options = {}) {
  const runId = options.runId || `agent-smoke-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const run = { keep: Boolean(options.keep), assignmentIds: [], assignmentEventIds: [], thread: null };
  try {
    run.thread = await createThread(runId);
    await createUserMessage(run.thread, scenarioPrompt(name, runId), runId);
    const result = await waitForAssistant(run.thread.id, Number(options.timeoutMs || 120000));
    const checks = assertScenario(name, result, run);
    return {
      ok: true,
      scenario: name,
      runId,
      assistantMessageId: result.assistant.id,
      assignmentIds: run.assignmentIds,
      apiCalls: checks.apiCalls,
      content: checks.content,
    };
  } finally {
    await cleanup(run);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const scenarioIndex = args.indexOf("--scenario");
  const scenario = scenarioIndex >= 0 ? args[scenarioIndex + 1] : args[0] || "hello";
  const keep = args.includes("--keep");
  try {
    const result = await runScenario(scenario, { keep });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, scenario, error: error?.message || String(error) }, null, 2));
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { runScenario };
