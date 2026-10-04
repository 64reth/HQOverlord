#!/usr/bin/env node
/* dev/toast-seat-shots.mjs — proof harness for WHERE THE TOAST RACK SITS (motion.css §7).
 *
 * The rack used to be pinned by two literal numbers (`left: 268px * --cz; bottom: 128px * --cz`)
 * that lined up with nothing: it floated inside the stage, and because the CREW seam is DRAGGABLE
 * (--crew-w, leftrail.js) a wide rail walked the stage out from under it and the card ended up
 * sitting ON the crew list. StationUI.seatToastRack() now measures the cabinet instead.
 *
 * This records, in VISUAL px (the unit the rects and the seam are authored in):
 *   the rack's left edge vs the columns' left edge (#bottombar) · its bottom edge vs the columns'
 *   bottom line (#stage-wrap) · that it never reaches COMMS · how much of it a floating window
 *   covers · and the same numbers for the OLD anchor, measured in the same frame via an injected
 *   style (the panel-UX A-B law: synchronous read, no rAF).
 * Runs at textScale 100 AND AUTO, so "the seat is hardware, the type is content" is measured.
 *
 *   node dev/toast-seat-shots.mjs <label>   → dev/.shots-toast/<label>-*.png
 *   ports: SKYNET_SHOT_PORT (default 9767) / SKYNET_CDP_PORT (default 9768)
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const LABEL = process.argv[2] || 'shot';
const PORT = process.env.SKYNET_SHOT_PORT || '9767';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9768);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-toast');

const setScale = (v) => `(() => {
  const KEY = 'starnet.station.v1';
  const r = JSON.parse(localStorage.getItem(KEY) || '{"v":1}');
  r.settings = Object.assign({}, r.settings, { textScale: ${v} });
  localStorage.setItem(KEY, JSON.stringify(r));
  location.reload();
  return 'reloading';
})()`;

// A long-dwell card so the shot and the measure see the same thing. `sev-bad` lingers 6.5s.
const FIRE = (msg, cls) => `(() => { StationUI.notify(${JSON.stringify(msg)}, ${JSON.stringify(cls)}); return 'fired'; })()`;

/* THE ALIGNMENT CHECK. The two edges the eye reads the rack against are the cabinet's outer
   padding line (#bottombar.left — shared by #topbar, the CREW rail and the dock) and the line
   where every column ends (#stage-wrap.bottom). Both must be EXACT, not close.
   The OLD anchor is measured in the same frame by injecting the pre-fix declaration, reading,
   and removing it — one synchronous A-B, no rAF (the panel-UX law). */
const MEASURE = `(() => {
  const R = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right), b: Math.round(b.bottom) }; };
  const stack = document.getElementById('toast-stack');
  const bar = R(document.getElementById('bottombar'));
  const stage = R(document.getElementById('stage-wrap'));
  const chat = R(document.getElementById('chat-panel'));
  const left = document.getElementById('left');
  const rail = left && left.offsetParent !== null ? R(left) : null;
  const wins = Array.prototype.map.call(document.querySelectorAll('#terms .term'), R);
  const coverOf = (s) => wins.reduce((sum, a) => {
    const ox = Math.max(0, Math.min(a.r, s.r) - Math.max(a.x, s.x));
    const oy = Math.max(0, Math.min(a.b, s.b) - Math.max(a.y, s.y));
    return sum + ox * oy;
  }, 0);
  const coachEl = document.querySelector('.nav-coach');
  const coach = coachEl && !coachEl.hasAttribute('hidden') && coachEl.getBoundingClientRect().height > 0 ? R(coachEl) : null;
  const read = () => {
    const s = R(stack);
    return {
      rack: s,
      leftGap: s.x - bar.x,             // want 0 — flush with the cabinet's outer padding line
      // want 0 resting on the line every column ends at, or lifted clear when the coach mark is up
      bottomGap: stage.b - s.b,
      coachClearance: coach ? coach.y - s.b : null,   // want >= 0 — never bury a first-run instruction
      commsClearance: chat.x - s.r,     // want >= 0 — the rack can never reach the live conversation
      railOverhang: rail ? s.r - rail.r : null,
      windowCoverPx2: coverOf(s),
    };
  };
  const now = read();
  // the pre-fix anchor, restored just long enough to read it
  const st = document.createElement('style');
  st.textContent = '#toast-stack{left:calc(268px * var(--cz,1))!important;bottom:calc(128px * var(--cz,1))!important;width:min(356px, calc(37vw * var(--cz,1)))!important}';
  document.head.appendChild(st);
  const was = read();
  st.remove();
  return {
    innerWidth: window.innerWidth, innerHeight: window.innerHeight,
    zoom: document.body.style.zoom || '1',
    vars: {
      x: stack.style.getPropertyValue('--toast-x') || '(unset)',
      b: stack.style.getPropertyValue('--toast-b') || '(unset)',
      cap: stack.style.getPropertyValue('--toast-cap') || '(unset)',
    },
    cabinet: { barLeft: bar.x, colBottom: stage.b, commsLeft: chat.x, railRight: rail ? rail.r : null, coach },
    openWindows: wins.length,
    now, was,
  };
})()`;

// a real pointer drag on the CREW seam — the motion that used to walk the stage out from under the rack
const dragRail = (toX) => `(() => {
  const seam = document.getElementById('crew-resizer');
  if (!seam) return '(no seam)';
  const r = seam.getBoundingClientRect();
  const opts = { pointerId: 1, bubbles: true, cancelable: true, isPrimary: true };
  seam.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ clientX: Math.round(r.left + 5), clientY: 400 }, opts)));
  seam.dispatchEvent(new PointerEvent('pointermove', Object.assign({ clientX: ${toX}, clientY: 400 }, opts)));
  seam.dispatchEvent(new PointerEvent('pointerup', Object.assign({ clientX: ${toX}, clientY: 400 }, opts)));
  return document.getElementById('screen-game').style.getPropertyValue('--crew-w');
})()`;

