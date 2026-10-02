import assert from "node:assert/strict";
import test from "node:test";
import { ids } from "@hqoverlord/core";
import { correlationId, eventId } from "@hqoverlord/events";
import { commandId, DurableRuntime, emptyDurableState, type DurableState } from "@hqoverlord/runtime";
import { createControlCentre } from "../src/server.ts";

test("local API/SSE require session, reject foreign scope/origin and hydrate/reconnect from committed state", async () => {
  const businessId = ids.business("allowed"), foreign = ids.business("denied"), now = "2026-10-02T12:00:00Z";
  let state: DurableState = { ...emptyDurableState(), authority: { businesses: [businessId, foreign].map(id => ({ id, name: id, status: "active", createdAt: now, updatedAt: now })), agents: [], jobs: [] } }, n = 0;
  const context = () => ({ commandId: commandId(`c${++n}`), businessId, principal: { kind: "human" as const, id: "operator" }, correlationId: correlationId("test") });
  const runtime = await DurableRuntime.open({ async load() { return state; }, async save(s) { state = structuredClone(s); } }, { now: () => now }, { agent: () => ids.agent(`a${++n}`), job: () => ids.job(`j${++n}`), event: () => eventId(`e${++n}`) });
  const app = createControlCentre({ runtime, businessIds: [businessId], context, assetRoot: new URL("../public/", import.meta.url) });
  await new Promise<void>(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${base}/api/snapshot`)).status, 401);
    const html = await fetch(base); assert.equal(html.status, 200); const cookie = html.headers.get("set-cookie")!.split(";")[0]!;
    assert.equal((await fetch(`${base}/api/snapshot?business=denied`, { headers: { Cookie: cookie } })).status, 403);
    assert.equal((await fetch(`${base}/api/snapshot`, { headers: { Cookie: cookie, Origin: "http://evil.test" } })).status, 403);
    assert.equal((await fetch(`${base}/api/cancel`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "{}" })).status, 403);
    const first = await fetch(`${base}/api/events`, { headers: { Cookie: cookie } }); const reader = first.body!.getReader();
    const frame = new TextDecoder().decode((await reader.read()).value); assert.match(frame, /event: snapshot/); assert.match(frame, /"agents":\[\]/); assert.doesNotMatch(frame, /"denied"/);
    const agent = (await runtime.createAgent(context(), { name: "Saved worker" })).record;
    const next = new TextDecoder().decode((await reader.read()).value); assert.match(next, /Saved worker/); await reader.cancel();
    const reconnected = await fetch(`${base}/api/events`, { headers: { Cookie: cookie, "Last-Event-ID": "old-epoch:0" } }); const again = reconnected.body!.getReader();
    assert.match(new TextDecoder().decode((await again.read()).value), /Saved worker/); await again.cancel();
    const headers = { Cookie: cookie, Origin: base, "Content-Type": "application/json" };
    const refused = await fetch(`${base}/api/job`, { method: "POST", headers, body: JSON.stringify({ agentId: "foreign-agent", objective: "Denied" }) });
    assert.equal(refused.status, 409); assert.equal(runtime.snapshot().authority.jobs.length, 0);
    const created = await fetch(`${base}/api/job`, { method: "POST", headers, body: JSON.stringify({ agentId: agent.id, objective: "Operator supplied work", actor: { kind: "agent", id: "untrusted" } }) });
    assert.equal(created.status, 200); assert.equal(runtime.snapshot().authority.jobs[0]!.status, "queued");
    assert.deepEqual(runtime.snapshot().facts.at(-1)!.actor, { kind: "human", id: "operator" }); assert.equal(runtime.snapshot().facts.at(-1)!.producer, "hq.runtime");
    const snapshot = await (await fetch(`${base}/api/snapshot`, { headers: { Cookie: cookie } })).json() as { agents: unknown[] }; assert.equal(snapshot.agents.length, 1);
  } finally { await app.close(); }
});
