import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { currencyCode, ids, money } from "@hqoverlord/core";
import { correlationId } from "@hqoverlord/events";
import {
  AuthorityStore, DurableRuntime, FileDurableStore, OpenAIModelProvider, ToolRegistry,
  commandId, emptyDurableState, modelAccountTotals, systemClock, systemIds,
  type CommandContext, type ModelProvider, type ModelPricing,
} from "../packages/runtime/src/index.ts";

// Explicit/manual only: never imported by automated tests. All data is disposable.
const defaultModel = "gpt-6-luna";
const model = process.env.HQ_MODEL?.trim() || defaultModel;
const currency = currencyCode("USD");
const budget = money(5n, currency);
let phase = "configuration";
const print = (tag: string, value: string) => console.log(`[${tag}] ${value}`);

function rate(name: string, fallback?: bigint): bigint {
  const value = process.env[name];
  if (value === undefined && fallback !== undefined) return fallback;
  if (value === undefined || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`Set ${name} to non-negative integer USD cents per million tokens`);
  }
  return BigInt(value);
}

async function main(): Promise<void> {
  console.log("HQ/OVERLORD - REAL AI IGNITION\n==============================");
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.error("Set OPENAI_API_KEY in your environment before running npm run live:openai. No request made.");
    process.exitCode = 1;
    return;
  }
  // Supplied ignition rates are configuration, not an assertion about other models' prices.
  // Overrides require their own explicit rates rather than silently inheriting Luna pricing.
  let pricing: ModelPricing;
  try {
    pricing = { provider: "openai", model, currency, tokensPerBlock: 1_000_000n,
      inputMinorUnits: rate("HQ_MODEL_INPUT_CENTS_PER_MILLION", model === defaultModel ? 10n : undefined),
      outputMinorUnits: rate("HQ_MODEL_OUTPUT_CENTS_PER_MILLION", model === defaultModel ? 50n : undefined),
      ...(process.env.HQ_MODEL_CACHED_INPUT_CENTS_PER_MILLION !== undefined
        ? { cachedInputMinorUnits: rate("HQ_MODEL_CACHED_INPUT_CENTS_PER_MILLION") } : {}),
    };
  } catch {
    console.error("Invalid pricing configuration. For HQ_MODEL overrides, set HQ_MODEL_INPUT_CENTS_PER_MILLION and HQ_MODEL_OUTPUT_CENTS_PER_MILLION to integer USD cents per million tokens. Cached input can be configured with HQ_MODEL_CACHED_INPUT_CENTS_PER_MILLION. No request made.");
    process.exitCode = 1;
    return;
  }
  print("MODEL", model);
  print("BUDGET", `${budget.minorUnits} USD cents hard limit`);
  print("PRICING", `per million tokens: input=${pricing.inputMinorUnits}, output=${pricing.outputMinorUnits}, cached input=${pricing.cachedInputMinorUnits ?? pricing.inputMinorUnits} USD cents (configured rates; each call rounds up to a cent)`);
  const directory = await mkdtemp(join(tmpdir(), "hq-real-ignition-"));
  try {
    phase = "temporary runtime boot";
    const path = join(directory, "state.json"), file = new FileDurableStore(path);
    const businessId = ids.business(randomUUID()), toolId = ids.tool("math.add");
    const context = (): CommandContext => ({ commandId: commandId(randomUUID()), businessId,
      principal: { kind: "human", id: "manual-ignition-human" }, correlationId: correlationId("real-ignition") });
    const seed = emptyDurableState(), authority = new AuthorityStore(seed.authority), now = systemClock.now();
    // Existing runtime has no business creation command; bootstrap this temporary store only.
    authority.addBusiness({ id: businessId, name: "Generic ignition business", status: "active", createdAt: now, updatedAt: now });
    await file.save({ ...seed, authority: authority.snapshot() });
    let runtime: DurableRuntime | undefined = await DurableRuntime.open(file, systemClock, systemIds);
    print("BOOT", "real DurableRuntime opened from a new temporary state file");
    print("BUSINESS", new AuthorityStore(runtime.snapshot().authority).requireBusiness(context()).name);
    const agent = (await runtime.createAgent(context(), { name: "Generic arithmetic worker", toolIds: [toolId] })).record;
    print("AGENT", `${agent.name} (${agent.id})`);
    const job = (await runtime.createJob(context(), { agentId: agent.id,
      objective: "Use the available math tool to calculate 17 + 25, then report the result." })).record;
    print("JOB", `${job.id}: ${job.status}`);
    let toolExecutions = 0;
    const tools = new ToolRegistry();
    tools.register({ definition: { id: toolId, name: "math.add", description: "Add two integers and return their sum", effect: "read_only" },
      inputSchema: { type: "object", properties: { a: { type: "integer" }, b: { type: "integer" } }, required: ["a", "b"], additionalProperties: false },
      async execute(input, turn) {
        phase = "local math.add validation";
        assert.equal(turn.businessId, businessId);
        assert.ok(turn.agent.toolIds.includes(toolId));
        assert.ok(input && typeof input === "object" && !Array.isArray(input));
        const args = input as Record<string, unknown>;
        assert.deepEqual(Object.keys(args).sort(), ["a", "b"]);
        assert.ok(Number.isSafeInteger(args.a) && Number.isSafeInteger(args.b));
        assert.equal(args.a, 17); assert.equal(args.b, 25);
        const sum = (args.a as number) + (args.b as number);
        toolExecutions++;
        print("HQ", `tool permission enforced for ${toolId}`);
        print("TOOL", `${toolId} executed: ${args.a} + ${args.b} = ${sum}`);
        phase = "model execution";
        return { output: { sum } };
      },
    });
    // Production provider reads credentials only from OPENAI_API_KEY internally.
    const realProvider = new OpenAIModelProvider({ onDiagnostic(diagnostic) {
      print("PROVIDER", JSON.stringify(diagnostic));
    } });
    const provider: ModelProvider = { name: realProvider.name, async invoke(request, signal) {
      phase = "real provider request";
      const account = runtime!.inspectModelAccount(context(), job.id)!;
      assert.equal(account.invocations.at(-1)!.status, "reserved");
      print("HQ", `budget admitted; reservation=${modelAccountTotals(account).reserved} USD cents (durably saved)`);
      const input = JSON.parse(request.input) as { observations: unknown[] };
      if (toolExecutions > 0) {
        assert.equal(input.observations.length, toolExecutions);
        for (const observation of input.observations) assert.deepEqual(observation, { toolId, result: { output: { sum: 42 } } });
        print("AI", `real tool observations received: count=${input.observations.length}, latest sum=42`);
      }
      print("AI", "model turn started");
      const result = await realProvider.invoke(request, signal);
      if (result.decision.kind === "tool") print("AI", `requested tool: ${result.decision.toolId}`);
      if (result.decision.kind === "complete") print("AI", `final response: ${String(result.decision.output)}`);
      if (result.decision.kind === "failure") print("AI", `controlled provider failure: ${result.decision.code}`);
      return result;
    } };
    phase = "model execution";
    const result = await runtime.executeModelJob(context(), job.id, provider, tools, {
      model, maxInputTokens: 4096, maxOutputTokens: 1024, maxTurns: 3, budget, pricing,
      instructions: "Use the available addition tool for the job's operands. After receiving its observation, report that sum and complete. Do not calculate instead of requesting the tool.",
    });
    if (result.status !== "completed") {
      print("JOB", `${result.status}; controlled runtime code=${result.error?.code ?? "NO_COMPLETION"}`);
      throw new Error("Job did not complete");
    }
    phase = "completion and accounting verification";
    assert.ok(toolExecutions >= 1);
    assert.equal(runtime.inspectJob(context(), job.id).status, "completed");
    const account = runtime.inspectModelAccount(context(), job.id)!;
    assert.equal(account.invocations.length, toolExecutions + 1);
    assert.ok(account.invocations.every(c => c.status === "settled" && c.usage && c.cost && c.ledgerEntryId));
    for (const call of account.invocations) {
      const usage = call.usage!;
      print("USAGE", `${usage.provider}/${usage.model}: input=${usage.inputTokens}, output=${usage.outputTokens}, cached input=${usage.cachedInputTokens ?? "not reported"}`);
    }
    const totals = modelAccountTotals(account), ledger = runtime.inspectLedger(context(), job.id);
    assert.equal(ledger.length, account.invocations.length);
    assert.equal(ledger.reduce((sum, e) => sum + e.amount.minorUnits, 0n), totals.spent);
    assert.ok(ledger.every(e => e.businessId === businessId && e.jobId === job.id && e.kind === "expense"));
    assert.equal(totals.reserved, 0n); assert.ok(totals.spent <= budget.minorUnits);
    print("JOB", "COMPLETED");
    print("COST", `calculated model expense=${totals.spent} USD cents; remaining=${budget.minorUnits - totals.spent} USD cents`);
    phase = "durable restart verification";
    const before = runtime.snapshot();
    runtime = undefined;
    runtime = await DurableRuntime.open(new FileDurableStore(path), systemClock, systemIds);
    assert.deepEqual(runtime.snapshot(), before);
    assert.equal(runtime.inspectJob(context(), job.id).status, "completed");
    assert.deepEqual(runtime.inspectModelAccount(context(), job.id), account);
    assert.deepEqual(runtime.inspectLedger(context(), job.id), ledger);
    print("RESTART", "completed job, model usage, ledger expenses and durable facts survived reopening");
  } finally {
    assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("hq-real-ignition-"));
    await rm(directory, { recursive: true, force: true });
    print("CLEANUP", "temporary ignition state removed");
  }
  console.log("==============================\nREAL AI IGNITION: PASS");
}

main().catch(() => {
  // Do not forward arbitrary provider, assertion, filesystem or request error text.
  console.error(`REAL AI IGNITION: FAIL during ${phase}. No success claimed; inspect preceding controlled status.`);
  process.exitCode = 1;
});
