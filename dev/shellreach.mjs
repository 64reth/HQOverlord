#!/usr/bin/env node
// dev/shellreach.mjs — WHERE DOES A HULL SKIN ACTUALLY REACH?
//
// Bakes one room twice (un-clad default vs TIMBER/WALNUT) and diffs the two bakes pixel for pixel.
// Anything that lights up is a surface the skin owns; anything black is a surface still painted from
// the module's global shell constants, i.e. the pre-axis shell, unchangeable from REFIT.
//
//   node dev/shellreach.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8963';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9363);
const URL = `http://127.0.0.1:${PORT}/`;

const PROBE = `(() => {
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };
  function bake(mat, style) {
    const st = WorldModel.create(WorldModel.defaultDoc());
    const A = st.addRoom({ kind: 'hab', rects: [{ x1: 20, y1: 20, x2: 33, y2: 28 }] });
    if (mat) st.setHull(A.id, { mat, style: style || 'follow' });
    const geo = st.projectGeometry(), bk = StationBake.bake(geo);
    const lit = mk(bk.W, bk.H);
    lit.g.fillStyle = '#000'; lit.g.fillRect(0, 0, bk.W, bk.H);
    lit.g.drawImage(bk.baseCv, 0, 0); lit.g.drawImage(bk.lightCv, 0, 0);
    const r = geo.allRects.find(x => x.z === A.id);
    return { lit, W: bk.W, H: bk.H, T: geo.TILE, r };
  }
  const A = bake(null, null), B = bake('timber', 'walnut');
  const da = A.lit.g.getImageData(0, 0, A.W, A.H).data;
  const db = B.lit.g.getImageData(0, 0, B.W, B.H).data;
  const diff = mk(A.W, A.H), out = diff.g.createImageData(A.W, A.H);
  let changed = 0;
  for (let i = 0; i < da.length; i += 4) {
    const d = Math.abs(da[i] - db[i]) + Math.abs(da[i+1] - db[i+1]) + Math.abs(da[i+2] - db[i+2]);
    const on = d > 6;
    if (on) changed++;
    out.data[i] = on ? 255 : 20; out.data[i+1] = on ? 90 : 20; out.data[i+2] = on ? 40 : 24; out.data[i+3] = 255;
  }
  diff.g.putImageData(out, 0, 0);
  // row/column reach: for each row, how many pixels changed
  const rows = [];
  for (let y = 0; y < A.H; y++) { let n = 0; for (let x = 0; x < A.W; x++) { const i = ((y*A.W)+x)<<2; if (Math.abs(da[i]-db[i])+Math.abs(da[i+1]-db[i+1])+Math.abs(da[i+2]-db[i+2]) > 6) n++; } rows.push(n); }
  const T = A.T, r = A.r;
  const zoom = (src, cx, cy, cw, ch, z) => { const o = mk(cw*z, ch*z); o.g.imageSmoothingEnabled = false; o.g.drawImage(src, cx, cy, cw, ch, 0, 0, cw*z, ch*z); return o.c.toDataURL('image/png').split(',')[1]; };
  const side = (b, l) => { const o = mk(b.W*2, b.H*2); o.g.imageSmoothingEnabled=false; o.g.drawImage(b.lit.c,0,0,b.W*2,b.H*2); return o.c.toDataURL('image/png').split(',')[1]; };
  return JSON.stringify({
    W: A.W, H: A.H, TILE: T,
    roomPx: { x1: r.x1*T, y1: r.y1*T, x2: (r.x2+1)*T, y2: (r.y2+1)*T },
    changedPx: changed,
    firstChangedRow: rows.findIndex(n => n > 0),
    lastChangedRow: rows.length - 1 - rows.slice().reverse().findIndex(n => n > 0),
    rowsWithChange: rows.map((n, y) => n > 0 ? y : -1).filter(y => y >= 0).join(','),
    crops: {
      diff: zoom(diff.c, 0, 0, A.W, A.H, 2),
      default_full: side(A),
      timber_full: side(B)
    }
  });
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'shellreach-'));
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
  console.error('shellreach: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {}
  try { side.kill(); } catch {}
  process.exit(2);
}
const data = JSON.parse(await evalJS(cdp, PROBE));
const dir = process.env.SKYNET_SHELL_DIR || join(process.cwd(), '.shellreach');
mkdirSync(dir, { recursive: true });
for (const [n, b64] of Object.entries(data.crops)) writeFileSync(join(dir, n + '.png'), Buffer.from(b64, 'base64'));
delete data.crops;
console.log(JSON.stringify(data, null, 1));
console.error('crops → ' + dir);
try { proc.kill(); } catch {}
try { side.kill(); } catch {}
process.exit(0);
