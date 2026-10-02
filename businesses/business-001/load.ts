import { AuthorityStore, DurableRuntime, commandId, validateDurableState, type DurableStore, type RuntimeClock, type RuntimeIds } from "@hqoverlord/runtime";
import { correlationId } from "@hqoverlord/events";
import { businessId, manifest, workers, workflow } from "./manifest.ts";

/** Business-owned bootstrap, not an HQ dependency. Do not run concurrently on one store. */
export async function loadBusiness001(store: DurableStore, clock: RuntimeClock, ids: RuntimeIds) {
  const state = await store.load();
  validateDurableState(state);
  const authority = new AuthorityStore(structuredClone(state.authority));
  const existing = state.authority.businesses.find(b => b.id === businessId);
  if (existing && existing.name !== manifest.identity.name) throw new Error("Business identifier is already owned by another configuration");
  if (!existing) {
    const now = clock.now();
    authority.addBusiness({ id: businessId, name: manifest.identity.name, status: "active", createdAt: now, updatedAt: now });
    const next = { ...state, authority: authority.snapshot() };
    validateDurableState(next);
    await store.save(next);
  }
  const runtime = await DurableRuntime.open(store, clock, ids);
  const context = (label: string) => ({ commandId: commandId(`business-001-bootstrap-v1-${label}`), businessId,
    principal: { kind: "human" as const, id: "business-001-owner" }, correlationId: correlationId("business-001-first-customer") });
  const agents = [];
  for (const worker of workers) {
    const result = await runtime.createAgent(context(worker.role), { name: worker.name, capabilities: worker.capabilities, toolIds: [] });
    agents.push({ role: worker.role, record: result.record });
  }
  const firstJob = (await runtime.createJob(context("first-analysis-job"), {
    agentId: agents[0]!.record.id, workflowId: workflow.id,
    objective: "Await human-supplied prospect and public website material, then draft a source-backed suitability assessment for the £10 Website AI Assistant offer. No browsing/contact capability is installed. Do not contact anyone, publish anything, invent sources, or claim payment.",
  })).record;
  return { runtime, agents, firstJob, manifest, workflow };
}
