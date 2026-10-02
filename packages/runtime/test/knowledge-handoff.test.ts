import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ids } from "@hqoverlord/core";
import { eventId, correlationId } from "@hqoverlord/events";
import { commandId, DurableRuntime, emptyDurableState, FileDurableStore, ToolRegistry, validateDurableState, type DurableStore, type DurableState } from "../src/index.ts";
const now = "2026-10-02T12:00:00.000Z", businessId = ids.business("a"), foreign = ids.business("b");
const context = (id: string, business = businessId) => ({ commandId: commandId(id), businessId: business, principal: { kind: "human" as const, id: "owner" }, correlationId: correlationId(id) });
function environment() { let n = 0; return { agent: () => ids.agent(`a${++n}`), job: () => ids.job(`j${++n}`), event: () => eventId(`e${++n}`) }; }
const seed = (): DurableState => ({ ...emptyDurableState(), authority: { businesses: [businessId, foreign].map(id => ({ id, name: id, status: "active", createdAt: now, updatedAt: now })), agents: [], jobs: [] } });
class Store implements DurableStore { state = seed(); fail = false; async load() { return structuredClone(this.state); } async save(s: DurableState) { if (this.fail) throw new Error("disk"); this.state = structuredClone(s); } }
async function setup(store: DurableStore = new Store()) {
  const runtime = await DurableRuntime.open(store, { now: () => now }, environment());
  const agent = (await runtime.createAgent(context("agent"), { name: "Research" })).record;
  const upstream = (await runtime.createJob(context("up"), { objective: "Research", agentId: agent.id })).record;
  const downstream = (await runtime.createJob(context("down"), { objective: "Use research", agentId: agent.id, dependsOn: [upstream.id] })).record;
  return { runtime, agent, upstream, downstream, store };
}
const complete = { async next() { return { kind: "complete" as const, output: { evidence: "supplied", count: 999999999999999999n, delta: -9007199254740993n } }; } };
test("dependencies block before provider dispatch until upstream and atomic output exist; downstream consumes provenance", async () => {
  const s = await setup(); let calls = 0;
  await assert.rejects(s.runtime.executeJob(context("blocked"), s.downstream.id, { async next() { calls++; return complete.next(); } }, new ToolRegistry()), /upstream/);
  assert.equal(calls, 0); assert.equal(s.runtime.inspectJob(context("read"), s.downstream.id).status, "queued");
  await s.runtime.executeJob(context("run-up"), s.upstream.id, complete, new ToolRegistry());
  const artifact = s.runtime.readArtifact(context("read"), `job-output:${s.upstream.id}`);
  assert.deepEqual(artifact.actor, context("run-up").principal); assert.equal(artifact.producer, "hq.runtime"); assert.equal(artifact.correlationId, "run-up"); assert.equal(artifact.agentId, s.agent.id);
  await s.runtime.executeJob(context("run-down"), s.downstream.id, { async next(turn) { assert.deepEqual(turn.inputs?.[0], artifact); return complete.next(); } }, new ToolRegistry());
  assert.equal(s.runtime.readArtifact(context("read"), `job-output:${s.downstream.id}`).references[0]?.artifactId, artifact.id);
});
test("sources, artifacts and knowledge are scoped, immutable, detached and reject foreign references", async () => {
  const s = await setup(), ctx = context("write");
  await s.runtime.recordSource(ctx, { id: "s", uri: "human:source", content: "source", contentType: "text/plain", retrievedAt: now });
  const input = { id: "a", category: "analysis" as const, contentType: "text/plain", content: "analysis", sourceIds: ["s"] };
  await s.runtime.createArtifact(ctx, input); await s.runtime.createArtifact(ctx, input);
  await s.runtime.recordKnowledge(ctx, { id: "k", statement: "Reference claim", references: [{ businessId, artifactId: "a" }] });
  assert.equal(s.runtime.readKnowledge(context("read", foreign)).length, 0);
  assert.throws(() => s.runtime.readArtifact(context("foreign", foreign), "a"), /business/);
  assert.throws(() => s.runtime.readSource(context("foreign", foreign), "s"), /business/);
  await assert.rejects(s.runtime.createArtifact(context("foreign", foreign), { ...input, id: "foreign", references: [{ businessId, artifactId: "a" }] }), /business|reference/);
  await assert.rejects(s.runtime.createArtifact(ctx, { ...input, content: "changed" }), /immutable/);
  await assert.rejects(s.runtime.createJob(context("foreign", foreign), { objective: "steal", dependsOn: [s.upstream.id] }), /business/);
  await assert.rejects(s.runtime.createJob(context("foreign", foreign), { objective: "steal", inputArtifactIds: ["a"] }), /business/);
  await assert.rejects(s.runtime.createArtifact(ctx, { ...input, id: `job-output:${s.upstream.id}` }), /only/);
});
test("file restart retains bigint outputs and scoped knowledge with downstream readiness", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hq-knowledge-"));
  try {
    const store = new FileDurableStore(join(directory, "state.json")); await store.save(seed()); const s = await setup(store);
    await s.runtime.executeJob(context("run"), s.upstream.id, complete, new ToolRegistry());
    const restored = await DurableRuntime.open(new FileDurableStore(join(directory, "state.json")), { now: () => now }, environment());
    assert.deepEqual(restored.jobInputs(context("read"), s.downstream.id), s.runtime.jobInputs(context("read"), s.downstream.id));
    assert.equal((restored.readArtifact(context("read"), `job-output:${s.upstream.id}`).content as { count: bigint }).count, 999999999999999999n);
    assert.equal((restored.readArtifact(context("read"), `job-output:${s.upstream.id}`).content as { delta: bigint }).delta, -9007199254740993n);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("cancelled upstream never releases downstream; cancelled downstream dispatches nothing", async () => {
  const s = await setup(); await s.runtime.cancelJob(context("cancel"), s.upstream.id);
  await assert.rejects(s.runtime.executeJob(context("blocked"), s.downstream.id, complete, new ToolRegistry()), /upstream/);
  await s.runtime.cancelJob(context("cancel-down"), s.downstream.id);
  const result = await s.runtime.executeJob(context("cancelled"), s.downstream.id, { async next() { throw new Error("must not dispatch"); } }, new ToolRegistry());
  assert.equal(result.status, "cancelled"); assert.equal(s.runtime.snapshot().artifacts?.length ?? 0, 0);
});
test("failed completion save emits no output/completion; observers only see committed state", async () => {
  const store = new Store(), s = await setup(store); let notified = 0;
  s.runtime.subscribe(() => { notified++; assert.deepEqual(s.runtime.snapshot(), store.state); });
  await assert.rejects(s.runtime.executeJob(context("run"), s.upstream.id, { async next() { store.fail = true; return complete.next(); } }, new ToolRegistry()), /disk/);
  assert.equal(notified, 1); assert.equal(s.runtime.snapshot().artifacts?.length ?? 0, 0); assert.equal(s.runtime.snapshot().facts.some(f => f.type === "job.completed"), false);
});
test("restore rejects cycles, foreign knowledge, mutable/executable content and forged provenance", async () => {
  const s = await setup(), state = s.runtime.snapshot();
  assert.throws(() => validateDurableState({ ...state, authority: { ...state.authority, jobs: state.authority.jobs.map(j => j.id === s.upstream.id ? { ...j, dependsOn: [s.downstream.id] } : j) } }), /knowledge/);
  await assert.rejects(s.runtime.createArtifact(context("bad"), { id: "bad", category: "structured", contentType: "application/json", content: new Date() }), /knowledge/);
  await assert.rejects(s.runtime.createArtifact(context("ambiguous"), { id: "ambiguous", category: "structured", contentType: "application/json", content: { "$hq.bigint": "1" } }), /knowledge/);
  await s.runtime.createArtifact(context("valid"), { id: "reference", category: "text", contentType: "text/plain", content: "source" });
  await s.runtime.recordKnowledge(context("fact"), { id: "fact", statement: "Reference", references: [{ businessId, artifactId: "reference" }] });
  const saved = s.runtime.snapshot();
  assert.throws(() => validateDurableState({ ...saved, knowledge: saved.knowledge!.map(k => ({ ...k, references: [{ businessId: foreign, artifactId: "reference" }] })) }), /knowledge/);
  assert.throws(() => validateDurableState({ ...saved, artifacts: saved.artifacts!.map(a => ({ ...a, producer: "untrusted" as "hq.runtime" })) }), /knowledge/);
});
test("agents cannot grant their own permissions or approve consequential operations", async () => {
  const s = await setup(), agentContext = { ...context("agent-consent"), principal: { kind: "agent" as const, id: s.agent.id } };
  await assert.rejects(s.runtime.configureAgentTools(agentContext, s.agent.id, [ids.tool("external")]), /human/);
  await assert.rejects(s.runtime.approveOperation(agentContext, ids.approval("unavailable")), /human/);
  await assert.rejects(s.runtime.rejectOperation(agentContext, ids.approval("unavailable"), "self"), /human/);
});
