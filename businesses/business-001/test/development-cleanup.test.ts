import assert from "node:assert/strict";
import test from "node:test";
import { ids } from "@hqoverlord/core";
import { correlationId, eventId } from "@hqoverlord/events";
import { commandId, commandFingerprint, type DurableState } from "@hqoverlord/runtime";
import { loadBusiness001 } from "../load.ts";
import { removeDevelopmentPlaceholder } from "../remove-development-placeholder.ts";
import { businessId } from "../manifest.ts";
import { emptyDurableState } from "@hqoverlord/runtime";

test("startup removes only the never-executed development fixture and preserves workforce/other work", async () => {
  let state = emptyDurableState(), n = 0; const clock = { now: () => "2026-10-02T12:00:00Z" };
  const environment = { agent: () => ids.agent(`a${++n}`), job: () => ids.job(`j${++n}`), event: () => eventId(`e${++n}`) };
  const store = { async load() { return structuredClone(state); }, async save(s: DurableState) { state = structuredClone(s); } };
  const loaded = await loadBusiness001(store, clock, environment);
  const context = (id: string) => ({ commandId: commandId(id), businessId, principal: { kind: "human" as const, id: "owner" }, correlationId: correlationId("service") });
  const fixture = (await loaded.runtime.createJob(context("business-001-bootstrap-v1-first-analysis-job"), { objective: "Private development fixture", agentId: loaded.agents[0]!.record.id })).record;
  const real = (await loaded.runtime.createJob(context("real-job"), { objective: "Actual supplied work", agentId: loaded.agents[1]!.record.id })).record;
  await loaded.runtime.cancelJob(context("remove-fixture"), fixture.id);
  const survivingFacts = loaded.runtime.snapshot().facts.filter(f => !("jobId" in f.payload && f.payload.jobId === fixture.id));
  const cleaned = await loadBusiness001(store, clock, environment);
  assert.deepEqual(cleaned.runtime.snapshot().authority.jobs, [real]); assert.equal(cleaned.agents.length, 5);
  assert.equal(cleaned.runtime.snapshot().facts.some(f => "jobId" in f.payload && f.payload.jobId === fixture.id), false);
  assert.deepEqual(cleaned.runtime.snapshot().facts, survivingFacts);
  const before = commandFingerprint(cleaned.runtime.snapshot()); await loadBusiness001(store, clock, environment); assert.equal(commandFingerprint(state), before);
});
test("cleanup refuses to delete development fixture that has executed or carries real accounting", async () => {
  const id = ids.job("dev"), agentId = ids.agent("agent"), now = "2026-10-02T12:00:00Z";
  const state: DurableState = { ...emptyDurableState(), authority: { businesses: [], agents: [], jobs: [{ id, businessId, agentId, objective: "fixture", status: "running" }] },
    processedCommands: [{ commandId: "business-001-bootstrap-v1-first-analysis-job", businessId, inputFingerprint: "fixture", eventIds: [], result: { kind: "job", recordId: id } }] };
  assert.throws(() => removeDevelopmentPlaceholder(state), /refusing/);
  assert.throws(() => removeDevelopmentPlaceholder({ ...state, authority: { ...state.authority, jobs: state.authority.jobs.map(j => ({ ...j, status: "cancelled" })) }, ledger: [{ id: ids.ledgerEntry("expense"), businessId, jobId: id, kind: "expense", amount: { currency: "USD" as import("@hqoverlord/core").CurrencyCode, minorUnits: 1n }, description: "real", occurredAt: now }] }), /refusing/);
  const foreign = ids.business("foreign");
  const unrelated = { ...state, processedCommands: state.processedCommands.map(c => ({ ...c, businessId: foreign })) };
  assert.equal(removeDevelopmentPlaceholder(unrelated), unrelated);
});
