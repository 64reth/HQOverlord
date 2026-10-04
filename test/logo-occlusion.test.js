/* node test/logo-occlusion.test.js
   Locks the brand-mark occlusion geometry (frontend/app/logoclip.js).

   REGRESSION: #logo is a <body> child at z960 (it has to out-stack the CRT glass at z940/950),
   while every floating window lives in #terms INSIDE #screen-game — a z-index:10 stacking context.
   So no window can ever paint over the mark by stacking alone, and dragging a panel into the
   top-left made the amber wordmark bleed straight through it (2026-07-29 report). The mark is
   clipped under the window rects instead; these are the cases that clip has to get right. */
'use strict';
const A = require('./_assert.js');
const LogoClip = require('../frontend/app/logoclip.js');

// the real measured mark in the topbar: 142×24 at (25,21). Rects are VISUAL px.
const MARK = { left: 25, top: 21, width: 142, height: 24 };
const rect = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b });

// how much of the mark (in local px²) the clip leaves visible — parsed back out of the path
function visibleArea(clip, box, zoom) {
  const z = zoom || 1;
  if (clip === '') return (box.width / z) * (box.height / z);
  if (clip === LogoClip.NOTHING) return 0;
  let area = 0;
  const re = /M([\d.-]+) ([\d.-]+)H([\d.-]+)V([\d.-]+)H/g;
  let m;
  while ((m = re.exec(clip))) area += (Number(m[3]) - Number(m[1])) * (Number(m[4]) - Number(m[2]));
  return area;
}

(async () => {
  // --- nothing open: no clip at all, so the mark keeps its crisp above-the-glass paint ---
  A.eq(LogoClip.clipFor(MARK, [], 1), '', 'no windows -> no clip');
  A.eq(LogoClip.clipFor(MARK, [rect(400, 300, 900, 700)], 1), '', 'window far from the mark -> no clip');
  A.eq(LogoClip.clipFor(MARK, [rect(167, 21, 600, 400)], 1), '', 'window flush against the right edge -> no clip');

  // --- a display:none (minimized) window reports a 0×0 rect and must occlude NOTHING ---
  A.eq(LogoClip.clipFor(MARK, [rect(0, 0, 0, 0)], 1), '', 'minimized window -> no clip');

  // --- fully buried: a valid "clip everything". An empty path() string is invalid CSS and would
  //     silently drop the clip, putting the logo back ON TOP of the window — the original bug. ---
  const buried = LogoClip.clipFor(MARK, [rect(0, 0, 1200, 800)], 1);
  A.eq(buried, LogoClip.NOTHING, 'window covering the whole mark -> inset(50%)');
  A.ok(buried !== 'path("")', 'never emits an empty path() (invalid CSS = no clip = the bug)');

  // --- the reported case: a window dragged in from the right cuts the wordmark at its left edge ---
  const cutAt = 100;   // window's left edge, visual px
  const partial = LogoClip.clipFor(MARK, [rect(cutAt, 0, 900, 700)], 1);
  A.ok(partial.startsWith('path("'), 'partial overlap -> a path, not a blanket hide');
  A.eq(visibleArea(partial, MARK, 1), (cutAt - MARK.left) * MARK.height,
    'exactly the uncovered strip survives (75 x 24)');

  // --- a window whose TOP edge lands mid-mark cuts horizontally, not vertically ---
  const half = LogoClip.clipFor(MARK, [rect(0, 33, 900, 700)], 1);
  A.eq(visibleArea(half, MARK, 1), MARK.width * 12, 'top-edge-at-midline -> upper half survives');

  // --- two windows, disjoint bites: both are subtracted, the gap between them survives ---
  const two = LogoClip.clipFor(MARK, [rect(45, 0, 65, 700), rect(120, 0, 140, 700)], 1);
  A.eq(visibleArea(two, MARK, 1), (142 - 20 - 20) * 24, 'two disjoint windows -> both bites removed');

  // --- overlapping windows must not double-subtract (the naive band sweep would drop area twice) ---
  const overlap = LogoClip.clipFor(MARK, [rect(45, 0, 100, 700), rect(80, 0, 125, 700)], 1);
  A.eq(visibleArea(overlap, MARK, 1), (142 - 80) * 24, 'overlapping windows -> union removed once');

  // --- uiZoom law: rects are VISUAL px, clip coordinates are the element's own LAYOUT px.
  //     At 2x zoom a mark that MEASURES 142x24 is only 71x12 in its own coordinate space. ---
  const zoomed = LogoClip.clipFor(MARK, [rect(100, 0, 900, 700)], 2);
  A.eq(visibleArea(zoomed, MARK, 2), ((100 - 25) / 2) * (24 / 2),
    'zoom divides exactly once (never a raw visual-px path)');
  A.ok(!/ 24Z|V24/.test(zoomed), 'no unzoomed height leaks into the path at 2x');

  // --- a sub-pixel graze is not occlusion (it would emit a degenerate subpath) ---
  A.eq(LogoClip.clipFor(MARK, [rect(166.995, 21, 600, 400)], 1), '', 'sub-pixel graze -> no clip');

  console.log('logo-occlusion.test.js OK');
  // report() settles the assertion counter — the .catch below only fires on a THROWN error, so
  // without this a failed assertion still exits 0 and the gate scores it green.
  A.report('logo-occlusion');
})().catch(e => { console.error(e); process.exit(1); });
