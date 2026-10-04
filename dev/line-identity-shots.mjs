#!/usr/bin/env node
/* dev/line-identity-shots.mjs — LIVE proof for WORK BELONGS TO A LINE (Andrew's ruling, 2026-08-07).
 *
 *   "each conveyor system built has a purpose and a different workflow — the conveyor system should
 *    visually run ONLY when the specific workflow is running."
 *
 * Boots a seeded sidecar from THIS worktree against a LOCAL MOCK OpenRouter (real runs, real dispatch,
 * zero spend), drives the REAL app over CDP, stamps + crews a two-stage RESEARCH LINE, then proves both
 * directions on the SAME entry dock:
 *   (a) the LINE'S OWN TRIGGER (the INBOX sample job) -> the downstream stage really runs and a handoff
 *       crate really rides the belts;
 *   (b) a DIRECT ORDER typed into COMMS at that same dock -> it answers, NO downstream run is bought
 *       (provider-call count, not vibes), and NO handoff crate ever appears.
 * Plus the legibility copy: the STEP card and the INBOX TRIGGER zone.
 *
 *   node dev/line-identity-shots.mjs      (ports: SKYNET_SHOT_PORT / SKYNET_CDP_PORT)
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9498';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9499);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-line-identity');
const MODEL = 'test/model';

/* a mock OpenRouter that tells the two stages apart: a request whose latest user turn is the PIPELINE
   HANDOFF is a downstream stage. Every request is recorded, so "did the line buy a second run?" is a
   COUNT, never an inference. */
function startMock() {
  const requests = [];
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url.indexOf('/models') >= 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: MODEL, context_length: 32000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] }] }));
        return;
      }
      if (req.url.indexOf('/chat/completions') >= 0) {
        let body = '';
        req.on('data', d => { body += d; });
        req.on('end', () => {
          let p = {}; try { p = JSON.parse(body); } catch {}
          requests.push(p);
          const handoff = (p.messages || []).some(m => m && m.role === 'user' && String(m.content || '').indexOf('PIPELINE HANDOFF') >= 0);
          const text = handoff ? 'STAGE TWO: the polished write-up.' : 'STAGE ONE: the raw findings.';
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n');
          res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 9, completion_tokens: 7, total_tokens: 16 } }) + '\n\n');
          res.write('data: [DONE]\n\n');
          res.end();
        });
        return;
      }
      res.writeHead(404); res.end('{}');
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, requests, base: 'http://127.0.0.1:' + server.address().port + '/api/v1' }));
  });
}

const handoffCalls = reqs => reqs.filter(p => (p.messages || []).some(m => m && m.role === 'user' && String(m.content || '').indexOf('PIPELINE HANDOFF') >= 0)).length;