const OPEN_WINDOWS = `(() => { ['deliverables','settings','tasks'].forEach(k => StationUI.openTerm(k)); return 'opened'; })()`;
const CLOSE_WINDOWS = `(() => { ['deliverables','settings','tasks'].forEach(k => { try { StationUI.closeTerm(k); } catch (_) {} }); return 'closed'; })()`;

/* THE BEFORE PICTURE. Andrew's report was about how this LOOKS, so the harness has to produce a
   render of the old anchor, not only its numbers — pin the pre-fix declaration, shoot, unpin. */
const PIN_OLD = `(() => {
  const st = document.createElement('style'); st.id = 'toast-old-anchor';
  st.textContent = '#toast-stack{left:calc(268px * var(--cz,1))!important;bottom:calc(128px * var(--cz,1))!important;width:min(356px, calc(37vw * var(--cz,1)))!important}';
  document.head.appendChild(st); return 'pinned';
})()`;
const UNPIN_OLD = `(() => { const st = document.getElementById('toast-old-anchor'); if (st) st.remove(); return 'unpinned'; })()`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'toastseat-'));
  materializeSeedWorkspace(join(scratch, 'ws'));
  const side = bootSeededSidecar({ port: PORT, scratchDir: join(scratch, 'ws') });
  let chrome = null, cdp = null;
  const results = {};
  try {
    if (!(await waitUp(URL))) throw new Error('sidecar never came up on ' + URL);
    chrome = launchChrome({ cdpPort: CDP_PORT, win: '1440,900', profileDir: join(scratch, 'chrome') });
    await sleep(1200);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Runtime.enable');
    const diag = collectDiagnostics(cdp);
    await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never reached the game screen');
    await sleep(1200);
    mkdirSync(OUT, { recursive: true });

    for (const [tag, scale] of [['t100', 100], ['auto', 0]]) {
      await evalJS(cdp, setScale(scale));
      if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never came back after textScale=' + scale);
      await sleep(1200);
      const R = {};

      // 1 · the resting station: one card, nothing else open
      await evalJS(cdp, FIRE('RUN COMPLETE: NOVA finished “draft the launch email”', 'good'));
      await sleep(700);
      R.default = await evalJS(cdp, MEASURE);
      await capture(cdp, OUT, `${LABEL}-${tag}-1-default`);

      // 2 · a burst — the rack is a rack, every frame flush
      await sleep(4200);
      for (const [m, c] of [['✓ connected OpenRouter API key — stored in your OS keychain', 'good'],
                            ['MODEL: anthropic / claude-haiku-4.5 / high', ''],
                            ['Could not reach the station — retrying in 5s', 'bad']]) {
        await evalJS(cdp, FIRE(m, c));
        await sleep(220);
      }
      await sleep(500);
      R.burst = await evalJS(cdp, MEASURE);
      await evalJS(cdp, PIN_OLD);
      await sleep(150);
      await capture(cdp, OUT, `${LABEL}-${tag}-2a-burst-OLD`);
      await evalJS(cdp, UNPIN_OLD);
      await sleep(150);
      await capture(cdp, OUT, `${LABEL}-${tag}-2b-burst-NEW`);

      // 3 · THE COMPLAINT: a card fired while floating windows are open. Shot twice in the SAME
      //     frame — old anchor then new — so the before/after is one comparison, not two runs.
      await sleep(6800);
      await evalJS(cdp, OPEN_WINDOWS);
      await sleep(900);
      await evalJS(cdp, FIRE('NEEDS APPROVAL: NOVA wants to run a shell command', 'warn'));
      await sleep(700);
      await evalJS(cdp, PIN_OLD);
      await sleep(150);
      await capture(cdp, OUT, `${LABEL}-${tag}-3a-windows-OLD`);
      await evalJS(cdp, UNPIN_OLD);
      await sleep(150);
      R.withWindows = await evalJS(cdp, MEASURE);
      await capture(cdp, OUT, `${LABEL}-${tag}-3b-windows-NEW`);
      await evalJS(cdp, CLOSE_WINDOWS);
      await sleep(500);

      // 4 · THE DRIFT BUG: drag the CREW seam wide, then fire. The old anchor stayed at 268
      //     while the rail grew past it; the measured seat cannot.
      await sleep(6000);
      R.dragTo420 = await evalJS(cdp, dragRail(420));
      await sleep(600);
      await evalJS(cdp, FIRE('SEAT: crew rail dragged wide', 'gold'));
      await sleep(700);
      R.wideRail = await evalJS(cdp, MEASURE);
      await capture(cdp, OUT, `${LABEL}-${tag}-4-wide-rail`);
      await evalJS(cdp, dragRail(243));
      await sleep(400);

      results[tag] = R;
      console.log(tag + ' ' + JSON.stringify(R, null, 1));
    }

    console.log(JSON.stringify({
      out: OUT, label: LABEL,
      consoleErrors: diag.consoleMsgs.filter(m => m.level === 'error').slice(0, 10),
      exceptions: diag.exceptions.slice(0, 10),
    }, null, 2));
  } finally {
    try { if (cdp) cdp.close(); } catch {}
    try { if (chrome) chrome.proc ? chrome.proc.kill() : chrome.kill(); } catch {}
    try { side.kill(); } catch {}
  }
}

main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
