#!/usr/bin/env node
// scripts/qa/summon-delegate-journey.mjs — `npm run qa:summon-delegate`
//
// THE WHOLE COMMANDER SENTENCE, END TO END:
//   "hey overseer, make a new agent and have that agent do this work"
//
// A real sidecar + a REAL browser (rAF alive — the pose only exists while the world ticks) + a mock
// model that drives the lead through the actual tool chain: brief.proceed -> team.summon -> team.dispatch.
// It then proves the thing the Commander actually asked for:
//   the new agent EXISTS, owns a workstation BOUND TO IT (not the hero's), and does the delegated
//   work SEATED AT THAT WORKSTATION.
//
// Why a browser is required: team.summon is a backend->frontend COMMAND. The sidecar emits
// crew.summon.request and the BROWSER runs the real summonAgent() (which seeds the desk) and acks.
// Headless, nothing is created — test/e2e.summon.test.js covers the sidecar leg with a fake browser;
// this covers the leg that fake stands in for, plus the world behaviour no HTTP test can see.
//
// NOT in any gate: it needs a real Chrome. Run it by hand when touching the summon/delegate/desk seam.
//   SKYNET_JOURNEY_PORT=8946 SKYNET_JOURNEY_CDP=9346 npm run qa:summon-delegate
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sleep, launchChrome, connectCDP, evalJS, collectDiagnostics } from '../lib/cdp.mjs';
import { materializeSeedWorkspace, waitUp, waitDevReady } from '../lib/seed.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const PORT = process.env.SKYNET_JOURNEY_PORT || '8946';
const CDP_PORT = Number(process.env.SKYNET_JOURNEY_CDP || 9346);
const OUT = process.env.SKYNET_JOURNEY_DIR || join(REPO, '.summon-journey');
const APP = `http://127.0.0.1:${PORT}/`;
const KEEP = process.argv.includes('--keep');
const WORKER_PROMPT = 'Find the current status of the orbital relay and report back.';

const checks = [];
const ck = (n, ok, d) => { checks.push({ n, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d ? '  -- ' + d : '')); };
const J = (v) => JSON.stringify(v);

// ---- mock model: settle the brief, summon a specialist, then delegate to the one just created ----
function startMock() {
  const seen = { brief: 0, summon: 0, dispatch: 0, worker: 0, final: 0, newId: null, summonResult: '' };
  const usage = { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 };
  const sse = (res, chunks) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    for (const c of chunks) res.write('data: ' + JSON.stringify(c) + '\n\n');
    res.write('data: [DONE]\n\n'); res.end();
  };
  const call = (id, name, args) => ([
    { choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] },
    { choices: [{ finish_reason: 'tool_calls', delta: {} }], usage }
  ]);
  const say = (text) => ([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }], usage }]);
  return new Promise((done) => {
    const server = createServer((req, res) => {
      if (req.url.includes('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ id: 'test/model', context_length: 200000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] }] }));
      }
      if (!req.url.includes('/chat/completions')) { res.writeHead(404); return res.end(); }
      let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
        // the WORKER's own run is the one carrying the delegated prompt as its user turn
        if (body.includes(WORKER_PROMPT) && !body.includes('team_dispatch')) {
          seen.worker++;
          // hold the worker's run open ~8s like a real one: the desk pose exists only while the run is
          // LIVE, so an instant reply would finish before the pose could be observed at all.
          return setTimeout(() => sse(res, say('Orbital relay is nominal. Reported.')), 8000);
        }
        if (!seen.brief) {   // the host gates consequential tools behind a settled Task Brief
          seen.brief++;
          return sse(res, call('call_b', 'brief_proceed', {
            objective: 'Create a research specialist and have it check the orbital relay',
            deliverable: 'a status report from the new agent', audience: 'the Commander',
            success: 'the new agent reports the relay status'
          }));
        }
        if (!seen.summon) { seen.summon++; return sse(res, call('call_s', 'team_summon', { name: 'RESEARCHER', specId: 'researcher' })); }
        if (!seen.dispatch) {
          // read the new id out of the team.summon TOOL RESULT (parse — the content is escaped JSON)
          let toolText = '';
          try { toolText = (JSON.parse(body).messages || []).filter((m) => m.role === 'tool').map((m) => String(m.content || '')).join(' '); } catch (_) {}
          const m = /"agentId"\s*:\s*"([A-Za-z0-9_-]+)"/.exec(toolText);
          seen.newId = m ? m[1] : null;
          seen.summonResult = toolText.slice(0, 240);
          if (!seen.newId) { seen.final++; return sse(res, say('no agentId came back from team.summon')); }
          seen.dispatch++;
          return sse(res, call('call_d', 'team_dispatch', { workers: [{ agentId: seen.newId, prompt: WORKER_PROMPT }] }));
        }
        seen.final++;
        return sse(res, say('RESEARCHER is on the crew and reported: relay nominal.'));
      });
    });
    server.listen(0, '127.0.0.1', () => done({ server, seen, base: 'http://127.0.0.1:' + server.address().port + '/api/v1' }));
  });
}

