import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currencyCode, ids, money, type ToolEffect } from "@hqoverlord/core";
import { correlationId, eventId } from "@hqoverlord/events";
import {
  DurableRuntime, FileDurableStore, FakeModelProvider, ModelDrivenAgentDriver, ExecutionEngine,
  ToolRegistry, commandId, emptyDurableState, encodeDurableState, decodeDurableState,
  priceModelUsage, maximumModelCost, modelAccountTotals, commandFingerprint,
  type CommandContext, type DurableState, type DurableStore, type ModelExecutionOptions,
  type ModelProvider, type ModelResult, type ModelUsage, type ModelPricing, type RuntimeIds,
} from "../src/index.ts";

const now = "2026-10-02T12:00:00.000Z";
const business = ids.business("model-business"), other = ids.business("other-business"), toolId = ids.tool("tool");
const currency = currencyCode("GBP");
const pricing: ModelPricing = { provider: "fake", model: "test-model", currency, tokensPerBlock: 1n,
  inputMinorUnits: 2n, outputMinorUnits: 3n, cachedInputMinorUnits: 1n };
const options: ModelExecutionOptions = { model: "test-model", maxInputTokens: 10, maxOutputTokens: 10, pricing, budget: money(100n, currency) };
const ctx = (id: string, businessId = business): CommandContext => ({ commandId: commandId(id), businessId,
  principal: { kind: "human", id: "trusted-owner" }, correlationId: correlationId(`corr-${id}`) });
