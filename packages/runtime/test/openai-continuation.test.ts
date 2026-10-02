import assert from "node:assert/strict";
import test from "node:test";
import { ids } from "@hqoverlord/core";
import { OpenAIModelProvider, ModelDrivenAgentDriver, ExecutionEngine, ToolRegistry,
  type ModelRequest, type OpenAIProviderDiagnostic } from "../src/index.ts";

const credential = "offline-test-credential";
const toolId = ids.tool("generic.local");
const request: ModelRequest = { model: "test-model", instructions: "Generic instructions", input: "Use the local tool",
  maxInputTokens: 1000, maxOutputTokens: 100,
  tools: [{ id: toolId, name: "Local", description: "Generic local tool", inputSchema: { type: "object", properties: {} } }],
  context: { conversationId: "business/job", observations: [] } };
const usage = { input_tokens: 10, output_tokens: 2 };
const reasoning = { type: "reasoning", id: "reasoning-1", summary: [], encrypted_content: "opaque-reasoning-content" };
const call = (call_id: string) => ({ type: "function_call", id: `item-${call_id}`, call_id, name: "hq_tool_0", arguments: "{}" });
const response = (output: unknown[]) => ({ id: "response-1", model: "test-model", status: "completed", usage, output });
const completed = response([{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "42" }] }]);
const observation = { toolId, result: { output: { sum: 42 } } };

function mocked(bodies: readonly unknown[]) {
  const requests: Record<string, unknown>[] = [];
  const transport: typeof fetch = async (_url, init) => {
    requests.push(JSON.parse(init!.body as string) as Record<string, unknown>);
    assert.ok(requests.length <= bodies.length, "Unexpected request");
    return new Response(JSON.stringify(bodies[requests.length - 1]));
  };
  return { requests, transport };
}

test("stateless OpenAI continuation preserves reasoning/call items and supplies exact call_id tool output", async () => {
  const m = mocked([{ input_tokens: 10 }, response([reasoning, call("call-1")]), { input_tokens: 15 }, completed]);
  const provider = new OpenAIModelProvider({ apiKey: credential, transport: m.transport });
  assert.equal((await provider.invoke(request)).decision.kind, "tool");
  const result = await provider.invoke({ ...request, input: "HQ's updated text is not a replacement for call linkage",
    context: { conversationId: "business/job", observations: [observation] } });
  assert.deepEqual(result.decision, { kind: "complete", output: "42" });
  const expected = [{ role: "user", content: request.input }, reasoning, call("call-1"),
    { type: "function_call_output", call_id: "call-1", output: '{"sum":42}' }];
  assert.deepEqual(m.requests[2]!.input, expected);
  assert.deepEqual(m.requests[3]!.input, expected);
  assert.equal(m.requests[3]!.store, false);
  assert.equal(m.requests[3]!.previous_response_id, undefined);
  assert.deepEqual(m.requests[3]!.include, ["reasoning.encrypted_content"]);
});

test("repeated same-tool decisions remain distinct calls with both correlated observations", async () => {
  const m = mocked([{ input_tokens: 10 }, response([call("call-1")]), { input_tokens: 20 }, response([call("call-2")]), { input_tokens: 30 }, completed]);
  const provider = new OpenAIModelProvider({ apiKey: credential, transport: m.transport });
  await provider.invoke(request);
  await provider.invoke({ ...request, context: { conversationId: "business/job", observations: [observation] } });
  assert.equal((await provider.invoke({ ...request, context: { conversationId: "business/job", observations: [observation, observation] } })).decision.kind, "complete");
  const items = m.requests[5]!.input as Record<string, unknown>[];
  assert.deepEqual(items.filter(i => i.type === "function_call_output").map(i => i.call_id), ["call-1", "call-2"]);
  assert.deepEqual(items.filter(i => i.type === "function_call").map(i => i.call_id), ["call-1", "call-2"]);
});

