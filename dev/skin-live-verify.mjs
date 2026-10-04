#!/usr/bin/env node
/* dev/skin-live-verify.mjs — prove IN THE RUNNING APP that the voidwizard's staff repair is what
   the app actually serves and decodes, and that the skin is still a live, selectable body.
 *
 * Why this shape and not a screenshot: the world canvas is rAF-driven and screenshots of it time
 * out (starnet-verify, "the canvas gotcha"). So the check is a DOM/state round-trip — the page
 * fetches its OWN manifest, decodes its OWN served PNGs through the same origin the floor engine
 * loads them from, and reports pixel measurements back. A stale mirror, an unsynced website copy
 * or a cached asset would all show up here as a failure; editing files on disk would not prove it.
 *
 *   node dev/skin-live-verify.mjs        (ports: SKYNET_SHOT_PORT / SKYNET_CDP_PORT)
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9878';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9879);
const URL = `http://127.0.0.1:${PORT}/`;

/* Runs IN THE PAGE. Loads every voidwizard frame the manifest advertises for the two repaired
   tracks plus an untouched control, and measures each one the way the bar scan does. */
const MEASURE = `(async () => {
  const man = await (await fetch('assets/sprites/manifest.json')).json();
  const load = (rel) => new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('404 ' + rel));
    im.src = 'assets/sprites/' + rel;
  });
  const measure = async (rel) => {
    const im = await load(rel);
    const c = document.createElement('canvas');
    c.width = im.width; c.height = im.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const ink = (x, y) => d[(y * c.width + x) * 4 + 3] > 16;
    const colN = [];
    let top = c.height, bot = -1, total = 0;
    for (let x = 0; x < c.width; x++) {
      let n = 0;
      for (let y = 0; y < c.height; y++) if (ink(x, y)) { n++; total++; if (y < top) top = y; if (y > bot) bot = y; }
      colN[x] = n;
    }
    const contentH = bot - top + 1;
    // leading column group up to 3 wide, and how solid the column just inside it is
    const first = colN.findIndex(n => n > 0);
    let end = first;
    while (end + 1 - first < 3 && colN[end + 1] > 0) end++;
    const barH = Math.max(...colN.slice(first, end + 1));
    const bar = (barH / contentH >= 0.5 && (colN[end + 1] || 0) <= barH * 0.5)
      ? { x0: first, x1: end, barH, inside: colN[end + 1] || 0 } : null;
    // staff wood + gem green, counted the way the repair painted them
    let wood = 0, gem = 0, pale = 0;
    for (let i = 0; i < c.width * c.height; i++) {
      const r = d[i*4], g2 = d[i*4+1], b = d[i*4+2], a = d[i*4+3];
      if (a < 200) continue;
      if (g2 > 120 && g2 > r * 1.4 && g2 > b * 1.4) gem++;
      else if (r > 70 && r < 140 && r > b * 1.4 && r >= g2) wood++;
      else if (Math.min(r, g2, b) > 150 && Math.max(r, g2, b) - Math.min(r, g2, b) < 40) pale++;
    }
    return { rel, w: im.width, h: im.height, total, top, bot, contentH, bar, wood, gem, pale };
  };
  const out = {};
  for (const key of ['voidwizard.walk.north-west', 'voidwizard.walk.west', 'voidwizard.rot.north',
                     'voidwizard.walk.east', 'voidwizard.rot.north-west',
                     'grimreaper.rot.north-west', 'grimreaper.rot.north-east']) {
    out[key] = [];
    for (const rel of man.sprites[key]) out[key].push(await measure(rel));
  }
  out.catalog = (typeof DATA !== 'undefined' && DATA.SKINS && DATA.SKINS.voidwizard) || null;
  out.setSkinLive = !!(typeof World !== 'undefined' && World.setSkin);
  return JSON.stringify(out);
})()`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'skinverify-'));
  materializeSeedWorkspace(join(scratch, 'ws'));
  const side = bootSeededSidecar({ port: PORT, scratchDir: join(scratch, 'ws') });
  let chrome = null, cdp = null, bad = 0;
  try {
    if (!(await waitUp(URL))) throw new Error('sidecar never came up on ' + URL);
    chrome = launchChrome({ cdpPort: CDP_PORT, win: '1440,1040', profileDir: join(scratch, 'chrome') });
    await sleep(1200);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Runtime.enable');
    collectDiagnostics(cdp);
    await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never reached the game screen');
    await sleep(1200);

    const raw = await evalJS(cdp, MEASURE);   // evalJS already awaits the promise
    const m = JSON.parse(raw);

    const say = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

    say(!!m.catalog, `the app's own catalog still carries voidwizard: ${JSON.stringify(m.catalog)}`);
    say(m.setSkinLive, 'World.setSkin is live, so the skin is still selectable on the floor');

    for (const key of Object.keys(m).filter(k => k.includes('.'))) {
      const frames = m[key];
      say(frames.length > 0, `${key}: app served ${frames.length} frame(s)`);
      const bars = frames.filter(f => f.bar);
      say(bars.length === 0,
        `${key}: no detached margin bar` + (bars.length ? ` — ${JSON.stringify(bars.map(b => [b.rel, b.bar]))}` : ''));
      const bots = [...new Set(frames.map(f => f.bot))];
      say(bots.length === 1, `${key}: every frame still lands on one floor line (bottom=${bots.join('/')})`);
      say(frames.every(f => f.total > 200), `${key}: every frame still has a body (min ink ${Math.min(...frames.map(f => f.total))}px)`);
    }
    // the repaired west track must now carry the same staff the untouched east track does
    const west = m['voidwizard.walk.west'], east = m['voidwizard.walk.east'];
    say(west.every(f => f.wood >= 8), `walk.west carries a wooden shaft in all 6 frames (wood px: ${west.map(f => f.wood).join(',')})`);
    say(west.every(f => f.gem >= 2), `walk.west carries a green gem in all 6 frames (gem px: ${west.map(f => f.gem).join(',')})`);
    say(east.every(f => f.wood >= 8), `walk.east (untouched control) still carries its shaft (wood px: ${east.map(f => f.wood).join(',')})`);
    const rn = m['voidwizard.rot.north'][0];
    say(rn.wood >= 20, `voidwizard rot.north's staff now runs to the floor rather than stopping in mid-air (wood ${rn.wood}px)`);
    const rnw = m['voidwizard.rot.north-west'][0];
    say(rnw.wood >= 15, `voidwizard rot.north-west now carries a staff at all (wood ${rnw.wood}px) — it had none`);
    // the reaper's scythe: a blade with no shaft is a FLOATING BLADE, so both are asserted
    const gnw = m['grimreaper.rot.north-west'][0], gne = m['grimreaper.rot.north-east'][0];
    say(gnw.pale >= 10, `grimreaper rot.north-west has a scythe BLADE (${gnw.pale}px pale vs ${gne.pale}px on its mirror)`);
    say(gnw.wood >= 8, `grimreaper rot.north-west has the scythe SHAFT too (${gnw.wood}px vs ${gne.wood}px on its mirror) — not a floating blade`);

    console.log(`\n${bad === 0 ? 'ALL LIVE CHECKS PASSED' : bad + ' LIVE CHECK(S) FAILED'}  (served from ${URL})`);
  } finally {
    try { if (chrome) chrome.kill(); } catch (_) {}
    try { side.kill(); } catch (_) {}
  }
  process.exit(bad ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
