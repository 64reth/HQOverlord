import type { BusinessId } from "@hqoverlord/core";
import { formatNanoUsd, stationIn, agentStationTools } from "@hqoverlord/runtime";
import type { DurableState } from "@hqoverlord/runtime";

/** One authoritative snapshot, filtered before it crosses the business boundary. */
export function projectBusiness(state: DurableState, businessId: BusinessId, activeJobIds: ReadonlySet<string> = new Set()) {
  const business = state.authority.businesses.find(b => b.id === businessId);
  if (!business) throw new Error("Business unavailable");
  const artifacts = (state.artifacts ?? []).filter(a => a.businessId === businessId);
  const station = stationIn(state, businessId);
  const jobs = state.authority.jobs.filter(j => j.businessId === businessId).map(job => {
    const execution = state.executions?.find(e => e.jobId === job.id && e.businessId === businessId);
    const account = state.modelAccounts?.find(a => a.jobId === job.id && a.businessId === businessId);
    const missing = (job.dependsOn ?? []).filter(id => !state.authority.jobs.some(j => j.id === id && j.businessId === businessId && j.status === "completed") || !artifacts.some(a => a.id === `job-output:${id}`));
    const active = activeJobIds.has(job.id);
    const visualState = job.status === "queued" ? missing.length ? "blocked" : "queued"
      : job.status === "running" ? execution?.status === "waiting_for_approval" ? "waiting-for-approval" : !active ? "interrupted" : execution?.operation?.dispatched ? "tool-use" : "working" : job.status;
    return { ...job, visualState, blockedBy: missing, execution: execution ? { status: execution.status, turns: execution.turns, startedAt: execution.startedAt ?? null, finishedAt: execution.finishedAt ?? null,
      operation: execution.operation ? { toolId: execution.operation.call.toolId, dispatched: execution.operation.dispatched, operationId: execution.operation.id } : null,
      observations: execution.observations.map(o => {const output=o.result.output as {content?:string};const path=['browser.screenshot','browser.pdf'].includes(o.toolId)?/saved to ([^\s]+)/i.exec(output?.content??'')?.[1]:undefined;return {toolId:o.toolId,...(path?{files:[{path,kind:o.toolId==='browser.screenshot'?'image':'file'}]}:{})};}), error: execution.outcome?.error ?? null } : null,
      inputs: [...(job.inputArtifactIds ?? []), ...(job.dependsOn ?? []).flatMap(id => artifacts.filter(a => a.id === `job-output:${id}`).map(a => a.id))],
      outputs: artifacts.filter(a => a.jobId === job.id).map(a => a.id),
      model: account ? { provider: account.policy.fallbackTargets?.[(account.activeTarget??0)-1]?.provider??account.policy.provider, model: account.policy.fallbackTargets?.[(account.activeTarget??0)-1]?.model??account.policy.model, invocations: account.invocations.map(i => ({ status: i.status, usage: i.usage ?? null })) } : null,
      spend: (state.meteredExpenses ?? []).filter(e => e.businessId === businessId && e.jobId === job.id).map(e => ({ id: e.id, display: formatNanoUsd(e.cost) })),
    };
  });
  const agents = state.authority.agents.filter(a => a.businessId === businessId).map(agent => {
    const assigned = jobs.filter(j => j.agentId === agent.id);
    const current = assigned.find(j => j.status === "running") ?? assigned.find(j => j.status === "queued") ?? assigned.at(-1);
    const profile = station.profiles.find(p => p.agentId === agent.id);
    return { ...agent, toolIds: [...new Set([...agent.toolIds, ...agentStationTools(station,agent.id)])], profile, desk: station.desks.find(d => d.agentId === agent.id) ?? null,
      visualState: current?.visualState ?? "idle", currentJobId: current?.id ?? null, model: profile?.model ?? (current?.model ? { provider: current.model.provider, model: current.model.model } : null) };
  });
  const approvals = (state.approvals ?? []).filter(a => a.businessId === businessId).map(a => {
    const operation = state.executions?.find(e => e.businessId === businessId && e.jobId === a.jobId && e.operation?.id === a.operationId)?.operation;
    return { ...a, operation: operation ? { toolId: operation.call.toolId, input: operation.call.input } : null };
  });
  const ledger = (state.ledger ?? []).filter(e => e.businessId === businessId);
  const expenses = (state.meteredExpenses ?? []).filter(e => e.businessId === businessId);
  const nanodollars = expenses.reduce((sum, e) => sum + e.cost.nanodollars, 0n);
  const revenue = new Map<string, bigint>([["GBP", 0n]]);
  for (const entry of ledger) if (entry.kind === "revenue") revenue.set(entry.amount.currency, (revenue.get(entry.amount.currency) ?? 0n) + entry.amount.minorUnits);
  const activity = state.facts.filter(f => f.businessId === businessId).slice(-60).map(f => ({ id: f.id, businessId: f.businessId, type: f.type, occurredAt: f.occurredAt, actor: f.actor,
    correlationId: f.correlationId, causationId: f.causationId, producer: f.producer, payload: f.payload }));
  return structuredClone({ business, station, agents, jobs, approvals, artifacts, sources: (state.sources ?? []).filter(s => s.businessId === businessId),
    knowledge: (state.knowledge ?? []).filter(k => k.businessId === businessId), ledger, expenses, revenue: [...revenue].map(([currency, minorUnits]) => ({ currency, minorUnits })),
    summary: { businessCount: 1, agents: agents.length, running: jobs.filter(j => j.status === "running").length,
      queued: jobs.filter(j => j.status === "queued").length, pendingApprovals: approvals.filter(a => a.status === "pending").length,
      modelSpend: formatNanoUsd({ version: 1, currency: "USD", unit: "nanodollar", nanodollars }), unsettledInvocations: jobs.flatMap(j => j.model?.invocations ?? []).filter(i => i.status !== "settled").length }, activity });
}
export type BusinessProjection = ReturnType<typeof projectBusiness>;
/** JSON integers stay explicit decimal strings, never Number(bigint). UI only displays them. */
export function wireJson(value: unknown): string { return JSON.stringify(value, (_key, v: unknown) => typeof v === "bigint" ? v.toString(10) : v); }
