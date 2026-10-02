import type { DurableState } from "@hqoverlord/runtime";
import { businessId } from "./manifest.ts";

/** Remove only the never-executed bootstrap fixture, never real work or accounting. */
export function removeDevelopmentPlaceholder(state: DurableState): DurableState {
  const bootstrap = state.processedCommands.find(c => c.businessId === businessId && c.commandId === "business-001-bootstrap-v1-first-analysis-job");
  if (!bootstrap || bootstrap.result.kind !== "job") return state;
  const id = bootstrap.result.recordId;
  const job = state.authority.jobs.find(j => j.id === id);
  if (!job || job.businessId !== businessId || !["queued", "cancelled"].includes(job.status)
    || state.executions?.some(e => e.jobId === id) || state.modelAccounts?.some(a => a.jobId === id)
    || state.ledger?.some(e => e.jobId === id) || state.meteredExpenses?.some(e => e.jobId === id)
    || state.approvals?.some(a => a.jobId === id) || state.artifacts?.some(a => a.jobId === id)
    || state.sources?.some(s => s.jobId === id) || state.knowledge?.some(k => k.jobId === id)
    || state.authority.jobs.some(j => j.dependsOn?.includes(job.id))) {
    throw new Error("Development placeholder has operational history; refusing to delete real work or accounting");
  }
  const removed = new Set(state.facts.filter(f => "jobId" in f.payload && f.payload.jobId === id).map(f => f.id));
  // Never rewrite surviving event provenance to make cleanup possible.
  if (state.facts.some(f => !removed.has(f.id) && f.causationId && removed.has(f.causationId))) {
    throw new Error("Development placeholder has surviving causal history; refusing to rewrite provenance");
  }
  return { ...state, authority: { ...state.authority, jobs: state.authority.jobs.filter(j => j.id !== id) },
    facts: state.facts.filter(f => !removed.has(f.id)),
    processedCommands: state.processedCommands.filter(c => !(c.result.kind === "job" && c.result.recordId === id)) };
}
