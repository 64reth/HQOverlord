import assert from "node:assert/strict";
import test from "node:test";
import { ids } from "@hqoverlord/core";
import { eventId } from "@hqoverlord/events";
import { DurableRuntime, emptyDurableState, FakeModelProvider, type DurableState } from "@hqoverlord/runtime";
import { loadBusiness001 } from "../load.ts";
import { jobModelOptions } from "../manifest.ts";
import { prepareMission, missionTools, runMissionJob, ownerContext } from "../operations.ts";

test("configured mission carries artifacts through five agents, mocked web evidence, restart and mandatory human release without customer/revenue", async () => {
  let state: DurableState = emptyDurableState(), n = 0; const clock = { now: () => "2026-10-02T12:00:00Z" };
  const environment = { agent: () => ids.agent(`a${++n}`), job: () => ids.job(`j${++n}`), event: () => eventId(`e${++n}`) };
  const store = { async load() { return structuredClone(state); }, async save(s: DurableState) { state = structuredClone(s); } };
  const loaded = await loadBusiness001(store, clock, environment);
  const input = { id: "supplied-attempt", url: "https://example.com", material: "Human supplied public source; no real customer asserted" };
  const jobs = await prepareMission(loaded, input); assert.deepEqual(await prepareMission(loaded, input), jobs);
  const tools = missionTools(loaded.runtime, { resolve: async () => [{ address: "93.184.216.34", family: 4 }], request: async () => ({ status: 200, contentType: "text/plain", body: Buffer.from("Public evidence") }), now: clock.now });
  const usage = { provider: "fake", model: "gpt-6-luna", inputTokens: 4, outputTokens: 2 };
  const provider = new FakeModelProvider([{ decision: { kind: "tool", toolId: ids.tool("web.read"), input: { url: input.url } }, usage },
    ...["Research evidence", "Reference knowledge", "Assistant draft", "QA findings"].map(output => ({ decision: { kind: "complete" as const, output }, usage }))]);
  const options = jobModelOptions({ pricing: { ...jobModelOptions().meteredPricing!, provider: "fake" } });
  await assert.rejects(runMissionJob(loaded.runtime, jobs[1]!.id, provider, tools, options), /upstream/); assert.equal(provider.requests.length, 0);
  for (const job of jobs.slice(0,4)) assert.equal((await runMissionJob(loaded.runtime, job.id, provider, tools, options)).status, "completed");
  assert.ok(provider.requests.slice(2).every(r => (JSON.parse(r.input) as { inputArtifacts: unknown[] }).inputArtifacts.length > 1));
  assert.equal(loaded.runtime.readKnowledge(ownerContext("read")).length, 1);
  const waiting = await runMissionJob(loaded.runtime, jobs[4]!.id, provider, tools, options); assert.equal(waiting.status, "waiting_for_approval");
  const calls = provider.requests.length;
  const restored = await DurableRuntime.open(store, clock, environment), approval = restored.snapshot().approvals!.find(a => a.jobId === jobs[4]!.id)!;
  await restored.approveOperation(ownerContext("approve"), approval.id);
  assert.equal((await runMissionJob(restored, jobs[4]!.id, provider, missionTools(restored), options)).status, "completed");
  assert.equal(provider.requests.length, calls); assert.equal(restored.snapshot().ledger?.filter(e => e.kind === "revenue").length ?? 0, 0);
  assert.equal(restored.snapshot().authority.jobs.find(j => j.id === jobs[4]!.id)?.status, "completed");
  const output = restored.readArtifact(ownerContext("read"), `job-output:${jobs[4]!.id}`); assert.match(JSON.stringify(output.content), /external action remains manual/);
  assert.ok(output.references.some(r => r.artifactId === `job-output:${jobs[3]!.id}`));
});
