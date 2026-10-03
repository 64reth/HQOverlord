import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currencyCode, ids, money } from "@hqoverlord/core";
import { correlationId, eventId } from "@hqoverlord/events";
import { DurableRuntime, FileDurableStore, FakeModelProvider, ToolRegistry, emptyDurableState, commandId,
  nanoUsd, priceMeteredUsage, maximumMeteredCost, usdCentsToNanoUsd, nanoUsdToCentsCeiling, formatNanoUsd,
  modelMeteredTotals, modelAccountTotals, encodeDurableState, decodeDurableState,
  type MeteredPricing, type DurableState, type DurableStore, type ModelExecutionOptions, type ModelResult } from "../src/index.ts";

const currency = currencyCode("USD"), businessId = ids.business("metered-business"), otherBusinessId = ids.business("other"), toolId = ids.tool("local");
const now = "2026-10-02T12:00:00.000Z";
const pricing: MeteredPricing = { version: 1, currency: "USD", unit: "nanodollar", provider: "fake", model: "worker",
  tokensPerBlock: 1_000_000n, inputNanodollars: 100_000_000n, outputNanodollars: 500_000_000n, cachedInputNanodollars: 100_000_000n };
const options: ModelExecutionOptions = { model: "worker", maxInputTokens: 500, maxOutputTokens: 100, budget: money(1n, currency), meteredPricing: pricing };
const usage = (inputTokens: number, outputTokens: number, cachedInputTokens = 0) => ({ provider: "fake", model: "worker", inputTokens, outputTokens, cachedInputTokens });
const result = (inputTokens: number, outputTokens: number, tool = false): ModelResult => ({ usage: usage(inputTokens, outputTokens),
  decision: tool ? { kind: "tool", toolId, input: {} } : { kind: "complete", output: "done" } });
const context = (label: string, business = businessId) => ({ commandId: commandId(label), businessId: business,
  principal: { kind: "human" as const, id: "owner" }, correlationId: correlationId(label) });
let sequence = 0;
const environment = { agent: () => ids.agent(`agent-${++sequence}`), job: () => ids.job(`job-${++sequence}`), event: () => eventId(`event-${++sequence}`) };
const clock = { now: () => now };
const seed = (): DurableState => ({ ...emptyDurableState(), authority: { businesses: [businessId, otherBusinessId].map(id => ({ id, name: id, status: "active", createdAt: now, updatedAt: now })), agents: [], jobs: [] } });
class Store implements DurableStore {
  state = seed(); fail = false;
  async load() { return structuredClone(this.state); }
  async save(state: DurableState) { if (this.fail) throw new Error("disk failure"); this.state = structuredClone(state); }
}
async function setup(store: DurableStore = new Store(), consequential = false) {
  const runtime = await DurableRuntime.open(store, clock, environment);
  const agent = (await runtime.createAgent(context("agent"), { name: "Generic worker", toolIds: [toolId] })).record;
  const job = (await runtime.createJob(context("job"), { agentId: agent.id, objective: "Generic work" })).record;
  const tools = new ToolRegistry(); let calls = 0;
  tools.register({ definition: { id: toolId, name: "Local", description: "Local", effect: consequential ? "consequential" : "read_only" }, async execute() { calls++; return { output: "observation" }; } });
  return { runtime, job, tools, store, calls: () => calls };
}

