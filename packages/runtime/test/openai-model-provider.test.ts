import assert from "node:assert/strict";
import test from "node:test";
import { currencyCode, ids, money } from "@hqoverlord/core";
import { correlationId, eventId } from "@hqoverlord/events";
import { OpenAIModelProvider, DurableRuntime, ToolRegistry, emptyDurableState, encodeDurableState, commandId,
  type ModelRequest, type DurableState, type DurableStore } from "../src/index.ts";

const credential = "mock-credential-for-offline-tests";
const toolId = ids.tool("tool:id/with spaces");
const request: ModelRequest = { model: "configured-model", instructions: "Generic instructions", input: "Generic context",
  tools: [{ id: toolId, name: "Lookup", description: "Read facts", inputSchema: { type: "object", properties: { query: { type: "string" } } } }],
  maxInputTokens: 100, maxOutputTokens: 20 };
const usage = { input_tokens: 12, output_tokens: 3, input_tokens_details: { cached_tokens: 4 } };
const response = (output: unknown[], extras: Record<string, unknown> = {}) => ({ id: "response-test", model: request.model, status: "completed", output, usage, ...extras });
const message = (text = "Done") => ({ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] });
function mock(bodies: readonly unknown[], status = 200) {
  const calls: { url: string; body: Record<string, unknown>; signal: AbortSignal | null | undefined; authorization: string | null }[] = [];
  const transport: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init!.body as string) as Record<string, unknown>, signal: init?.signal,
      authorization: new Headers(init?.headers).get("Authorization") });
    const body = bodies[calls.length - 1];
    assert.notEqual(body, undefined, "Unexpected transport call; all transport is mocked");
    return new Response(JSON.stringify(body), { status: calls.length === 1 ? 200 : status });
  };
  return { transport, calls };
}

test("OpenAI Responses adapter maps configured request and complete response without live transport", async () => {
  const m = mock([{ input_tokens: 10 }, response([message()])]);
  const provider = new OpenAIModelProvider({ apiKey: credential, transport: m.transport });
  const result = await provider.invoke(request);
  assert.deepEqual(result, { decision: { kind: "complete", output: "Done" }, usage: {
    provider: "openai", model: request.model, inputTokens: 12, outputTokens: 3, cachedInputTokens: 4, requestId: "response-test",
  } });
  assert.equal(m.calls.length, 2);
  assert.equal(m.calls[0]!.url, "https://api.openai.com/v1/responses/input_tokens");
  assert.equal(m.calls[1]!.url, "https://api.openai.com/v1/responses");
  for (const call of m.calls) {
    assert.equal(call.authorization, `Bearer ${credential}`);
    assert.equal(call.body.model, request.model); assert.equal(call.body.input, request.input);
    assert.equal(call.body.instructions, request.instructions);
    assert.doesNotMatch(JSON.stringify(call.body), new RegExp(credential));
  }
  assert.equal(m.calls[1]!.body.max_output_tokens, 20);
  assert.equal(m.calls[1]!.body.parallel_tool_calls, false);
  assert.equal(m.calls[1]!.body.store, false);
  assert.equal(m.calls[1]!.body.truncation, "disabled");
  assert.deepEqual(m.calls[0]!.body.tools, m.calls[1]!.body.tools);
  assert.equal(JSON.stringify(provider), '{"name":"openai"}');
});

test("OpenAI adapter maps safe function names back to HQ tool identifiers and parses JSON arguments", async () => {
  const m = mock([{ input_tokens: 10 }, response([{ type: "function_call", name: "hq_tool_0", arguments: '{"query":"fact"}', call_id: "call-test" }])]);
  const result = await new OpenAIModelProvider({ apiKey: credential, transport: m.transport }).invoke(request);
  assert.deepEqual(result.decision, { kind: "tool", toolId, input: { query: "fact" } });
  assert.deepEqual(m.calls[1]!.body.tools, [{ type: "function", name: "hq_tool_0", description: "Read facts", parameters: request.tools[0]!.inputSchema, strict: false }]);
});