const usage = (inputTokens = 2, outputTokens = 1): ModelUsage => ({ provider: "fake", model: "test-model", inputTokens, outputTokens });
const complete = (u: ModelUsage | undefined = usage()): ModelResult => ({ decision: { kind: "complete", output: "done" }, ...(u ? { usage: u } : {}) });
const call = (id = toolId): ModelResult => ({ decision: { kind: "tool", toolId: id, input: { query: "exact-input" } }, usage: usage() });
let sequence = 0;
const environment: RuntimeIds = { agent: () => ids.agent(`agent-${++sequence}`), job: () => ids.job(`job-${++sequence}`), event: () => eventId(`event-${++sequence}`) };
const clock = { now: () => now };
function seed(): DurableState {
  return { ...emptyDurableState(), authority: { businesses: [business, other].map(id => ({ id, name: id, status: "active", createdAt: now, updatedAt: now })), agents: [], jobs: [] } };
}
class MemoryStore implements DurableStore {
  state = seed();
  saves = 0;
  failAt = Infinity;
  async load() { return structuredClone(this.state); }
  async save(state: DurableState) {
    this.saves += 1;
    if (this.saves >= this.failAt) throw new Error("disk unavailable");
    this.state = structuredClone(state);
  }
}
async function setup(effect: ToolEffect = "read_only", store: DurableStore = new MemoryStore()) {
  const runtime = await DurableRuntime.open(store, clock, environment);
  const agent = (await runtime.createAgent(ctx("agent"), { name: "Generic worker", toolIds: [toolId], capabilities: ["analysis"] })).record;
  const job = (await runtime.createJob(ctx("job"), { objective: "Solve the generic objective", agentId: agent.id })).record;
  const tools = new ToolRegistry();
  let calls = 0;
  tools.register({ definition: { id: toolId, name: "Lookup", description: "Read a generic fact", effect },
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    async execute(input, context) {
      calls += 1; assert.equal(context.businessId, business);
      assert.deepEqual(input, { query: "exact-input" }); return { output: "observed fact" };
    } });
  return { runtime, agent, job, tools, store, toolCalls: () => calls };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("model-driven AgentDriver completes through the existing standalone boundary", async () => {
  const s = await setup();
  const provider = new FakeModelProvider([complete()]);
  const driver = new ModelDrivenAgentDriver(provider, s.tools, options);
  assert.deepEqual(await new ExecutionEngine(s.tools).execute(s.job, s.agent, driver), { status: "completed", output: "done" });
  const request = provider.requests[0]!;
  assert.match(request.input, /Solve the generic objective/);
  assert.match(request.input, /Generic worker/);
  assert.equal(request.tools[0]?.id, toolId);
  assert.ok(request.tools[0]?.inputSchema);
});

test("model tool decision receives its observation on the next turn and both calls are metered", async () => {
  const s = await setup(), provider = new FakeModelProvider([call(), complete()]);
  const result = await s.runtime.executeModelJob(ctx("execute"), s.job.id, provider, s.tools, options);
  assert.equal(result.status, "completed");
  assert.equal(s.toolCalls(), 1);
  assert.match(provider.requests[1]!.input, /observed fact/);
  assert.equal(s.runtime.inspectLedger(ctx("read"), s.job.id).length, 2);
  assert.deepEqual(modelAccountTotals(s.runtime.inspectModelAccount(ctx("read"), s.job.id)!), { spent: 14n, reserved: 0n });
});

test("model output cannot bypass tool permissions even for a registered tool", async () => {
  const s = await setup(), forbidden = ids.tool("forbidden");
  let calls = 0;
  s.tools.register({ definition: { id: forbidden, name: "Forbidden", description: "Forbidden", effect: "read_only" }, async execute() { calls++; return { output: null }; } });
  const provider = new FakeModelProvider([call(forbidden)]);
  const result = await s.runtime.executeModelJob(ctx("execute"), s.job.id, provider, s.tools, options);
  assert.equal(result.error?.code, "BUSINESS_SCOPE_VIOLATION");
  assert.equal(calls, 0);
  assert.equal(provider.requests[0]!.tools.some(t => t.id === forbidden), false);
  assert.equal(s.runtime.inspectLedger(ctx("read"), s.job.id).length, 1);
});

test("unknown model-requested tool is a controlled failure", async () => {
  const s = await setup();
  const result = await s.runtime.executeModelJob(ctx("execute"), s.job.id, new FakeModelProvider([call(ids.tool("unknown"))]), s.tools, options);
  assert.equal(result.status, "failed");
  assert.equal(s.toolCalls(), 0);
});

test("consequential model decision waits for host approval and resumes without another model dispatch for that call", async () => {
  const s = await setup("consequential"), provider = new FakeModelProvider([call(), complete()]);
  assert.equal((await s.runtime.executeModelJob(ctx("execute"), s.job.id, provider, s.tools, options)).status, "waiting_for_approval");
  assert.equal(s.toolCalls(), 0);
  const accountBefore = s.runtime.inspectModelAccount(ctx("read"), s.job.id)!;
  const approval = s.runtime.snapshot().approvals![0]!;
  const reopened = await DurableRuntime.open(s.store, clock, environment);
  assert.deepEqual(reopened.inspectModelAccount(ctx("read"), s.job.id), accountBefore);
  await reopened.approveOperation(ctx("approve"), approval.id);
  assert.equal((await reopened.executeModelJob(ctx("resume"), s.job.id, provider, s.tools, options)).status, "completed");
  assert.equal(provider.requests.length, 2);
  assert.equal(s.toolCalls(), 1);
  assert.match(provider.requests[1]!.input, /observed fact/);
  assert.equal(reopened.inspectLedger(ctx("read"), s.job.id).length, 2);
  await reopened.executeModelJob(ctx("resume"), s.job.id, provider, s.tools, options);
  assert.equal(provider.requests.length, 2);
});

test("fake provider returns detached normalized usage including optional cache and request identity", async () => {
  const u = { ...usage(), cachedInputTokens: 1, requestId: "fake-response" };
  const provider = new FakeModelProvider([complete(u)]);
  const result = await provider.invoke({ model: options.model, instructions: "generic", input: "test", tools: [], maxInputTokens: 10, maxOutputTokens: 10 });
  assert.deepEqual(result.usage, u);
  assert.notEqual(result.usage, u);
});

test("pricing uses exact bigint arithmetic with cache rates and rounds combined usage up once", () => {
  const p = { ...pricing, tokensPerBlock: 3n };
  assert.deepEqual(priceModelUsage({ ...usage(), cachedInputTokens: 1 }, p), money(2n, currency));
  const huge = 900719925474099312345n;
  assert.equal(priceModelUsage(usage(1, 0), { ...pricing, inputMinorUnits: huge })?.minorUnits, huge);
  assert.equal(priceModelUsage({ ...usage(), model: "unpriced" }, pricing), undefined);
  assert.throws(() => priceModelUsage({ ...usage(), inputTokens: 0.5 }, pricing), /Invalid model usage/);
  assert.throws(() => priceModelUsage(usage(), { ...pricing, tokensPerBlock: 0n }), /Invalid model pricing/);
  assert.equal(maximumModelCost("fake", "test-model", 10, 10, { ...pricing, cachedInputMinorUnits: 5n })?.minorUnits, 80n);
});

test("known usage creates a scoped expense and trusted additive usage/ledger facts", async () => {
  const s = await setup(), provider = new FakeModelProvider([complete()]), context = ctx("execute");
  await s.runtime.executeModelJob(context, s.job.id, provider, s.tools, options);
  const entry = s.runtime.inspectLedger(ctx("read"), s.job.id)[0]!;
  assert.equal(entry.businessId, business); assert.equal(entry.jobId, s.job.id);
  assert.equal(entry.kind, "expense"); assert.deepEqual(entry.amount, money(7n, currency));
  const state = s.runtime.snapshot();
  const facts = state.facts.filter(f => ["model.usage_recorded", "ledger.entry_recorded"].includes(f.type));
  assert.equal(facts.length, 2);
  for (const fact of facts) {
    assert.deepEqual(fact.actor, context.principal); assert.equal(fact.producer, "hq.runtime");
    assert.equal(fact.businessId, business); assert.equal(fact.correlationId, context.correlationId);
  }
  assert.equal(facts[1]!.causationId, facts[0]!.id);
  assert.deepEqual(decodeDurableState(encodeDurableState(state)), state);
});

test("hard budget admission denies before provider dispatch and invents no spend", async () => {
  const s = await setup(), provider = new FakeModelProvider([complete()]);
  const result = await s.runtime.executeModelJob(ctx("execute"), s.job.id, provider, s.tools, { ...options, budget: money(49n, currency) });
  assert.equal(result.error?.code, "MODEL_BUDGET_DENIED"); assert.equal(provider.requests.length, 0);
  assert.deepEqual(s.runtime.inspectLedger(ctx("read"), s.job.id), []);
  assert.equal(s.runtime.snapshot().facts.some(f => f.type === "model.usage_recorded"), false);
});

test("durable reservation precedes dispatch and reconciliation stops the next unaffordable turn", async () => {
  const s = await setup(), scripted = new FakeModelProvider([call(), complete()]);
  const provider: ModelProvider = { name: "fake", async invoke(request, signal) {
    const account = s.runtime.inspectModelAccount(ctx("read"), s.job.id)!;
    assert.deepEqual(modelAccountTotals(account), { spent: 0n, reserved: 50n });
    assert.equal((s.store as MemoryStore).state.modelAccounts![0]!.invocations[0]!.status, "reserved");
    return scripted.invoke(request, signal);
  } };
  const result = await s.runtime.executeModelJob(ctx("execute"), s.job.id, provider, s.tools, { ...options, budget: money(56n, currency) });
  assert.equal(result.error?.code, "MODEL_BUDGET_DENIED"); assert.equal(scripted.requests.length, 1);
  assert.equal(s.toolCalls(), 1);
  assert.deepEqual(modelAccountTotals(s.runtime.inspectModelAccount(ctx("read"), s.job.id)!), { spent: 7n, reserved: 0n });
});

test("hard budgets require known exact prices with matching currency", async () => {
  for (const configuration of [
    { ...options, pricing: { ...pricing, model: "different" } },
    { ...options, budget: money(100n, currencyCode("USD")) },
    { model: options.model, maxInputTokens: 10, maxOutputTokens: 10, budget: options.budget! },
  ]) {
    const s = await setup(), provider = new FakeModelProvider([complete()]);
    assert.equal((await s.runtime.executeModelJob(ctx("execute"), s.job.id, provider, s.tools, configuration)).error?.code, "MODEL_CONFIGURATION_INVALID");
    assert.equal(provider.requests.length, 0);
  }
});

test("business scope rejects foreign budget execution and ledger reads without mutating state", async () => {
  const s = await setup(), provider = new FakeModelProvider([complete()]);
  await s.runtime.executeModelJob(ctx("execute"), s.job.id, provider, s.tools, options);
  const before = s.runtime.snapshot();
  assert.throws(() => s.runtime.inspectModelAccount(ctx("intruder", other), s.job.id), { code: "BUSINESS_SCOPE_VIOLATION" });
  assert.throws(() => s.runtime.inspectLedger(ctx("intruder", other), s.job.id), { code: "BUSINESS_SCOPE_VIOLATION" });
  await assert.rejects(s.runtime.executeModelJob(ctx("intruder", other), s.job.id, provider, s.tools, options), { code: "BUSINESS_SCOPE_VIOLATION" });
  assert.deepEqual(s.runtime.snapshot(), before);
  const foreignAgent = (await s.runtime.createAgent(ctx("foreign-agent", other), { name: "Another worker" })).record;
  const foreignJob = (await s.runtime.createJob(ctx("foreign-job", other), { objective: "Other work", agentId: foreignAgent.id })).record;
  await s.runtime.executeModelJob(ctx("foreign-execute", other), foreignJob.id, new FakeModelProvider([complete()]), s.tools, options);
  assert.equal(s.runtime.inspectLedger(ctx("foreign-read", other), foreignJob.id)[0]!.businessId, other);
  assert.deepEqual(s.runtime.inspectModelAccount(ctx("read"), s.job.id), before.modelAccounts![0]);
});

test("thrown provider errors become controlled failures without leaking error text or inventing costs", async () => {
  const s = await setup();
  const provider: ModelProvider = { name: "fake", async invoke() { throw new Error("sensitive transport content"); } };
  const result = await s.runtime.executeModelJob(ctx("execute"), s.job.id, provider, s.tools, { model: "test-model", maxInputTokens: 10, maxOutputTokens: 10 });
  assert.equal(result.error?.code, "PROVIDER_FAILED");
  assert.doesNotMatch(encodeDurableState(s.runtime.snapshot()), /sensitive transport content/);
  assert.equal(s.runtime.inspectLedger(ctx("read"), s.job.id).length, 0);
});

test("malformed decisions fail after preserving billable usage", async () => {
  const s = await setup();
  const provider: ModelProvider = { name: "fake", async invoke() { return { decision: { kind: "unsupported" }, usage: usage() } as unknown as ModelResult; } };
  assert.equal((await s.runtime.executeModelJob(ctx("execute"), s.job.id, provider, s.tools, options)).error?.code, "MODEL_DECISION_INVALID");
  assert.equal(s.runtime.inspectLedger(ctx("read"), s.job.id)[0]!.amount.minorUnits, 7n);
});

test("failed provider result with valid usage is accounted without claiming job completion", async () => {
  const s = await setup();
  const provider = new FakeModelProvider([{ decision: { kind: "failure", code: "PROVIDER_FAILED" }, usage: usage() }]);
  assert.equal((await s.runtime.executeModelJob(ctx("execute"), s.job.id, provider, s.tools, options)).error?.code, "PROVIDER_FAILED");
  assert.equal(s.runtime.inspectLedger(ctx("read"), s.job.id).length, 1);
  assert.equal(s.runtime.snapshot().facts.some(f => f.type === "job.completed"), false);
});

test("missing usage retains reservation without fabricated tokens or cost, including after restart", async () => {
  const s = await setup(), provider = new FakeModelProvider([{ decision: { kind: "complete", output: "unmetered" } }]);
  assert.equal((await s.runtime.executeModelJob(ctx("execute"), s.job.id, provider, s.tools, options)).error?.code, "MODEL_USAGE_UNKNOWN");
  const account = s.runtime.inspectModelAccount(ctx("read"), s.job.id)!;
  assert.deepEqual(modelAccountTotals(account), { spent: 0n, reserved: 50n });
  assert.equal(account.invocations[0]!.usage, undefined);
  assert.equal(s.runtime.inspectLedger(ctx("read"), s.job.id).length, 0);
  assert.equal(s.runtime.snapshot().facts.some(f => f.type === "model.usage_recorded"), false);
  const reopened = await DurableRuntime.open(s.store, clock, environment);
  await reopened.executeModelJob(ctx("execute"), s.job.id, provider, s.tools, options);
  assert.equal(provider.requests.length, 1);
  assert.deepEqual(reopened.inspectModelAccount(ctx("read"), s.job.id), account);
});

test("known usage without a configured price remains usage, never guessed money", async () => {
  const s = await setup();
  await s.runtime.executeModelJob(ctx("execute"), s.job.id, new FakeModelProvider([complete()]), s.tools,
    { model: "test-model", maxInputTokens: 10, maxOutputTokens: 10 });
  assert.equal(s.runtime.inspectLedger(ctx("read"), s.job.id).length, 0);
  assert.deepEqual(s.runtime.inspectModelAccount(ctx("read"), s.job.id)!.invocations[0]!.usage, usage());
});

test("usage for an unpriced model preserves the reservation and refuses further budgeted decisions", async () => {
  const s = await setup(), provider = new FakeModelProvider([complete({ ...usage(), model: "unknown-model" })]);
  assert.equal((await s.runtime.executeModelJob(ctx("execute"), s.job.id, provider, s.tools, options)).error?.code, "MODEL_USAGE_UNKNOWN");
  assert.equal(s.runtime.inspectLedger(ctx("read"), s.job.id).length, 0);
  assert.equal(s.runtime.inspectModelAccount(ctx("read"), s.job.id)!.invocations[0]!.usage?.model, "unknown-model");
});

test("invalid token counts do not become authoritative telemetry or spend", async () => {
  for (const u of [{ ...usage(), inputTokens: -1 }, { ...usage(), cachedInputTokens: 3 }, { ...usage(), outputTokens: 0.5 }]) {
    const s = await setup();
    assert.equal((await s.runtime.executeModelJob(ctx("execute"), s.job.id, new FakeModelProvider([complete(u)]), s.tools, options)).error?.code, "MODEL_USAGE_UNKNOWN");
    assert.equal(s.runtime.inspectLedger(ctx("read"), s.job.id).length, 0);
  }
});

test("provider limit violation records actual spend and fails before any requested tool executes", async () => {
  const s = await setup();
  const provider: ModelProvider = { name: "fake", async invoke() { return { ...call(), usage: usage(20, 20) }; } };
  assert.equal((await s.runtime.executeModelJob(ctx("execute"), s.job.id, provider, s.tools, options)).error?.code, "MODEL_BUDGET_DENIED");
  assert.equal(s.runtime.inspectLedger(ctx("read"), s.job.id)[0]!.amount.minorUnits, 100n);
  assert.equal(s.toolCalls(), 0);
});

test("cancellation during a model call accounts its late usage but prevents all subsequent tools/turns", async () => {
  const s = await setup(), entered = deferred(), release = deferred();
  let calls = 0;
  const provider: ModelProvider = { name: "fake", async invoke(_request, signal) {
    calls++; entered.resolve(); await release.promise; assert.equal(signal?.aborted, true); return call();
  } };
  const run = s.runtime.executeModelJob(ctx("execute"), s.job.id, provider, s.tools, options);
  await entered.promise;
  await s.runtime.cancelJob(ctx("cancel"), s.job.id);
  release.resolve();
  assert.equal((await run).status, "cancelled"); assert.equal(calls, 1); assert.equal(s.toolCalls(), 0);
  assert.equal(s.runtime.inspectLedger(ctx("read"), s.job.id).length, 1);
  assert.equal(s.runtime.snapshot().facts.some(f => f.type === "job.completed"), false);
});

test("failed reservation persistence dispatches no provider and publishes no reservation/failure facts", async () => {
  const s = await setup(), provider = new FakeModelProvider([complete()]), store = s.store as MemoryStore;
  store.failAt = store.saves + 2;
  await assert.rejects(s.runtime.executeModelJob(ctx("execute"), s.job.id, provider, s.tools, options), /accounting persistence failed/);
  assert.equal(provider.requests.length, 0);
  assert.equal(s.runtime.snapshot().modelAccounts, undefined);
  assert.equal(s.runtime.snapshot().facts.at(-1)!.type, "job.started");
});

test("failed reconciliation persistence leaves a reserved interrupted call and never replays it", async () => {
  const s = await setup(), store = s.store as MemoryStore;
  let calls = 0;
  const provider: ModelProvider = { name: "fake", async invoke() { calls++; store.failAt = store.saves + 1; return complete(); } };
  await assert.rejects(s.runtime.executeModelJob(ctx("execute"), s.job.id, provider, s.tools, options), /accounting persistence failed/);
  const before = s.runtime.snapshot();
  assert.equal(before.modelAccounts![0]!.invocations[0]!.status, "reserved");
  assert.equal(before.ledger!.length, 0);
  assert.equal(before.facts.some(f => f.type === "model.usage_recorded" || f.type === "job.failed" || f.type === "job.completed"), false);
  store.failAt = Infinity;
  const reopened = await DurableRuntime.open(store, clock, environment);
  await assert.rejects(reopened.executeModelJob(ctx("execute"), s.job.id, provider, s.tools, options), /cannot be replayed safely/);
  assert.equal(calls, 1); assert.deepEqual(reopened.snapshot(), before);
});

test("file restart retains exact model expense and idempotent terminal result", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hq-model-"));
  try {
    const path = join(directory, "state.json"), store = new FileDurableStore(path);
    await store.save(seed());
    const s = await setup("read_only", store), provider = new FakeModelProvider([complete()]);
    await s.runtime.executeModelJob(ctx("execute"), s.job.id, provider, s.tools, options);
    const reopened = await DurableRuntime.open(new FileDurableStore(path), clock, environment);
    assert.deepEqual(reopened.snapshot(), s.runtime.snapshot());
    await reopened.executeModelJob(ctx("execute"), s.job.id, provider, s.tools, options);
    assert.equal(provider.requests.length, 1);
    assert.equal(reopened.inspectLedger(ctx("read"), s.job.id).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("restoration rejects cross-business or inconsistent model accounting", async () => {
  const s = await setup();
  await s.runtime.executeModelJob(ctx("execute"), s.job.id, new FakeModelProvider([complete()]), s.tools, options);
  const original = s.runtime.snapshot(), account = original.modelAccounts![0]!, call = account.invocations[0]!, entry = original.ledger![0]!;
  const invalid: DurableState[] = [
    { ...original, modelAccounts: [{ ...account, businessId: other }] },
    { ...original, ledger: [{ ...entry, businessId: other }] },
    { ...original, ledger: [{ ...entry, amount: money(8n, currency) }] },
    { ...original, modelAccounts: [{ ...account, invocations: [{ ...call, reservation: money(49n, currency) }] }] },
    { ...original, modelAccounts: [{ ...account, invocations: [call, call] }] },
    { ...original, modelAccounts: [{ ...account, invocations: [{ ...call, status: "reserved" }] }] },
    { ...original, facts: original.facts.filter(f => f.type !== "model.usage_recorded") },
  ];
  for (const state of invalid) {
    const store = new MemoryStore(); store.state = state;
    await assert.rejects(DurableRuntime.open(store, clock, environment), { code: "INVALID_STATE" });
  }
});

test("job policy cannot be increased or changed after an approval pause", async () => {
  const s = await setup("consequential"), provider = new FakeModelProvider([call(), complete()]);
  await s.runtime.executeModelJob(ctx("execute"), s.job.id, provider, s.tools, options);
  const before = s.runtime.snapshot();
  await assert.rejects(s.runtime.executeModelJob(ctx("resume"), s.job.id, provider, s.tools, { ...options, budget: money(1000n, currency) }), { code: "COMMAND_CONFLICT" });
  assert.deepEqual(s.runtime.snapshot(), before); assert.equal(provider.requests.length, 1);
});

test("concurrent model execution cannot duplicate reservations or dispatch", async () => {
  const s = await setup(), entered = deferred(), release = deferred();
  let calls = 0;
  const provider: ModelProvider = { name: "fake", async invoke() { calls++; entered.resolve(); await release.promise; return complete(); } };
  const run = s.runtime.executeModelJob(ctx("execute"), s.job.id, provider, s.tools, options);
  await entered.promise;
  await assert.rejects(s.runtime.executeModelJob(ctx("other-execute"), s.job.id, provider, s.tools, options), /already active/);
  release.resolve(); await run;
  assert.equal(calls, 1); assert.equal(s.runtime.inspectLedger(ctx("read"), s.job.id).length, 1);
});

test("accounting snapshots and exact-money policy fingerprints are detached and stable", async () => {
  const s = await setup();
  await s.runtime.executeModelJob(ctx("execute"), s.job.id, new FakeModelProvider([complete()]), s.tools, options);
  const ledger = s.runtime.inspectLedger(ctx("read"), s.job.id);
  (ledger[0]!.amount as { minorUnits: bigint }).minorUnits = 1000n;
  assert.equal(s.runtime.inspectLedger(ctx("read"), s.job.id)[0]!.amount.minorUnits, 7n);
  assert.equal(commandFingerprint({ a: 1n, b: 2 }), commandFingerprint({ b: 2, a: 1n }));
});
