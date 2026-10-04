/* node test/crew-rail-fit.test.js — the CREW rail's roster window always ends flush under a row.

   Reported 2026-08-07: the roster "cuts off" — the last agent rendered sliced in half. Cause: the
   window was a flat `max-height: 40%` of the column, and a percentage of a column is never a whole
   number of rows. Measured on a 6-agent station that left 10px of a row hanging at 1440x900, 18px
   at 780 and 25px at 660 — enough that the list reads as broken rather than as scrollable.

   The fix measures the window from real row geometry and rounds DOWN to a whole row. crewCap is
   that decision, split out from the measuring so it is genuinely unit-testable; the measuring
   itself needs a layout engine (offsetTop/offsetHeight read 0 under jsdom) and is source-locked
   here instead.

   OUT OF HEADLESS SCOPE: the on-screen result — rows whole, nothing sliced, scroll reaching the
   last agent, and the same under a WORKING row and at 85%/130% TEXT SIZE — is covered live by
   dev/crew-fit-probe.mjs and dev/crew-fit-stress.mjs. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const { crewCap, rowsAtHeight, ROWS_MIN, SHARE, WS_FLOOR } = require('../frontend/app/leftrail.js');

/* ---- 1. GENUINE: the cap always lands ON one of the row cuts, never between them ---- */
// a 6-agent roster, rows ~49px: the max-height that ends the list flush under each row in turn
const CUTS = [52, 101, 151, 200, 249, 299];

A.eq(crewCap(CUTS, { railH: 774, spare: 600 }), 299, 'a tall rail keeps its 40% share — all 6 rows fit whole');
A.eq(crewCap(CUTS, { railH: 652, spare: 500 }), 249, '40% of 652 is 261: rounds DOWN to 5 whole rows, not a 10px slice');
A.eq(crewCap(CUTS, { railH: 548, spare: 400 }), 200, '40% of 548 is 219: rounds DOWN to 4 whole rows, not an 18px slice');
A.eq(crewCap(CUTS, { railH: 443, spare: 300 }), 200, '40% of 443 is only 3 rows, but ROWS_MIN lifts a short rail back to 4 whole');

for (const railH of [280, 443, 548, 652, 774, 1200]) {
  const cap = crewCap(CUTS, { railH, spare: 900 });
  A.ok(CUTS.indexOf(cap) >= 0, 'rail ' + railH + 'px: the cap IS a row cut (' + cap + '), never a value between two rows');
}

// the SESSIONS floor wins over the roster's floor — but still only by whole rows
A.eq(crewCap(CUTS, { railH: 774, spare: 160 }), 151, 'a column that can only spare 160px drops to 3 WHOLE rows, not a 160px slice');
A.eq(crewCap(CUTS, { railH: 774, spare: 10 }), 52, 'an impossibly tight column still shows one WHOLE row rather than a sliver');
A.eq(crewCap(CUTS, { railH: 0, spare: 0 }), 52, 'a degenerate measurement fails closed to one whole row');

// a roster shorter than the floor is shown entire — the cap never invents rows it does not have
A.eq(crewCap([52, 101], { railH: 774, spare: 600 }), 101, 'a 2-agent roster is shown entire (nothing to scroll)');
A.eq(crewCap([52], { railH: 774, spare: 600 }), 52, 'a 1-agent roster is shown entire');
A.eq(crewCap([], { railH: 774, spare: 600 }), 0, 'an empty roster asks for no cap at all');

// fractional layout must never round DOWN into the row it is meant to reveal
A.eq(crewCap([52.4, 101.6], { railH: 300, spare: 600 }), 102, 'a fractional row cut rounds UP so the last row stays whole');

A.ok(ROWS_MIN >= 3 && ROWS_MIN <= 4, 'the rail promises 3-4 agents visible whole (Commander directive)');
A.ok(SHARE > 0 && SHARE < 1, 'the roster keeps a fractional share of the column, never all of it');
A.ok(WS_FLOOR > 0, 'SESSIONS keeps a floor no matter how deep the crew gets');

