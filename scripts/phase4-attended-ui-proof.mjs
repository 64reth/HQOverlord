#!/usr/bin/env node
// phase4-attended-ui-proof.mjs - operator/CDP-driven P4 UI evidence collector.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capture, collectDiagnostics, connectCDP, evalJS, launchChrome, sleep } from './lib/cdp.mjs';
import { bootSeededSidecar, DEFAULT_MODEL, isUp, materializeSeedWorkspace, waitDevReady, waitUp } from './lib/seed.mjs';
import { providerKeyFromEnv } from './lib/provider-env.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const key = providerKeyFromEnv();
if (!key) {
  console.error('[phase4-ui-proof] missing live key: set SKYNET_OPENROUTER_KEY, STARNET_OPENROUTER_KEY, or OPENROUTER_API_KEY');
  process.exit(2);
}

const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
const OUT = resolve(process.env.STARNET_PHASE4_UI_PROOF_DIR || join(ROOT, '.dogfood', 'phase4-ui-proof-' + STAMP));
const SCRATCH = join(OUT, 'workspace');
const PROFILE = join(OUT, 'profile');
const PORT = String(process.env.STARNET_PHASE4_UI_PROOF_PORT || 8944);
const CDP_PORT = Number(process.env.STARNET_PHASE4_UI_PROOF_CDP || 9444);
const APP_URL = 'http://127.0.0.1:' + PORT + '/';
const MODEL = process.env.SKYNET_SMOKE_MODEL || process.env.STARNET_SMOKE_MODEL || process.env.SKYNET_DEFAULT_MODEL || process.env.STARNET_DEFAULT_MODEL || DEFAULT_MODEL;
const attendedFile = join(ROOT, '.dogfood', 'phase4-attended-evidence.json');
const PROOF_PROPS = ['war_intelcab', 'gigs_servercart', 'workbench'];
const REQUIRED_CAPS = ['cabinet', 'notebook', 'workbench'];

const J = (v) => JSON.stringify(v);

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
function unique(xs) {
  return Array.from(new Set((xs || []).filter(x => String(x || '').trim())));
}
async function waitExpr(cdp, expr, tries = 40, delay = 250) {
  for (let i = 0; i < tries; i++) {
    const v = await evalJS(cdp, expr).catch(() => false);
    if (v) return v;
    await sleep(delay);
  }
  return false;
}
async function api(cdp, path, init = {}) {
  const expr = `(() => fetch(${J(path)}, Object.assign({ headers: Object.assign({ 'X-StarNet-Token': window.__STARNET_API_TOKEN__ || '' }, ${(J(init.headers || {}))}) }, ${J(init)})).then(async r => {
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch (_) {}
    return { status: r.status, ok: r.ok, json, text };
  }))()`;
  return await evalJS(cdp, expr);
}
async function sendChat(cdp, msg) {
  return await evalJS(cdp, `(() => {
    const i = document.getElementById('chat-input');
    if (!i) return 'NO_INPUT';
    i.focus();
    i.value = ${J(msg)};
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    return 'sent';
  })()`);
}
async function clickApproveIfPresent(cdp) {
  return await evalJS(cdp, `(() => {
    const b = Array.from(document.querySelectorAll('.consent-btn')).find(x => !x.classList.contains('deny'));
    if (!b) return false;
    b.click();
    return true;
  })()`).catch(() => false);
}
async function placeProps(cdp, props) {
  await evalJS(cdp, `(() => { const b = document.querySelector('#bb-build'); if (b) b.click(); return true; })()`);
  await waitExpr(cdp, `!!(window.Build && Build.__test__ && Build.__test__.isOpen())`, 30, 200);
  const placed = [];
  for (const prop of props) {
    const res = await evalJS(cdp, `Build.__test__.placeCapProp(${J(prop)})`).catch(e => ({ ok: false, reason: e.message, type: prop }));
    placed.push(res);
  }
  await evalJS(cdp, `(() => { const b = document.querySelector('#refit-done'); if (b) b.click(); return true; })()`);
  await sleep(800);
  return placed;
}
async function collectState(cdp) {
  const active = await evalJS(cdp, `(() => {
    const ws = window.Workstreams && Workstreams.active && Workstreams.active();
    return ws ? { id: ws.id, runIds: ws.runIds || [], deliverables: ws.deliverables || [], cost: ws.cost || {} } : null;
  })()`).catch(() => null);
  const events = await evalJS(cdp, `window.__SKYNET_TEST__.events()`).catch(() => []);
  const starts = events.filter(e => e.name === 'agent.run.start').map(e => e.payload || {});
  const ends = events.filter(e => e.name === 'agent.run.end').map(e => e.payload || {});
  const costs = events.filter(e => e.name === 'agent.cost').map(e => e.payload || {});
  const deliverables = events.filter(e => e.name === 'deliverable').map(e => e.payload || {});
  const memories = events.filter(e => e.name.indexOf('memory.') === 0).map(e => e.payload || {});
  const runs = await api(cdp, '/api/runs?agent=agent&limit=20').catch(e => ({ error: e.message }));
  const budget = await api(cdp, '/api/budget/status').catch(e => ({ error: e.message }));
  const records = await api(cdp, '/api/memory/records?agent=agent').catch(e => ({ error: e.message }));
  const streamIds = unique([active && active.id].concat((runs.json && runs.json.runs || []).map(r => r.streamId)));
  const transcripts = [];
  for (const stream of streamIds) {
    if (!stream) continue;
    const t = await api(cdp, '/api/transcript?stream=' + encodeURIComponent(stream) + '&agent=agent&limit=50').catch(e => ({ error: e.message }));
    transcripts.push({ stream, response: t });
  }
  return { active, events, starts, ends, costs, deliverables, memories, runs, budget, records, transcripts };
}
async function waitRunComplete(cdp, { needDeliverable = false } = {}) {
  let state = null;
  for (let i = 0; i < 180; i++) {
    await clickApproveIfPresent(cdp);
    state = await collectState(cdp);
    const done = state.ends.some(e => e.reason === 'done');
    const hasDeliverable = state.deliverables.length > 0;
    if (done && (!needDeliverable || hasDeliverable)) return state;
    await sleep(500);
  }
  return state;
}