test("previous live usage costs 63300 nanodollars, not two cents", () => {
  assert.deepEqual(priceMeteredUsage(usage(448, 37), pricing), nanoUsd(63_300n));
  assert.equal(formatNanoUsd(nanoUsd(63_300n)), "$0.000063300 USD");
  assert.equal(priceMeteredUsage(usage(202, 25), pricing)!.nanodollars + priceMeteredUsage(usage(246, 12), pricing)!.nanodollars, 63_300n);
});
test("tiny usage, cached input and zero usage retain exact integer costs", () => {
  assert.equal(priceMeteredUsage(usage(1, 1), pricing)!.nanodollars, 600n);
  assert.deepEqual(priceMeteredUsage(usage(0, 0), pricing), nanoUsd(0n));
  assert.equal(priceMeteredUsage(usage(10, 1, 5), { ...pricing, cachedInputNanodollars: 50_000_000n })!.nanodollars, 1_250n);
  assert.equal(priceMeteredUsage(usage(1, 0), { ...pricing, tokensPerBlock: 1n, inputNanodollars: 900719925474099312345n })!.nanodollars, 900719925474099312345n);
  assert.throws(() => nanoUsd(1 as unknown as bigint), TypeError);
  assert.throws(() => priceMeteredUsage(usage(0.5, 0), pricing), TypeError);
});
test("conversions are explicit, integer and currency safe", () => {
  assert.deepEqual(usdCentsToNanoUsd(money(100n, currency)), nanoUsd(1_000_000_000n));
  assert.deepEqual(nanoUsdToCentsCeiling(nanoUsd(63_300n)), money(1n, currency));
  assert.equal(nanoUsdToCentsCeiling(nanoUsd(10_000_000n)).minorUnits, 1n);
  assert.equal(nanoUsdToCentsCeiling(nanoUsd(0n)).minorUnits, 0n);
  assert.throws(() => usdCentsToNanoUsd(money(500n, currencyCode("GBP"))), /without FX/);
  assert.equal(maximumMeteredCost("fake", "worker", 10, 10, { ...pricing, cachedInputNanodollars: 600_000_000n })!.nanodollars, 11_000n);
});

test("cache creation is separately priced and conservatively reserved; an absent creation rate remains unknown",()=>{
  const reported={...usage(10,2,3),cacheCreationInputTokens:4};
  assert.equal(priceMeteredUsage(reported,pricing),undefined);
  const priced={...pricing,cacheCreationInputNanodollars:200_000_000n,cachedInputNanodollars:50_000_000n};
  assert.equal(priceMeteredUsage(reported,priced)!.nanodollars,2250n);
  assert.equal(maximumMeteredCost('fake','worker',10,2,priced)!.nanodollars,3000n);
});
test("multiple tiny calls accumulate as separate truthful scaled expenses without legacy cent charges", async () => {
  const s = await setup(), provider = new FakeModelProvider([result(1, 1, true), result(1, 1)]);
  assert.equal((await s.runtime.executeModelJob(context("run"), s.job.id, provider, s.tools, options)).status, "completed");
  assert.deepEqual(modelMeteredTotals(s.runtime.inspectModelAccount(context("read"), s.job.id)!), { spentNanodollars: 1200n, reservedNanodollars: 0n });
  assert.deepEqual(s.runtime.inspectLedger(context("read"), s.job.id), []);
  const entries = s.runtime.inspectMeteredExpenses(context("read"), s.job.id);
  assert.equal(entries.length, 2);
  assert.ok(entries.every(e => e.cost.unit === "nanodollar" && e.cost.version === 1 && e.cost.nanodollars === 600n));
  assert.throws(() => modelAccountTotals(s.runtime.inspectModelAccount(context("read"), s.job.id)!), /nanodollar/);
  const facts = s.runtime.snapshot().facts.filter(f => f.type === "model.expense_recorded.v1");
  assert.equal(facts.length, 2);
  assert.ok(facts.every(f => f.businessId === businessId && f.producer === "hq.runtime" && f.actor.id === "owner"));
});