async function main() {
  const mock = await startMock();
  const scratch = mkdtempSync(join(tmpdir(), 'lineid-'));
  materializeSeedWorkspace(join(scratch, 'ws'), MODEL);
  const side = bootSeededSidecar({
    port: PORT, model: MODEL, key: 'sk-or-v1-line-identity-mock', scratchDir: join(scratch, 'ws'),
    env: { SKYNET_OPENROUTER_BASE: mock.base, STARNET_OPENROUTER_BASE: mock.base }
  });
  let chrome = null, cdp = null;
  const report = {};
  try {
    if (!(await waitUp(URL))) throw new Error('sidecar never came up on ' + URL);
    chrome = launchChrome({ cdpPort: CDP_PORT, win: '1560,1060', profileDir: join(scratch, 'chrome') });
    await sleep(1200);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Runtime.enable');
    const diag = collectDiagnostics(cdp);
    await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never reached the game screen');
    await sleep(1800);
    mkdirSync(OUT, { recursive: true });

    /* ---- 1. stamp a two-stage RESEARCH LINE and CREW both docks ---- */
    const built = await evalJS(cdp, `(() => {
      if (!Build.isOpen()) Build.open();
      const card = document.querySelector('.refit-firstrun');
      if (card) { const go = card.querySelector('#refit-guide-go'); if (go) go.click(); }
      const st = Build.__test__.station();
      for (const b of st.belts()) st.removeBelt(b.x, b.y);
      const WF = { intake:1, bay:1, outbox:1, filter:1, splitter:1, merger:1 };
      for (const p of st.props().slice()) if (WF[p.t]) st.removeProp(p.id);
      const bnd = st.bounds();
      let spot = null;
      for (let ty = bnd.minTy - 2; ty <= bnd.maxTy + 2 && !spot; ty++)
        for (let tx = bnd.minTx - 2; tx <= bnd.maxTx + 2 && !spot; tx++)
          if (st.canPlaceBlueprint('research_line', tx, ty).ok) spot = { tx, ty };
      if (!spot) return { err: 'no-spot' };
      const res = st.stampBlueprint('research_line', spot.tx, spot.ty);
      if (!res || !res.ok) return { err: 'stamp-failed' };
      const ok = document.querySelector('.tut-coach-ok'); if (ok) ok.click();
      const bays = st.props().filter(p => p.t === 'bay').sort((a, b) => a.x - b.x);
      return { spot, bays: bays.map(b => ({ id: b.id, role: b.role, x: b.x })), agents: (App.agents() || []).map(a => a.id) };
    })()`);
    console.log('STAMP:', JSON.stringify(built));
    if (!built || built.err) throw new Error('stamp failed: ' + JSON.stringify(built));

    // the ENTRY dock is crewed by the HERO (so a plain COMMS turn IS a direct order to that dock);
    // the second dock gets a real summoned specialist through the same seam the STEP card uses.
    const crew = await evalJS(cdp, `(() => {
      const st = Build.__test__.station();
      const bays = st.props().filter(p => p.t === 'bay').sort((a, b) => a.x - b.x);
      const r1 = st.assignPropAgent(bays[0].id, 'agent');
      let second = (App.agents() || []).map(a => a.id).filter(id => id !== 'agent')[0] || null;
      if (!second) {
        const a = App.summonAgent({ cls: 'writer', name: 'SCRIBE' }, { activate: false, desk: true });
        second = a && a.id;
      }
      const r2 = second ? st.assignPropAgent(bays[1].id, second) : { ok: false };
      return { entry: r1 && r1.agentId, entryBay: bays[0].id, second: r2 && r2.agentId, secondBay: bays[1].id };
    })()`);
    console.log('CREW:', JSON.stringify(crew));
    if (!crew || !crew.entry || !crew.second) throw new Error('crewing failed: ' + JSON.stringify(crew));
    report.crew = crew;

    /* ---- 2. LEGIBILITY: the STEP card states what makes this line distinct + that a direct job stops here ---- */
    const stepCopy = await evalJS(cdp, `(() => {
      document.querySelectorAll('.refit-step-card').forEach(n => n.remove());
      Build.openAssign(${JSON.stringify(crew.entryBay)});
      const g = document.querySelector('.refit-step-card');
      if (!g) return { err: 'no step card' };
      return { facts: [...g.querySelectorAll('.step-fact')].map(n => n.textContent.trim()),
               notes: [...g.querySelectorAll('.refit-note')].map(n => n.textContent.trim()) };
    })()`);
    console.log('STEP COPY:', JSON.stringify(stepCopy, null, 2));
    report.stepCopy = stepCopy;
    report.shotStep = (await capture(cdp, OUT, 'legibility-step-card')).path;

    const inboxCopy = await evalJS(cdp, `(() => {
      document.querySelectorAll('.refit-step-card').forEach(n => n.remove());
      document.querySelectorAll('.refit-flow-card').forEach(n => n.remove());
      const st = Build.__test__.station();
      const inbox = st.props().find(p => p.t === 'intake');
      Build.openAssign(inbox.id);
      const g = document.querySelector('.refit-flow-card');
      if (!g) return { err: 'no flow card' };
      const secs = [...g.querySelectorAll('.refit-sec')].map(n => n.textContent.trim());
      return { secs, notes: [...g.querySelectorAll('.refit-note')].map(n => n.textContent.trim()) };
    })()`);
    console.log('INBOX COPY:', JSON.stringify(inboxCopy, null, 2));
    report.inboxCopy = inboxCopy;
    report.shotInbox = (await capture(cdp, OUT, 'legibility-inbox-triggers')).path;

    report.lineIdentity = JSON.parse(await evalJS(cdp, `JSON.stringify((() => {
      const plan = Pipeline.compileRoutingPlan(Build.__test__.station().projectGeometry());
      return { lines: (plan.lines || []).map(l => ({ lineId: l.lineId, agents: l.agents })), lineOfAgent: plan.lineOfAgent };
    })())`));
    console.log('LINE IDENTITY (compiled):', JSON.stringify(report.lineIdentity));

    // close REFIT so the LIVE world (and its real conveyor) resumes on the new floor
    await evalJS(cdp, `(() => { document.querySelectorAll('.refit-flow-card,.refit-step-card').forEach(n => n.remove()); Build.close(); return true; })()`);
    await sleep(2500);

    // the floor's compiled plan must have reached the sidecar before either trigger fires
    let sync = null;
    for (let i = 0; i < 40; i++) {
      sync = JSON.parse(await evalJS(cdp, `JSON.stringify(World._dbgBeltLegibility().planSync)`));
      if (sync && sync.lastHash && !sync.stale) break;
      await sleep(400);
    }
    console.log('PLAN SYNC:', JSON.stringify(sync));
    if (!sync || !sync.lastHash) throw new Error('the compiled plan never reached the sidecar');
    report.planSync = sync;


    /* ---- 3. (a) THE LINE'S OWN TRIGGER: the INBOX sample job ---- */
    const before = mock.requests.length;
    const sample = await evalJS(cdp, `Harness.api.post('/api/routing/sample', {}).then(r => JSON.stringify({ ok: r.ok, status: r.status, j: r.j }))`);
    // watch for a handoff crate riding the belts WHILE the line runs
    let sawChainCrate = null;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const boxes = JSON.parse(await evalJS(cdp, `JSON.stringify(World._dbgBeltLegibility().boxes.map(b => ({ tile: b.tile || (b.x + ',' + b.y), kind: b.payload && b.payload.kind, lineId: b.payload && b.payload.lineId, box: b.payload && b.payload.box, agentId: b.payload && b.payload.agentId })))`));
      const chain = boxes.find(b => b.kind === 'chain');
      if (chain && !sawChainCrate) {
        sawChainCrate = chain;
        report.shotTrigger = (await capture(cdp, OUT, 'a-trigger-handoff-crate-rides')).path;
        break;
      }
      await sleep(120);
    }
    await sleep(2500);
    const afterTrigger = mock.requests.slice(before);
    report.trigger = {
      sample: JSON.parse(sample),
      providerCalls: afterTrigger.length,
      handoffCalls: handoffCalls(afterTrigger),
      chainCrate: sawChainCrate
    };
    console.log('TRIGGER RESULT:', JSON.stringify(report.trigger, null, 2));
    if (!report.shotTrigger) report.shotTrigger = (await capture(cdp, OUT, 'a-trigger-line-ran')).path;

    /* ---- 3. (b) THE SAME ENTRY DOCK, A DIRECT ORDER TYPED INTO COMMS ---- */
    const before2 = mock.requests.length;
    const crateLog = [];
    await evalJS(cdp, `(() => {
      window.__LI_CRATES__ = [];
      U.bus.on('workitem.placed', p => window.__LI_CRATES__.push({ kind: p.kind, agentId: p.agentId, lineId: p.lineId || null }));
      return true;
    })()`);
    await evalJS(cdp, `(() => { Chat.send('research the competitive landscape and write it up'); return true; })()`);
    let sawChainCrate2 = null;
    const dl2 = Date.now() + 30000;
    let idleSince = 0;
    while (Date.now() < dl2) {
      const s = JSON.parse(await evalJS(cdp, `JSON.stringify({ busy: Chat.isBusy(), boxes: World._dbgBeltLegibility().boxes.map(b => ({ kind: b.payload && b.payload.kind, box: b.payload && b.payload.box, outbound: !!(b.payload && b.payload.outbound) })) })`));
      const chain = s.boxes.find(b => b.kind === 'chain');
      if (chain) { sawChainCrate2 = chain; break; }
      const product = s.boxes.find(b => b.outbound && b.box === 'product');
      if (product && !report.shotDirect) report.shotDirect = (await capture(cdp, OUT, 'b-direct-order-own-product-crate')).path;
      if (!s.busy) { if (!idleSince) idleSince = Date.now(); else if (Date.now() - idleSince > 6000) break; }
      await sleep(150);
    }
    await sleep(2500);
    const afterDirect = mock.requests.slice(before2);
    report.direct = {
      providerCalls: afterDirect.length,
      handoffCalls: handoffCalls(afterDirect),
      chainCrate: sawChainCrate2,
      crates: JSON.parse(await evalJS(cdp, `JSON.stringify(window.__LI_CRATES__ || [])`))
    };
    console.log('DIRECT RESULT:', JSON.stringify(report.direct, null, 2));
    if (!report.shotDirect) report.shotDirect = (await capture(cdp, OUT, 'b-direct-order-terminal')).path;
    report.shotDirectFinal = (await capture(cdp, OUT, 'b-direct-order-comms')).path;

    /* ---- 4. THE FLOOR MUST NOT LIE — the ship-out decision at a dock that HANDS OFF ----
       Driven on the REAL floor through the EXACT bus events the sidecar emits (world.js listens to these and
       nothing else), with the ONE variable being whether the work-item carried a lineId. A line-owned run at
       a hand-off dock must NOT also ship a crate out the door — its product IS the handoff crate. That same
       dock's DIRECT order hands off to nobody, so suppressing its crate would erase real delivered work.
       (The mock provider does no tool work, so a natural run ships nothing at all under the crate-honesty
       law — which is why this probe supplies the tool_result the renderer counts as proven work.) */
    const probe = (label, extra) => `(async () => {
      const aid = ${JSON.stringify(crew.entry)};
      const outCount = () => World._dbgBeltLegibility().boxes.filter(b => b.payload && b.payload.outbound && b.payload.box === 'product').length;
      const before = outCount();
      U.bus.emit('workitem.placed', Object.assign({ workitemId: '${label}', queueId: aid, agentId: aid, preview: 'probe', ts: Date.now() }, ${extra}));
      U.bus.emit('agent.run.start', { agentId: aid, runId: '${label}' });
      U.bus.emit('agent.tool_result', { agentId: aid, runId: '${label}', isError: false });
      U.bus.emit('agent.run.end', { agentId: aid, runId: '${label}', reason: 'done', turns: 1, usd: 0 });
      await new Promise(r => setTimeout(r, 600));
      return JSON.stringify({ shipped: outCount() - before });
    })()`;
    const entryLine = String((report.lineIdentity && report.lineIdentity.lineOfAgent && report.lineIdentity.lineOfAgent[crew.entry]) || '');
    const shipLine = JSON.parse(await evalJS(cdp, probe('probe-line', JSON.stringify({ kind: 'telegram', lineId: entryLine }))));
    const shipDirect = JSON.parse(await evalJS(cdp, probe('probe-direct', JSON.stringify({ kind: 'directive' }))));
    report.floorHonesty = { entryLine, lineOwnedShipOut: shipLine.shipped, directOrderShipOut: shipDirect.shipped };
    console.log('FLOOR HONESTY:', JSON.stringify(report.floorHonesty));
    report.shotFloor = (await capture(cdp, OUT, 'c-direct-order-ships-its-own-crate')).path;

    report.consoleErrors = diag.consoleMsgs.filter(m => m.level === 'error').slice(0, 10);
    report.exceptions = diag.exceptions.slice(0, 10);
    console.log('\n===== REPORT =====\n' + JSON.stringify(report, null, 2));

    /* ---- the verdict ---- */
    const fails = [];
    const sj = (report.trigger.sample && report.trigger.sample.j) || {};
    const stageTwoRuns = (sj.runs || []).filter(r => r.agentId === crew.second).length;
    if (stageTwoRuns !== 1) fails.push('the line\'s own trigger did NOT run the downstream dock exactly once (durable runs by ' + crew.second + ': ' + stageTwoRuns + ')');
    if (report.trigger.handoffCalls < 1) fails.push('no PIPELINE HANDOFF turn ever reached the provider');
    if (!report.trigger.chainCrate) fails.push('no handoff crate rode the belts for line-owned work');
    if (report.trigger.chainCrate && !report.trigger.chainCrate.lineId) fails.push('the handoff crate carried no line id');
    if (report.direct.handoffCalls !== 0) fails.push('a DIRECT order bought ' + report.direct.handoffCalls + ' downstream provider call(s) — money spent the user never asked for');
    if (report.direct.chainCrate) fails.push('a DIRECT order drew a handoff crate — the pipeline animated a workflow that did not run');
    if ((report.direct.crates || []).some(c => c.kind === 'chain')) fails.push('a DIRECT order placed a chain work-item');
    if ((report.direct.crates || []).some(c => c.lineId)) fails.push('a DIRECT order carried a line id');
    if (report.floorHonesty.lineOwnedShipOut !== 0) fails.push('a line-owned run at a hand-off dock ALSO shipped a crate out the door (the same work drawn leaving twice)');
    if (report.floorHonesty.directOrderShipOut !== 1) fails.push('a DIRECT order shipped ' + report.floorHonesty.directOrderShipOut + ' product crate(s) — real delivered work must not vanish from the floor');
    if (fails.length) throw new Error('LIVE PROOF FAILED:\n  - ' + fails.join('\n  - '));
    console.log('\nLIVE PROOF: PASS');
  } finally {
    try { if (cdp) cdp.close(); } catch {}
    try { if (chrome) chrome.proc ? chrome.proc.kill() : chrome.kill(); } catch {}
    try { side.kill(); } catch {}
    try { mock.server.close(); } catch {}
  }
}

main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
