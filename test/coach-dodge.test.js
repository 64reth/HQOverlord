/* node test/coach-dodge.test.js — the tour's two closing overlays must never cover each other.

   finishUp() spawns BOTH surfaces: the FIRST STEPS brief (the durable map, z 1300) and the ⚑ QUESTS
   coachmark (z 99000). They were positioned by two functions that had never heard of each other —
   placeBrief clamps against #left/#chat-panel, placeCoach against the viewport — so at 1280x720 the
   coach landed square on the checklist the tour had just handed over (measured live 2026-08-03:
   brief 255-501 x 394-674, coach 121-441 x 441-664, ~186x223px buried).

   Unlike the rest of the tour's coverage this is a GENUINE unit, not a source regex: dodgeRect is pure
   geometry hoisted out of the IIFE (the shape stationui.js uses for clampTerminalSize), so the gate can
   actually run it — across viewports and anchor positions a live walk would never enumerate. */
'use strict';
const A = require('./_assert.js');
const { dodgeRect } = require('../frontend/app/tutorial.js');

const hit = (a, b) => !(a.left + a.w <= b.left || a.left >= b.right || a.top + a.h <= b.top || a.top >= b.bottom);
const onScreen = (b, vw, vh) => b.left >= 8 && b.left + b.w <= vw - 8 && b.top >= 8 && b.top + b.h <= vh - 8;
// the real .tut-brief: width 246, bottom:52px, left set by placeBrief (right of the #left rail)
const briefAt = (left, vh, h) => ({ left, top: vh - 52 - h, right: left + 246, bottom: vh - 52 });

/* ---- 1. the exact live regression ---- */
{
  const brief = { left: 255, top: 394, right: 501, bottom: 674 };
  const out = dodgeRect({ left: 121, top: 441, w: 320, h: 223 }, brief, 1280, 720);
  A.ok(!hit(out, brief), 'the measured 1280x720 collision no longer overlaps');
  A.ok(onScreen(out, 1280, 720), 'and the dodged coach stays on screen');
  A.eq(out.left, 121, 'ABOVE is preferred, so the bubble keeps the anchor\'s column (never slides onto COMMS)');
}

/* ---- 2. an already-clear box is returned untouched (no gratuitous motion) ---- */
{
  const brief = { left: 255, top: 394, right: 501, bottom: 674 };
  const out = dodgeRect({ left: 700, top: 120, w: 320, h: 90 }, brief, 1280, 720);
  A.eq({ left: out.left, top: out.top }, { left: 700, top: 120 }, 'a coach that already clears the brief is not moved');
}

/* ---- 3. SWEEP: every viewport x anchor position the app can realistically produce ---- */
{
  const viewports = [[1280, 720], [1440, 900], [1920, 1080], [1120, 700], [1024, 640], [900, 600], [820, 560]];
  let cases = 0, moved = 0, unresolved = 0;
  for (const [vw, vh] of viewports) {
    for (const bh of [180, 230, 280]) {                       // brief height grows with ticked steps
      const brief = briefAt(14, vh, bh);                      // worst case: hard against the left edge
      for (let x = 8; x + 320 <= vw - 8; x += 53) {
        for (let y = 8; y + 223 <= vh - 8; y += 47) {
          cases++;
          const start = { left: x, top: y, w: 320, h: 223 };
          const out = dodgeRect(Object.assign({}, start), brief, vw, vh);
          const overlapped = hit(start, brief);
          if (!overlapped) { A.ok(out.left === x && out.top === y, 'clear boxes are never nudged'); continue; }
          if (out.left === x && out.top === y) { unresolved++; continue; }   // no clean slot — left where the anchor put it
          moved++;
          A.ok(!hit(out, brief), `dodged box clears the brief (${vw}x${vh} from ${x},${y})`);
          A.ok(onScreen(out, vw, vh), `dodged box stays on screen (${vw}x${vh} from ${x},${y})`);
          // stability: re-running on the result must be a no-op (placeCoach calls this every rAF)
          const again = dodgeRect(Object.assign({}, out), brief, vw, vh);
          A.eq({ left: again.left, top: again.top }, { left: out.left, top: out.top }, 'the dodge is idempotent (no per-frame jitter)');
        }
      }
    }
  }
  A.ok(cases > 2000, 'the sweep actually covered a meaningful grid (' + cases + ' cases)');
  A.ok(moved > 0, 'the sweep exercised real collisions (' + moved + ' dodged)');
  // a box only stays put when NO candidate both clears and fits — never because the dodge gave up early
  A.ok(unresolved === 0, 'every collision in the realistic grid found a clean slot (' + unresolved + ' unresolved)');
}

/* ---- 4. degrade honestly: a viewport with genuinely nowhere to go leaves the box put, never off-screen ---- */
{
  const brief = { left: 0, top: 0, right: 10000, bottom: 10000 };   // pathological: the brief covers everything
  const start = { left: 100, top: 100, w: 320, h: 223 };
  const out = dodgeRect(Object.assign({}, start), brief, 1280, 720);
  A.eq({ left: out.left, top: out.top }, { left: 100, top: 100 }, 'nowhere clean to go -> left where the anchor put it, not flung off-screen');
}

A.report('coach-dodge.test');
