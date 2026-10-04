#!/usr/bin/env node
/* dev/guided-c-shots.mjs — live proof shots for the guided-workflow Phase 4 lane (RUN A SAMPLE JOB).
 *
 * Boots a seeded sidecar from THIS worktree against a LOCAL mock provider (zero spend, deterministic),
 * drives the REAL app over CDP (the established headless pattern — see belt-onramp-shots.mjs), and captures:
 *   1. refusal JSON        — POST /api/routing/sample with NO armed plan (409, honest reason)
 *   2. sample-card.png     — the REAL canvas click on the INBOX opens the RUN-A-SAMPLE-JOB card
 *   3. sample-riding.png   — the real button clicked; the card's honest in-flight state
 *   4. inflight JSON       — a second POST while the first rides (409 one-per-station)
 *   5. sample-delivered.png— the card's delivered state (reply glance + OUTBOX pointer)
 *   6. outbox-window.png   — the OUTBOX window holding the sample crate (ReturnStore fold)
 *   7. happy JSON          — a direct endpoint transcript (replies/runs/delivered/totalUsd)
 *
 *   node dev/guided-c-shots.mjs      (server port 9499; CDP 9501)
 */
import http from 'node:http';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9499';   // NEVER 9496 (that port belongs to another live rig)
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9501);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-guided-c');

// content-driven mock OpenRouter (the e2e's shape): the sample text earns a deterministic real reply
function startMock() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.includes('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ id: 'test/model', context_length: 8000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] }] }));
      }
      if (req.url.includes('/chat/completions')) {
        let body = '';
        req.on('data', d => { body += d; });
        req.on('end', () => {
          let msgs = []; try { msgs = JSON.parse(body).messages || []; } catch {}
          const lastUser = [...msgs].reverse().find(m => m && m.role === 'user');
          const t = String((lastUser && lastUser.content) || '').toLowerCase();
          const text = t.includes('sample job')
            ? 'This work line takes an incoming job at the INBOX, routes it to my dock, and ships the finished answer out through the OUTBOX. In short: request in, real run, result out.'
            : 'nothing to do';
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n');
          res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }) + '\n\n');
          res.write('data: [DONE]\n\n');
          res.end();
        });
        return;
      }
      res.writeHead(404); res.end();
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: 'http://127.0.0.1:' + server.address().port + '/api/v1' }));
  });
}

const POST_SAMPLE = `fetch('/api/routing/sample', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  .then(r => r.json().then(j => ({ status: r.status, j })))`;

