import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { currencyCode, ids, money, type JobId, type ToolId } from "@hqoverlord/core";
import { correlationId } from "@hqoverlord/events";
import {
  AuthorityStore, DurableRuntime, FakeModelProvider, FileDurableStore, ToolRegistry,
  commandId, emptyDurableState, modelAccountTotals, systemClock, systemIds,
  type CommandContext, type DurableState, type DurableStore, type ModelProvider,
  type ModelResult, type ToolResult,
} from "../packages/runtime/src/index.ts";

const businessId = ids.business(randomUUID());
const currency = currencyCode("GBP");
const model = "local-acceptance-model";
// Illustrative fake pricing, not provider billing or actual money spent.
const options = {
  model, maxInputTokens: 20, maxOutputTokens: 10, maxTurns: 3,
  budget: money(35n, currency),
  pricing: { provider: "fake", model, currency, tokensPerBlock: 1n, inputMinorUnits: 1n, outputMinorUnits: 1n },
};
function context(label: string): CommandContext {
  return { commandId: commandId(randomUUID()), businessId,
    principal: { kind: "human", id: "local-acceptance-human" }, correlationId: correlationId(label) };
}
function print(tag: string, value: string): void { console.log(`[${tag}] ${value}`); }

/** Observe only facts whose actual file save has succeeded. */
function liveStore(file: FileDurableStore): DurableStore {
  const printed = new Set<string>();
  return {
    async load() {
      const state = await file.load();
      for (const fact of state.facts) printed.add(fact.id);
      return state;
    },
    async save(state) {
      await file.save(state);
      for (const fact of state.facts) {
        if (printed.has(fact.id)) continue;
        printed.add(fact.id);
        switch (fact.type) {
          case "job.started": print("JOB", `${fact.payload.jobId} started (durable)`); break;
          case "job.completed": print("JOB", `${fact.payload.jobId} completed (durable)`); break;
          case "approval.requested": print("HQ", `approval required: ${fact.payload.approval.id} (durable)`); break;
          case "approval.granted": print("HUMAN", `${fact.payload.approvalId} granted by ${fact.actor.id} (durable)`); break;
          case "model.usage_recorded": {
            const u = fact.payload;
            print("USAGE", `${u.provider}/${u.model}: input=${u.inputTokens}, output=${u.outputTokens}, request=${u.requestId}`);
            break;
          }
          case "ledger.entry_recorded": print("COST", `fake model expense: ${fact.payload.entry.amount.minorUnits} ${fact.payload.entry.amount.currency} minor units`); break;
        }
      }
    },
  };
}

function scriptedProvider(runtime: DurableRuntime, jobId: JobId, toolId: ToolId, input: unknown,
  expectedObservation: ToolResult, label: string) {
  const results: ModelResult[] = [
    { decision: { kind: "tool", toolId, input }, usage: { provider: "fake", model, inputTokens: 3, outputTokens: 2, requestId: `${label}-tool` } },
    { decision: { kind: "complete", output: expectedObservation.output }, usage: { provider: "fake", model, inputTokens: 4, outputTokens: 1, requestId: `${label}-complete` } },
  ];
  const fake = new FakeModelProvider(results);
  const provider: ModelProvider = {
    name: fake.name,
    async invoke(request, signal) {
      assert.equal(runtime.inspectJob(context(label), jobId).status, "running");
      const account = runtime.inspectModelAccount(context(label), jobId)!;
      assert.ok(account);
      assert.equal(account.invocations.at(-1)!.status, "reserved");
      assert.equal(modelAccountTotals(account).reserved, 30n);
      assert.deepEqual(request.tools.map(t => t.id), [toolId]);
      const conversation = JSON.parse(request.input) as { observations: unknown[] };
      if (fake.requests.length === 0) assert.deepEqual(conversation.observations, []);
      else {
        assert.deepEqual(conversation.observations, [{ toolId, result: expectedObservation }]);
        print("MODEL", `observation received: ${JSON.stringify(conversation.observations[0])}`);
      }
      const result = await fake.invoke(request, signal);
      print("MODEL", result.decision.kind === "tool"
        ? `tool requested: ${result.decision.toolId}` : `decision: ${result.decision.kind}`);
      return result;
    },
  };
  return { provider, fake };
}