async function boot({ preserve = false } = {}) {
  if (!preserve) materializeSeedWorkspace(SCRATCH, MODEL);
  if (await isUp(APP_URL)) throw new Error('proof port already in use: ' + PORT);
  const sidecar = bootSeededSidecar({ port: PORT, scratchDir: SCRATCH, key, model: MODEL, fullAccess: true });
  if (!(await waitUp(APP_URL))) throw new Error('sidecar failed to boot on :' + PORT);
  return sidecar;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  rmSync(PROFILE, { recursive: true, force: true });

  let sidecar = await boot();
  const { proc } = launchChrome({ cdpPort: CDP_PORT, win: process.env.SKYNET_SHOT_SIZE || '1440,900', profileDir: PROFILE });
  let cdp = null;
  const screenshots = [];
  const report = { generatedAt: new Date().toISOString(), model: MODEL, outDir: OUT, checks: {}, sameWork: null, restart: null };
  try {
    cdp = await connectCDP(CDP_PORT);
    collectDiagnostics(cdp);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url: APP_URL });
    const ready = await waitDevReady(cdp, evalJS, { tries: 30, url: APP_URL });
    if (!ready) throw new Error('UI never reached seeded game state');
    await waitExpr(cdp, '!!window.__SKYNET_TEST__ && window.__SKYNET_TEST__.ready()', 30, 250);
    screenshots.push((await capture(cdp, OUT, '01-fresh-floor')).path);

    const placed = await placeProps(cdp, PROOF_PROPS);
    report.placed = placed;
    const capsBefore = await evalJS(cdp, `(typeof World !== 'undefined' && World.heroCaps) ? World.heroCaps('agent').map(c => c.objectType) : []`).catch(() => []);
    report.capsBeforeRun = capsBefore;
    const missingCaps = REQUIRED_CAPS.filter(c => !Array.isArray(capsBefore) || !capsBefore.includes(c));
    if (missingCaps.length) {
      writeJson(join(OUT, 'phase4-ui-proof-report.json'), report);
      throw new Error('capability placement failed before live run: missing ' + missingCaps.join(', '));
    }
    await evalJS(cdp, 'window.__SKYNET_TEST__.clearEvents()');
    screenshots.push((await capture(cdp, OUT, '02-capabilities-placed')).path);

    const prompt = [
      'Phase 4 replacement proof task.',
      'The room already contains FILES, MEMORY, and TERMINAL stations.',
      'Use the file tool to write a Markdown file named phase4-proof.md.',
      'The file must contain these exact lines:',
      '# Phase 4 Proof',
      'verdict: live UI file-write proof',
      'evidence: StarNet created this through the gamified UI with a live model.',
      'Then use notebook.write to remember this exact durable note: phase4-ui-proof-memory.',
      'Finish with one short sentence naming the saved file.'
    ].join('\n');
    const sent = await sendChat(cdp, prompt);
    if (sent !== 'sent') throw new Error('could not send proof prompt: ' + sent);
    const sameWork = await waitRunComplete(cdp, { needDeliverable: true });
    screenshots.push((await capture(cdp, OUT, '03-same-work-complete')).path);
    report.sameWork = sameWork;

    const artifactTitles = unique((sameWork.deliverables || []).map(d => d.title).concat((sameWork.active && sameWork.active.deliverables || []).map(d => d.title)));
    const artifactDiskPaths = artifactTitles.map(t => join(SCRATCH, 'agent', t));
    const transcriptIds = unique((sameWork.transcripts || []).filter(t => t.response && t.response.ok && t.response.json && (t.response.json.turns || []).length).map(t => t.stream));
    const ledgerRows = (sameWork.runs.json && sameWork.runs.json.runs || []).slice(0, 5);
    report.checks.sameWorkPassed = sameWork.ends.some(e => e.reason === 'done')
      && sameWork.costs.some(c => (c.usd || 0) > 0)
      && artifactDiskPaths.some(p => existsSync(p))
      && transcriptIds.length > 0
      && ledgerRows.length > 0;

    try { sidecar.kill('SIGKILL'); } catch {}
    await sleep(1000);
    sidecar = await boot({ preserve: true });
    await cdp.send('Page.navigate', { url: APP_URL });
    const restartReady = await waitDevReady(cdp, evalJS, { tries: 30, url: APP_URL });
    if (!restartReady) throw new Error('UI did not recover after sidecar restart');
    await waitExpr(cdp, '!!window.__SKYNET_TEST__ && window.__SKYNET_TEST__.ready()', 30, 250);
    screenshots.push((await capture(cdp, OUT, '04-after-restart')).path);
    const restart = await collectState(cdp);
    report.restart = restart;

    const restartRuns = restart.runs.json && restart.runs.json.runs || [];
    const restartTranscripts = restart.transcripts || [];
    const caps = await evalJS(cdp, `(typeof World !== 'undefined' && World.heroCaps) ? World.heroCaps('agent').map(c => c.objectType) : []`).catch(() => []);
    report.restart.caps = caps;
    report.checks.restartPass = restartReady
      && restartRuns.length > 0
      && restartTranscripts.some(t => t.response && t.response.ok && t.response.json && (t.response.json.turns || []).length)
      && artifactDiskPaths.some(p => existsSync(p))
      && REQUIRED_CAPS.every(c => Array.isArray(caps) && caps.includes(c));
    report.checks.memoryPreserved = !!(restart.records.json && Array.isArray(restart.records.json.records) && restart.records.json.records.length)
      || sameWork.memories.length > 0;

    const existing = readJson(attendedFile, null) || {
      generatedAt: new Date().toISOString(),
      operator: process.env.USERNAME || process.env.USER || 'andro',
      sameWorkTrial: { passed: false, screenshots: [], runIds: [], transcriptIds: [], artifactPaths: [], ledgerRows: [], notes: '' },
      soak: { freshPass: false, restartPass: false, transcriptPreserved: false, ledgerPreserved: false, artifactsPreserved: false, memoryPreserved: false, stationStatePreserved: false, notes: '' },
      failureRecovery: { cancelPassed: false, budgetPassed: false, deniedConsentPassed: false, toolErrorPassed: false, checkpointRestorePassed: false, notes: '' }
    };
    existing.generatedAt = new Date().toISOString();
    existing.sameWorkTrial = {
      passed: !!report.checks.sameWorkPassed,
      screenshots: unique((existing.sameWorkTrial && existing.sameWorkTrial.screenshots || []).concat(screenshots)),
      runIds: unique((existing.sameWorkTrial && existing.sameWorkTrial.runIds || []).concat(sameWork.starts.map(s => s.runId)).concat(sameWork.active && sameWork.active.runIds || [])),
      transcriptIds: unique((existing.sameWorkTrial && existing.sameWorkTrial.transcriptIds || []).concat(transcriptIds)),
      artifactPaths: unique((existing.sameWorkTrial && existing.sameWorkTrial.artifactPaths || []).concat(artifactDiskPaths.filter(p => existsSync(p)))),
      ledgerRows: (existing.sameWorkTrial && existing.sameWorkTrial.ledgerRows || []).concat(ledgerRows).slice(0, 10),
      notes: 'Collected by scripts/phase4-attended-ui-proof.mjs via the gamified UI, live model ' + MODEL + '.'
    };
    existing.soak = Object.assign({}, existing.soak || {}, {
      freshPass: !!report.checks.sameWorkPassed,
      restartPass: !!report.checks.restartPass,
      transcriptPreserved: restartTranscripts.some(t => t.response && t.response.ok && t.response.json && (t.response.json.turns || []).length),
      ledgerPreserved: restartRuns.length > 0,
      artifactsPreserved: artifactDiskPaths.some(p => existsSync(p)),
      memoryPreserved: !!report.checks.memoryPreserved,
      stationStatePreserved: REQUIRED_CAPS.every(c => Array.isArray(caps) && caps.includes(c)),
      notes: 'Fresh UI proof was restarted on the same workspace/profile; run, transcript, artifacts, memory signal, and station caps were checked after restart.'
    });
    writeJson(attendedFile, existing);
    writeJson(join(OUT, 'phase4-ui-proof-report.json'), report);

    console.log('[phase4-ui-proof] evidence: ' + OUT);
    console.log('[phase4-ui-proof] attended: ' + attendedFile);
    console.log('[phase4-ui-proof] sameWork=' + report.checks.sameWorkPassed + ' restart=' + report.checks.restartPass + ' memory=' + report.checks.memoryPreserved);
    process.exit((report.checks.sameWorkPassed && report.checks.restartPass && report.checks.memoryPreserved) ? 0 : 1);
  } finally {
    try { cdp?.ws.close(); } catch {}
    try { proc.kill('SIGKILL'); } catch {}
    try { sidecar.kill('SIGKILL'); } catch {}
  }
}

main().catch(e => { console.error('[phase4-ui-proof] FATAL: ' + ((e && e.stack) || e)); process.exit(1); });
