#!/usr/bin/env node
/* dev/perf-lag-verify.mjs — LIVE proof of the 2026-08-26 perf-lag fixes (the shipped v0.10.10 lag).
 *
 * The lane changed four things; this drives the REAL app over CDP (rAF runs in headless one-off
 * Chrome, unlike the preview pane) against a local mock OpenRouter and proves each live:
 *   1. HEALTHY BASELINE — the sentinel now reads through the willReadFrequently probe canvas
 *      (readAlpha1). Proof it reads TRUTHFULLY: after seconds of frames, _dbgStageState().armed
 *      is true (an opaque heartbeat was read) with rebuilds===0 and no '[world] cached canvases
 *      lost' console spam — i.e. the new read path answers opaque on a healthy stage, no
 *      false-positive recovery loop.
 *   2. WATCHDOG STILL HEALS — _dbgKillStageContext(), wait out grace, assert rebuilds>=1,
 *      deadSince===0 (a healthy read PROVED the cure), and a mid-frame pixel sweep is non-black.
 *   3. COMMS STREAM INTEGRITY — a streamed markdown-bearing reply renders complete and parsed
 *      (the per-frame coalescing must lose no tokens and still flush at close), caret gone.
 *   4. TRANSCRIPT DOM CAP — pad #chat-log past LOG_DOM_CAP with inert rows, run another real
 *      turn, assert the log was pruned back to the cap (oldest shed, newest intact).
 *
 *   node dev/perf-lag-verify.mjs      (ports: SKYNET_SHOT_PORT / SKYNET_CDP_PORT)
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { launchChrome, connectCDP, evalJS, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9531';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9532);
const URL = `http://127.0.0.1:${PORT}/`;
const MODEL = 'test/model';
const REPLY = 'Status is **green** across the line. See http://example.com/report for the drop.\n- belts nominal\n- docks crewed\nDone checking.';

function startMock() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url.includes('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ id: MODEL, context_length: 8000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] }] }));
      }
      if (req.url.includes('/chat/completions')) {
        let body = '';
        req.on('data', d => { body += d; });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          // stream in SMALL deltas (~6 chars) so plain() sees many tokens against a growing
          // markdown paragraph — the exact shape the coalescing exists for
          for (let i = 0; i < REPLY.length; i += 6) {
            res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: REPLY.slice(i, i + 6) } }] }) + '\n\n');
          }
          res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 40, total_tokens: 45 } }) + '\n\n');
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

async function waitReply(cdp, marker, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const got = await evalJS(cdp, `(() => {
      const rows = [...document.querySelectorAll('#chat-log .cmsg.agent .body')];
      const last = rows[rows.length - 1];
      return last && last.textContent.includes(${JSON.stringify(marker)}) ? 'yes' : 'no';
    })()`);
    if (String(got).includes('yes')) return true;
    await sleep(500);
  }
  return false;
}

async function main() {
  const mock = await startMock();
  const scratch = mkdtempSync(join(tmpdir(), 'perflag-'));
  materializeSeedWorkspace(join(scratch, 'ws'), MODEL);
  const side = bootSeededSidecar({
    port: PORT, model: MODEL, key: 'sk-or-v1-perf-lag-mock', scratchDir: join(scratch, 'ws'),
    env: { SKYNET_OPENROUTER_BASE: mock.base, STARNET_OPENROUTER_BASE: mock.base }
  });
  let chrome = null, cdp = null;
  const fails = [];
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
    await sleep(4000);   // several seconds of real frames — the probes run at 4Hz

    /* ---- 1. healthy baseline: probe-canvas read answers OPAQUE, no recovery spam ---- */
    const base = JSON.parse(await evalJS(cdp, `JSON.stringify(World._dbgStageState())`));
    report.baseline = base;
    if (!base.armed) fails.push('sentinel never armed — readAlpha1 is not reading an opaque heartbeat from the healthy stage');
    if (base.rebuilds !== 0) fails.push('stage rebuilt on a HEALTHY run (' + base.rebuilds + ') — the probe path is false-positive');
    if (base.deadSince !== 0) fails.push('healthy stage reads as dead (deadSince=' + base.deadSince + ')');

    /* ---- 2. kill the stage context; the watchdog must rebuild and PROVE the cure ---- */
    const killed = await evalJS(cdp, `String(World._dbgKillStageContext())`);
    if (!String(killed).includes('true')) fails.push('_dbgKillStageContext refused (' + killed + ')');
    await sleep(5000);   // STAGE_GRACE_MS 3000 + probe cadence + one healthy read
    const healed = JSON.parse(await evalJS(cdp, `JSON.stringify(World._dbgStageState())`));
    report.healed = healed;
    if (healed.rebuilds < 1) fails.push('stage was never rebuilt after the kill (rebuilds=' + healed.rebuilds + ')');
    if (healed.deadSince !== 0) fails.push('rebuild not proven by a healthy read (deadSince=' + healed.deadSince + ')');
    if (healed.futile !== 0) fails.push('rebuild still marked futile (' + healed.futile + ')');
    const px = JSON.parse(await evalJS(cdp, `JSON.stringify((() => {
      const cv = document.getElementById('stage');
      const s = document.createElement('canvas'); s.width = 200; s.height = 200;
      const g = s.getContext('2d', { willReadFrequently: true });
      g.drawImage(cv, cv.width / 2 - 100, cv.height / 2 - 100, 200, 200, 0, 0, 200, 200);
      const d = g.getImageData(0, 0, 200, 200).data;
      let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
      return { lit, of: 10000 };
    })())`));
    report.pixels = px;
    if (!px || px.lit < 500) fails.push('rebuilt stage is not visibly painting (lit=' + (px && px.lit) + '/10000 mid-frame px)');

    /* ---- 3. a real streamed markdown turn renders complete + parsed ---- */
    await evalJS(cdp, `(() => {
      const inp = document.getElementById('chat-input');
      inp.value = 'give me the line status';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('chat-send').onclick();
      return 'sent';
    })()`);
    const done1 = await waitReply(cdp, 'Done checking.', 30000);
    if (!done1) fails.push('streamed reply never completed in the transcript');
    const prose = JSON.parse(await evalJS(cdp, `JSON.stringify((() => {
      const rows = [...document.querySelectorAll('#chat-log .cmsg.agent .body')];
      const last = rows[rows.length - 1];
      return {
        text: last ? last.textContent : '',
        html: last ? last.innerHTML.slice(0, 400) : '',
        caret: !!(last && last.parentElement.querySelector('.caret')),
        bullets: last ? last.querySelectorAll('.md-li').length : 0,
        linked: !!(last && last.querySelector('a'))
      };
    })())`));
    report.prose = prose;
    if (done1) {
      if (!/Status is green across the line/.test(prose.text.replace(/\s+/g, ' '))) fails.push('streamed prose is incomplete/mangled: ' + JSON.stringify(prose.text.slice(0, 120)));
      if (prose.bullets < 2) fails.push('markdown bullets did not render (' + prose.bullets + ') — the coalesced path is not parsing');
      if (!prose.linked) fails.push('URL did not linkify in the coalesced path');
      if (prose.caret) fails.push('caret survived stream close — closeSeg flush is broken');
    }

    /* ---- 4. the transcript DOM cap prunes on the next real row ---- */
    const cap = JSON.parse(await evalJS(cdp, `JSON.stringify((() => {
      const log = document.getElementById('chat-log');
      for (let i = 0; i < 520; i++) { const d = document.createElement('div'); d.className = 'cmsg system'; d.textContent = 'pad ' + i; log.insertBefore(d, log.firstChild); }
      log.scrollTop = log.scrollHeight;   // Commander at the bottom → pruning is allowed
      return { padded: log.children.length };
    })())`));
    await evalJS(cdp, `(() => {
      const inp = document.getElementById('chat-input');
      inp.value = 'status again please';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('chat-send').onclick();
      return 'sent';
    })()`);
    const done2 = await waitReply(cdp, 'Done checking.', 30000);
    const after = JSON.parse(await evalJS(cdp, `JSON.stringify((() => {
      const log = document.getElementById('chat-log');
      const rows = [...document.querySelectorAll('#chat-log .cmsg.agent .body')];
      const last = rows[rows.length - 1];
      return { count: log.children.length, newestIntact: !!(last && last.textContent.includes('Done checking.')) };
    })())`));
    report.domCap = { padded: cap.padded, after: after.count, newestIntact: after.newestIntact };
    if (!done2) fails.push('second streamed reply never completed');
    if (after.count > 410) fails.push('transcript DOM was not pruned (still ' + after.count + ' rows after a real turn)');
    if (!after.newestIntact) fails.push('pruning ate the NEWEST row — cap is shedding the wrong end');

    const errs = diag.consoleMsgs.filter(m => m.level === 'error').slice(0, 10);
    const lossSpam = diag.consoleMsgs.filter(m => /cached canvases lost/.test(String(m.text || ''))).length;
    report.consoleErrors = errs;
    report.bakeRecoveryWarnings = lossSpam;
    if (lossSpam > 1) fails.push('bake watchdog fired ' + lossSpam + ' recoveries — the probe-canvas bake read is false-positive');

    console.log('\n===== REPORT =====\n' + JSON.stringify(report, null, 2));
    if (fails.length) throw new Error('LIVE VERIFY FAILED:\n  - ' + fails.join('\n  - '));
    console.log('\nPERF-LAG LIVE VERIFY: PASS — sentinel truthful, kill→rebuild healed, stream complete+parsed, DOM capped');
  } finally {
    try { if (cdp) cdp.close(); } catch {}
    try { if (chrome) chrome.kill(); } catch {}
    try { side.kill(); } catch {}
    try { mock.server.close(); } catch {}
  }
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
