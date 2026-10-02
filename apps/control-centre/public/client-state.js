/** Client state is only a received projection and transport health, never canonical operations. */
export function initialView() { return { snapshot: null, connection: 'connecting', receivedAt: null }; }
export function hydrate(view, snapshot, receivedAt) { return { ...view, snapshot, connection: 'connected', receivedAt }; }
export function disconnected(view) { return { ...view, connection: 'disconnected' }; }
export function visualState(agent, connection) { return connection === 'connected' ? agent.visualState : 'unknown'; }
