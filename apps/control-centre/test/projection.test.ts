import assert from "node:assert/strict";
import test from "node:test";
import { ids } from "@hqoverlord/core";
import { eventId, correlationId } from "@hqoverlord/events";
import { emptyDurableState, commandId, DurableRuntime, ToolRegistry, type DurableState } from "@hqoverlord/runtime";
import { projectBusiness, wireJson } from "../src/projection.ts";

const businessId = ids.business("projection-business"), foreign = ids.business("foreign"), now = "2026-10-02T12:00:00Z";
const context = (id: string) => ({ commandId: commandId(id), businessId, principal: { kind: "human" as const, id: "owner" }, correlationId: correlationId(id) });
async function setup() {
  let state: DurableState = { ...emptyDurableState(), authority: { businesses: [businessId, foreign].map(id => ({ id, name: id, status: "active", createdAt: now, updatedAt: now })), agents: [], jobs: [] } }, n = 0;
  const runtime = await DurableRuntime.open({ async load() { return state; }, async save(s) { state = structuredClone(s); } }, { now: () => now }, { agent: () => ids.agent(`a${++n}`), job: () => ids.job(`j${++n}`), event: () => eventId(`e${++n}`) });
  return runtime;
}
test("initial hydration projects idle agents and queued jobs without invented work or spend", async () => {
  const runtime = await setup(), agent = (await runtime.createAgent(context("agent"), { name: "Worker" })).record;
  assert.equal(projectBusiness(runtime.snapshot(), businessId).agents[0]!.visualState, "idle");
  await runtime.createJob(context("job"), { agentId: agent.id, objective: "Await evidence" });
  const projection = projectBusiness(runtime.snapshot(), businessId);
  assert.equal(projection.agents[0]!.visualState, "queued"); assert.equal(projection.summary.running, 0); assert.equal(projection.expenses.length, 0);
  assert.equal(projectBusiness(runtime.snapshot(), foreign).agents.length, 0); assert.equal(projectBusiness(runtime.snapshot(), foreign).activity.length, 0);
});
test("working and tool-use require live backend ownership; restored running state is interrupted", async () => {
  const runtime = await setup(), toolId = ids.tool("read");
  const agent = (await runtime.createAgent(context("agent"), { name: "Worker", toolIds: [toolId] })).record;
  const job = (await runtime.createJob(context("job"), { objective: "work", agentId: agent.id })).record;
  const tools = new ToolRegistry();
  tools.register({ definition: { id: toolId, name: "read", description: "read", effect: "read_only" }, async execute() {
    const live = projectBusiness(runtime.snapshot(), businessId, new Set([job.id])); assert.equal(live.agents[0]!.visualState, "tool-use");
    assert.equal(projectBusiness(runtime.snapshot(), businessId).jobs[0]!.visualState, "interrupted"); return { output: "evidence" };
  } });
  await runtime.executeJob(context("run"), job.id, { async next(turn) {
    if (!turn.observations.length) { assert.equal(projectBusiness(runtime.snapshot(), businessId, new Set([job.id])).agents[0]!.visualState, "working"); return { kind: "tool", toolId, input: {} }; }
    return { kind: "complete", output: "actual" };
  } }, tools);
  const completed = projectBusiness(runtime.snapshot(), businessId); assert.equal(completed.agents[0]!.visualState, "completed"); assert.equal(completed.jobs[0]!.outputs.length, 1);
});
test("approval projection uses exact persisted pending/granted/rejected state and cancellation", async () => {
  const runtime = await setup(), toolId = ids.tool("release");
  const agent = (await runtime.createAgent(context("agent"), { name: "Worker", toolIds: [toolId] })).record;
  const job = (await runtime.createJob(context("job"), { objective: "release", agentId: agent.id })).record;
  const tools = new ToolRegistry(); tools.register({ definition: { id: toolId, name: "release", description: "release", effect: "consequential" }, async execute() { throw new Error("not before approval"); } });
  await runtime.executeJob(context("run"), job.id, { async next() { return { kind: "tool", toolId, input: { artifactId: "exact" } }; } }, tools);
  const pending = projectBusiness(runtime.snapshot(), businessId); assert.equal(pending.agents[0]!.visualState, "waiting-for-approval"); assert.equal(pending.summary.pendingApprovals, 1);
  await runtime.approveOperation(context("approve"), pending.approvals[0]!.id);
  assert.equal(projectBusiness(runtime.snapshot(), businessId).approvals[0]!.status, "approved");
  await runtime.cancelJob(context("cancel"), job.id); assert.equal(projectBusiness(runtime.snapshot(), businessId).agents[0]!.visualState, "cancelled");
});
test("ledger projection retains exact recorded money and does not invent revenue or convert nanodollars", async () => {
  const runtime = await setup(), state = runtime.snapshot();
  const entry = { id: ids.ledgerEntry("real"), businessId, kind: "expense" as const, amount: { currency: "GBP" as ReturnType<typeof import('@hqoverlord/core').currencyCode>, minorUnits: 999999999999999999n }, description: "real", occurredAt: now };
  const projection = projectBusiness({ ...state, ledger: [entry] }, businessId);
  assert.equal(projection.ledger[0]!.amount.minorUnits, 999999999999999999n); assert.match(wireJson(projection), /999999999999999999/); assert.equal(projectBusiness({ ...state, ledger: [entry] }, foreign).ledger.length, 0);
});
test("frontend disconnect marks visual activity unknown; reconnect rehydrates without fabricated events", async () => {
  // Import the actual browser transport-state module, not a duplicate test reducer.
  // @ts-expect-error Plain browser JS intentionally has no emitted TypeScript declarations.
  const { initialView, hydrate, disconnected, visualState } = await import("../public/client-state.js");
  const runtime = await setup(), snapshot = projectBusiness(runtime.snapshot(), businessId);
  const live = hydrate(initialView(), snapshot, 42), stale = disconnected(live);
  assert.equal(stale.snapshot, snapshot); assert.equal(visualState({ visualState: "working" }, stale.connection), "unknown");
  const restored = hydrate(stale, snapshot, 43); assert.equal(restored.connection, "connected"); assert.equal(restored.snapshot.activity.length, 0);
});
