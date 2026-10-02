import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ids, type ToolEffect } from "@hqoverlord/core";
import { correlationId, eventId } from "@hqoverlord/events";
import {
  DurableRuntime, FileDurableStore, ToolRegistry, ExecutionEngine, commandId,
  emptyDurableState, type AgentDriver, type CommandContext, type DurableState,
  type DurableStore, type RuntimeIds,
} from "../src/index.ts";

const now = "2026-10-02T12:00:00.000Z";
const businessId = ids.business("execution-business");
const otherBusinessId = ids.business("other-business");
const toolId = ids.tool("test-tool");
const context = (id: string, business = businessId): CommandContext => ({
  commandId: commandId(id), businessId: business,
  principal: { kind: "human", id: "trusted-owner" },
  correlationId: correlationId(`correlation-${id}`),
});
const clock = { now: () => now };
function environment(): RuntimeIds {
  let sequence = 0;
  return {
    agent: () => ids.agent(`agent-${++sequence}`),
    job: () => ids.job(`job-${++sequence}`),
    event: () => eventId(`event-${++sequence}`),
  };
}
function seed(): DurableState {
  return { ...emptyDurableState(), authority: {
    businesses: [businessId, otherBusinessId].map(id => ({ id, name: id, status: "active", createdAt: now, updatedAt: now })),
    agents: [], jobs: [],
  } };
}
class MemoryStore implements DurableStore {
  state = seed();
  fail = false;
  async load() { return structuredClone(this.state); }
  async save(state: DurableState) {
    if (this.fail) throw new Error("disk unavailable");
    this.state = structuredClone(state);
  }
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function setup(effect: ToolEffect = "read_only", store: DurableStore = new MemoryStore()) {
  const runtime = await DurableRuntime.open(store, clock, environment());
  const agent = (await runtime.createAgent(context("agent"), { name: "Worker", toolIds: [toolId] })).record;
  const job = (await runtime.createJob(context("job"), { objective: "Do work", agentId: agent.id })).record;
  const tools = new ToolRegistry();
  let calls = 0;
  const inputs: unknown[] = [];
  tools.register({
    definition: { id: toolId, name: "Tool", description: "Deterministic test tool", effect },
    async execute(input, ctx) {
      calls += 1;
      inputs.push(input);
      assert.equal(ctx.businessId, businessId);
      assert.ok(ctx.signal);
      return { output: "observed" };
    },
  });
  const driver: AgentDriver = { async next(ctx) {
    return ctx.observations.length === 0
      ? { kind: "tool", toolId, input: { destination: "exact-target", text: "original" } }
      : { kind: "complete", output: ctx.observations[0]?.result.output };
  } };
  return { runtime, agent, job, tools, driver, store, calls: () => calls, inputs };
}

test("queued job is durably running before its driver executes and completes with truthful facts", async () => {
  const s = await setup();
  const runContext = context("execute");
  const result = await s.runtime.executeJob(runContext, s.job.id, {
    async next(turn) {
      assert.equal(s.runtime.inspectJob(runContext, s.job.id).status, "running");
      assert.equal((s.store as MemoryStore).state.authority.jobs[0]?.status, "running");
      return s.driver.next(turn);
    },
  }, s.tools);
  assert.deepEqual(result, { status: "completed", output: "observed" });
  assert.equal(s.calls(), 1);
  assert.equal(s.runtime.inspectJob(runContext, s.job.id).status, "completed");
  const facts = s.runtime.snapshot().facts.slice(2);
  assert.deepEqual(facts.map(f => f.type), ["job.started", "tool.dispatched.v1", "tool.completed.v1", "job.completed", "artifact.created.v1"]);
  for (const fact of facts) {
    assert.deepEqual(fact.actor, runContext.principal);
    assert.equal(fact.producer, "hq.runtime");
    assert.equal(fact.businessId, businessId);
    assert.equal(fact.correlationId, runContext.correlationId);
  }
  assert.equal(facts[1]?.causationId, facts[0]?.id);
});

test("driver failure durably fails the job and emits job.failed", async () => {
  const s = await setup();
  const result = await s.runtime.executeJob(context("execute"), s.job.id, { async next() { throw new Error("driver failed"); } }, s.tools);
  assert.equal(result.status, "failed");
  assert.equal(s.runtime.inspectJob(context("read"), s.job.id).status, "failed");
  const fact = s.runtime.snapshot().facts.at(-1);
  assert.equal(fact?.type, "job.failed");
  if (fact?.type === "job.failed") assert.equal(fact.payload.error.message, "driver failed");
});

test("read-only permitted tools execute without approval", async () => {
  const s = await setup();
  await s.runtime.executeJob(context("execute"), s.job.id, s.driver, s.tools);
  assert.equal(s.calls(), 1);
  assert.deepEqual(s.runtime.snapshot().approvals, []);
});

test("consequential tool waits with durable exact-operation approval instead of completing", async () => {
  const s = await setup("consequential");
  const result = await s.runtime.executeJob(context("execute"), s.job.id, s.driver, s.tools);
  assert.equal(result.status, "waiting_for_approval");
  assert.equal(s.calls(), 0);
  const state = s.runtime.snapshot();
  assert.equal(state.authority.jobs[0]?.status, "running");
  assert.equal(state.executions?.[0]?.status, "waiting_for_approval");
  const approval = state.approvals?.[0];
  assert.ok(approval);
  assert.equal(approval.jobId, s.job.id);
  assert.equal(approval.operationId, state.executions?.[0]?.operation?.id);
  assert.deepEqual(approval.toolCall.input, { destination: "exact-target", text: "original" });
  assert.equal(state.facts.at(-1)?.type, "approval.requested");
  assert.deepEqual((s.store as MemoryStore).state, state);
  assert.equal(state.facts.some(f => f.type === "job.completed"), false);
});

test("approved operation resumes captured input once and retains its observation", async () => {
  const s = await setup("consequential");
  await s.runtime.executeJob(context("execute"), s.job.id, s.driver, s.tools);
  const approval = s.runtime.snapshot().approvals![0]!;
  const approver = { ...context("approve"), principal: { kind: "human" as const, id: "trusted-approver" } };
  await s.runtime.approveOperation(approver, approval.id);
  await s.runtime.approveOperation(approver, approval.id);
  assert.equal(s.calls(), 0);
  const result = await s.runtime.executeJob(context("resume"), s.job.id, { async next(turn) {
    assert.equal(turn.observations.length, 1);
    return { kind: "complete", output: "done" };
  } }, s.tools);
  assert.equal(result.status, "completed");
  assert.equal(s.calls(), 1);
  assert.deepEqual(s.inputs[0], approval.toolCall.input);
  const grant = s.runtime.snapshot().facts.find(f => f.type === "approval.granted");
  assert.deepEqual(grant?.actor, approver.principal);
  assert.equal(grant?.producer, "hq.runtime");
  assert.equal(s.runtime.snapshot().facts.filter(f => f.type === "approval.granted").length, 1);
  await s.runtime.executeJob(context("resume"), s.job.id, s.driver, s.tools);
  assert.equal(s.calls(), 1);
});

test("rejecting approval prevents tool execution and durably fails the job", async () => {
  const s = await setup("consequential");
  await s.runtime.executeJob(context("execute"), s.job.id, s.driver, s.tools);
  const approval = s.runtime.snapshot().approvals![0]!;
  await s.runtime.rejectOperation(context("reject"), approval.id, "Not permitted");
  await s.runtime.rejectOperation(context("reject"), approval.id, "Not permitted");
  assert.equal(s.runtime.inspectApproval(context("read"), approval.id).status, "rejected");
  assert.equal((await s.runtime.executeJob(context("resume"), s.job.id, s.driver, s.tools)).status, "failed");
  assert.equal(s.calls(), 0);
  assert.deepEqual(s.runtime.snapshot().facts.slice(-2).map(f => f.type), ["approval.rejected", "job.failed"]);
  await assert.rejects(s.runtime.approveOperation(context("late-approve"), approval.id), /no longer pending/);
});

test("cross-business execution, approval, rejection, cancellation and inspection are rejected", async () => {
  const s = await setup("consequential");
  await s.runtime.executeJob(context("execute"), s.job.id, s.driver, s.tools);
  const approval = s.runtime.snapshot().approvals![0]!;
  const other = context("intruder", otherBusinessId);
  const before = s.runtime.snapshot();
  for (const operation of [
    () => s.runtime.executeJob(other, s.job.id, s.driver, s.tools),
    () => s.runtime.approveOperation(other, approval.id),
    () => s.runtime.rejectOperation(other, approval.id, "No"),
    () => s.runtime.cancelJob(other, s.job.id),
  ]) await assert.rejects(operation, { code: "BUSINESS_SCOPE_VIOLATION" });
  assert.throws(() => s.runtime.inspectJob(other, s.job.id), { code: "BUSINESS_SCOPE_VIOLATION" });
  assert.throws(() => s.runtime.inspectExecution(other, s.job.id), { code: "BUSINESS_SCOPE_VIOLATION" });
  assert.throws(() => s.runtime.inspectApproval(other, approval.id), { code: "BUSINESS_SCOPE_VIOLATION" });
  assert.deepEqual(s.runtime.snapshot(), before);
  assert.equal(s.calls(), 0);
});

test("cancellation during a driver turn prevents subsequent tool dispatch", async () => {
  const s = await setup();
  const entered = deferred(), release = deferred();
  const run = s.runtime.executeJob(context("execute"), s.job.id, { async next(turn) {
    entered.resolve();
    await release.promise;
    assert.equal(turn.signal?.aborted, true);
    return { kind: "tool", toolId, input: {} };
  } }, s.tools);
  await entered.promise;
  await s.runtime.cancelJob(context("cancel"), s.job.id);
  release.resolve();
  assert.equal((await run).status, "cancelled");
  assert.equal(s.calls(), 0);
  assert.equal(s.runtime.snapshot().facts.filter(f => f.type === "job.cancelled").length, 1);
  assert.equal(s.runtime.snapshot().facts.some(f => f.type === "job.completed"), false);
});

test("cancelling an in-flight tool propagates abort and prevents the next tool", async () => {
  const s = await setup();
  const entered = deferred(), release = deferred();
  const tools = new ToolRegistry();
  let calls = 0;
  tools.register({ definition: s.tools.require(toolId).definition, async execute(_input, turn) {
    calls += 1; entered.resolve(); await release.promise;
    assert.equal(turn.signal?.aborted, true);
    return { output: "late result" };
  } });
  const run = s.runtime.executeJob(context("execute"), s.job.id, { async next() { return { kind: "tool", toolId, input: {} }; } }, tools);
  await entered.promise;
  await s.runtime.cancelJob(context("cancel"), s.job.id);
  release.resolve();
  assert.equal((await run).status, "cancelled");
  assert.equal(calls, 1);
});

test("queued and approval-waiting jobs can be cancelled without executing tools", async () => {
  for (const waiting of [false, true]) {
    const s = await setup("consequential");
    if (waiting) await s.runtime.executeJob(context("execute"), s.job.id, s.driver, s.tools);
    await s.runtime.cancelJob(context("cancel"), s.job.id);
    await s.runtime.cancelJob(context("cancel"), s.job.id);
    assert.equal((await s.runtime.executeJob(context("resume"), s.job.id, s.driver, s.tools)).status, "cancelled");
    if (waiting) {
      const approval = s.runtime.snapshot().approvals![0]!;
      assert.equal(approval.status, "cancelled");
      await assert.rejects(s.runtime.approveOperation(context("approve"), approval.id), /no longer pending/);
    }
    assert.equal(s.calls(), 0);
  }
});

test("failed start persistence publishes neither running state nor job.started", async () => {
  const s = await setup();
  const before = s.runtime.snapshot();
  (s.store as MemoryStore).fail = true;
  await assert.rejects(s.runtime.executeJob(context("execute"), s.job.id, s.driver, s.tools), /disk unavailable/);
  assert.deepEqual(s.runtime.snapshot(), before);
  assert.equal(s.calls(), 0);
  (s.store as MemoryStore).fail = false;
  assert.equal((await s.runtime.executeJob(context("execute"), s.job.id, s.driver, s.tools)).status, "completed");
});

test("failed approval request persistence executes no tool and publishes no approval", async () => {
  const s = await setup("consequential");
  await assert.rejects(s.runtime.executeJob(context("execute"), s.job.id, { async next() {
    (s.store as MemoryStore).fail = true;
    return { kind: "tool", toolId, input: {} };
  } }, s.tools), /disk unavailable/);
  assert.equal(s.calls(), 0);
  assert.equal(s.runtime.snapshot().approvals?.length ?? 0, 0);
  assert.equal(s.runtime.inspectJob(context("read"), s.job.id).status, "running");
  assert.equal(s.runtime.snapshot().facts.at(-1)?.type, "job.started");
});

test("failed approval decision and cancellation persistence leave authoritative state unchanged", async () => {
  const s = await setup("consequential");
  await s.runtime.executeJob(context("execute"), s.job.id, s.driver, s.tools);
  const approval = s.runtime.snapshot().approvals![0]!;
  const before = s.runtime.snapshot();
  (s.store as MemoryStore).fail = true;
  await assert.rejects(s.runtime.approveOperation(context("approve"), approval.id), /disk unavailable/);
  await assert.rejects(s.runtime.rejectOperation(context("reject"), approval.id, "No"), /disk unavailable/);
  await assert.rejects(s.runtime.cancelJob(context("cancel"), s.job.id), /disk unavailable/);
  assert.deepEqual(s.runtime.snapshot(), before);
  assert.equal(s.calls(), 0);
});

test("failed terminal persistence does not announce completion or rerun the tool", async () => {
  const s = await setup();
  await assert.rejects(s.runtime.executeJob(context("execute"), s.job.id, { async next(turn) {
    if (turn.observations.length) (s.store as MemoryStore).fail = true;
    return s.driver.next(turn);
  } }, s.tools), /disk unavailable/);
  assert.equal(s.calls(), 1);
  assert.equal(s.runtime.inspectJob(context("read"), s.job.id).status, "running");
  assert.equal(s.runtime.snapshot().facts.some(f => f.type === "job.completed"), false);
  (s.store as MemoryStore).fail = false;
  await assert.rejects(s.runtime.executeJob(context("execute"), s.job.id, s.driver, s.tools), /cannot be replayed safely/);
  assert.equal(s.calls(), 1);
});

test("file restart preserves pending approval and safely resumes the exact granted operation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hq-execution-"));
  try {
    const path = join(directory, "state.json");
    const store = new FileDurableStore(path);
    await store.save(seed());
    const s = await setup("consequential", store);
    await s.runtime.executeJob(context("execute"), s.job.id, s.driver, s.tools);
    const before = s.runtime.snapshot();
    const restarted = await DurableRuntime.open(new FileDurableStore(path), clock, environment());
    assert.deepEqual(restarted.snapshot(), before);
    const approval = before.approvals![0]!;
    assert.equal((await restarted.executeJob(context("still-waiting"), s.job.id, s.driver, s.tools)).status, "waiting_for_approval");
    await restarted.approveOperation(context("approve"), approval.id);
    // Keep the injected ID generator from reusing IDs across this simulated restart.
    const nextIds = environment();
    for (let i = 0; i < 30; i++) nextIds.event();
    const resumed = await DurableRuntime.open(new FileDurableStore(path), clock, nextIds);
    assert.equal((await resumed.executeJob(context("resume"), s.job.id, s.driver, s.tools)).status, "completed");
    assert.equal(s.calls(), 1);
    assert.deepEqual(s.inputs[0], approval.toolCall.input);
    const final = await DurableRuntime.open(new FileDurableStore(path), clock, environment());
    assert.equal(final.inspectJob(context("read"), s.job.id).status, "completed");
    assert.equal(final.inspectApproval(context("read"), approval.id).status, "approved");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("restoration rejects cross-business approvals and altered approved input", async () => {
  const s = await setup("consequential");
  await s.runtime.executeJob(context("execute"), s.job.id, s.driver, s.tools);
  const original = s.runtime.snapshot();
  for (const approval of [
    { ...original.approvals![0]!, businessId: otherBusinessId },
    { ...original.approvals![0]!, toolCall: { kind: "tool" as const, toolId, input: { destination: "different" } } },
  ]) {
    const store = new MemoryStore();
    store.state = { ...original, approvals: [approval] };
    await assert.rejects(DurableRuntime.open(store, clock, environment()), { code: "INVALID_STATE" });
  }
});

test("concurrent execute requests cannot dispatch the same job twice", async () => {
  const s = await setup();
  const entered = deferred(), release = deferred();
  const run = s.runtime.executeJob(context("execute"), s.job.id, { async next() {
    entered.resolve(); await release.promise;
    return { kind: "complete", output: "done" };
  } }, s.tools);
  await entered.promise;
  await assert.rejects(s.runtime.executeJob(context("another"), s.job.id, s.driver, s.tools), /already active/);
  release.resolve();
  await run;
  assert.equal(s.runtime.snapshot().facts.filter(f => f.type === "job.started").length, 1);
});

test("approval pauses cannot reset max-turn protection", async () => {
  const s = await setup("consequential");
  await s.runtime.executeJob(context("execute"), s.job.id, s.driver, s.tools, { maxTurns: 1 });
  await s.runtime.approveOperation(context("approve"), s.runtime.snapshot().approvals![0]!.id);
  const result = await s.runtime.executeJob(context("resume"), s.job.id, s.driver, s.tools, { maxTurns: 100 });
  assert.equal(result.error?.code, "MAX_TURNS_EXCEEDED");
  assert.equal(s.calls(), 1);
});

test("standalone execution never automatically dispatches consequential tools", async () => {
  const s = await setup("consequential");
  assert.equal((await new ExecutionEngine(s.tools).execute(s.job, s.agent, s.driver)).status, "waiting_for_approval");
  assert.equal(s.calls(), 0);
});

test("new creation commands retain pending execution state and snapshots cannot alter approval input", async () => {
  const s = await setup("consequential");
  await s.runtime.executeJob(context("execute"), s.job.id, s.driver, s.tools);
  const snapshot = s.runtime.snapshot();
  const input = snapshot.approvals![0]!.toolCall.input as Record<string, unknown>;
  input.destination = "mutated";
  await s.runtime.createAgent(context("another-agent"), { name: "Another worker" });
  const approval = s.runtime.snapshot().approvals![0]!;
  assert.equal((approval.toolCall.input as Record<string, unknown>).destination, "exact-target");
  assert.equal(s.runtime.inspectExecution(context("read"), s.job.id)?.status, "waiting_for_approval");
});