test("OpenAI adapter input token preflight enforces cap before generation", async () => {
  const m = mock([{ input_tokens: 101 }]);
  assert.equal((await new OpenAIModelProvider({ apiKey: credential, transport: m.transport }).invoke(request)).decision.kind, "failure");
  assert.equal(m.calls.length, 1);
});

test("OpenAI adapter missing key and invalid limits are controlled and never dispatch", async () => {
  const m = mock([]);
  for (const provider of [new OpenAIModelProvider({ apiKey: "", transport: m.transport }), new OpenAIModelProvider({ apiKey: credential, transport: m.transport, timeoutMs: 0 })]) {
    assert.deepEqual((await provider.invoke(request)).decision, { kind: "failure", code: "MODEL_CONFIGURATION_INVALID" });
  }
  assert.deepEqual((await new OpenAIModelProvider({ apiKey: credential, transport: m.transport }).invoke({ ...request, maxOutputTokens: 0 })).decision,
    { kind: "failure", code: "MODEL_CONFIGURATION_INVALID" });
  assert.equal(m.calls.length, 0);
});

test("OpenAI adapter refuses credentials in instructions/input/tool schemas before dispatch", async () => {
  const m = mock([]), provider = new OpenAIModelProvider({ apiKey: credential, transport: m.transport });
  for (const r of [{ ...request, input: credential }, { ...request, instructions: credential },
    { ...request, tools: [{ ...request.tools[0]!, inputSchema: { description: credential } }] }]) {
    assert.deepEqual((await provider.invoke(r)).decision, { kind: "failure", code: "MODEL_CONFIGURATION_INVALID" });
  }
  assert.equal(m.calls.length, 0);
});

test("OpenAI adapter network exceptions are sanitized and never automatically retried", async () => {
  let calls = 0;
  const transport: typeof fetch = async () => { calls++; throw new Error(`Authorization Bearer ${credential}`); };
  const result = await new OpenAIModelProvider({ apiKey: credential, transport }).invoke(request);
  assert.deepEqual(result, { decision: { kind: "failure", code: "PROVIDER_FAILED" },failureReason:"unknown" });
  assert.equal(calls, 1); assert.doesNotMatch(JSON.stringify(result), new RegExp(credential));
});

test("OpenAI adapter malformed/multiple/unknown/hosted decisions preserve reported billable usage", async () => {
  const invalidOutputs = [
    [{ type: "function_call", name: "hq_tool_0", arguments: "not-json" }],
    [{ type: "function_call", name: "hq_tool_0", arguments: "[]" }],
    [{ type: "function_call", name: "unknown", arguments: "{}" }],
    [0],
    [{ type: "web_search_call" }],
    [message(), { type: "function_call", name: "hq_tool_0", arguments: "{}" }, { type: "function_call", name: "hq_tool_0", arguments: "{}" }],
    [{ ...message(), content: [{ type: "refusal", refusal: "No" }] }],
    [],
  ];
  for (const output of invalidOutputs) {
    const m = mock([{ input_tokens: 10 }, response(output)]);
    const result = await new OpenAIModelProvider({ apiKey: credential, transport: m.transport }).invoke(request);
    assert.deepEqual(result.decision, { kind: "failure", code: "MODEL_DECISION_INVALID" });
    assert.equal(result.usage?.inputTokens, 12);
  }
});

test("OpenAI incomplete or HTTP-failed generation preserves supplied usage without false completion", async () => {
  for (const [status, body] of [[200, response([message()], { status: "incomplete" })], [500, response([], { error: { message: credential } })]] as const) {
    const m = mock([{ input_tokens: 10 }, body], status);
    const result = await new OpenAIModelProvider({ apiKey: credential, transport: m.transport }).invoke(request);
    assert.equal(result.decision.kind, "failure"); assert.equal(result.usage?.outputTokens, 3);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(credential));
  }
});

