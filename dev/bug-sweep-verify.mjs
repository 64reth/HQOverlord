#!/usr/bin/env node
/* dev/bug-sweep-verify.mjs — LIVE proof of the 2026-08-28 bug-sweep frontend batch.
 *
 * Drives the REAL app over CDP (headless one-off Chrome fires rAF, unlike the preview pane)
 * against a local mock OpenRouter and proves live:
 *   1. STUCK CAMERA DRAG RELEASED — mousedown on the stage, drag right, release OUTSIDE the
 *      canvas (window-level mouseup). The old code kept `drag` truthy: hovering back over the
 *      stage with no button then panned the camera and locked cursor to 'grabbing'. Proof:
 *      after the outside release, a bare mousemove over the stage leaves cursor NOT 'grabbing'.
 *      Repeated with window blur (alt-tab mid-drag).
 *   2. COMMS STREAM STILL WORKS — the composer guards (input listener + attachment wiring are
 *      now once-guarded) must not have broken the real send path: a streamed reply completes.
 *   3. NO CONSOLE ERRORS across the whole session.
 *
 *   node dev/bug-sweep-verify.mjs      (ports: SKYNET_SHOT_PORT / SKYNET_CDP_PORT)
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { launchChrome, connectCDP, evalJS, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9541';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9542);
const URL = `http://127.0.0.1:${PORT}/`;
const MODEL = 'test/model';
const REPLY = 'All belts nominal. Done checking.';

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
          for (let i = 0; i < REPLY.length; i += 8) {
            res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: REPLY.slice(i, i + 8) } }] }) + '\n\n');
          }
          res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 } }) + '\n\n');
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

// one drag-then-lose-the-button cycle; `release` is JS run in-page after the drag starts
const dragCycle = release => `JSON.stringify((() => {
  const cv = document.getElementById('stage');
  const r = cv.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const mk = (t, x, y) => new MouseEvent(t, { bubbles: true, clientX: x, clientY: y, button: 0 });
  cv.dispatchEvent(mk('mousedown', cx, cy));
  for (let i = 1; i <= 6; i++) cv.dispatchEvent(mk('mousemove', cx + i * 10, cy));   // >4px accum -> drag.moved
  const during = cv.style.cursor;                       // 'grabbing' while genuinely dragging
  ${release}
  const afterRelease = cv.style.cursor;
  cv.dispatchEvent(mk('mousemove', cx + 20, cy + 10));  // bare hover back over the stage, NO button
  const afterHover = cv.style.cursor;
  return { during, afterRelease, afterHover };
})())`;

async function main() {
  const mock = await startMock();
  const scratch = mkdtempSync(join(tmpdir(), 'bugsweep-'));
  materializeSeedWorkspace(join(scratch, 'ws'), MODEL);
  const side = bootSeededSidecar({
    port: PORT, model: MODEL, key: 'sk-or-v1-bug-sweep-mock', scratchDir: join(scratch, 'ws'),
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
    await sleep(2500);

    /* ---- 1a. drag released OUTSIDE the canvas (window-level mouseup) ---- */
    const outUp = JSON.parse(await evalJS(cdp, dragCycle(
      `window.dispatchEvent(mk('mouseup', r.right + 300, cy));`
    )));
    report.outsideMouseup = outUp;
    if (outUp.during !== 'grabbing') fails.push('drag never engaged (cursor "' + outUp.during + '" mid-drag) — the probe is not exercising the pan path');
    if (outUp.afterHover === 'grabbing') fails.push('OUTSIDE-RELEASE STILL STICKS: bare hover after a window-level mouseup re-entered the pan branch');

    /* ---- 1b. drag abandoned by alt-tab (window blur) ---- */
    const blurUp = JSON.parse(await evalJS(cdp, dragCycle(
      `window.dispatchEvent(new Event('blur'));`
    )));
    report.blurRelease = blurUp;
    if (blurUp.afterHover === 'grabbing') fails.push('BLUR STILL STICKS: bare hover after window blur re-entered the pan branch');

    /* ---- 2. the composer still sends and streams (the once-guards broke nothing) ---- */
    await evalJS(cdp, `(() => {
      const inp = document.getElementById('chat-input');
      inp.value = 'line status?';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('chat-send').onclick();
      return 'sent';
    })()`);
    const done = await waitReply(cdp, 'Done checking.', 30000);
    report.streamCompleted = done;
    if (!done) fails.push('streamed reply never completed — the composer wiring changes broke the send path');

    const errs = diag.consoleMsgs.filter(m => m.level === 'error').slice(0, 10);
    report.consoleErrors = errs;
    if (errs.length) fails.push('console errors during the session: ' + JSON.stringify(errs));

    console.log('\n===== REPORT =====\n' + JSON.stringify(report, null, 2));
    if (fails.length) throw new Error('LIVE VERIFY FAILED:\n  - ' + fails.join('\n  - '));
    console.log('\nBUG-SWEEP LIVE VERIFY: PASS — outside-release + blur both free the camera drag, stream complete, console clean');
  } finally {
    try { if (cdp) cdp.close(); } catch {}
    try { if (chrome) chrome.kill(); } catch {}
    try { side.kill(); } catch {}
    try { mock.server.close(); } catch {}
  }
}

main().catch(e => { console.error(e && e.message || e); process.exit(1); });
