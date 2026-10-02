import { AuthorityStore, DurableRuntime, commandId, validateDurableState, type DurableStore, type RuntimeClock, type RuntimeIds } from "@hqoverlord/runtime";
import { correlationId } from "@hqoverlord/events";
import { businessId, manifest, workers, workflow } from "./manifest.ts";
import { removeDevelopmentPlaceholder } from "./remove-development-placeholder.ts";

/** Business-owned bootstrap, not an HQ dependency. Do not run concurrently on one store. */
export async function loadBusiness001(store: DurableStore, clock: RuntimeClock, ids: RuntimeIds) {
  const original = await store.load();
  const state = removeDevelopmentPlaceholder(original);
  validateDurableState(state);
  if (state !== original) await store.save(state);
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
    principal: { kind: "human" as const, id: "business-001-owner" }, correlationId: correlationId("business-001-service") });
  const agents = [];
  for (const worker of workers) {
    const result = await runtime.createAgent(context(worker.role), { name: worker.name, capabilities: worker.capabilities, toolIds: [] });
    agents.push({ role: worker.role, record: result.record });
  }
  return { runtime, agents, manifest, workflow };
}