async function main() {
  const mock = await startMock();
  const scratch = mkdtempSync(join(tmpdir(), 'guidedc-'));
  materializeSeedWorkspace(join(scratch, 'ws'), 'test/model');
  const side = bootSeededSidecar({
    port: PORT, model: 'test/model', key: 'sk-or-v1-guided-c-fake', scratchDir: join(scratch, 'ws'),
    env: { SKYNET_OPENROUTER_BASE: mock.base, STARNET_OPENROUTER_BASE: mock.base }
  });
  let chrome = null, cdp = null;
  const shots = [];
  const out = {};
  try {
    if (!(await waitUp(URL))) throw new Error('sidecar never came up on ' + URL);
    chrome = launchChrome({ cdpPort: CDP_PORT, profileDir: join(scratch, 'chrome') });
    await sleep(1200);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Runtime.enable');
    const diag = collectDiagnostics(cdp);
    await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never reached the game screen');
    await sleep(1500);
    mkdirSync(OUT, { recursive: true });

    // ---- 1. REFUSAL: no armed plan (the seed floor has no complete line) ----
    out.refusalNoPlan = await evalJS(cdp, POST_SAMPLE);
    console.log('REFUSAL (no plan):', JSON.stringify(out.refusalNoPlan));

    // ---- 2. draw a REAL line: stamp a blueprint, bind its bay (the station model's own APIs) ----
    await evalJS(cdp, `(() => { if (typeof Build !== 'undefined' && !Build.isOpen()) Build.open(); const card = document.querySelector('.refit-firstrun'); if (card) { const go = card.querySelector('#refit-guide-go'); if (go) go.click(); } })()`);
    await sleep(500);
    const spot = await evalJS(cdp, `(() => {
      const st = Build.__test__.station();
      const b = st.bounds();
      for (let ty = b.minTy - 2; ty <= b.maxTy + 2; ty++)
        for (let tx = b.minTx - 2; tx <= b.maxTx + 2; tx++)
          if (st.canPlaceBlueprint('research_line', tx, ty).ok) return { tx, ty };
      return null;
    })()`);
    if (!spot) throw new Error('no stampable spot for research_line');
    const setup = await evalJS(cdp, `(() => {
      const st = Build.__test__.station();
      const res = st.stampBlueprint('research_line', ${spot.tx}, ${spot.ty});
      if (!res.ok) return { error: res.error || 'stamp failed' };
      const bays = st.props().filter(p => p.t === 'bay');
      // bind ONLY the first bay (two docks on one roster agent would be a DUP-BINDING blocker — the
      // router refuses such a plan; an unbound second bay is a warn, and the plan stays deployable)
      const bind = st.assignPropAgent(bays[0].id, 'w0');
      return { stamped: res.ids.length, bays: bays.length, bind: bind.ok, bay: bays[0].id };
    })()`);
    console.log('line setup:', JSON.stringify(setup));
    if (setup.error) throw new Error(setup.error);
    // the blueprint bay's room grants no compute — place a REAL workstation (console → 'computer' cap) in
    // the bay's room, or the run honestly errors "no compute" (the cost-safe gate; proven on the first run
    // of this script). bayObjects('w0') is the same truth the sidecar's station projection reads.
    const pc = await evalJS(cdp, `(() => {
      const st = Build.__test__.station();
      const bay = st.props().find(p => p.t === 'bay' && p.agentId === 'w0');
      if (!bay) return { ok: false, why: 'no bound bay' };
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = bay.x + dx, y = bay.y + dy;
        if (!st.canPlaceProp('console', x, y, 1, 1).ok) continue;
        const r = st.addProp({ t: 'console', x, y, w: 1, h: 1 });
        if (r.ok && (st.bayObjects('w0') || []).indexOf('computer') >= 0) return { ok: true, x, y, objs: st.bayObjects('w0') };
        if (r.ok) st.removeProp(r.id);   // landed in a different room — keep scanning
      }
      return { ok: false, why: 'no spot granted compute' };
    })()`);
    console.log('compute placed:', JSON.stringify(pc));
    if (!pc.ok) throw new Error('could not grant the bay compute: ' + pc.why);
    await evalJS(cdp, `(() => { if (typeof Build !== 'undefined' && Build.isOpen()) Build.close(); return true; })()`);
    // wait until the world's own plan-poster FULLY DELIVERED the compiled floor to the sidecar: hash
    // committed, nothing pending/in flight, not stale, not refused — the server-armed truth, settled.
    let armed = null;
    for (let i = 0; i < 40; i++) {
      armed = await evalJS(cdp, `(() => { const d = World._dbgBeltLegibility(); return { live: d.liveCount, nags: d.nags, plan: d.planSync }; })()`);
      const p = armed.plan;
      if (armed.live > 0 && p.lastHash && !p.stale && !p.inflight && !p.pendingHash && !p.refusedHash) break;
      await sleep(500);
    }
    console.log('plan armed:', JSON.stringify(armed));
    const ap = armed && armed.plan;
    if (!armed || !armed.live || !ap.lastHash || ap.stale || ap.inflight || ap.pendingHash || ap.refusedHash) {
      throw new Error('the drawn line never armed server routing: ' + JSON.stringify(armed));
    }

    // ---- 3. the REAL canvas click on the INBOX opens the sample card ----
    let cardUp = false;
    for (let i = 0; i < 5 && !cardUp; i++) {
      await evalJS(cdp, `(() => {
        const pt = World._dbgPropClientPoint('intake');
        if (!pt) return null;
        const cv = document.getElementById('stage');
        cv.dispatchEvent(new MouseEvent('mousedown', { clientX: pt.clientX, clientY: pt.clientY, button: 0, bubbles: true }));
        cv.dispatchEvent(new MouseEvent('mouseup', { clientX: pt.clientX, clientY: pt.clientY, button: 0, bubbles: true }));
        return pt;
      })()`);
      await sleep(600);
      cardUp = await evalJS(cdp, `!!document.querySelector('.sample-card')`);
    }
    if (!cardUp) throw new Error('the INBOX click never opened the sample card');
    const cardText = await evalJS(cdp, `document.querySelector('.sample-card').textContent.slice(0, 300)`);
    console.log('sample card:', JSON.stringify(cardText));
    shots.push(await capture(cdp, OUT, 'sample-card'));

    // ---- 4. click the REAL button; while riding, a second POST refuses 409 ----
    await evalJS(cdp, `(() => { const b = [...document.querySelectorAll('.sample-card .consent-btn.primary')].find(x => /RUN A SAMPLE JOB/.test(x.textContent)); b.click(); return b.textContent; })()`);
    await sleep(150);   // let the button's own POST claim the one-per-station lock first
    out.refusalInFlight = await evalJS(cdp, POST_SAMPLE);
    console.log('REFUSAL (one in flight):', JSON.stringify(out.refusalInFlight));
    const inflight = await evalJS(cdp, `(document.querySelector('.sample-card .consent-btn.primary') || {}).textContent || '(button gone)'`);
    console.log('in-flight button:', JSON.stringify(inflight));
    shots.push(await capture(cdp, OUT, 'sample-riding'));
    // crates on the belt while the sample rides (the world draws from the REAL events — no new visual code)
    let boxesSeen = [];
    for (let i = 0; i < 150; i++) {
      const done = await evalJS(cdp, `/sample delivered|did not finish clean/.test((document.querySelector('.sample-card') || {}).textContent || '')`);
      const boxes = await evalJS(cdp, `World._dbgBeltLegibility().boxes`);
      if (boxes && boxes.length && !boxesSeen.length) { boxesSeen = boxes; shots.push(await capture(cdp, OUT, 'crate-riding')); }
      if (done) break;
      await sleep(200);
    }
    console.log('crates observed mid-ride:', JSON.stringify(boxesSeen).slice(0, 300));

    // ---- 5. delivered state + the OUTBOX crate ----
    const deliveredText = await evalJS(cdp, `(document.querySelector('.sample-card') || {}).textContent || ''`);
    console.log('delivered card:', JSON.stringify(deliveredText.slice(0, 400)));
    if (!/sample delivered/.test(deliveredText)) throw new Error('the card never reached the delivered state: ' + deliveredText.slice(0, 200));
    shots.push(await capture(cdp, OUT, 'sample-delivered'));
    const pending = await evalJS(cdp, `({ count: ReturnStore.pendingCount(), rows: ReturnStore.pendingRows() })`);
    console.log('OUTBOX pending:', JSON.stringify(pending));
    await evalJS(cdp, `StationUI.openTerm('outbox')`);
    await sleep(1200);
    shots.push(await capture(cdp, OUT, 'outbox-window'));
    const obRow = await evalJS(cdp, `(() => { const r = document.querySelector('#ob-list .ob-row'); return r ? r.textContent.replace(/\\s+/g, ' ').slice(0, 240) : null; })()`);
    console.log('OUTBOX row:', JSON.stringify(obRow));

    // ---- 6. a clean endpoint transcript for the report (another real ride, mock-priced $0) ----
    await evalJS(cdp, `(() => { const t = document.querySelector('.term-outbox .term-x, #term-outbox .term-x'); if (t) t.click(); return true; })()`).catch(() => {});
    out.happy = await evalJS(cdp, POST_SAMPLE);
    console.log('HAPPY PATH:', JSON.stringify(out.happy));

    console.log(JSON.stringify({
      out: OUT, shots: shots.map(s => s.path),
      consoleErrors: diag.consoleMsgs.slice(0, 10), exceptions: diag.exceptions.slice(0, 10)
    }, null, 2));
  } finally {
    try { if (cdp) cdp.close && cdp.close(); } catch {}
    try { if (cdp && cdp.ws) cdp.ws.close(); } catch {}
    try { if (chrome) chrome.proc ? chrome.proc.kill() : chrome.kill(); } catch {}
    try { side.kill(); } catch {}
    try { mock.server.close(); } catch {}
  }
}

main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
