import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { ids } from "@hqoverlord/core";
import { correlationId, eventId } from "@hqoverlord/events";
import { AuthorityStore, DurableRuntime, FakeModelProvider, ToolRegistry, commandId, emptyDurableState,
  modelMeteredTotals, type DurableState, type DurableStore } from "@hqoverlord/runtime";
import { businessId, manifest, workers, jobModelOptions } from "../manifest.ts";
import { loadBusiness001 } from "../load.ts";

const now = "2026-10-02T12:00:00.000Z", clock = { now: () => now };
let sequence = 0;
const environment = { agent: () => ids.agent(`agent-${++sequence}`), job: () => ids.job(`job-${++sequence}`), event: () => eventId(`event-${++sequence}`) };
class Store implements DurableStore {
  state = emptyDurableState(); fail = false;
  async load() { return structuredClone(this.state); }
  async save(state: DurableState) { if (this.fail) throw new Error("disk failure"); this.state = structuredClone(state); }
}
const context = (label: string, business = businessId) => ({ commandId: commandId(label), businessId: business,
  principal: { kind: "human" as const, id: "owner" }, correlationId: correlationId(label) });
const fakeOptions = () => jobModelOptions({ pricing: { ...jobModelOptions().meteredPricing!, provider: "fake" } });

test("separate Business 001 configuration loads five generic agents without a development objective", async () => {
  const store = new Store(), loaded = await loadBusiness001(store, clock, environment);
  const state = loaded.runtime.snapshot();
  assert.equal(state.authority.businesses[0]!.name, "Business 001");
  assert.equal(loaded.agents.length, 5);
  assert.deepEqual(loaded.agents.map(a => a.record.name), ["Prospect Research", "Knowledge Builder", "Assistant Builder", "QA", "Delivery"]);
  assert.ok(loaded.agents.every(a => a.record.businessId === businessId && a.record.toolIds.length === 0 && !Object.hasOwn(a.record, "model")));
  assert.equal(state.authority.jobs.length, 0);
  assert.equal(loaded.workflow.name, "Website assistant preparation");
  assert.doesNotMatch(JSON.stringify(loaded.manifest, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value), /\u00a310|2026-10-04|First.*Customer/);
  assert.equal(state.facts.some(f => f.type === "ledger.entry_recorded" || f.type === "model.expense_recorded.v1"), false);
});
test("bootstrap is idempotent after reopen and preserves unrelated businesses", async () => {
  const store = new Store(), foreign = ids.business("foreign");
  store.state = { ...store.state, authority: { ...store.state.authority, businesses: [{ id: foreign, name: "Foreign", status: "active", createdAt: now, updatedAt: now }] } };
  const first = await loadBusiness001(store, clock, environment), before = first.runtime.snapshot();
  const second = await loadBusiness001(store, clock, environment);
  assert.deepEqual(second.runtime.snapshot(), before);
  assert.deepEqual(second.agents, first.agents);
  assert.equal(second.runtime.snapshot().authority.businesses.length, 2);
  assert.throws(() => new AuthorityStore(before.authority).requireAgent(context("intruder", foreign), first.agents[0]!.record.id), { code: "BUSINESS_SCOPE_VIOLATION" });
});
test("business configuration has no goal/deadline/price target and external steps remain manual", () => {
  assert.equal(Object.hasOwn(manifest, "mission"), false);
  assert.equal(Object.hasOwn(manifest, "offer"), false);
  assert.equal(manifest.steps.find(s => s.id === "contact-delivery")!.mode, "manual-human-handoff");
  assert.equal(manifest.steps.find(s => s.id === "payment-confirmation")!.mode, "manual-human-payment-evidence");
  assert.equal(manifest.steps.find(s => s.id === "revenue-ledger")!.mode, "manual-human-ledger-handoff-not-implemented");
  assert.ok(manifest.authority.humanApprovalRequired.includes("purchases"));
});
test("GBP allocation and user-stated funding are not USD conversion or provider telemetry", () => {
  assert.deepEqual(manifest.budgets.internalAllocation.amount, { minorUnits: 500n, currency: "GBP" });
  assert.equal(manifest.budgets.internalAllocation.status, "configuration-only-no-cross-currency-aggregate-enforcement");
  assert.deepEqual(manifest.budgets.fundingContext.amount, { minorUnits: 2000n, currency: "GBP" });
  assert.equal(manifest.budgets.fundingContext.providerTelemetry, false);
  assert.equal(jobModelOptions().budget!.currency, "USD");
});
test("per-job model routing changes without redefining agents and requires matching pricing", () => {
  const original = structuredClone(workers);
  const options = jobModelOptions({ model: "different-worker", pricing: { ...jobModelOptions().meteredPricing!, model: "different-worker" } });
  assert.equal(options.model, "different-worker");
  assert.deepEqual(workers, original);
  assert.throws(() => jobModelOptions({ model: "different-worker" }), /explicit matching pricing/);
});
test("fake service draft runs through admitted HQ spending without creating a customer or revenue", async () => {
  const loaded = await loadBusiness001(new Store(), clock, environment);
  const firstJob = (await loaded.runtime.createJob(context("supplied-job"), { objective: "Analyse supplied sources", agentId: loaded.agents[0]!.record.id })).record;
  const provider = new FakeModelProvider([{ decision: { kind: "complete", output: "Await supplied sources; no customer claimed" },
    usage: { provider: "fake", model: "gpt-6-luna", inputTokens: 3, outputTokens: 1 } }]);
  const result = await loaded.runtime.executeModelJob(context("draft"), firstJob.id, provider, new ToolRegistry(), fakeOptions());
  assert.equal(result.status, "completed");
  assert.equal(modelMeteredTotals(loaded.runtime.inspectModelAccount(context("read"), firstJob.id)!).spentNanodollars, 800n);
  assert.deepEqual(loaded.runtime.inspectLedger(context("read"), firstJob.id), []);
  assert.equal(provider.requests[0]!.tools.length, 0);
});
test("configured workers cannot contact/publish through an unpermitted consequential tool", async () => {
  const loaded = await loadBusiness001(new Store(), clock, environment), tools = new ToolRegistry(), toolId = ids.tool("external-contact");
  const firstJob = (await loaded.runtime.createJob(context("supplied-job"), { objective: "Analyse supplied sources", agentId: loaded.agents[0]!.record.id })).record;
  let calls = 0;
  tools.register({ definition: { id: toolId, name: "External", description: "Consequential", effect: "consequential" }, async execute() { calls++; return { output: null }; } });
  const provider = new FakeModelProvider([{ decision: { kind: "tool", toolId, input: {} }, usage: { provider: "fake", model: "gpt-6-luna", inputTokens: 1, outputTokens: 1 } }]);
  const outcome = await loaded.runtime.executeModelJob(context("unauthorized"), firstJob.id, provider, tools, fakeOptions());
  assert.equal(outcome.error?.code, "BUSINESS_SCOPE_VIOLATION");
  assert.equal(calls, 0);
});
test("failed bootstrap persistence creates no authoritative business or workforce", async () => {
  const store = new Store(); store.fail = true;
  await assert.rejects(loadBusiness001(store, clock, environment), /disk failure/);
  assert.deepEqual(store.state, emptyDurableState());
});
test("generic packages neither import Business 001 nor contain its product concepts", async () => {
  const packages = fileURLToPath(new URL("../../../packages/", import.meta.url));
  async function inspect(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = join(path, entry.name);
      if (entry.isDirectory()) await inspect(name);
      else if (entry.name.endsWith(".ts")) assert.doesNotMatch(await readFile(name, "utf8"), /businesses\/business-001|business-001|Website AI Assistant/);
    }
  }
  await inspect(packages);
  assert.equal(typeof DurableRuntime.open, "function");
});
