// dev/skin-bar-scan.mjs — find DETACHED MARGIN BARS across the whole sprite roster.
//
// The defect the connected-component audit cannot see (dev/skin-orphan-audit.mjs): a prop the
// generator parked at the edge of the frame as a dead-straight bar, clear of the body, which
// still counts as "one component" because some part of the silhouette brushes its outline for a
// few rows. voidwizard.walk.north-west was exactly this — a full-height pole 2px off the body
// while the hand held nothing.
//
// Measure, per frame: take the leading (and trailing) column group up to 3 wide. It is a bar if
// its ink runs >= 50% of the content height AND the column just inside it is nearly empty (so
// the body is not simply that thin there — a staff held vertically THROUGH the hand fails this
// test and is correctly left alone).
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRGBA, isInk } from './lib/pixpng.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'assets', 'sprites');

export function findBars(im, { maxW = 3, minFrac = 0.5 } = {}) {
  const colN = [];
  let top = im.height, bot = -1;
  for (let x = 0; x < im.width; x++) {
    let n = 0;
    for (let y = 0; y < im.height; y++) if (isInk(im, x, y)) { n++; if (y < top) top = y; if (y > bot) bot = y; }
    colN[x] = n;
  }
  if (bot < 0) return [];
  const contentH = bot - top + 1;
  const out = [];
  for (const side of ['left', 'right']) {
    const order = side === 'left'
      ? [...colN.keys()]
      : [...colN.keys()].reverse();
    const first = order.find(x => colN[x] > 0);
    if (first == null) continue;
    const step = side === 'left' ? 1 : -1;
    let end = first;
    while (Math.abs(end + step - first) < maxW && colN[end + step] > 0) end += step;
    const barH = Math.max(...(side === 'left' ? colN.slice(first, end + 1) : colN.slice(end, first + 1)));
    const inside = colN[end + step] || 0;
    if (barH / contentH >= minFrac && inside <= barH * 0.5) {
      out.push({ side, x0: Math.min(first, end), x1: Math.max(first, end), barH, inside, contentH });
    }
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('skin-bar-scan.mjs')) {
  const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
  const sets = readdirSync(ROOT)
    .filter(d => !d.startsWith('_') && statSync(path.join(ROOT, d)).isDirectory())
    .filter(d => !only.length || only.includes(d));
  const hits = [];
  for (const set of sets) {
    for (const f of readdirSync(path.join(ROOT, set)).filter(f => f.endsWith('.png'))) {
      const im = readRGBA(path.join(ROOT, set, f));
      for (const b of findBars(im)) hits.push({ set, frame: f.replace(/\.png$/, ''), ...b });
    }
  }
  const bySet = new Map();
  for (const h of hits) { if (!bySet.has(h.set)) bySet.set(h.set, []); bySet.get(h.set).push(h); }
  console.log(`=== DETACHED MARGIN BARS — ${hits.length} frames in ${bySet.size} sets ===`);
  for (const [set, hs] of [...bySet].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${set}  (${hs.length} frames)`);
    for (const h of hs.sort((a, b) => a.frame.localeCompare(b.frame))) {
      console.log(`  ${h.frame.padEnd(22)} ${h.side.padEnd(5)} x=${h.x0}..${h.x1}  barH=${h.barH}/${h.contentH}  inside=${h.inside}`);
    }
  }
  if (!hits.length) console.log('(clean)');
}