test("OpenAI missing usage stays absent and invalid counts/cache are not normalized", async () => {
  for (const u of [null, { ...usage, input_tokens: -1 }, { ...usage, output_tokens: 0.5 }, { ...usage, input_tokens_details: { cached_tokens: 13 } }]) {
    const m = mock([{ input_tokens: 10 }, response([message()], { usage: u })]);
    const result = await new OpenAIModelProvider({ apiKey: credential, transport: m.transport }).invoke(request);
    assert.equal(result.decision.kind, "complete"); assert.equal(result.usage, undefined);
  }
});

test("OpenAI optional cache usage and reported model identity are retained truthfully", async () => {
  const m = mock([{ input_tokens: 10 }, response([message()], { model: "resolved-model", usage: { input_tokens: 12, output_tokens: 3 } })]);
  const result = await new OpenAIModelProvider({ apiKey: credential, transport: m.transport }).invoke(request);
  assert.equal(result.usage?.model, "resolved-model"); assert.equal(result.usage?.cachedInputTokens, undefined);
});

test("OpenAI cancellation after preflight prevents generation and propagates AbortSignal", async () => {
  const controller = new AbortController();
  let calls = 0;
  const transport: typeof fetch = async (_url, init) => {
    calls++; assert.ok(init?.signal); controller.abort(); return new Response(JSON.stringify({ input_tokens: 10 }));
  };
  const provider = new OpenAIModelProvider({ apiKey: credential, transport });
  assert.equal((await provider.invoke(request, controller.signal)).decision.kind, "failure"); assert.equal(calls, 1);
  await provider.invoke(request, controller.signal); assert.equal(calls, 1);
});

test("OpenAI credential echoes are redacted before decisions enter durable output, facts or accounting", async () => {
  const m = mock([{ input_tokens: 10 }, response([message(credential)], { id: `response-${credential}` })]);
  const provider = new OpenAIModelProvider({ apiKey: credential, transport: m.transport });
  const businessId = ids.business("business"), now = "2026-10-02T12:00:00.000Z";
  let state: DurableState = { ...emptyDurableState(), authority: { businesses: [{ id: businessId, name: "Generic", status: "active", createdAt: now, updatedAt: now }], agents: [], jobs: [] } };
  const store: DurableStore = { async load() { return structuredClone(state); }, async save(next) { state = structuredClone(next); } };
  let id = 0;
  const runtime = await DurableRuntime.open(store, { now: () => now }, { agent: () => ids.agent(`agent-${++id}`), job: () => ids.job(`job-${++id}`), event: () => eventId(`event-${++id}`) });
  const context = (command: string) => ({ commandId: commandId(command), businessId, principal: { kind: "human" as const, id: "owner" }, correlationId: correlationId(command) });
  const agent = (await runtime.createAgent(context("agent"), { name: "Worker" })).record;
  const job = (await runtime.createJob(context("job"), { objective: "Generic objective", agentId: agent.id })).record;
  const currency = currencyCode("GBP");
  const result = await runtime.executeModelJob(context("execute"), job.id, provider, new ToolRegistry(), {
    model: request.model, maxInputTokens: 100, maxOutputTokens: 20, budget: money(1000n, currency),
    pricing: { provider: "openai", model: request.model, currency, tokensPerBlock: 1n, inputMinorUnits: 1n, outputMinorUnits: 1n },
  });
  assert.equal(result.status, "completed"); assert.equal(result.output, "[REDACTED]");
  assert.doesNotMatch(encodeDurableState(state), new RegExp(credential));
  assert.doesNotMatch(JSON.stringify(provider), new RegExp(credential));
  assert.equal(runtime.inspectLedger(context("read"), job.id).length, 1);
});

test("OpenAI credential echoes in function arguments, keys and usage identity are redacted", async () => {
  const m = mock([{ input_tokens: 10 }, response([{ type: "function_call", name: "hq_tool_0", arguments: JSON.stringify({ [credential]: credential }) }], { id: credential })]);
  const result = await new OpenAIModelProvider({ apiKey: credential, transport: m.transport }).invoke(request);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(credential));
  assert.equal(result.usage?.requestId, "[REDACTED]");
});