function verifyAccounting(runtime: DurableRuntime, jobId: JobId): void {
  const ctx = context("verify");
  const account = runtime.inspectModelAccount(ctx, jobId)!;
  assert.ok(account);
  assert.equal(account.invocations.length, 2);
  assert.ok(account.invocations.every(c => c.status === "settled" && c.usage?.provider === "fake" && c.usage.model === model));
  assert.deepEqual(account.invocations.map(c => [c.usage!.inputTokens, c.usage!.outputTokens]), [[3, 2], [4, 1]]);
  const totals = modelAccountTotals(account);
  assert.deepEqual(totals, { spent: 10n, reserved: 0n });
  const ledger = runtime.inspectLedger(ctx, jobId);
  assert.equal(ledger.length, 2);
  assert.ok(ledger.every(e => e.businessId === businessId && e.jobId === jobId && e.kind === "expense" && e.amount.currency === currency));
  assert.equal(ledger.reduce((sum, e) => sum + e.amount.minorUnits, 0n), totals.spent);
  print("BUDGET", `limit=${account.policy.budget!.minorUnits}, spent=${totals.spent}, reserved=${totals.reserved}, remaining=${account.policy.budget!.minorUnits - totals.spent - totals.reserved} ${currency} minor units (fake accounting)`);
}

