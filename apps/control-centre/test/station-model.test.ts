import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Browser modules intentionally ship as plain JS.
import { initialView, hydrate, disconnected, selectAgent, mutationsAllowed, expireTransport } from "../public/client-state.js";
// @ts-expect-error Browser modules intentionally ship as plain JS.
import { stationModel, exactMoney, revenueText } from "../public/station-model.js";
// @ts-expect-error Browser modules intentionally ship as plain JS.
import { stationPositions, hitStation } from "../public/world.js";

function snapshot() {
  return { business: { id: "b" }, agents: [{ id: "a", businessId: "b", name: "Worker" }, { id: "second", businessId: "b", name: "Other" }, { id: "foreign", businessId: "outside" }],
    jobs: [] as { id: string; businessId: string; agentId: string; status: string; visualState: string }[], activity: [], knowledge: [], artifacts: [], sources: [], approvals: [], ledger: [], expenses: [] };
}

test("station hydration and realtime selection stay in the current business and never impersonate a missing agent", () => {
  const s = snapshot(); let view = hydrate(initialView(), s, 1);
  assert.equal(view.selectedAgentId, "a"); view = selectAgent(view, "second");
  assert.equal(selectAgent(view, "foreign"), view);
  view = hydrate(view, s, 2); assert.equal(stationModel(view).selected.id, "second");
  const missing = hydrate(view, { ...s, agents: s.agents.filter(a => a.id !== "second") }, 3);
  assert.equal(stationModel(missing).selected, null); assert.equal(missing.selectionLost, true);
  const switched = hydrate(view, { ...s, business: { id: "outside" } }, 4);
  assert.equal(stationModel(switched).selected.id, "foreign");
});

test("station body stays idle after durable terminal outcomes, while queued/wait/tool/interrupted states require real jobs", () => {
  const s = snapshot(); const job = { id: "j", businessId: "b", agentId: "a", status: "completed", visualState: "completed" };
  let view = hydrate(initialView(), { ...s, jobs: [job] }, 1);
  assert.equal(stationModel(view).agents[0].state, "idle"); assert.equal(stationModel(view).agents[0].outcome, "completed");
  for (const [status, visualState] of [["queued", "queued"], ["queued", "blocked"], ["running", "waiting-for-approval"], ["running", "working"], ["running", "tool-use"], ["running", "interrupted"]]) {
    view = hydrate(view, { ...s, jobs: [{ ...job, status, visualState }] }, 2);
    assert.equal(stationModel(view).agents[0].state, visualState);
  }
  const stale = disconnected(view); assert.equal(stationModel(stale).agents[0].state, "unknown"); assert.equal(mutationsAllowed(stale), false);
  const expired = expireTransport(view, 2, 25003); assert.equal(mutationsAllowed(expired), false); assert.equal(stationModel(expired).agents[0].state, "unknown");
  assert.equal(expireTransport(view, 2, 25002), view);
  assert.equal(mutationsAllowed(initialView()), false); assert.equal(mutationsAllowed(hydrate(stale, s, 3)), true);
});

test("station adapter retains evidence, approval and ledger provenance while filtering every foreign record", () => {
  const s = snapshot(), own = { id: "evidence", businessId: "b", verification: "unverified", sourceIds: ["source"], actor: { kind: "human", id: "operator" }, producer: "hq.runtime" };
  const mixed = { ...s, jobs: [{ id: "foreign-job", businessId: "outside", agentId: "a", status: "running", visualState: "working" }] } as Record<string, unknown>;
  for (const key of ["activity", "knowledge", "artifacts", "sources", "approvals", "ledger", "expenses"]) mixed[key] = [own, { ...own, businessId: "outside" }];
  const model = stationModel(hydrate(initialView(), mixed, 1));
  assert.equal(model.jobs.length, 0); assert.equal(model.agents.length, 2); assert.equal(model.agents[0].state, "idle");
  for (const key of ["activity", "knowledge", "artifacts", "sources", "approvals", "ledger", "expenses"]) assert.deepEqual(model[key], [own]);
});

test("financial labels preserve exact large integers, separate currencies and factual zero revenue", () => {
  assert.equal(revenueText(), "£0.00"); assert.equal(exactMoney({ currency: "GBP", minorUnits: "999999999999999999" }), "£9999999999999999.99");
  assert.equal(revenueText([{ currency: "GBP", minorUnits: "0" }, { currency: "USD", minorUnits: "1" }]), "£0.00 / $0.01");
});

test("canvas station hit testing maps actual rendered positions to agents and empty floor selects nobody", () => {
  const positions = stationPositions(5); assert.equal(positions.length, 5);
  positions.forEach((p: { x: number; y: number }, i: number) => assert.equal(hitStation(positions, p.x, p.y + 30), i));
  assert.equal(hitStation(positions, 0, 0), -1);
});
