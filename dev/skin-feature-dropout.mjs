// dev/skin-feature-dropout.mjs — find FEATURE DROPOUTS: a colour a skin wears in most of its
// facings and loses completely in one or two.
//
// This is the "inconsistencies between the frames" class that no existing check sees. The build
// test (test/sprite-walk-motion.test.js) compares SIZE, the orphan audit compares TOPOLOGY —
// neither notices that voidwizard's green staff gem is in five facings and absent from three, or
// that a visor colour survives every direction but north-west. The 8-direction rebuild dropped
// accessories per-direction, so the roster has to be measured per-direction.
//
// Measure: quantise to a 5-bit-per-channel palette, total each colour's pixels per DIRECTION
// (rot + walk + gesture frames of that facing together), then report colours that are solidly
// present in most facings and missing from at least one. Alpha-blended edge tones are excluded —
// only colours that carry real area anywhere are considered, so anti-aliasing cannot fire this.
import { readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRGBA } from './lib/pixpng.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'assets', 'sprites');
const DIRS = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'];

const key = (r, g, b) => ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5);
const unkey = k => [((k >> 10) & 31) * 8 + 4, ((k >> 5) & 31) * 8 + 4, (k & 31) * 8 + 4];

function tallyFrame(file, into) {
  const im = readRGBA(file);
  for (let i = 0; i < im.width * im.height; i++) {
    const a = im.data[i * 4 + 3];
    if (a < 200) continue;                       // solid pixels only — no anti-alias tones
    const r = im.data[i * 4], g = im.data[i * 4 + 1], b = im.data[i * 4 + 2];
    if (Math.max(r, g, b) < 48) continue;        // outline black is everywhere; carries no identity
    const k = key(r, g, b);
    into.set(k, (into.get(k) || 0) + 1);
  }
}

export function dropouts(set) {
  const dir = path.join(ROOT, set);
  const files = readdirSync(dir).filter(f => f.endsWith('.png'));
  const perDir = new Map();
  for (const d of DIRS) {
    const mine = files.filter(f => {
      const m = f.match(/^(rot|walk|gesture)_(.+?)(?:_\d+)?\.png$/);
      return m && m[2] === d;
    });
    if (!mine.length) continue;
    const t = new Map();
    for (const f of mine) tallyFrame(path.join(dir, f), t);
    perDir.set(d, { t, frames: mine.length });
  }
  if (perDir.size < 6) return [];                // not an 8-direction set; nothing to compare
  const all = new Set();
  for (const { t } of perDir.values()) for (const k of t.keys()) all.add(k);
  const out = [];
  for (const k of all) {
    const rates = [...perDir].map(([d, { t, frames }]) => [d, (t.get(k) || 0) / frames]);
    const present = rates.filter(([, r]) => r >= 1.5);
    const missing = rates.filter(([, r]) => r === 0);
    const peak = Math.max(...rates.map(([, r]) => r));
    // solidly worn in most facings (>=5 of 8, and real area at peak) yet gone from at least one
    if (present.length >= 5 && peak >= 4 && missing.length >= 1) {
      const rate = Object.fromEntries(rates);
      // MIRROR TEST: a body seen from the left and from the right wears the same things. A colour
      // that carries real area on one side of a mirror pair and is flat ZERO on the other cannot
      // be explained by "you can't see his face from behind" — which is what makes 4 in 5 of the
      // raw dropouts above legitimate. This is the filter that separates art from anatomy.
      const asym = [['east', 'west'], ['north-east', 'north-west'], ['south-east', 'south-west']]
        .filter(([a, b]) => rate[a] != null && rate[b] != null &&
          ((rate[a] >= 3 && rate[b] === 0) || (rate[b] >= 3 && rate[a] === 0)))
        .map(([a, b]) => (rate[a] === 0 ? `${b}>${a}` : `${a}>${b}`));
      out.push({
        colour: unkey(k), peak: +peak.toFixed(1),
        present: present.length, missing: missing.map(([d]) => d), asym,
      });
    }
  }
  return out.sort((a, b) => b.peak - a.peak);
}

if (process.argv[1] && process.argv[1].endsWith('skin-feature-dropout.mjs')) {
  const only = process.argv.slice(2);
  const sets = readdirSync(ROOT)
    .filter(d => !d.startsWith('_') && statSync(path.join(ROOT, d)).isDirectory())
    .filter(d => !only.length || only.includes(d));
  const mirrorOnly = !process.argv.includes('--all');
  let rows = [];
  for (const set of sets) {
    for (const d of dropouts(set)) rows.push({ set, ...d });
  }
  const total = rows.length;
  if (mirrorOnly) rows = rows.filter(r => r.asym.length);
  const bySet = new Map();
  for (const r of rows) { if (!bySet.has(r.set)) bySet.set(r.set, []); bySet.get(r.set).push(r); }
  console.log(`=== FEATURE DROPOUTS${mirrorOnly ? ' — MIRROR-ASYMMETRIC ONLY' : ''} — ` +
    `${rows.length}${mirrorOnly ? ` of ${total}` : ''} colours across ${bySet.size} sets ===\n`);
  for (const [set, rs] of [...bySet].sort((a, b) => b[1][0].peak - a[1][0].peak)) {
    console.log(`${set}  (${rs.length})`);
    for (const r of rs.slice(0, 6)) {
      console.log(`   rgb(${r.colour.join(',')}) peak ${String(r.peak).padStart(5)}px/frame  in ${r.present}/8  ` +
        `MISSING: ${r.missing.join(' ')}${r.asym.length ? `   MIRROR: ${r.asym.join(', ')}` : ''}`);
    }
    if (rs.length > 6) console.log(`   … ${rs.length - 6} more`);
  }
  if (!rows.length) console.log('(clean)');
}