async function scenario(path: string, consequential: boolean): Promise<void> {
  const label = consequential ? "B" : "A";
  console.log(`\nSCENARIO ${label}: ${consequential ? "CONSEQUENTIAL ACTION" : "NORMAL AGENT EXECUTION"}`);
  let runtime: DurableRuntime | undefined = await DurableRuntime.open(liveStore(new FileDurableStore(path)), systemClock, systemIds);
  print("BOOT", "real DurableRuntime opened from temporary file");
  const business = new AuthorityStore(runtime.snapshot().authority).requireBusiness(context(label));
  print("BUSINESS", `${business.name} (${business.id})`);
  const toolId = ids.tool(`local-${label}`);
  const agent = (await runtime.createAgent(context(label), { name: `Acceptance worker ${label}`, toolIds: [toolId] })).record;
  print("AGENT", `${agent.name} (${agent.id}); permitted tool=${agent.toolIds[0]}`);
  const job = (await runtime.createJob(context(label), { objective: consequential ? "Perform one explicitly approved local increment" : "Calculate a sum with the permitted local tool", agentId: agent.id })).record;
  assert.equal(job.status, "queued");
  print("JOB", `${job.id}: ${job.status}; objective=${job.objective}; configured fake budget=${options.budget.minorUnits}`);
  let executions = 0;
  const tools = new ToolRegistry();
  const input = consequential ? { increment: 1 } : { values: [2, 3, 5] };
  const expectedObservation: ToolResult = { output: consequential ? { counter: 1 } : { sum: 10 } };
  tools.register({
    definition: { id: toolId, name: consequential ? "Local counter" : "Local sum", description: "Generic local acceptance operation", effect: consequential ? "consequential" : "read_only" },
    inputSchema: consequential ? { type: "object", properties: { increment: { type: "integer" } } }
      : { type: "object", properties: { values: { type: "array", items: { type: "integer" } } } },
    async execute(actualInput, turn) {
      assert.deepEqual(actualInput, input);
      assert.equal(turn.businessId, businessId);
      assert.equal(turn.job.id, job.id);
      assert.ok(turn.agent.toolIds.includes(toolId));
      if (consequential) {
        const approval = runtime!.snapshot().approvals!.find(a => a.jobId === job.id)!;
        assert.equal(approval.status, "approved");
        assert.ok(runtime!.snapshot().facts.some(f => f.type === "approval.granted" && f.payload.approvalId === approval.id));
      }
      executions += 1;
      const observation = consequential ? { output: { counter: executions } }
        : { output: { sum: (actualInput as { values: number[] }).values.reduce((sum, value) => sum + value, 0) } };
      print("TOOL", `${toolId} executed; count=${executions}; observation returned=${JSON.stringify(observation)}`);
      return observation;
    },
  });
  const { provider, fake } = scriptedProvider(runtime, job.id, toolId, input, expectedObservation, label);
  let result = await runtime.executeModelJob(context(label), job.id, provider, tools, options);
  let approvalId;
  if (consequential) {
    assert.equal(result.status, "waiting_for_approval");
    assert.equal(executions, 0);
    assert.equal(fake.requests.length, 1);
    const execution = runtime.inspectExecution(context(label), job.id)!;
    assert.equal(execution.status, "waiting_for_approval");
    assert.equal(execution.operation!.dispatched, false);
    const approval = runtime.snapshot().approvals!.find(a => a.jobId === job.id)!;
    approvalId = approval.id;
    assert.equal(approval.status, "pending");
    assert.deepEqual(approval.toolCall.input, input);
    print("APPROVAL", JSON.stringify(approval));
    print("VERIFY", `tool executions BEFORE APPROVAL: ${executions}`);
    const granted = await runtime.approveOperation(context("explicit-human-approval"), approval.id);
    assert.equal(granted.status, "approved");
    assert.equal(executions, 0);
    result = await runtime.executeModelJob(context("resume-approved-operation"), job.id, provider, tools, options);
    print("VERIFY", `tool executions AFTER APPROVAL: ${executions}`);
  }
  assert.equal(result.status, "completed");
  assert.deepEqual(result.output, expectedObservation.output);
  assert.equal(executions, 1);
  assert.equal(fake.requests.length, 2);
  assert.equal(runtime.inspectJob(context(label), job.id).status, "completed");
  verifyAccounting(runtime, job.id);
  const beforeRestart = runtime.snapshot();
  const facts = beforeRestart.facts.filter(f => f.type === "model.usage_recorded" ? f.payload.jobId === job.id
    : ["job.started", "job.completed"].includes(f.type) && "jobId" in f.payload && f.payload.jobId === job.id);
  assert.deepEqual(facts.map(f => f.type), ["job.started", "model.usage_recorded", "model.usage_recorded", "job.completed"]);
  assert.ok(beforeRestart.facts.every(f => f.businessId === businessId && f.producer === "hq.runtime" && f.actor.kind === "human"));
  runtime = undefined;
  runtime = await DurableRuntime.open(new FileDurableStore(path), systemClock, systemIds);
  print("RESTART", "runtime discarded and reopened from the same file");
  assert.deepEqual(runtime.snapshot(), beforeRestart);
  const authority = new AuthorityStore(runtime.snapshot().authority);
  assert.deepEqual(authority.requireBusiness(context(label)), business);
  assert.deepEqual(authority.requireAgent(context(label), agent.id), agent);
  assert.equal(runtime.inspectJob(context(label), job.id).status, "completed");
  assert.deepEqual(runtime.inspectExecution(context(label), job.id)!.outcome, result);
  verifyAccounting(runtime, job.id);
  if (approvalId) assert.equal(runtime.inspectApproval(context(label), approvalId).status, "approved");
  // Terminal replay must return its saved result without model/tool dispatch.
  assert.deepEqual(await runtime.executeModelJob(context("terminal-replay"), job.id, provider, tools, options), result);
  assert.equal(executions, 1);
  assert.equal(fake.requests.length, 2);
  print("VERIFY", `business, agent, completed job, execution output, usage and expenses survived restart${approvalId ? "; granted approval survived" : ""}`);
  print("FACTS", `persisted: ${facts.map(f => f.type).join(", ")}; ledger.entry_recorded x2${approvalId ? ", approval.requested, approval.granted" : ""}`);
  console.log(`SCENARIO ${label}: PASS`);
}

async function main(): Promise<void> {
  console.log("HQ/OVERLORD LIVE ACCEPTANCE\n===========================");
  const directory = await mkdtemp(join(tmpdir(), "hq-live-acceptance-"));
  try {
    const path = join(directory, "state.json");
    // There is no createBusiness command yet. Seed only this disposable store using existing APIs.
    const state = emptyDurableState(), authority = new AuthorityStore(state.authority), now = systemClock.now();
    authority.addBusiness({ id: businessId, name: "Local acceptance business", status: "active", createdAt: now, updatedAt: now });
    await new FileDurableStore(path).save({ ...state, authority: authority.snapshot() });
    await scenario(path, false);
    await scenario(path, true);
  } finally {
    assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("hq-live-acceptance-"));
    await rm(directory, { recursive: true, force: true });
    print("CLEANUP", "temporary acceptance state removed");
  }
  console.log("\n===========================\nHQ LIVE ACCEPTANCE: PASS");
}

main().catch((error: unknown) => {
  console.error("HQ LIVE ACCEPTANCE: FAIL", error);
  process.exitCode = 1;
});
