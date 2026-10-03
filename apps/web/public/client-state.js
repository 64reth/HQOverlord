/** Received state and local selection only; never canonical operational state. */
export function initialView() { return { snapshot: null, connection: 'connecting', receivedAt: null, selectedAgentId: null, selectionLost: false }; }
export function hydrate(view, snapshot, receivedAt) {
  const agents = snapshot.agents.filter(a => a.businessId === snapshot.business.id);
  const fresh = !view.snapshot || view.snapshot.business.id !== snapshot.business.id;
  const retained = agents.some(a => a.id === view.selectedAgentId);
  const selectedAgentId = fresh ? agents[0]?.id ?? null : retained ? view.selectedAgentId : null;
  return { ...view, snapshot, connection: 'connected', receivedAt, selectedAgentId, selectionLost: !fresh && !retained && (view.selectionLost || !!view.selectedAgentId) };
}
export function selectAgent(view, id) { return view.snapshot?.agents.some(a => a.id === id && a.businessId === view.snapshot.business.id) ? { ...view, selectedAgentId: id, selectionLost: false } : view; }
export function disconnected(view) { return { ...view, connection: 'disconnected' }; }
export function visualState(agent, connection) { return connection === 'connected' ? agent.visualState : 'unknown'; }
export function mutationsAllowed(view) { return view.connection === 'connected' && !!view.snapshot; }
export function expireTransport(view, lastSeen, now) {
  return lastSeen && now - lastSeen > 25000 && view.connection === 'connected' ? disconnected(view) : view;
}
