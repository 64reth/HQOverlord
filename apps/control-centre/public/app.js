import { initialView, hydrate, disconnected } from './client-state.js';
import { renderRoom } from './room.js';
let view = initialView(), page = 'Overview', stream = null, lastSeen = 0, business = '', busy = false;
const pages = ['Overview','Businesses','Agents','Jobs','Approvals','Ledger','Activity'];
const $ = id => document.getElementById(id);
const node = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
const card = title => { const n = node('section', undefined, 'card'); n.append(node('h2', title)); return n; };
const badge = state => node('span', state.replaceAll('-', ' '), `pill ${state}`);
const detail = (label, value) => { const d = node('details'); d.append(node('summary', label), node('pre', JSON.stringify(value, null, 2))); return d; };
const btn = (label, action) => { const b = node('button', label); b.type = 'button'; b.disabled = busy || view.connection !== 'connected'; b.onclick = action; return b; };
const empty = text => node('p', text, 'empty');
for (const name of pages) { const button = btn(name, () => { page = name; render(); }); button.disabled = false; button.dataset.page = name; $('nav').append(button); }
async function command(path, input) {
  if (view.connection !== 'connected' || busy) return;
  busy = true; $('notice').textContent = 'Submitting to HQ runtime…'; render();
  try { const response = await fetch(`/api/${path}?business=${encodeURIComponent(business)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Operation refused'); $('notice').textContent = path === 'run' ? 'Run submitted. Progress comes from runtime telemetry.' : 'Saved by HQ runtime.';
  } catch (error) { $('notice').textContent = error.message; } finally { busy = false; render(); }
}
function mission(snapshot) {
  const metadata = snapshot.metadata; if (!metadata) return empty('No mission metadata configured.');
  const panel = node('section', undefined, 'mission'), copy = node('div');
  copy.append(node('p', snapshot.business.name.toUpperCase(), 'eyebrow'), node('h2', metadata.mission.name), node('p', metadata.mission.goal), badge(snapshot.business.status));
  const deadline = node('div', undefined, 'deadline'); deadline.append(node('p', 'MISSION DEADLINE', 'eyebrow'), node('strong', metadata.mission.deadline), node('p', metadata.mission.timezone, 'muted'));
  panel.append(copy, deadline); return panel;
}
function activity(snapshot, limit = 15) { const section = card('Runtime activity'); const rows = snapshot.activity.slice(-limit).reverse();
  if (!rows.length) section.append(empty('No recorded events.'));
  for (const fact of rows) { const row = node('div', undefined, 'activity-row'); row.append(node('strong', fact.type), node('time', `${fact.occurredAt} · ${fact.actor.kind}: ${fact.actor.id}`), detail('Provenance / event', fact)); section.append(row); } return section;
}
function jobs(snapshot) { const list = node('div'); if (!snapshot.jobs.length) return empty('No jobs.');
  for (const job of snapshot.jobs) {
    const c = card(job.objective), row = node('div', undefined, 'row');
    row.append(badge(view.connection === 'connected' ? job.visualState : 'unknown'), node('span', snapshot.agents.find(a => a.id === job.agentId)?.name || 'Unassigned', 'muted')); c.append(row);
    c.append(node('p', `Job ${job.id} · ${job.model ? `${job.model.provider} / ${job.model.model}` : 'No provider invocation recorded'}`, 'muted'));
    if (job.blockedBy.length) c.append(node('p', `Blocked by: ${job.blockedBy.join(', ')}`, 'status-note'));
    c.append(detail('Dependencies and input/output artifacts', { dependencies: job.dependsOn || [], inputArtifacts: job.inputs, outputArtifacts: job.outputs,
      artifacts: snapshot.artifacts.filter(a => job.inputs.includes(a.id) || job.outputs.includes(a.id)) }));
    c.append(detail('Usage, cost and tool activity', { model: job.model, meteredExpenses: job.spend, execution: job.execution }));
    const actions = node('div', undefined, 'actions');
    const delivery = snapshot.agents.find(a => a.id === job.agentId)?.toolIds.includes('artifact.release');
    const approved = snapshot.approvals.some(a => a.jobId === job.id && a.status === 'approved');
    if (job.visualState === 'queued' || job.visualState === 'waiting-for-approval' && approved) {
      if (snapshot.modelEnabled || delivery) actions.append(btn(approved ? 'Resume approved handoff' : delivery ? 'Request human release' : 'Run job', () => command('run', { jobId: job.id })));
      else c.append(node('p', 'Paid execution disabled. Start server with explicit model execution enabled to run this job.', 'muted'));
    }
    if (['queued','running'].includes(job.status)) actions.append(btn('Cancel job', () => command('cancel', { jobId: job.id })));
    c.append(actions); list.append(c);
  } return list;
}
function render() {
  $('page-title').textContent = page; for (const button of $('nav').children) button.classList.toggle('active', button.dataset.page === page);
  $('connection').textContent = view.connection === 'connected' ? 'Live' : view.connection === 'disconnected' ? 'Disconnected · stale' : 'Connecting'; $('link-lamp').className = `lamp ${view.connection}`;
  const content = $('content'); content.replaceChildren(); const s = view.snapshot;
  if (!s) { content.append(empty('Waiting for an authoritative snapshot.')); return; }
  if (page === 'Overview') {
    content.append(mission(s)); const metrics = node('div', undefined, 'metrics');
    for (const [label, value] of [['Businesses in scope',s.businesses.length],['Agents',s.summary.agents],['Running / queued',`${s.summary.running} / ${s.summary.queued}`],['Pending approvals',s.summary.pendingApprovals],['Model spend · USD',s.summary.modelSpend]]) {
      const m = node('div', undefined, 'metric'); m.append(node('small',label),node('strong',String(value), label.includes('spend') ? 'money' : '')); metrics.append(m);
    } content.append(metrics);
    if (s.summary.unsettledInvocations) content.append(node('p', `${s.summary.unsettledInvocations} unsettled provider invocation(s): shown spend is known cost only; reservations remain held.`, 'status-note'));
    content.append(renderRoom(s.agents, view.connection), activity(s, 6));
  } else if (page === 'Businesses') {
    content.append(mission(s)); const budget = card('Business budget & authority'); budget.append(detail('Configured allocation, model routing and manual boundaries', { budgets: s.metadata?.budgets, routing: s.metadata?.modelRouting, authority: s.metadata?.authority }), node('p', 'GBP allocation is configuration. No FX conversion, provider balance or earned revenue is inferred.', 'muted')); content.append(budget);
    const prepare = card('Prepare a mission attempt'); prepare.append(node('p', 'Supply genuine prospect/source material. This creates five dependent jobs and durable source evidence; preparation makes no model call or customer contact.', 'muted'));
    const form = node('form', undefined, 'form'); for (const [name,label,tag] of [['id','Stable attempt identifier','input'],['url','Public source URL (optional)','input'],['material','Human-supplied source material','textarea']]) {
      const l = node('label',label), field = node(tag); field.name = name; field.required = name !== 'url'; l.append(field); form.append(l);
    } const submit = btn('Prepare dependent jobs', () => {}); submit.type = 'submit'; form.append(submit); form.onsubmit = event => { event.preventDefault(); command('prepare', Object.fromEntries(new FormData(form))); }; prepare.append(form); content.append(prepare);
    content.append(renderRoom(s.agents, view.connection), jobs(s));
  } else if (page === 'Agents') {
    const grid = node('div', undefined, 'grid'); for (const agent of s.agents) {
      const c = card(agent.name); c.append(badge(view.connection === 'connected' ? agent.visualState : 'unknown'), node('p', `${s.business.name} · ${agent.currentJobId || 'No assigned job'}`, 'muted'), node('p', agent.model ? `${agent.model.provider} / ${agent.model.model}` : 'Model not yet known', 'muted'), detail('Allowed capabilities / tool IDs', { capabilities: agent.capabilities, toolIds: agent.toolIds }));
      c.append(detail('Recent activity', s.activity.filter(f => f.payload.agentId === agent.id || f.actor.id === agent.id || f.payload.jobId && s.jobs.some(j => j.id === f.payload.jobId && j.agentId === agent.id)).slice(-8))); grid.append(c);
    } content.append(grid);
  } else if (page === 'Jobs') content.append(jobs(s));
  else if (page === 'Approvals') {
    if (!s.approvals.length) content.append(empty('No approvals requested.'));
    for (const approval of s.approvals) { const c = card(approval.reason); c.append(badge(approval.status), node('p', `Job ${approval.jobId} · operation ${approval.operationId}`, 'muted'), detail('Exact operation for review', approval.toolCall));
      if (approval.status === 'pending') { const actions = node('div',undefined,'actions'); actions.append(btn('Approve exact operation', () => command('approval',{ approvalId:approval.id,decision:'approve' })),btn('Reject', () => command('approval',{ approvalId:approval.id,decision:'reject' }))); c.append(actions); } content.append(c);
    }
  } else if (page === 'Ledger') {
    const c = card('Recorded money'); c.append(node('p', `Known provider spend: ${s.summary.modelSpend}. No expense is inferred from a reservation.`, 'muted'));
    if (!s.ledger.length && !s.expenses.length) c.append(empty('No recorded expenses or revenue.'));
    for (const expense of s.expenses) c.append(detail(`${expense.description} · ${expense.occurredAt}`, expense));
    for (const entry of s.ledger) c.append(detail(`${entry.kind} · ${entry.amount.currency} ${entry.amount.minorUnits} minor units`, entry)); content.append(c);
  } else content.append(activity(s,60));
}
function connect() {
  stream?.close(); view = { ...view, connection:'connecting' }; render();
  const source = new EventSource(`/api/events${business ? `?business=${encodeURIComponent(business)}` : ''}`); stream = source;
  source.addEventListener('snapshot', event => { if (source !== stream) return;
    try { const snapshot = JSON.parse(event.data); lastSeen = Date.now(); view = hydrate(view,snapshot,lastSeen); business = snapshot.business.id;
      const select = $('business-select'); select.replaceChildren(); for (const b of snapshot.businesses) { const option = node('option',b.name); option.value = b.id; option.selected = b.id === business; select.append(option); }
      if ($('notice').textContent.startsWith('Loading') || $('notice').textContent.startsWith('Telemetry')) $('notice').textContent = ''; render();
    } catch { view = disconnected(view); $('notice').textContent = 'Telemetry payload unavailable; displayed values are stale.'; render(); }
  });
  source.addEventListener('heartbeat', () => { if (source === stream) lastSeen = Date.now(); });
  source.onerror = () => { if (source !== stream) return; view = disconnected(view); $('notice').textContent = 'Telemetry disconnected. Displayed values are stale; reconnect will hydrate from HQ.'; render(); };
}
$('business-select').onchange = event => { business = event.target.value; view = initialView(); connect(); };
setInterval(() => { if (view.connection === 'connected' && Date.now() - lastSeen > 25000) { view = disconnected(view); $('notice').textContent = 'Telemetry stale. Reconnecting to HQ…'; connect(); } },5000);
connect();