if (!KEEP) { try { rmSync(OUT, { recursive: true, force: true }); } catch (_) {} }
mkdirSync(OUT, { recursive: true });
const mock = await startMock();
const scratch = join(OUT, '_seed-workspace');
materializeSeedWorkspace(scratch, 'test/model');
const side = spawn(process.execPath, [join(REPO, 'sidecar', 'index.js')], {
  cwd: REPO, stdio: 'ignore',
  env: Object.assign({}, process.env, {
    SKYNET_DEV: '1', SKYNET_FULL_ACCESS: '1', SKYNET_WORKSPACES: scratch, SKYNET_PORT: String(PORT),
    SKYNET_DEFAULT_MODEL: 'test/model', SKYNET_OPENROUTER_KEY: 'sk-or-journey-fake', SKYNET_OPENROUTER_BASE: mock.base
  })
});
if (!(await waitUp(APP))) throw new Error('sidecar failed to come up on :' + PORT);
console.log('sidecar: up on :' + PORT + '  (model -> mock)');

const { proc } = launchChrome({ cdpPort: CDP_PORT, win: '1440,900', profileDir: join(OUT, '_profile') });
let cdp, diag = { exceptions: [] };
try {
  cdp = await connectCDP(CDP_PORT);
  diag = collectDiagnostics(cdp);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: APP });
  if (!(await waitDevReady(cdp, evalJS, { tries: 30, url: APP }))) throw new Error('never reached the in-game floor');
  await evalJS(cdp, `(() => { window.__RAF = 0; const t = () => { window.__RAF++; requestAnimationFrame(t); }; requestAnimationFrame(t); return 1; })()`);
  await sleep(1000);
  ck('booted to the live floor with rAF running', Number(await evalJS(cdp, 'window.__RAF')) > 10);
  const before = JSON.parse(await evalJS(cdp, `JSON.stringify({ props: Build.__test__.station().props().length, bodies: window.__SKYNET_TEST__.bodies().map(b => b.id) })`));
  ck('baseline: the hero alone, with its starter desk', before.bodies.length === 1 && before.props === 1, J(before));

  // run-lifecycle bus traffic — the delegation pose is driven by tool_call(team.dispatch) setting
  // delegateLead, then the WORKER's agent.run.start triggering handoff().
  await evalJS(cdp, `(() => { window.__EV = [];
    U.bus.on('agent.run.start', p => window.__EV.push({ e: 'run.start', agentId: p && p.agentId, trigger: p && p.trigger }));
    U.bus.on('agent.run.end', p => window.__EV.push({ e: 'run.end', agentId: p && p.agentId }));
    U.bus.on('agent.tool_call', p => window.__EV.push({ e: 'tool_call', name: p && p.name, agentId: p && p.agentId }));
    return 1; })()`);
  // FRAME-RATE pose recorder. CDP polling aliases past a short pose window — sampling every 400ms
  // reported "never worked" on a run that provably did. Record every distinct transition instead.
  await evalJS(cdp, `(() => { window.__POSE = []; let last = '';
    const tick = () => {
      try {
        const st = Build.__test__.station(); const o = st.projectGeometry().origin || { tx: 0, ty: 0 };
        const rows = window.__SKYNET_TEST__.bodies().filter(b => !b.hero).map(b => {
          const d = st.props().find(p => p.agentId === b.id);
          return { id: b.id, working: !!b.working, sitting: !!b.sitting,
                   w: { x: b.tile.x + o.tx, y: b.tile.y + o.ty },        // LOCAL tile -> world: add origin
                   desk: d ? { x: d.x, y: d.y, w: d.w } : null };
        });
        const key = JSON.stringify(rows);
        if (key !== last) { last = key; window.__POSE.push({ t: Math.round(performance.now()), rows }); }
      } catch (e) {}
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick); return 1; })()`);

  // ---- THE ASK, typed at the overseer exactly as a Commander would ----
  await evalJS(cdp, `Chat.send('make a research agent and have it check the orbital relay')`);
  let state = null;
  for (let i = 0; i < 220; i++) {
    await sleep(400);
    state = JSON.parse(await evalJS(cdp, `JSON.stringify({
      busy: Chat.isBusy ? Chat.isBusy() : null,
      props: Build.__test__.station().props().map(p => ({ id: p.id, t: p.t, x: p.x, y: p.y, w: p.w, agentId: p.agentId || null })),
      bodies: window.__SKYNET_TEST__.bodies().map(b => ({ id: b.id, hero: b.hero }))
    })`));
    if (mock.seen.final >= 1 && mock.seen.worker >= 1 && !state.busy) break;
  }

  const pose = JSON.parse(await evalJS(cdp, `JSON.stringify(window.__POSE || [])`));
  const inSeatRow = (r) => !!(r.desk && r.w.y === r.desk.y + 1 && r.w.x >= r.desk.x - 1 && r.w.x <= r.desk.x + (r.desk.w || 1));
  const working = pose.filter((s) => s.rows.some((r) => r.working));
  const atDesk = pose.find((s) => s.rows.some((r) => r.working && inSeatRow(r)));
  const seated = pose.find((s) => s.rows.some((r) => r.working && r.sitting && inSeatRow(r)));
  console.log('   tool chain: ' + J(mock.seen));
  console.log('   bus: ' + await evalJS(cdp, `JSON.stringify(window.__EV)`));
  console.log('   pose transitions: ' + pose.length + ' · frames with a working crew body: ' + working.length);

  const NEW = mock.seen.newId;
  ck('the overseer called team.summon', mock.seen.summon === 1);
  ck('the summon result named the new agent AND its workstation', /"agentId"/.test(mock.seen.summonResult) && /workstation/.test(mock.seen.summonResult), mock.seen.summonResult);
  ck('the overseer then delegated to the agent it had just created', mock.seen.dispatch === 1 && !!NEW, 'newId=' + NEW);
  ck('the delegated worker actually ran (its own model call happened)', mock.seen.worker >= 1, 'worker calls=' + mock.seen.worker);
  ck('the lead synthesized a final answer for the Commander', mock.seen.final >= 1);

  const mine = state.props.filter((p) => p.agentId === NEW);
  ck('a workstation exists and is bound to THAT new agent', mine.length === 1, J(mine));
  ck('it is a SEPARATE desk from the hero\'s (one workstation per agent)',
    state.props.filter((p) => p.t === 'desk').length === 2 && state.props.some((p) => p.agentId === 'agent'),
    J(state.props.map((p) => p.t + '->' + (p.agentId || '-'))));
  ck('the new agent has a real floor body', state.bodies.some((b) => b.id === NEW), J(state.bodies));
  ck('the new agent took the WORKING pose for the delegated run', working.length > 0, 'working frames=' + working.length);
  ck('...and did that work AT ITS OWN desk (that desk\'s seat row)', !!atDesk, atDesk ? J(atDesk.rows) : 'never observed');
  ck('...SEATED there, not standing on open deck', !!seated, seated ? J(seated.rows) : 'never observed');

  // ---- THE OTHER HALF OF THE RULE: the Recruitment Bay must NOT seed ----------------------------
  // Creating an agent BY HAND is a different intent: the Commander gets the new agent's chat plus a
  // SUGGESTION, and places the workstation wherever they want. Only an agent the overseer was ASKED
  // to create arrives with one. Run the bay's own call shape (marketplace.js: onPick(spec,{activate:true}))
  // on this same floor, so the two paths are compared against each other rather than in isolation.
  const deskCount = async () => JSON.parse(await evalJS(cdp, `JSON.stringify(Build.__test__.station().props().filter(p => p.t === 'desk').map(p => p.x + ',' + p.y + '->' + (p.agentId || '-')))`));
  const beforeBay = await deskCount();
  const bay = JSON.parse(await evalJS(cdp, `(() => {
    const s = Specialties.get('engineer');
    const a = App.summonAgent(Object.assign({}, s, { skin: DATA.DEFAULT_SKIN, agentName: 'BAYHAND' }), { activate: true });
    return JSON.stringify({ id: a && a.id }); })()`));
  await sleep(1400);
  const afterBay = await deskCount();
  ck('BAY: a hand-created agent gets NO workstation — the floor is untouched', J(afterBay) === J(beforeBay), J(afterBay));
  ck('BAY: nothing on the floor is bound to it', !afterBay.some((p) => p.endsWith('->' + bay.id)), J(afterBay));
  const bayUi = JSON.parse(await evalJS(cdp, `(() => {
    const log = (document.getElementById('chat-log') || {}).textContent || '';
    const chips = [...document.querySelectorAll('#chat-log button, #chat-log .choice, #chat-log [data-choice]')].map((b) => (b.textContent || '').trim());
    return JSON.stringify({ suggests: /nowhere to sit|needs a desk|place one/i.test(log), chips: chips.slice(-6), focused: App.currentAgent ? App.currentAgent().id : null }); })()`));
  ck('BAY: the Commander lands in the new agent\'s chat, as before', bayUi.focused === bay.id, 'focused=' + bayUi.focused);
  ck('BAY: and is SUGGESTED a desk (the manual guidance survives untouched)',
    bayUi.suggests && bayUi.chips.some((c) => /place its desk/i.test(c)), J(bayUi.chips));
} finally {
  try { proc.kill(); } catch (_) {}
  try { side.kill(); } catch (_) {}
  try { mock.server.close(); } catch (_) {}
}
const errs = (diag.exceptions || []).slice(0, 6);
ck('no page exceptions across the whole journey', errs.length === 0, errs.length ? J(errs) : 'clean');
const bad = checks.filter((c) => !c.ok);
console.log('\n' + (bad.length ? 'SUMMON-DELEGATE JOURNEY: ' + bad.length + ' FAILED of ' + checks.length : 'SUMMON-DELEGATE JOURNEY: all ' + checks.length + ' checks green'));
process.exit(bad.length ? 1 : 0);
