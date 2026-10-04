#!/usr/bin/env node
// dev/snapfit-proof.mjs — does a room placed NEAR another actually land FLUSH against it?
//
// Asserting snapFit() directly would prove the arithmetic and nothing about the half that silently
// breaks: the ghost showing flush while the click commits the raw gesture one tile off. So this
// drives the REAL gesture through onDown/onMove/onUp with the tool armed, and measures the gap
// between the committed rect and its neighbour.
//
// The measurement is the gap in TILES, because that is the user-visible fact — 0 means one deck,
// anything else means two hulls and a wall between them, which is the whole defect.
//
//   node dev/snapfit-proof.mjs
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8985';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9385);
const URL = `http://127.0.0.1:${PORT}/`;

const PROBE = `(async () => {
  const B = (typeof Build !== 'undefined' ? Build : window.Build);
  if (!B || !B.__test__) return JSON.stringify({ error: 'Build.__test__ missing — is __STARNET_DEV__ set?' });
  if (!B.__test__.isOpen()) { B.open ? B.open() : (document.querySelector('#dock-build') || {}).click?.(); await new Promise(r => setTimeout(r, 800)); }
  const T = B.__test__;
  if (!T.isOpen()) return JSON.stringify({ error: 'REFIT never opened' });
  const st = T.station();
  const base = st.rooms()[0];
  if (!base) return JSON.stringify({ error: 'no seed room' });
  const b = base.rects[0];

  // gap in tiles between two rects along the axis that separates them (0 = flush, -1 = overlapping)
  const gapX = (a, c) => (c.x1 > a.x2) ? c.x1 - a.x2 - 1 : (a.x1 > c.x2) ? a.x1 - c.x2 - 1 : -1;
  const gapY = (a, c) => (c.y1 > a.y2) ? c.y1 - a.y2 - 1 : (a.y1 > c.y2) ? a.y1 - c.y2 - 1 : -1;

  const out = [];
  const shot = (name, mode, from, to, axis) => {
    const ghostBefore = null;
    const r = T.placeDrag(mode, from, to);
    if (!r.ok) { out.push({ name, ok: false, why: r.reason || 'rejected' }); return; }
    const got = r.rects[0];
    const gap = axis === 'x' ? gapX(b, got) : gapY(b, got);
    out.push({ name, ok: true, requested: r.requested, landed: got, gapTiles: gap, flush: gap === 0 });
  };

  /* EACH CASE MUTATES THE STATION IT IS TESTED AGAINST. The first cut ran every east case in the
     same y band, so case 2 was rejected for overlapping the room CASE 1 had just placed — which
     reads exactly like a snap failure and is not one. Cases are spaced onto their own bands. */
  // ONE tile short of the seed room's east wall — the exact miss in Andrew's save
  shot('room 1 tile short (east)',  'room', [b.x2 + 2, b.y1 + 1], [b.x2 + 8, b.y1 + 5], 'x');
  // TWO tiles short, on its own band — still inside SNAP_FIT
  shot('room 2 tiles short (east)', 'room', [b.x2 + 3, b.y1 + 7], [b.x2 + 9, b.y1 + 10], 'x');
  // ONE tile short below the seed room's south wall
  shot('room 1 tile short (south)', 'room', [b.x1 + 1, b.y2 + 2], [b.x1 + 7, b.y2 + 6], 'y');
  // FAR AWAY — must NOT be dragged across the deck; a snap that teleports is worse than none
  shot('room far away (no snap)',   'room', [b.x2 + 14, b.y1 + 1], [b.x2 + 20, b.y1 + 5], 'x');

  return JSON.stringify({ seed: b, results: out });
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'snapfit-'));
materializeSeedWorkspace(scratch);
const side = bootSeededSidecar({ port: PORT, scratchDir: scratch });
await waitUp(URL);
const { proc } = launchChrome({ cdpPort: CDP_PORT, profileDir: join(scratch, 'chrome') });
await sleep(1200);
const cdp = await connectCDP(CDP_PORT);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Page.navigate', { url: URL });
if (!(await waitDevReady(cdp, evalJS, { url: URL }))) {
  console.error('snapfit: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {} try { side.kill(); } catch {}
  process.exit(2);
}
await sleep(1500);
const raw = await evalJS(cdp, PROBE);
console.log(raw);
try { proc.kill(); } catch {} try { side.kill(); } catch {}
process.exit(0);
