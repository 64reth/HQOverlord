#!/usr/bin/env node
/* dev/rotate-live-proof.mjs — prove prop orientation in the REAL running app, not in a stub.
 *
 * Boots a seeded sidecar + headless Chrome, opens REFIT, arms the CHAIR from the real palette,
 * presses R on the real window keydown path, stamps with a real pointer gesture on the real canvas,
 * then presses R again with the cursor over the placed prop — and reads the answer back out of the
 * live doc, the live geometry projection, and the pixels the shipped renderer paints.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8959';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9359);
const URL = `http://127.0.0.1:${PORT}/?dev=1`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'rotlive-'));
  materializeSeedWorkspace(join(scratch, 'ws'));
  const side = bootSeededSidecar({ port: PORT, scratchDir: join(scratch, 'ws') });
  let chrome = null, cdp = null;
  const out = {};
  try {
    if (!(await waitUp(URL))) throw new Error('sidecar never came up on ' + URL);
    chrome = launchChrome({ cdpPort: CDP_PORT, profileDir: join(scratch, 'chrome') });
    await sleep(1200);
    cdp = await connectCDP(CDP_PORT);
    await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
    await waitDevReady(cdp, evalJS, { url: URL });
    for (let i = 0; i < 40; i++) {
      if (await evalJS(cdp, `typeof Build === 'object' && !!(Build.__test__ && Build.__test__.station())`)) break;
      await sleep(500);
    }
    out.dev = await evalJS(cdp, `!!(window.__STARNET_DEV__ && Build.__test__)`);
    if (!out.dev) throw new Error('dev hooks absent — the probe needs ?dev=1');

    await evalJS(cdp, `Build.open()`);
    await sleep(900);
    /* THE FIRST-RUN GUIDE CARD IS A MODAL, and REFIT's key handler returns early on any key but
       ESC while one is up — so a probe that starts typing straight after open() measures nothing
       and looks like a broken feature. Close whatever is up before touching the keyboard. */
    out.modals = await evalJS(cdp, `(() => {
      const seen = [];
      for (let i = 0; i < 4; i++) {
        const card = document.querySelector('.refit-guide, .refit-card, .card.open');
        if (!card) break;
        seen.push(card.className);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
      return seen;
    })()`);
    await sleep(400);

    // arm the PROP tool (real key), then walk the REAL palette tabs to the chair. The grid
    // re-renders between clicks, so each step is its own eval with a beat in between — querying
    // the tile in the same tick as the tab click finds nothing and looks like a missing feature.
    await evalJS(cdp, `window.dispatchEvent(new KeyboardEvent('keydown', { key: '6', bubbles: true }))`);
    await sleep(400);
    out.tabs = await evalJS(cdp, `(() => {
      const inp = document.querySelector('.refit-searchfield');
      if (!inp) return { search: false };
      inp.value = 'chair'; inp.oninput && inp.oninput();
      return { search: true };
    })()`);
    await sleep(500);
    out.arm = await evalJS(cdp, `(() => {
      const tile = document.querySelector('.refit-proptile[data-prop="chair"]');
      if (tile) tile.click();
      return { tool: Build.__test__.tool(), armedChair: !!tile,
               tiles: document.querySelectorAll('.refit-proptile').length };
    })()`);
    await sleep(300);

    // press R on the PENDING placement and read the hint the builder actually paints
    out.pendingTurn = await evalJS(cdp, `(() => {
      const hint = () => { const el = document.querySelector('.refit-hint-verb'); return el ? el.textContent.trim() : null; };
      const before = hint();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
      const after = hint();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
      return { before, afterOneR: after, afterTwoR: hint() };
    })()`);

    // stamp it with a REAL pointer gesture on the REAL canvas
    out.stamp = await evalJS(cdp, `(() => {
      const st = Build.__test__.station();
      const rid = st.rooms()[0].id, rect = st.roomById(rid).rects[0];
      const tile = [rect.x1 + 1, rect.y1 + 1];
      const cv = document.querySelector('.refit-canvas');
      const ev = Build.__test__._tileEvent(tile);
      for (const type of ['pointerdown', 'pointerup']) cv.dispatchEvent(new PointerEvent(type, Object.assign({ bubbles: true }, ev)));
      const p = st.props().find(q => q.t === 'chair');
      return { tile, placed: !!p, r: p ? (p.r || 0) : null, id: p ? p.id : null };
    })()`);

    // now press R with the cursor HOVERING the placed prop — the other half of the affordance
    out.hoverTurn = await evalJS(cdp, `(() => {
      const st = Build.__test__.station();
      const p = st.props().find(q => q.t === 'chair'); if (!p) return { skipped: 'no chair' };
      const cv = document.querySelector('.refit-canvas');
      const ev = Build.__test__._tileEvent([p.x, p.y]);
      cv.dispatchEvent(new PointerEvent('pointermove', Object.assign({ bubbles: true }, ev)));
      const seen = [];
      for (let i = 0; i < 4; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'R', bubbles: true }));
        const q = st.propById(p.id);
        seen.push({ r: q.r || 0, w: q.w, h: q.h });
      }
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', shiftKey: true, bubbles: true }));
      seen.push({ shiftBack: st.propById(p.id).r || 0 });
      return seen;
    })()`);

    // a TABLE turn must RE-TILE in the live doc, and the blocked tiles must follow it
    out.table = await evalJS(cdp, `(() => {
      const st = Build.__test__.station();
      const rid = st.rooms()[0].id, rect = st.roomById(rid).rects[0];
      const res = st.addProp({ t: 'longtable', x: rect.x1 + 3, y: rect.y1 + 2, w: 3, h: 1, block: true });
      if (!res.ok) return { placed: false, code: res.code };
      const cv = document.querySelector('.refit-canvas');
      const p0 = st.propById(res.id);
      cv.dispatchEvent(new PointerEvent('pointermove', Object.assign({ bubbles: true }, Build.__test__._tileEvent([p0.x, p0.y]))));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
      const p = st.propById(res.id);
      const g = st.projectGeometry(), t = g.props.find(q => q.id === res.id);
      const col = [0, 1, 2].map(i => g.blockedTiles.has(t.x + ',' + (t.y + i)));
      return { placed: true, r: p.r || 0, box: [p.w, p.h], geoR: t.r || 0, columnBlocked: col };
    })()`);

    /* PIXEL PROOF: every facing a prop offers, drawn through the shipped renderer, must hash
       DIFFERENTLY — two facings with the same hash are the same picture whatever the doc says. */
    out.pixels = await evalJS(cdp, `(() => {
      const sig = (id, r) => {
        const box = PropSprites.footprintAt(id, r);
        const cv = document.createElement('canvas'); cv.width = 96; cv.height = 96;
        const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
        PropSprites.setCtx(g); PropSprites.setNow(2400);
        PropSprites.draw({ t: id, x: 1, y: 3, w: box.w, h: box.h, r: r, id: 'px' }, true);
        const d = g.getImageData(0, 0, 96, 96).data;
        let hsh = 2166136261, ink = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3]) {
          ink++; hsh = ((hsh ^ (d[i] + 3 * d[i + 1] + 7 * d[i + 2] + i)) >>> 0) * 16777619 >>> 0;
        }
        return { r, ink, hash: hsh };
      };
      const rows = {};
      /* Read the live catalog instead of maintaining a second prop list here. Retired props keep
         neither a catalog row nor a footprint, while newly-authored facings become eligible through
         PropSprites.facings(). The proof therefore follows exactly what REFIT can currently offer. */
      const ids = PropSprites.CATALOG.map(p => p.id).filter(id => PropSprites.facings(id).length > 1);
      for (const id of ids) {
        const fs = PropSprites.facings(id).map(r => sig(id, r));
        rows[id] = { facings: fs, distinct: new Set(fs.map(s => s.hash)).size === fs.length };
      }
      return rows;
    })()`);

    const badPixels = Object.entries(out.pixels).filter(([, row]) =>
      !row.distinct || row.facings.some(f => !f.ink));
    if (badPixels.length) throw new Error('orientation pixel proof failed: ' + badPixels.map(([id]) => id).join(', '));

    out.consoleErrors = await evalJS(cdp, `(() => (window.__errs || []).slice(0, 5))()`);
    console.log(JSON.stringify(out, null, 2));
  } finally {
    try { if (cdp) cdp.close(); } catch {}
    try { if (chrome) chrome.kill(); } catch {}
    try { side.kill(); } catch {}
  }
}

main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
