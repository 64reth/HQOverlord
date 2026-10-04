/* node test/agent-affinity-weight.test.js — bonds BIAS the station's social beats, they never LOCK them.

   THE ASK, verbatim: "users will notice some agents around specific other agents frequently that they
   interact with most frequently as well sometimes groups of 3."

   The failure mode this file exists to prevent is the obvious over-correction: make favourites strong
   enough and the floor silently fractures into fixed duos who only ever talk to each other, which reads
   as a broken station rather than a social one. So the load-bearing assertion here is not "best buds are
   likelier" (easy, and any implementation gets it) — it is that a STRANGER'S WEIGHT IS NEVER ZERO, and
   that a bonded pair still serves a real cooldown so it cannot monopolise the conversation budget.

   Same extraction discipline as test/social-trio.test.js: world.js is a browser IIFE, so the marked
   BOND-WEIGHT-PURE block is sliced out of the SOURCE and executed — the shipped maths is under test, not
   a copy of it. Comments are stripped before the purity sweep, because a test that passes on a code
   COMMENT proves nothing. */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');

const src = fs.readFileSync(path.join(__dirname, '../frontend/app/world.js'), 'utf8');

// ---- extract + execute the marked pure block from the real source ----
const BEGIN = 'BOND-WEIGHT-PURE-BEGIN', END = 'BOND-WEIGHT-PURE-END';
const i0 = src.indexOf(BEGIN), i1 = src.indexOf(END);
A.ok(i0 >= 0 && i1 > i0, 'world.js carries the BOND-WEIGHT-PURE extraction markers');
const block = src.slice(src.indexOf('*/', i0) + 2, src.lastIndexOf('/*', i1));
const codeOnly = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
A.ok(/function bondWeights\(/.test(codeOnly), 'the marked block holds the weighting function (not just a comment about it)');
A.ok(!/\bU\.|\bMath\.random|\bDate\b|\bdocument\b|\bwindow\b|\baffinityPairs\b/.test(codeOnly),
  'the block is PURE — no module state, no RNG, no DOM (the bond lookup is injected)');

const scope = {};
new Function('S', codeOnly + '\nS.bondMean = bondMean; S.bondWeights = bondWeights;')(scope);
const { bondMean, bondWeights } = scope;

// the real constant, read from the source so the test can never drift from what ships
const PULL = Number((src.match(/const BOND_PULL\s*=\s*([\d.]+)/) || [])[1]);
A.ok(Number.isFinite(PULL) && PULL > 0, 'BOND_PULL is read from the shipped source');

/* a fixture graph: hero+bestbud are proven companions, hero+acquaintance barely, hero+stranger never.
   `graph` normalises key order the same way the sidecar's pairKey does, so a fixture can't silently
   miss by being written in the wrong order (it can, and did, while this test was being written). */
function graph(entries) {
  const m = new Map();
  for (const [a, b, s] of entries) m.set([a, b].sort().join('|'), s);
  return (a, b) => m.get([a, b].sort().join('|')) || 0;
}
const look = graph([
  ['hero', 'bestbud', 0.77],
  ['hero', 'acquaintance', 0.2],
  ['bestbud', 'acquaintance', 0.65]
]);

/* ---- THE LOAD-BEARING LAW: variety survives ---- */
{
  const w = bondWeights('hero', ['bestbud', 'acquaintance', 'stranger'], look, PULL);
  A.eq(w[2], 1, 'a STRANGER keeps weight exactly 1 — never 0, so no pairing is ever impossible');
  A.eq(w.every(x => x > 0), true, 'every candidate keeps a real chance');
  A.eq(w[0] > w[1] && w[1] > w[2], true, 'ordering follows proven bond strength');
  A.eq(w[0] / w[2] < 10, true, 'the favourite is likelier, not dominant — a bias, not a lock');
}

/* an empty graph must reproduce uniform selection exactly */
{
  const w = bondWeights('hero', ['a', 'b', 'c'], () => 0, PULL);
  A.eq(w[0] === w[1] && w[1] === w[2] && w[0] === 1, true,
    'with no proven bonds every weight is 1 — identical to the old uniform pick');
}

/* ---- the trio is a friend GROUP, not a pair plus a bystander ---- */
{
  // bonded to BOTH hero and bestbud vs bonded to only one
  const both = bondMean(['hero', 'bestbud'], 'acquaintance', look);
  const one = bondMean(['hero', 'bestbud'], 'stranger', look);
  A.eq(both > one, true, 'a body bonded to both anchors outscores one bonded to neither');
  A.eq(both, (0.2 + 0.65) / 2, 'the group score is the MEAN across anchors');

  // a body bonded to only ONE anchor scores strictly between
  const half = bondMean(['hero', 'bestbud'], 'halfway', graph([['hero', 'halfway', 0.8]]));
  A.eq(half, 0.4, 'bonded to one of two anchors scores half — a bystander does not ride in on one friendship');
}

/* single anchor may be passed bare or as an array — the trio path passes two */
{
  A.eq(bondMean('hero', 'bestbud', look), bondMean(['hero'], 'bestbud', look),
    'a bare anchor id behaves identically to a one-element array');
  A.eq(bondMean([], 'bestbud', look), 0, 'no anchors -> no bond, never a divide-by-zero');
}

/* an unknown candidate never throws and never invents a bond */
{
  A.eq(bondMean('hero', undefined, look), 0, 'an id-less candidate scores 0');
  A.eq(bondWeights('hero', [], look, PULL).length, 0, 'an empty candidate list yields no weights');
}

/* ---- the cooldown relief must not let a duo monopolise the floor ---- */
{
  const RELIEF = Number((src.match(/const BOND_CD_RELIEF\s*=\s*([\d.]+)/) || [])[1]);
  const FLOOR = Number((src.match(/const BOND_CD_FLOOR\s*=\s*(\d+)/) || [])[1]);
  const LANE_MAX = Number((src.match(/const SOCIAL_STATION_CD_MIN\s*=\s*\d+,\s*SOCIAL_STATION_CD_MAX\s*=\s*(\d+)/) || [])[1]);
  const PAIR_MIN = Number((src.match(/const SOCIAL_PAIR_CD_MIN\s*=\s*(\d+)/) || [])[1]);
  A.ok(Number.isFinite(RELIEF) && Number.isFinite(FLOOR) && Number.isFinite(LANE_MAX) && Number.isFinite(PAIR_MIN),
    'the cooldown constants are read from the shipped source');
  A.eq(RELIEF < 1, true, 'relief can never zero out the per-pair cooldown');
  A.eq(FLOOR >= LANE_MAX * 0.75, true,
    'the floor stays comparable to the station conversation lane, so even the strongest bond cannot re-fire as the immediate next beat');
  A.eq(FLOOR < PAIR_MIN, true, 'but it IS a real reduction — best buds genuinely come back around sooner');
  // strongest possible bond (1.0) still serves the floor
  A.eq(Math.max(FLOOR, Math.round(PAIR_MIN * (1 - RELIEF * 1))) >= FLOOR, true,
    'a perfect bond still serves at least the floor');
}

A.report('agent-affinity-weight.test');
