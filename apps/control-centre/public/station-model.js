/** Thin StarNet-style station model: no inferred execution or frontend-owned jobs. */
export function stationModel(view) {
  const snapshot = view.snapshot;
  if (!snapshot) return { agents: [], jobs: [], selected: null, activity: [] };
  const id = snapshot.business.id, jobs = snapshot.jobs.filter(j => j.businessId === id);
  const agents = snapshot.agents.filter(a => a.businessId === id).map(agent => {
    const assigned = jobs.filter(j => j.agentId === agent.id);
    const current = assigned.find(j => j.status === 'running') ?? assigned.find(j => j.status === 'queued');
    const latest = assigned.at(-1);
    return { ...agent, state: view.connection === 'connected' ? current?.visualState ?? 'idle' : 'unknown', current: current ?? null,
      outcome: latest && !['queued','running'].includes(latest.status) ? latest.status : null, assigned };
  });
  const scoped = key => (snapshot[key] ?? []).filter(record => record.businessId === id);
  return { agents, jobs, selected: agents.find(a => a.id === view.selectedAgentId) ?? null, activity: scoped('activity'),
    knowledge: scoped('knowledge'), artifacts: scoped('artifacts'), sources: scoped('sources'), approvals: scoped('approvals'), ledger: scoped('ledger'), expenses: scoped('expenses') };
}
export function exactMoney(amount) {
  const n = BigInt(amount.minorUnits), negative = n < 0n, abs = negative ? -n : n;
  return `${negative ? '-' : ''}${({ GBP: '£', USD: '$', EUR: '€' })[amount.currency] ?? amount.currency + ' '}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
export function revenueText(amounts = [{ currency: 'GBP', minorUnits: '0' }]) { return amounts.map(exactMoney).join(' / '); }