test('Responses maps actual host attachment blocks on both token-count and generation requests',async()=>{
  const m=mock([{input_tokens:10},response([message('Saw actual attachment')])]),provider=new OpenAIModelProvider({apiKey:credential,transport:m.transport});
  const result=await provider.invoke({...request,inputContent:[{type:'image_url',image_url:{url:'data:image/png;base64,YWN0dWFs'}}]});assert.equal(result.decision.kind,'complete');
  for(const call of m.calls)assert.deepEqual(call.body.input,[{role:'user',content:[{type:'input_text',text:request.input},{type:'input_image',image_url:'data:image/png;base64,YWN0dWFs'}]}]);assert.equal(m.calls[1]!.body.max_output_tokens,request.maxOutputTokens);
});


test('Responses streams real output deltas before its terminal receipt, redacts split credentials and retains exact terminal usage',async()=>{
 let controller!:ReadableStreamDefaultController<Uint8Array>,calls=0,seen!:()=>void;const ready=new Promise<void>(r=>{seen=r;}),updates:string[]=[],encoder=new TextEncoder();
 const provider=new OpenAIModelProvider({apiKey:credential,transport:async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body));if(calls===1){assert.equal(body.stream,undefined);return new Response(JSON.stringify({input_tokens:10}));}assert.equal(body.stream,true);assert.equal(body.max_output_tokens,20);return new Response(new ReadableStream<Uint8Array>({start(c){controller=c;c.enqueue(encoder.encode('data: '+JSON.stringify({type:'response.output_text.delta',delta:'Actual text '+credential.slice(0,12)})+'\n\n'));}}),{headers:{'content-type':'text/event-stream'}});}});
 const pending=provider.invoke(request,undefined,delta=>{updates.push(delta);seen();});await ready;assert.equal(updates.join(''),'Actual text ');controller.enqueue(encoder.encode('data: '+JSON.stringify({type:'response.output_text.delta',delta:credential.slice(12)+' finished'})+'\n\n'));controller.enqueue(encoder.encode('data: '+JSON.stringify({type:'response.completed',response:response([message('Actual text '+credential+' finished')])})+'\n\n'));controller.close();
 const result=await pending;assert.equal(result.decision.kind,'complete');assert.equal(updates.join(''),'Actual text [REDACTED] finished');assert.equal(JSON.stringify(result).includes(credential),false);assert.equal(result.usage!.inputTokens,12);assert.equal(result.usage!.cachedInputTokens,4);assert.equal(calls,2);
});

test('an ended Responses stream without its actual terminal receipt never invents usage or a completed answer',async()=>{
 let calls=0;const provider=new OpenAIModelProvider({apiKey:credential,transport:async()=>++calls===1?new Response(JSON.stringify({input_tokens:10})):new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:'Partial only'})+'\n\n',{headers:{'content-type':'text/event-stream'}})});const partial:string[]=[];const result=await provider.invoke(request,undefined,t=>partial.push(t));assert.deepEqual(partial,['Partial only']);assert.equal(result.decision.kind,'failure');assert.equal(result.usage,undefined);assert.equal(calls,2);
});

test('Responses classifies the actual provider output ceiling without retaining its raw error or credentials',async()=>{
 const m=mock([{input_tokens:10},{error:{message:'max_tokens is too large: 100. This model supports at most 25 completion tokens, '+credential}}]),provider=new OpenAIModelProvider({apiKey:credential,transport:m.transport});
 const original=m.transport;let count=0;const transport:typeof fetch=async(...args)=>{const response=await original(...args);return ++count===2?new Response(await response.text(),{status:400}):response;};
 const result=await new OpenAIModelProvider({apiKey:credential,transport}).invoke(request);assert.equal(result.failureReason,'output_cap');assert.equal(result.allowedMaxOutputTokens,25);assert.doesNotMatch(JSON.stringify(result),new RegExp(credential));assert.equal(result.usage,undefined);
});