/* ---- 2. SOURCE-LOCK the measuring + the CSS contract ---- */
const js = fs.readFileSync(path.join(__dirname, '../frontend/app/leftrail.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../frontend/css/style.css'), 'utf8');

const crewRule = /#crew\s*\{[^}]*\}/.exec(css);
A.ok(crewRule, 'style.css still carries the #crew rule');
const rule = crewRule ? crewRule[0] : '';
A.ok(/max-height:\s*var\(--crew-cap/.test(rule), '#crew is capped by the MEASURED --crew-cap, not a flat percentage');
A.ok(/flex:\s*0\s+0\s+auto/.test(rule), '#crew cannot be flex-SHRUNK below its cap (a shrink re-opens the slice)');
A.ok(/overflow-y:\s*auto/.test(rule), 'the agents past the window are still reachable by scrolling');

A.ok(/setProperty\('--crew-cap'/.test(js), 'leftrail writes the measured cap onto --crew-cap');
A.ok(/removeProperty\('--crew-cap'\)/.test(js), 'an empty roster clears the cap so the empty state sizes itself');
A.ok(/offsetTop[\s\S]{0,80}offsetHeight/.test(js), 'the cut list is summed from REAL row geometry (offsetTop/offsetHeight), not a constant row height');
A.ok(/U\.elZoom/.test(js), 'visual rect px are converted through elZoom — TEXT SIZE is a body zoom (uiZoom law)');
A.ok(/getBoundingClientRect\(\)[\s\S]{0,200}\/ z/.test(js), '…and converted exactly ONCE, where the rects are read');
A.ok(/observe\(ul,\s*\{\s*childList:\s*true\s*\}\)/.test(js), 're-measures when crewRender replaces the rows');
const rowWatch = /observe\(ul,\s*\{\s*subtree:\s*true,\s*attributeFilter:\s*\[([^\]]+)\]\s*\}\)/.exec(js);
A.ok(rowWatch && rowWatch[1].includes("'class'"), 're-measures when a row picks up .working (which opens the in-flight bar)');
A.ok(rowWatch && rowWatch[1].includes("'hidden'") && js.includes(".crew-row:not([hidden])"),
  'activity-filter changes re-measure the rail and exclude hidden agents from row cuts');
A.ok(!/childList:\s*true,\s*subtree:\s*true/.test(js), 'the row-count observer is NOT subtree — crewTick rewrites every status line each second, and watching that costs ~8 forced layouts a second');
// motion.css §17 TRANSITIONS that bar open/closed, so the class toggle fires at the OLD height
A.ok(/'transitionrun'/.test(js) && /requestAnimationFrame\(follow\)/.test(js), 'follows the in-flight bar frame by frame while it animates — a single re-measure samples it mid-collapse');
A.ok(/transitionend[\s\S]{0,140}propertyName === 'height'/.test(js), '…and re-measures once more on the exact landing');
A.ok(/\.crew-row \.crew-prog\s*\{[^}]*transition:\s*height/.test(fs.readFileSync(path.join(__dirname, '../frontend/css/motion.css'), 'utf8')),
  '…and that transition is still the reason: motion.css animates the bar height');
A.ok(/new ResizeObserver\([\s\S]{0,40}observe\(left\)/.test(js), 're-measures when the rail itself resizes (window, TEXT SIZE, rail show/hide)');
A.ok(/requestAnimationFrame/.test(js), 'the re-measure is coalesced into one frame, not run per mutation');

/* ---- 3. THE ROSTER SEAM (2026-08-10) — the Commander may set that row count by dragging ----
   "users should have the option to raise the sessions way higher if they want more space to see
   their sessions." A dragged split replaces the automatic budget, and NOTHING else: rows stay
   whole, SESSIONS keeps its floor, and one whole row is still the bottom of the range. */
A.eq(crewCap(CUTS, { railH: 774, spare: 600, rows: 2 }), 101, 'dragged to 2 rows: the roster takes 2 whole rows and SESSIONS gets the rest');
A.eq(crewCap(CUTS, { railH: 774, spare: 600, rows: 1 }), 52, 'dragged to the floor: one whole row, never zero — a CREW panel showing no crew is a lie');
A.eq(crewCap(CUTS, { railH: 443, spare: 600, rows: 6 }), 299, 'dragged the other way: 6 rows on a short rail, past the automatic 40% share');
A.eq(crewCap(CUTS, { railH: 774, spare: 600, rows: 9 }), 299, 'asking for more rows than the roster has stops at the last row');
A.eq(crewCap(CUTS, { railH: 774, spare: 160, rows: 6 }), 151, 'the SESSIONS floor still wins over a dragged row count — and still by whole rows');
A.eq(crewCap([52, 101], { railH: 774, spare: 600, rows: 5 }), 101, 'a 2-agent roster dragged tall is still shown entire');
A.eq(crewCap(CUTS, { railH: 652, spare: 500 }), crewCap(CUTS, { railH: 652, spare: 500, rows: null }),
  'an unset preference measures exactly as it did before the seam existed');

/* THE ROSTER MAY BE DRAGGED SHUT (2026-08-10, round 2). Andrew: "maybe we should have it to where
   the user can drag it over the crew tab in case the user wants to only see sessions." So 0 is a
   real value of the preference — the roster closes and SESSIONS owns the column — and it is NOT
   the same as "unset", which still means "measure it for me". The rail does not stop telling the
   truth about the crew: the header and the WORKING/IDLE totals stay, and the seam is the way back. */
A.eq(crewCap(CUTS, { railH: 774, spare: 600, rows: 0 }), 0, 'dragged shut: the roster takes no height at all and SESSIONS gets the column');
A.eq(crewCap(CUTS, { railH: 774, spare: 10, rows: 0 }), 0, '…even when the column is too tight to have offered it automatically');
A.eq(crewCap([52], { railH: 774, spare: 600, rows: 0 }), 0, 'a one-agent roster can be closed too — that is the second notch a lone agent now has');
A.eq(crewCap(CUTS, { railH: 774, spare: 600, rows: null }), 299, 'and null still means "measure it", NOT "closed" — the two must never collapse into one falsy value');
A.eq(crewCap([], { railH: 774, spare: 600, rows: 0 }), 0, 'an empty roster asks for no cap whether or not it was dragged shut');
for (const rows of [1, 2, 3, 4, 5, 6, 7]) {
  A.ok(CUTS.indexOf(crewCap(CUTS, { railH: 774, spare: 900, rows })) >= 0, 'dragged to ' + rows + ': the cap is STILL a row cut, never a value between two rows');
}

// the drag→rows half: a dragged height snaps to the NEAREST cut, so the seam moves in whole notches
A.eq(rowsAtHeight(CUTS, 101), 2, 'a drag landing exactly on a row cut takes that many rows');
A.eq(rowsAtHeight(CUTS, 110), 2, 'a drag just past a cut has not reached the next row yet');
A.eq(rowsAtHeight(CUTS, 130), 3, '…and past the midpoint it snaps forward to the next whole row');
A.eq(rowsAtHeight(CUTS, 40), 1, 'a drag just under the first cut still keeps that row');
A.eq(rowsAtHeight(CUTS, 20), 0, '…and past ITS midpoint the last notch is the roster shut');
A.eq(rowsAtHeight(CUTS, 0), 0, 'dragging to the top of the roster closes it');
A.eq(rowsAtHeight(CUTS, -400), 0, 'dragging above the rail entirely closes it, it does not bounce back to one row');
A.eq(rowsAtHeight(CUTS, 9999), 6, 'dragging below the last row stops at the whole roster');
A.eq(rowsAtHeight([], 200), 0, 'an empty roster has no notch to land on');

/* ---- 4. SOURCE-LOCK the seam: the handle, the persistence unit, the drag vocabulary ---- */
const html = fs.readFileSync(path.join(__dirname, '../frontend/index.html'), 'utf8');
const appcss = fs.readFileSync(path.join(__dirname, '../frontend/css/app.css'), 'utf8');

A.ok(/id="crew-vresizer"[^>]*class="row-resizer"/.test(html), 'the rail ships the CREW/SESSIONS seam');
A.ok(/role="separator"[^>]*aria-orientation="horizontal"/.test(html), '…announced as a horizontal separator');
// the flex flow is what puts the handle on the seam — the same "no arithmetic" law the column seam
// learned. If it ever stops being a sibling BETWEEN the counter strip and the module, it has to be
// positioned by hand against margins that move.
const railOrder = /<div id="crew-sum">[\s\S]{0,600}?<div id="crew-vresizer"[\s\S]{0,600}?<div id="ws-wrap">/.test(html);
A.ok(railOrder, 'the seam sits BETWEEN #crew-sum and #ws-wrap, so the flex flow places it on the gap the eye reads');
A.ok(/\.row-resizer\s*\{[^}]*height:\s*0/.test(appcss), '…and is layout-neutral (zero height): it moves the split, it does not take space from it');
A.ok(/\.row-resizer::before\s*\{[^}]*cursor:\s*row-resize/.test(appcss), 'the hit strip is a pseudo covering the gap, and it reads as a resize handle');
A.ok(/body\.row-resizing\s*\{[^}]*cursor:\s*row-resize/.test(appcss), 'the whole document keeps the resize cursor mid-drag (the col-resizing vocabulary)');

A.ok(/starnet\.crewrail\.rows/.test(js), 'the dragged split persists per machine');
A.ok(/String\(wantRows\)/.test(js), '…as a ROW COUNT, not a px height: rows change height and the roster changes depth');
// 0 is a NOTCH, not an empty value. Every guard on the drag path must test for null, never for
// truthiness, or the closed roster silently refuses to persist / to flush / to be restored.
A.ok(/wantRows != null\) localStorage\.setItem/.test(js), 'a roster dragged SHUT persists too — 0 is a choice, not an unset preference');
A.ok(/if \(s >= 0\) wantRows = s/.test(js), '…and is restored as 0, not discarded as falsy');
A.ok(/pendingRows != null/.test(js) && !/if \(pendingRows\)/.test(js), 'the drag flushes a pending 0 (closing the roster) instead of treating it as nothing pending');
A.ok(/let best = 0, bestD = Math\.abs\(h\)/.test(js), 'the notch below the first row is the closed roster, and a drag above the rail lands there');
A.ok(/classList\.toggle\('shut', cap === 0\)/.test(js), 'a shut roster is marked as such — the cap is a max-height and the list padding sits outside it');
A.ok(/#crew\.shut\s*\{[^}]*padding:\s*0/.test(appcss), '…and that class takes the padding with it, so SHUT measures zero instead of a 4px sliver');
A.ok(/setPointerCapture/.test(js) && /releasePointerCapture/.test(js), 'the drag captures the pointer like the two column seams');
A.ok(/requestAnimationFrame\(flushRows\)/.test(js), '…and coalesces its writes to one per frame');
A.ok(/'dblclick'[\s\S]{0,200}removeItem\(RKEY\)/.test(js), 'double-click hands the split back to the measured default');
A.ok(/vseam\.hidden = !cuts\.length/.test(js), 'only an EMPTY roster hides the handle — one agent still has two notches (shown, or closed)');
A.ok(/rowsAtHeight\(cuts, \(clientY[\s\S]{0,60}\/ zoomOf\(\)\)/.test(js), 'the dragged height is converted through the body zoom exactly once (uiZoom law)');

A.report('crew-rail-fit');