test("real driver and engine correlate repeated tool observations through the adapter without bypassing gates", async () => {
  const m = mocked([{ input_tokens: 10 }, response([call("call-1")]), { input_tokens: 20 }, response([call("call-2")]), { input_tokens: 30 }, completed]);
  const provider = new OpenAIModelProvider({ apiKey: credential, transport: m.transport });
  const tools = new ToolRegistry();
  let calls = 0;
  tools.register({ definition: { id: toolId, name: "Local", description: "Local", effect: "read_only" }, async execute() { calls++; return observation.result; } });
  const businessId = ids.business("business"), agentId = ids.agent("agent");
  const agent = { id: agentId, businessId, name: "Worker", status: "idle" as const, toolIds: [toolId], capabilities: [] };
  const job = { id: ids.job("job"), businessId, agentId, objective: "Use the tool", status: "queued" as const };
  const result = await new ExecutionEngine(tools, { maxTurns: 3 }).execute(job, agent,
    new ModelDrivenAgentDriver(provider, tools, { model: "test-model", maxInputTokens: 1000, maxOutputTokens: 100 }));
  assert.equal(result.status, "completed"); assert.equal(calls, 2);
  const items = m.requests[5]!.input as Record<string, unknown>[];
  assert.deepEqual(items.filter(i => i.type === "function_call_output").map(i => i.call_id), ["call-1", "call-2"]);
});

test("continuation fails closed for missing adapter state, wrong observations or another conversation", async () => {
  for (const nextContext of [
    { conversationId: "business/job", observations: [] },
    { conversationId: "another-business/job", observations: [observation] },
    { conversationId: "business/job", observations: [{ ...observation, toolId: ids.tool("wrong") }] },
  ]) {
    const m = mocked([{ input_tokens: 10 }, response([call("call-1")])]);
    const diagnostics: OpenAIProviderDiagnostic[] = [];
    const provider = new OpenAIModelProvider({ apiKey: credential, transport: m.transport, onDiagnostic: d => diagnostics.push(d) });
    await provider.invoke(request);
    assert.equal((await provider.invoke({ ...request, context: nextContext })).decision.kind, "failure");
    assert.equal(m.requests.length, 2);
    assert.equal(diagnostics[0]!.category, "invalid_continuation");
  }
});

test("HTTP failures report safe stage/status/code/type/parameter while retaining usage", async () => {
  const diagnostics: OpenAIProviderDiagnostic[] = [];
  let calls = 0;
  const transport: typeof fetch = async () => {
    calls++;
    return calls === 1 ? new Response('{"input_tokens":10}') : new Response(JSON.stringify({ usage, model: "test-model",
      error: { code: "rate_limit_exceeded", type: "rate_limit_error", param: "model", message: `Bearer ${credential}` },
    }), { status: 429, headers: { Authorization: credential } });
  };
  const result = await new OpenAIModelProvider({ apiKey: credential, transport, onDiagnostic: d => diagnostics.push(d) }).invoke(request);
  assert.deepEqual(result.decision, { kind: "failure", code: "PROVIDER_FAILED" });
  assert.equal(result.usage?.inputTokens, 10);
  assert.deepEqual(diagnostics, [{ stage: "response", category: "http_error", httpStatus: 429,
    errorCode: "rate_limit_exceeded", errorType: "rate_limit_error", parameter: "model" }]);
  assert.ok(!JSON.stringify(diagnostics).includes(credential));
});

test("diagnostics drop arbitrary secret-bearing strings, headers and exception messages", async () => {
  for (const network of [false, true]) {
    const diagnostics: OpenAIProviderDiagnostic[] = [];
    const transport: typeof fetch = async () => {
      if (network) throw new Error(`Authorization ${credential} other-sensitive-secret`);
      return new Response(JSON.stringify({ error: { code: credential, type: "other-sensitive-secret", param: credential, message: credential } }), { status: 400 });
    };
    await new OpenAIModelProvider({ apiKey: credential, transport, onDiagnostic: d => diagnostics.push(d) }).invoke(request);
    assert.equal(diagnostics.length, 1);
    assert.ok(!JSON.stringify(diagnostics).includes(credential));
    assert.ok(!JSON.stringify(diagnostics).includes("other-sensitive-secret"));
  }
});

test("HTML HTTP errors retain status and diagnostic callback failures cannot alter outcomes", async () => {
  const diagnostics: OpenAIProviderDiagnostic[] = [];
  let calls = 0;
  const transport: typeof fetch = async () => ++calls === 1 ? new Response('{"input_tokens":10}') : new Response("server unavailable", { status: 503 });
  const result = await new OpenAIModelProvider({ apiKey: credential, transport, onDiagnostic(d) { diagnostics.push(d); throw new Error("observer failed"); } }).invoke(request);
  assert.equal(result.decision.kind, "failure");
  assert.equal(diagnostics[0]?.httpStatus, 503);
});
