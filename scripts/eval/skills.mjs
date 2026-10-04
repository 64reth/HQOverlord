/* scripts/eval/skills.mjs — SKILL GOLDEN REGRESSION (consistency loop, slice 4, 2026-08-22).
 *
 *   npm run eval:skills -- [--base http://127.0.0.1:8787] [--agent agent] [--skill <id>] [--repeat N] [--model id] [--provider id] [--token T] [--json out.json]
 *   (--model/--provider default to SKYNET_DEFAULT_MODEL / SKYNET_PROVIDER; /api/run needs a model. --token defaults to
 *    STARNET_API_TOKEN — every /api route is token-gated per launch; start the sidecar with a fixed token to script it)
 *
 * For every golden on record (GET /api/agent-skills/goldens — great-rated runs frozen per skill), drive the golden's
 * directive through the REAL run endpoint of a RUNNING sidecar, read the output off the run's NDJSON stream, and
 * grade it with sidecar/skills/goldens.js check() — a deterministic shape+content consistency measure (length band +
 * keyword overlap, thresholds printed). --repeat N runs each golden N times and reports the pass RATE, which is the
 * actual answer to "does the same task give the same output".
 *
 * WHAT THIS MEASURES depends on who answered: the report names the model per run. A live model → a real consistency
 * measure. A scripted/replay provider (test/model, replay/model) → PLUMBING ONLY (the skill reached the prompt, the
 * runner and grader work); the summary says so and never prints a green consistency claim for it.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const goldens = require('../../sidecar/skills/goldens.js');

const PLUMBING_MODELS = /^(test\/model|replay\/model|mock\/|replay\/)/;

export function parseArgs(argv) {
  const o = { base: 'http://127.0.0.1:8787', agent: 'agent', skill: '', repeat: 1, token: process.env.STARNET_API_TOKEN || process.env.SKYNET_API_TOKEN || '', json: '', model: process.env.SKYNET_DEFAULT_MODEL || '', provider: process.env.SKYNET_PROVIDER || '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === '--base') { o.base = String(v || o.base).replace(/\/$/, ''); i++; }
    else if (a === '--agent') { o.agent = String(v || o.agent); i++; }
    else if (a === '--skill') { o.skill = String(v || ''); i++; }
    else if (a === '--repeat') { o.repeat = Math.max(1, Math.floor(Number(v) || 1)); i++; }
    else if (a === '--token') { o.token = String(v || ''); i++; }
    else if (a === '--json') { o.json = String(v || ''); i++; }
    else if (a === '--model') { o.model = String(v || ''); i++; }
    else if (a === '--provider') { o.provider = String(v || ''); i++; }
  }
  return o;
}

/* summarize — pure: per-skill pass rates + the honest mode label. results: [{skillId, goldenId, model, pass, ...}] */
export function summarize(results) {
  const bySkill = {};
  let plumbingOnly = results.length > 0;
  for (const r of results) {
    const s = bySkill[r.skillId] = bySkill[r.skillId] || { skillId: r.skillId, runs: 0, passed: 0, goldens: new Set(), models: new Set() };
    s.runs++; if (r.pass) s.passed++; s.goldens.add(r.goldenId); s.models.add(r.model || '?');
    if (!PLUMBING_MODELS.test(String(r.model || ''))) plumbingOnly = false;
  }
  const rows = Object.values(bySkill).map(s => ({ skillId: s.skillId, runs: s.runs, passed: s.passed, rate: s.runs ? Number((s.passed / s.runs).toFixed(3)) : 0, goldens: s.goldens.size, models: Array.from(s.models) }));
  rows.sort((a, b) => a.rate - b.rate || a.skillId.localeCompare(b.skillId));
  const total = results.length, passed = results.filter(r => r.pass).length;
  return { rows, total, passed, rate: total ? Number((passed / total).toFixed(3)) : 0, mode: total === 0 ? 'empty' : (plumbingOnly ? 'plumbing' : 'live') };
}

