/** Thin StarNet-style station model: no inferred execution or frontend-owned jobs. */
export function stationModel(view) {
  const snapshot = view.snapshot;
  if (!snapshot) return { agents: [], jobs: [], selected: null, activity: [] };
  const id = snapshot.business.id, jobs = snapshot.jobs.filter(j => j.businessId === id);
  const agents = snapshot.agents.filter(a => a.businessId === id && a.status !== 'retired').map(agent => {
    const assigned = jobs.filter(j => j.agentId === agent.id);
    const current = assigned.find(j => ['working','tool-use'].includes(j.visualState)) ?? assigned.find(j => j.status === 'running') ?? assigned.find(j => j.status === 'queued');
    const latest = assigned.at(-1);
    return { ...agent, state: view.connection === 'connected' ? current?.visualState ?? 'idle' : 'unknown', current: current ?? null,
      outcome: latest && !['queued','running'].includes(latest.status) ? latest.status : null, assigned };
  });
  const scoped = key => (snapshot[key] ?? []).filter(record => record.businessId === id);
  return { agents, jobs, rooms:snapshot.station?.rooms??[], appearance:snapshot.station?.appearance, workflows:snapshot.station?.workflows??[], workItems:(snapshot.station?.workItems??[]).filter(item=>jobs.some(job=>job.id===item.jobId&&job.agentId===item.agentId)).map(item=>{const job=jobs.find(j=>j.id===item.jobId);return {...item,state:view.connection!=="connected"?"unknown":["working","tool-use"].includes(job?.visualState)?"working":item.state==="placed"&&job?.visualState==="interrupted"?"interrupted":item.state};}), equipment: snapshot.station?.equipment ?? [], selected: agents.find(a => a.id === view.selectedAgentId) ?? null, activity: scoped('activity'),
    knowledge: scoped('knowledge'), artifacts: scoped('artifacts'), sources: scoped('sources'), approvals: scoped('approvals'), ledger: scoped('ledger'), expenses: scoped('expenses') };
}
/** Running clocks only advance while the host confirms ownership; terminal clocks use durable end time. */
export function elapsedTime(job, connection, now = Date.now()) {
  if (connection !== 'connected') return 'unknown';
  const start = Date.parse(job.execution?.startedAt);
  if (!Number.isFinite(start)) return 'not started';
  const end = Date.parse(job.execution?.finishedAt);
  if (!Number.isFinite(end) && !['working','tool-use','waiting-for-approval'].includes(job.visualState)) return 'interrupted';
  return `${Math.floor(Math.max(0,(Number.isFinite(end) ? end : now)-start)/1000)}s`;
}
export function exactMoney(amount) {
  const n = BigInt(amount.minorUnits), negative = n < 0n, abs = negative ? -n : n;
  return `${negative ? '-' : ''}${({ GBP: '£', USD: '$', EUR: '€' })[amount.currency] ?? amount.currency + ' '}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
export function revenueText(amounts = [{ currency: 'GBP', minorUnits: '0' }]) { return amounts.map(exactMoney).join(' / '); }
