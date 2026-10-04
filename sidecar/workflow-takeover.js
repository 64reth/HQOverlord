'use strict';

// Read existing task/run history; never learn a workflow from a prompt counter alone.
const crypto = require('node:crypto');
const { makeDurableJsonStore } = require('./durable-store.js');
const DAY = 86400000;
const WINDOW = 60 * DAY;
const MIN_GAP = 20 * 3600000;
const MAX_OFFERS = 2;
const RETRY = /\b(try again|retry|still broken|still wrong|did(?:n't| not) work|fix (?:it|that|this)|instead|correction|redo|undo|revert)\b/i;
const INTERNAL = /^(cron|nightshift|workshop|scout|autopilot|system)[-:]/;
const clip = (s, n) => String(s == null ? '' : s).trim().slice(0, n);

// Deliberately small paraphrase vocabulary. Preserve targets, negation, numbers and paths.
// Different topics are not one workflow just because both start with “summarize”.
function signature(text) {
  let s = clip(text, 4000).toLowerCase().replace(/^(?:(?:please|can you|could you|would you)\s+)+/, '');
  if (!s || RETRY.test(s) || /\b(attached|attachment|this file|this document|above|below)\b/i.test(s)) return '';
  s = s.replace(/\b(?:compile|assemble)\b/g, 'prepare').replace(/\bsummarise\b/g, 'summarize');
  const words = s.match(/[\p{L}\p{N}_:/@.\\-]+/gu) || [];
  const kept = words.map(w => w.replace(/\.+$/, '')).filter(w => w && !/^(the|a|an|please)$/.test(w));
  if (kept.length < 4) return '';
  return kept.join(' '); // preserve source/destination roles and step order
}
function idFor(key) { return 'workflow-' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 24); }
function normalize(raw) {
  const x = raw || {};
  return { v: 1, forgottenAt: Math.max(0, Number(x.forgottenAt) || 0),
    decisions: (Array.isArray(x.decisions) ? x.decisions : []).filter(d => d && /^workflow-[a-f0-9]{24}$/.test(d.id))
      .slice(-200).map(d => ({ id: d.id, offers: Math.max(0, Number(d.offers) || 0),
        never: d.never === true, until: Math.max(0, Number(d.until) || 0), at: Math.max(0, Number(d.at) || 0) })) };
}
function candidates(input) {
  const { briefs = [], runs = [], ratings = [], jobs = [], now = 0, redact = s => s } = input || {};
  const state = normalize(input && input.state);
  if (input && input.enabled === false) return [];
  const runMap = new Map(runs.map(r => [r.runId, r]));
  const ratingMap = new Map(ratings.map(r => [r.runId, r.verdict]));
  const groups = new Map();
  const seen = new Set();
  for (const b of briefs.slice(0, 500)) {
    const r = runMap.get(b.runId);
    if (!r || seen.has(r.runId) || r.internal || INTERNAL.test(r.streamId || '') ||
        !['interactive', 'channel'].includes(b.source) || b.agentId !== r.agentId) continue;
    seen.add(r.runId);
    const at = Number(b.completedAt || b.updatedAt);
    if (!(at > state.forgottenAt && at <= now && now - at <= WINDOW)) continue;
    const text = clip(b.originalDirective, 4000);
    if (redact(text) !== text) continue; // never carry a credential-bearing request into a proposed routine
    const sig = signature(text); if (!sig) continue;
    const project = String(r.projectRoot || '');
    const key = [b.agentId, project, sig].join('\n');
    const rows = groups.get(key) || [];
    const uncertain = r.completionEvidence && (['verification_required', 'incomplete'].includes(r.completionEvidence.completionVerdict) ||
      ['unverified_effects', 'judgment_required'].includes(r.completionEvidence.effectVerdict));
    const ok = !['ok', 'miss'].includes(ratingMap.get(r.runId)) &&
      b.status === 'done' && r.reason === 'done' && !r.clarifying && !uncertain &&
      !(r.uncertainMutations || []).length && (r.toolsOk > 0 || (r.artifacts || []).length > 0);
    rows.push({ b, r, text, at, ok }); groups.set(key, rows);
  }
  const out = [];
  for (const [key, rows] of groups) {
    rows.sort((a, b) => a.at - b.at);
    let occasions = [];
    for (const row of rows) {
      if (!row.ok) { occasions = []; continue; } // repeated failures never earn a takeover
      if (!occasions.length || row.at - occasions[occasions.length - 1].at >= MIN_GAP) occasions.push(row);
      else occasions[occasions.length - 1] = row; // one work session counts once, using its latest instructions
    }
    if (occasions.length < 3) continue;
    const last = occasions[occasions.length - 1];
    const id = idFor(key), decision = state.decisions.find(d => d.id === id);
    if (decision && (decision.never || decision.until > now || decision.offers >= MAX_OFFERS)) continue;
    if (jobs.some(j => (j.meta && j.meta.workflowTakeoverId === id) ||
      (j.agentId === last.b.agentId && signature(j.prompt) === signature(last.text)))) continue;
    const evidence = occasions.slice(-6).map(x => ({ briefId: x.b.id, runId: x.r.runId, at: x.at, quote: clip(x.text, 400) }));
    const answers = (last.b.questions || []).filter(q => q.answer).map(q => '- ' + clip(redact(q.text), 240) + ': ' + clip(redact(q.answer), 500));
    const settled = last.b.settled || {};
    const context = [];
    for (const field of ['deliverable', 'audience', 'success']) if (settled[field]) context.push(field + ': ' + clip(redact(settled[field]), 500));
    for (const source of (settled.sources || [])) context.push('source: ' + clip(redact(source), 300));
    const prompt = [last.text, context.length ? '\nDetails from the last completed task:\n' + context.join('\n') : '',
      answers.length ? '\nChoices from the last completed task (review for future runs):\n' + answers.join('\n') : ''].filter(Boolean).join('\n');
    out.push({ id, name: clip(last.text.replace(/\s+/g, ' '), 80), prompt, agentId: last.b.agentId,
      workdir: last.r.projectRoot || '', count: occasions.length, lastAt: last.at, evidence,
      why: 'You asked for this workflow on ' + occasions.length + ' separate occasions, and each recorded run completed with tool work or an artifact.' });
  }
  return out.sort((a, b) => b.lastAt - a.lastAt || b.count - a.count).slice(0, 3);
}
function makeWorkflowTakeoverStore(deps) {
  const durable = makeDurableJsonStore({ fs: deps.fs, path: deps.path,
    fileFor: () => deps.path.join(deps.workspaces, 'workflow-takeovers.json'),
    writeDurable: deps.writeDurable, onRecover: deps.onRecover, onCorrupt: deps.onCorrupt });
  const read = () => normalize(durable.get('workflow-takeovers'));
  function decide(id, action, now) {
    if (!/^workflow-[a-f0-9]{24}$/.test(id) || !['shown', 'defer', 'never', 'review'].includes(action)) return Promise.resolve(false);
    return durable.update('workflow-takeovers', raw => {
      const s = normalize(raw); let d = s.decisions.find(x => x.id === id);
      if (!d) { d = { id, offers: 0, never: false, until: 0, at: 0 }; s.decisions.push(d); }
      if (action === 'shown') { d.offers++; d.until = now + DAY; }
      if (action === 'defer') { d.until = now + 7 * DAY; d.offers = Math.min(d.offers, MAX_OFFERS - 1); }
      if (action === 'review') d.until = now + 7 * DAY;
      if (action === 'never') d.never = true;
      d.at = now; return normalize(s);
    }).then(() => true);
  }
  const forget = now => durable.update('workflow-takeovers', () => ({ v: 1, forgottenAt: now, decisions: [] }));
  return { read, decide, forget };
}
module.exports = { signature, candidates, makeWorkflowTakeoverStore, normalize, MIN_GAP };