export function render(sum) {
  const lines = [];
  if (sum.mode === 'empty') { lines.push('eval:skills — no goldens on record (rate a skill-loaded run ▲ nailed it to mint one)'); return lines.join('\n'); }
  for (const r of sum.rows) lines.push((r.rate >= 1 ? 'PASS ' : r.rate > 0 ? 'FLAKY' : 'FAIL ') + ' ' + r.skillId.padEnd(32) + ' ' + r.passed + '/' + r.runs + ' (' + (r.rate * 100).toFixed(0) + '%)  goldens=' + r.goldens + '  model=' + r.models.join(','));
  lines.push('thresholds: length ratio ' + goldens.LENGTH_MIN + '–' + goldens.LENGTH_MAX + ', keyword overlap ≥ ' + (goldens.OVERLAP_MIN * 100).toFixed(0) + '%');
  if (sum.mode === 'plumbing') lines.push('MODE: PLUMBING ONLY — a scripted/replay model answered. This proves the skill reached the prompt and the grader runs; it is NOT a consistency measure. Point --base at a sidecar with a live model for one.');
  else lines.push('MODE: LIVE — ' + sum.passed + '/' + sum.total + ' golden runs consistent (' + (sum.rate * 100).toFixed(0) + '%)');
  return lines.join('\n');
}

async function jget(base, path, token) {
  const r = await fetch(base + path, { headers: Object.assign({ Origin: base }, token ? { 'X-StarNet-Token': token } : {}) });
  if (!r.ok) throw new Error('GET ' + path + ' → ' + r.status);
  return r.json();
}

/* driveRun — POST the directive to the real run endpoint and read the per-run NDJSON stream: `agent.token` deltas
   are the output (the run row's deliveryText exists only for session-scoped runs, so the stream is the truth),
   `agent.run.end` carries reason + model. Returns { runId, text, model, reason }. */
async function driveRun(base, token, agentId, text, o) {
  const r = await fetch(base + '/api/run', {
    method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', Origin: base }, token ? { 'X-StarNet-Token': token } : {}),
    body: JSON.stringify(Object.assign({ agentId, isTask: true, messages: [{ role: 'user', content: text }] }, o && o.model ? { model: o.model } : {}, o && o.provider ? { provider: o.provider } : {}))
  });
  if (!r.ok || !r.body) throw new Error('POST /api/run → ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120));
  const reader = r.body.getReader(); const dec = new TextDecoder();
  let buf = '', out = '', runId = '', model = '', reason = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf(String.fromCharCode(10))) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev; try { ev = JSON.parse(line); } catch (_) { continue; }
      const p = ev && ev.payload ? ev.payload : {};
      if (ev.name === 'agent.run.start') { runId = p.runId || runId; model = p.model || model; }
      else if (ev.name === 'agent.token' && typeof p.delta === 'string') out += p.delta;
      else if (ev.name === 'agent.run.end') { reason = p.reason || ''; model = p.model || model; }
    }
  }
  if (!runId) throw new Error('no agent.run.start on the stream');
  return { runId, text: out.trim(), model, reason };
}

export async function main(argv) {
  const o = parseArgs(argv);
  const all = await jget(o.base, '/api/agent-skills/goldens?agent=' + encodeURIComponent(o.agent), o.token);
  const bySkill = all.bySkill || {};
  const results = [];
  for (const skillId of Object.keys(bySkill)) {
    if (o.skill && skillId !== o.skill) continue;
    for (const g of bySkill[skillId]) {
      for (let n = 0; n < o.repeat; n++) {
        let row = null, err = '';
        try { row = await driveRun(o.base, o.token, o.agent, g.directive, o); } catch (e) { err = String((e && e.message) || e); }
        const verdict = row ? (row.reason && row.reason !== 'done' ? { pass: false, reason: 'run ended ' + row.reason, lengthRatio: 0, overlap: 0 } : goldens.check(g, row.text || '')) : { pass: false, reason: err || 'no run', lengthRatio: 0, overlap: 0 };
        results.push({ skillId, goldenId: g.id, directive: g.directive, runId: row ? row.runId : '', model: row ? (row.model || '') : '', pass: !!verdict.pass, lengthRatio: verdict.lengthRatio, overlap: verdict.overlap, reason: verdict.reason || '' });
        process.stdout.write((verdict.pass ? '  ok   ' : '  MISS ') + skillId + ' · ' + g.directive.slice(0, 60) + (verdict.reason ? ' — ' + verdict.reason : '') + '\n');
      }
    }
  }
  const sum = summarize(results);
  process.stdout.write(render(sum) + '\n');
  if (o.json) writeFileSync(o.json, JSON.stringify({ base: o.base, agent: o.agent, results, summary: Object.assign({}, sum, { rows: sum.rows }) }, null, 2));
  return sum;
}

if (process.argv[1] && /skills\.mjs$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main(process.argv.slice(2)).then(sum => { process.exit(sum.mode === 'live' && sum.rate < 1 ? 1 : 0); }, e => { console.error('eval:skills failed: ' + ((e && e.message) || e)); process.exit(2); });
}
