#!/usr/bin/env node
// phase5-live-workload-proof.mjs - live gamified UI ref-style workload evidence.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capture, collectDiagnostics, connectCDP, evalJS, launchChrome, sleep } from './lib/cdp.mjs';
import { bootSeededSidecar, DEFAULT_MODEL, isUp, materializeSeedWorkspace, waitDevReady, waitUp } from './lib/seed.mjs';
import { providerKeyFromEnv } from './lib/provider-env.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const key = providerKeyFromEnv();
if (!key) {
  console.error('[phase5-workload] missing live key: set SKYNET_OPENROUTER_KEY, STARNET_OPENROUTER_KEY, or OPENROUTER_API_KEY');
  process.exit(2);
}

const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
const OUT = resolve(process.env.STARNET_PHASE5_WORKLOAD_DIR || join(ROOT, '.dogfood', 'phase5-workload-' + STAMP));
const SCRATCH = join(OUT, 'workspace');
const PROFILE = join(OUT, 'profile');
const PORT = String(process.env.STARNET_PHASE5_WORKLOAD_PORT || 8955);
const CDP_PORT = Number(process.env.STARNET_PHASE5_WORKLOAD_CDP || 9455);
const APP_URL = 'http://127.0.0.1:' + PORT + '/';
const MODEL = process.env.SKYNET_SMOKE_MODEL || process.env.STARNET_SMOKE_MODEL || process.env.SKYNET_DEFAULT_MODEL || process.env.STARNET_DEFAULT_MODEL || DEFAULT_MODEL;
const evidenceFile = join(ROOT, '.dogfood', 'phase5-evidence.json');
const PROOF_PROPS = ['war_intelcab', 'gigs_servercart', 'workbench', 'comms_dish'];
const REQUIRED_CAPS = ['cabinet', 'notebook', 'workbench', 'dish'];
const REQUIRED_TOOL_GROUPS = [
  ['fs_write'],
  ['notebook_write'],
  ['shell_exec', 'verify_run'],
  ['browser_navigate'],
  ['browser_get_text']
];

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
function evidenceTemplate() {
  return {
    generatedAt: new Date().toISOString(),
    operator: process.env.USERNAME || process.env.USER || 'andro',
    workloads: { passed: false, proofLevel: '', screenshots: [], runIds: [], transcriptIds: [], artifactPaths: [], ledgerRows: [], modelNames: [], toolCalls: [], notes: '' },
    surface: {
      browser: { status: 'blocked', proofLevel: '', logs: [], notes: '' },
      computer: { status: 'blocked', proofLevel: '', logs: [], notes: '' }
    },
    soak: { phase4LiveGreen: false, phase5WorkloadGreen: false, restartPreserved: false, notes: '' },
    recovery: { phase4RecoveryGreen: false, phase5RecoveryGreen: false, notes: '' },
    desktop: { status: 'blocked', logs: [], notes: '' }
  };
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
  const errors = events.filter(e => e.name === 'agent.run.error').map(e => e.payload || {});
  const costs = events.filter(e => e.name === 'agent.cost').map(e => e.payload || {});
  const toolCalls = events.filter(e => e.name === 'agent.tool_call').map(e => e.payload || {});
  const toolResults = events.filter(e => e.name === 'agent.tool_result').map(e => e.payload || {});
  const deliverables = events.filter(e => e.name === 'deliverable').map(e => e.payload || {});
  const memories = events.filter(e => e.name.indexOf('memory.') === 0).map(e => e.payload || {});
  const runs = await api(cdp, '/api/runs?agent=agent&limit=20').catch(e => ({ error: e.message }));
  const budget = await api(cdp, '/api/budget/status').catch(e => ({ error: e.message }));
  const records = await api(cdp, '/api/memory/records?agent=agent').catch(e => ({ error: e.message }));
  const streamIds = unique([active && active.id].concat((runs.json && runs.json.runs || []).map(r => r.streamId)));
  const transcripts = [];
  for (const stream of streamIds) {
    if (!stream) continue;
    const t = await api(cdp, '/api/transcript?stream=' + encodeURIComponent(stream) + '&agent=agent&limit=80').catch(e => ({ error: e.message }));
    transcripts.push({ stream, response: t });
  }
  return { active, events, starts, ends, errors, costs, toolCalls, toolResults, deliverables, memories, runs, budget, records, transcripts };
}
async function waitRunComplete(cdp) {
  let state = null;
  for (let i = 0; i < 240; i++) {
    await clickApproveIfPresent(cdp);
    state = await collectState(cdp);
    if (state.ends.some(e => e.reason === 'done' || e.reason === 'error' || e.reason === 'budget' || e.reason === 'max_iters')) return state;
    await sleep(500);
  }
  return state;
}
async function boot({ preserve = false } = {}) {
  if (!preserve) materializeSeedWorkspace(SCRATCH, MODEL);
  if (await isUp(APP_URL)) throw new Error('proof port already in use: ' + PORT);
  // Proof runs are synthetic-only too. A QA script must never quietly widen the exact
  // physical-input authority production denies.
  const env = { STARNET_COMPUTER_DRIVER: '0', STARNET_BROWSER_HEADLESS: '1' };
  const sidecar = bootSeededSidecar({ port: PORT, scratchDir: SCRATCH, key, model: MODEL, fullAccess: true, env });
  if (!(await waitUp(APP_URL))) throw new Error('sidecar failed to boot on :' + PORT);
  return sidecar;
}
function toolGroupPresent(names, group) {
  return group.some(name => names.includes(name));
}
function extractTranscriptIds(state) {
  return unique((state.transcripts || [])
    .filter(t => t.response && t.response.ok && t.response.json && (t.response.json.turns || []).length)
    .map(t => t.stream));
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
      writeJson(join(OUT, 'phase5-workload-report.json'), report);
      throw new Error('capability placement failed before live run: missing ' + missingCaps.join(', '));
    }
    await evalJS(cdp, 'window.__SKYNET_TEST__.clearEvents()');
    screenshots.push((await capture(cdp, OUT, '02-capabilities-placed')).path);

    const prompt = [
      'Phase 5 the reference harness replacement workload proof.',
      'The room already contains FILES, MEMORY, TERMINAL, WEB, and COMPUTER stations.',
      'Use the live tools, do not merely describe them.',
      'Required tool work:',
      '1. Call browser.navigate to https://example.com.',
      '2. Call browser.get_text and use the visible page text as evidence.',
      '3. Call shell_exec or verify_run with a harmless command that prints phase5-shell-ok.',
      '4. Call fs_write to create phase5-ref-workload.md.',
      '5. Call notebook_write to remember phase5-ref-workload-memory.',
      'Do not use web_search or web_fetch as a substitute for browser.navigate and browser.get_text.',
      'The Markdown file must include these exact lines:',
      '# Phase 5 the reference harness Workload',
      'verdict: live StarNet workload proof',
      'browser: example.com text captured',
      'input: synthetic-only (physical driver disabled)',
      'shell: live command attempted',
      'memory: phase5-ref-workload-memory',
      'Finish with one short sentence naming the saved file.'
    ].join('\n');
    const sent = await sendChat(cdp, prompt);
    if (sent !== 'sent') throw new Error('could not send workload prompt: ' + sent);
    const sameWork = await waitRunComplete(cdp);
    screenshots.push((await capture(cdp, OUT, '03-workload-complete')).path);
    report.sameWork = sameWork;

    const artifactTitles = unique((sameWork.deliverables || []).map(d => d.title).concat((sameWork.active && sameWork.active.deliverables || []).map(d => d.title)));
    const artifactDiskPaths = unique(artifactTitles.map(t => join(SCRATCH, 'agent', t)).concat([join(SCRATCH, 'agent', 'phase5-ref-workload.md')]));
    const transcriptIds = extractTranscriptIds(sameWork);
    const ledgerRows = (sameWork.runs.json && sameWork.runs.json.runs || []).slice(0, 5);
    const toolNames = unique((sameWork.toolCalls || []).map(t => t.name));
    const okToolNames = unique((sameWork.toolResults || []).filter(t => !t.isError).map(t => {
      const call = (sameWork.toolCalls || []).find(c => c.callId === t.callId);
      return call && call.name;
    }));
    const modelNames = unique((sameWork.starts || []).map(s => s.model).concat(ledgerRows.map(r => r.model)));
    const toolGroupsPresent = REQUIRED_TOOL_GROUPS.every(group => toolGroupPresent(toolNames, group));
    const okTerminal = toolGroupPresent(okToolNames, ['shell_exec', 'verify_run']);
    const okBrowser = okToolNames.includes('browser_navigate') && okToolNames.includes('browser_get_text');
    report.checks.workloadPassed = sameWork.ends.some(e => e.reason === 'done')
      && sameWork.errors.length === 0
      && sameWork.costs.some(c => (c.usd || 0) > 0)
      && artifactDiskPaths.some(p => existsSync(p))
      && transcriptIds.length > 0
      && ledgerRows.length > 0
      && modelNames.length > 0
      && toolGroupsPresent
      && okTerminal
      && okBrowser
      && !toolNames.includes('computer_use');
    report.checks.browserRefProven = okBrowser;
    // Absence of a call is not an installed input-isolation proof. Keep this false until the
    // rebuilt desktop bundle completes the full Win32 observer receipt.
    report.checks.computerRefProven = false;

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
    const restartTranscripts = extractTranscriptIds(restart);
    const caps = await evalJS(cdp, `(typeof World !== 'undefined' && World.heroCaps) ? World.heroCaps('agent').map(c => c.objectType) : []`).catch(() => []);
    report.restart.caps = caps;
    report.checks.restartPreserved = restartReady
      && restartRuns.length > 0
      && restartTranscripts.length > 0
      && artifactDiskPaths.some(p => existsSync(p))
      && REQUIRED_CAPS.every(c => Array.isArray(caps) && caps.includes(c));

    const existing = readJson(evidenceFile, evidenceTemplate());
    existing.generatedAt = new Date().toISOString();
    existing.operator = existing.operator || process.env.USERNAME || process.env.USER || 'andro';
    existing.workloads = {
      passed: !!report.checks.workloadPassed,
      proofLevel: 'live-ui',
      screenshots: unique((existing.workloads && existing.workloads.screenshots || []).concat(screenshots)),
      runIds: unique((existing.workloads && existing.workloads.runIds || []).concat(sameWork.starts.map(s => s.runId)).concat(sameWork.active && sameWork.active.runIds || [])),
      transcriptIds: unique((existing.workloads && existing.workloads.transcriptIds || []).concat(transcriptIds)),
      artifactPaths: unique((existing.workloads && existing.workloads.artifactPaths || []).concat(artifactDiskPaths.filter(p => existsSync(p)))),
      ledgerRows: (existing.workloads && existing.workloads.ledgerRows || []).concat(ledgerRows).slice(0, 10),
      modelNames: unique((existing.workloads && existing.workloads.modelNames || []).concat(modelNames)),
      toolCalls: unique((existing.workloads && existing.workloads.toolCalls || []).concat(toolNames)),
      notes: 'Collected by scripts/phase5-live-workload-proof.mjs through the gamified UI with live model ' + MODEL + '.'
    };
    existing.surface = existing.surface || {};
    existing.surface.browser = {
      status: okBrowser ? 'ref-proven' : ((existing.surface.browser && existing.surface.browser.status) || 'blocked'),
      proofLevel: okBrowser ? 'live-ui-browser-tools' : ((existing.surface.browser && existing.surface.browser.proofLevel) || ''),
      logs: unique((existing.surface.browser && existing.surface.browser.logs || []).concat(join(OUT, 'phase5-workload-report.json'))),
      notes: okBrowser
        ? 'Live workload used browser.navigate and browser.get_text through the gamified UI.'
        : 'Live workload has not yet produced successful browser.navigate plus browser.get_text evidence.'
    };
    existing.surface.computer = {
      status: 'blocked',
      proofLevel: 'synthetic-input-isolation-pending-installed-proof',
      logs: unique((existing.surface.computer && existing.surface.computer.logs || []).concat(join(OUT, 'phase5-workload-report.json'))),
      notes: 'Physical computer.use is intentionally disabled in proof and product runs. An installed browser.test_* plus Win32 observer receipt is required before this surface can be promoted.'
    };
    existing.soak = Object.assign({}, existing.soak || {}, {
      phase5WorkloadGreen: !!report.checks.workloadPassed,
      restartPreserved: !!report.checks.restartPreserved,
      notes: 'Phase 5 live workload restarted the sidecar on the same workspace/profile and checked run, transcript, artifact, ledger, and station caps after restart.'
    });
    writeJson(evidenceFile, existing);
    writeJson(join(OUT, 'phase5-workload-report.json'), report);

    console.log('[phase5-workload] evidence: ' + OUT);
    console.log('[phase5-workload] phase5 evidence: ' + evidenceFile);
    console.log('[phase5-workload] workload=' + report.checks.workloadPassed + ' restart=' + report.checks.restartPreserved + ' tools=' + toolNames.join(','));
    process.exit((report.checks.workloadPassed && report.checks.restartPreserved) ? 0 : 1);
  } finally {
    try { cdp?.ws.close(); } catch {}
    try { proc.kill('SIGKILL'); } catch {}
    try { sidecar.kill('SIGKILL'); } catch {}
  }
}

main().catch(e => { console.error('[phase5-workload] FATAL: ' + ((e && e.stack) || e)); process.exit(1); });
