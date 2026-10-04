/* Repeated successful requests -> the existing routine review form. No scheduler writes here. */
'use strict';
const WorkflowTakeoverStore = (() => {
  let rows = [], offered = false, generation = 0, pending = null;
  const enabled = () => typeof MintStore === 'undefined' || !MintStore.enabled || MintStore.enabled();
  async function request(body) {
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 2500);
    try {
      const r = await fetch('/api/workflow-takeovers', { method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: ac.signal });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || 'Could not load workflow offers.');
      return data;
    } finally { clearTimeout(timer); }
  }
  function init() { generation++; rows = []; offered = false; pending = null; }
  function refresh() {
    if (!enabled()) { rows = []; return Promise.resolve(); }
    if (pending) return pending;
    const gen = generation;
    const work = request().then(data => { if (gen === generation) rows = data.candidates || []; })
      .catch(() => { if (gen === generation) rows = []; })
      .finally(() => { if (pending === work) pending = null; });
    pending = work; return work;
  }
  function pick(agentId) {
    if (offered || !enabled() || typeof AutomationWindow === 'undefined' || !AutomationWindow.openDraft) return null;
    return rows.find(c => c.agentId === (agentId || 'agent')) || null;
  }
  function notify(message) {
    if (typeof StationUI !== 'undefined' && StationUI.notify) StationUI.notify(message, 'warn');
  }
  function propose(c) {
    if (!c || offered || !enabled() || typeof Chat === 'undefined' || !Chat.nudge) return;
    const gen = generation;
    let handled = false;
    let shown;
    // This is only an offer to review: technical completion is not proof of unattended readiness.
    const card = Chat.nudge('You’ve asked me to “' + c.name + '” on ' + c.count +
      ' separate occasions, and those runs completed. Want me to take this off your plate? Review the instructions and choose when it should run.',
      [{ label: 'review takeover', value: 'review' }, { label: 'not now', value: 'defer', skip: true },
        { label: 'don’t offer this again', value: 'never', skip: true }], async choice => {
        if (gen !== generation || handled) return;
        const action = choice && choice.value;
        if (!['review', 'defer', 'never'].includes(action)) return;
        handled = true;
        try {
          await shown;
          const data = await request({ id: c.id, action });
          if (gen !== generation) return;
          if (typeof RecLedger !== 'undefined') {
            if (action === 'review' && RecLedger.accepted) RecLedger.accepted('routine');
            else if (RecLedger.declined) RecLedger.declined('routine', action === 'defer');
          }
          if (action === 'review') AutomationWindow.openDraft(Object.assign({}, data.candidate, { workflowTakeoverId: c.id }));
        } catch (e) { notify(e.message || 'Could not save this workflow decision.'); }
      }, { keepUntilDecision: true });
    if (!card) return;
    offered = true;
    shown = request({ id: c.id, action: 'shown' });
    shown.catch(() => {}); // review reports the error; an ignored card must not create an unhandled rejection
  }
  function candidate(agentId) {
    const c = pick(agentId); if (!c) return null;
    return { kind: 'routine', title: c.name, target: c.id, why: c.why,
      strength: 0.9, takeover: true, fire: () => propose(c) };
  }
  return { init, refresh, candidate };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = { WorkflowTakeoverStore };