test('an unavailable provider decision still records its actual reported expense instead of losing usage during transcript serialization',async()=>{
  const s=await setup(),provider={name:'fake',async invoke(){return {usage:usage(12,3)} as ModelResult;}};
  assert.equal((await s.runtime.executeModelJob(context('malformed-paid-result'),s.job.id,provider,s.tools,options)).status,'failed');
  assert.equal(s.runtime.inspectMeteredExpenses(context('malformed-expense'),s.job.id)[0]!.cost.nanodollars,2700n);
  assert.equal(s.runtime.inspectModelAccount(context('malformed-account'),s.job.id)!.invocations[0]!.status,'settled');
});
test("zero usage creates a genuine zero expense rather than charging the reservation", async () => {
  const s = await setup();
  await s.runtime.executeModelJob(context("run"), s.job.id, new FakeModelProvider([result(0, 0)]), s.tools, options);
  assert.equal(s.runtime.inspectMeteredExpenses(context("read"), s.job.id)[0]!.cost.nanodollars, 0n);
});
test("exact hard budget boundary admits once and denies the next generation without overspend", async () => {
  const s = await setup(), provider = new FakeModelProvider([result(10, 10, true), result(1, 1)]);
  const boundaryPricing: MeteredPricing = { ...pricing, tokensPerBlock: 1n, inputNanodollars: 900_000n, outputNanodollars: 100_000n, cachedInputNanodollars: 900_000n };
  const outcome = await s.runtime.executeModelJob(context("run"), s.job.id, provider, s.tools,
    { ...options, maxInputTokens: 10, maxOutputTokens: 10, meteredPricing: boundaryPricing });
  assert.equal(outcome.error?.code, "MODEL_BUDGET_DENIED");
  assert.equal(provider.requests.length, 1); assert.equal(s.calls(), 1);
  assert.equal(modelMeteredTotals(s.runtime.inspectModelAccount(context("read"), s.job.id)!).spentNanodollars, 10_000_000n);
});
test("zero budget denial prevents dispatch, and mixed accounting or GBP budgets fail closed", async () => {
  for (const opt of [
    { ...options, budget: money(0n, currency) },
    { ...options, budget: money(500n, currencyCode("GBP")) },
    { ...options, pricing: { provider: "fake", model: "worker", currency, tokensPerBlock: 1n, inputMinorUnits: 1n, outputMinorUnits: 1n } },
  ]) {
    const s = await setup(), provider = new FakeModelProvider([result(1, 1)]);
    assert.equal((await s.runtime.executeModelJob(context("run"), s.job.id, provider, s.tools, opt)).status, "failed");
    assert.equal(provider.requests.length, 0);
  }
});
test("missing usage retains the fine reservation and invents no metered expense", async () => {
  const s = await setup();
  const outcome = await s.runtime.executeModelJob(context("run"), s.job.id, new FakeModelProvider([{ decision: { kind: "complete", output: "unknown" } }]), s.tools, options);
  assert.equal(outcome.error?.code, "MODEL_USAGE_UNKNOWN");
  assert.deepEqual(s.runtime.inspectMeteredExpenses(context("read"), s.job.id), []);
  assert.equal(modelMeteredTotals(s.runtime.inspectModelAccount(context("read"), s.job.id)!).reservedNanodollars, 100_000n);
});
test("metered expense reads and commands retain business isolation", async () => {
  const s = await setup();
  await s.runtime.executeModelJob(context("run"), s.job.id, new FakeModelProvider([result(1, 1)]), s.tools, options);
  assert.throws(() => s.runtime.inspectMeteredExpenses(context("foreign", otherBusinessId), s.job.id), { code: "BUSINESS_SCOPE_VIOLATION" });
  await assert.rejects(s.runtime.executeModelJob(context("foreign", otherBusinessId), s.job.id, new FakeModelProvider([]), s.tools, options), { code: "BUSINESS_SCOPE_VIOLATION" });
});
test("scaled accounting survives file restart and terminal replay without duplicate expenses", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hq-metered-"));
  try {
    const path = join(directory, "state.json"), store = new FileDurableStore(path);
    await store.save(seed());
    const s = await setup(store), provider = new FakeModelProvider([result(202, 25, true), result(246, 12)]);
    await s.runtime.executeModelJob(context("run"), s.job.id, provider, s.tools, options);
    const reopened = await DurableRuntime.open(new FileDurableStore(path), clock, environment);
    assert.deepEqual(reopened.snapshot(), s.runtime.snapshot());
    await reopened.executeModelJob(context("run"), s.job.id, provider, s.tools, options);
    assert.equal(provider.requests.length, 2);
    assert.equal(modelMeteredTotals(reopened.inspectModelAccount(context("read"), s.job.id)!).spentNanodollars, 63_300n);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("legacy cent-denominated snapshots retain their values and historical ledger facts", async () => {
  const s = await setup();
  await s.runtime.executeModelJob(context("run"), s.job.id, new FakeModelProvider([result(1, 1)]), s.tools,
    { model: "worker", maxInputTokens: 10, maxOutputTokens: 10, budget: money(100n, currency),
      pricing: { provider: "fake", model: "worker", currency, tokensPerBlock: 1n, inputMinorUnits: 1n, outputMinorUnits: 1n } });
  const old = decodeDurableState(encodeDurableState(s.runtime.snapshot()));
  const store = new Store(); store.state = old;
  const reopened = await DurableRuntime.open(store, clock, environment);
  assert.deepEqual(reopened.snapshot(), old);
  assert.equal(reopened.inspectLedger(context("read"), s.job.id)[0]!.amount.minorUnits, 2n);
  assert.deepEqual(reopened.inspectMeteredExpenses(context("read"), s.job.id), []);
  assert.ok(old.facts.some(f => f.type === "ledger.entry_recorded"));
});
test("consequential approval still pauses before dispatch with metered usage already saved", async () => {
  const s = await setup(new Store(), true), provider = new FakeModelProvider([result(1, 1, true), result(1, 1)]);
  assert.equal((await s.runtime.executeModelJob(context("run"), s.job.id, provider, s.tools, options)).status, "waiting_for_approval");
  assert.equal(s.calls(), 0);
  assert.equal(s.runtime.inspectMeteredExpenses(context("read"), s.job.id).length, 1);
  await s.runtime.approveOperation(context("approve"), s.runtime.snapshot().approvals![0]!.id);
  assert.equal((await s.runtime.executeModelJob(context("resume"), s.job.id, provider, s.tools, options)).status, "completed");
  assert.equal(s.calls(), 1);
});
test("failed fine-accounting persistence publishes no expense and forbids generation replay", async () => {
  const store = new Store(), s = await setup(store);
  const provider = { name: "fake", async invoke() { store.fail = true; return result(1, 1); } };
  await assert.rejects(s.runtime.executeModelJob(context("run"), s.job.id, provider, s.tools, options), /persistence failed/);
  assert.deepEqual(s.runtime.inspectMeteredExpenses(context("read"), s.job.id), []);
  assert.equal(s.runtime.snapshot().facts.some(f => f.type === "model.expense_recorded.v1"), false);
  store.fail = false;
  await assert.rejects(s.runtime.executeModelJob(context("retry"), s.job.id, provider, s.tools, options), /cannot be replayed safely/);
});
test("restore rejects rescaled, altered, duplicate and cross-business metered records", async () => {
  const s = await setup();
  await s.runtime.executeModelJob(context("run"), s.job.id, new FakeModelProvider([result(1, 1)]), s.tools, options);
  const original = s.runtime.snapshot(), entry = original.meteredExpenses![0]!;
  for (const state of [
    { ...original, meteredExpenses: [{ ...entry, businessId: otherBusinessId }] },
    { ...original, meteredExpenses: [{ ...entry, cost: nanoUsd(1n) }] },
    { ...original, meteredExpenses: [entry, entry] },
    { ...original, facts: original.facts.filter(f => f.type !== "model.expense_recorded.v1") },
    { ...original, meteredExpenses: [{ ...entry, cost: { ...entry.cost, unit: "cent" } }] },
  ]) {
    const store = new Store(); store.state = state as DurableState;
    await assert.rejects(DurableRuntime.open(store, clock, environment), { code: "INVALID_STATE" });
  }
});
