#!/usr/bin/env node
// dev/corridordeck.mjs — review CORRIDOR DECK candidates in a real bake.
//
// Same discipline as dev/wallprobe.mjs: bakes offscreen at 1:1 through the shipped StationBake so
// nothing is judged at a fractional uiZoom, and composites over MAGENTA so anything painted outside
// the hull shows up instead of hiding against a dark void fill.
//
// The shape under test is a VERTICAL hallway running between a room above and a room below — the
// one Andrew reported — because the question is never "is this deck nice" but "does it match the
// rooms it connects". Each candidate is rendered in that hallway with the rooms UNCHANGED beside it.
//
//   SKYNET_DECK_MATS=runner,treadway,meshway node dev/corridordeck.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8954';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9354);
const URL = `http://127.0.0.1:${PORT}/`;
const MATS = (process.env.SKYNET_DECK_MATS || 'spine,runner,treadway,meshway').split(',').map(s => s.trim()).filter(Boolean);

const PROBE = `((MATS) => {
  const st = WorldModel.create(WorldModel.defaultDoc());
  st.addRoom({ kind: 'bridge',  rects: [{ x1: 21, y1: 0,  x2: 34, y2: 9  }] });
  st.addRoom({ kind: 'foundry', rects: [{ x1: 20, y1: 15, x2: 33, y2: 26 }] });
  st.placeHallway({ rects: [{ x1: 24, y1: 10, x2: 26, y2: 14 }] });
  const geo0 = st.projectGeometry();
  const cor = geo0.allRects.filter(r => geo0.isCorridor(r.z)).find(r => (r.y2 - r.y1) > (r.x2 - r.x1));
  const T = geo0.TILE;

  const shot = () => {
    const geo = st.projectGeometry(), bk = StationBake.bake(geo);
    const cv = document.createElement('canvas'); cv.width = bk.W; cv.height = bk.H;
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    g.fillStyle = '#ff00ff'; g.fillRect(0, 0, bk.W, bk.H);
    g.drawImage(bk.baseCv, 0, 0); g.drawImage(bk.lightCv, 0, 0);
    // BARE too: the corridor sits at the dark end of the ambient, where tone questions are
    // answerable but SHAPE questions are not. Every geometry call is made on the bare composite.
    const bare = document.createElement('canvas'); bare.width = bk.W; bare.height = bk.H;
    const gb = bare.getContext('2d'); gb.imageSmoothingEnabled = false;
    gb.fillStyle = '#ff00ff'; gb.fillRect(0, 0, bk.W, bk.H); gb.drawImage(bk.baseCv, 0, 0);
    return { cv, bare, bk };
  };
  const crop = (src, cx, cy, cw, ch, z) => {
    const c2 = document.createElement('canvas'); c2.width = cw * z; c2.height = ch * z;
    const g2 = c2.getContext('2d'); g2.imageSmoothingEnabled = false;
    g2.drawImage(src, cx, cy, cw, ch, 0, 0, cw * z, ch * z);
    return c2.toDataURL('image/png').split(',')[1];
  };

  // the junction crop: the hallway PLUS a slab of the room above and below it, so the match (or
  // mismatch) through the doorway is what you are looking at, not the hallway in isolation.
  const jx = cor.x1 * T - 30, jy = cor.y1 * T - 34;
  const jw = (cor.x2 - cor.x1 + 1) * T + 60, jh = (cor.y2 - cor.y1 + 1) * T + 68;

  const crops = {}, stats = {};
  for (const m of MATS) {
    const r = st.setMaterial(cor.z, m);
    if (!r.ok) { stats[m] = { error: r.error }; continue; }
    const s = shot();
    crops[m] = crop(s.cv, jx, jy, jw, jh, 7);
    crops[m + '_bare'] = crop(s.bare, jx, jy, jw, jh, 7);
    // deck tone stats on the BARE composite (the ambient gradient alone yields hundreds of tones
    // and makes the metric meaningless) — corridor interior only, inset off the walls.
    const gb = s.bare.getContext('2d');
    const d = gb.getImageData(cor.x1 * T + 3, cor.y1 * T + 3, (cor.x2 - cor.x1 + 1) * T - 6, (cor.y2 - cor.y1 + 1) * T - 6).data;
    let sum = 0, cnt = 0, mn = 255, mx = 0; const tones = new Set();
    for (let i = 0; i < d.length; i += 4) {
      const L = Math.round(0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]);
      sum += L; cnt++; if (L < mn) mn = L; if (L > mx) mx = L; tones.add(d[i]+','+d[i+1]+','+d[i+2]);
    }
    stats[m] = { meanLum: Math.round(sum / cnt), min: mn, max: mx, tones: tones.size };
  }
  st.setMaterial(cor.z, 'spine');

  // the ROOM's own deck, measured the same way — the number every candidate has to sit beside
  const room = st.projectGeometry().allRects.find(r => !st.projectGeometry().isCorridor(r.z));
  const s = shot();
  const rd = s.bare.getContext('2d').getImageData(room.x1 * T + 6, room.y1 * T + 6, 60, 60).data;
  let rs = 0, rc = 0; for (let i = 0; i < rd.length; i += 4) { rs += Math.round(0.299*rd[i] + 0.587*rd[i+1] + 0.114*rd[i+2]); rc++; }
  stats.__room = { mat: st.projectGeometry().matOf(room.z), meanLum: Math.round(rs / rc) };

  return JSON.stringify({ corridor: [cor.x1, cor.y1, cor.x2, cor.y2], stats, crops });
})(${JSON.stringify(MATS)})`;

const scratch = mkdtempSync(join(tmpdir(), 'corrdeck-'));
materializeSeedWorkspace(scratch);
const side = bootSeededSidecar({ port: PORT, scratchDir: scratch });
await waitUp(URL);
const { proc } = launchChrome({ cdpPort: CDP_PORT, profileDir: join(scratch, 'chrome') });
await sleep(1200);
const cdp = await connectCDP(CDP_PORT);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Page.navigate', { url: URL });
// waitDevReady returns false on timeout rather than throwing — ignoring it is how a probe ends up
// evaluating against a bare document and blaming scoping (see dev/wallprobe.mjs).
if (!(await waitDevReady(cdp, evalJS, { url: URL }))) {
  console.error('corridordeck: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {}
  try { side.kill(); } catch {}
  process.exit(2);
}
const out = await evalJS(cdp, PROBE);
const data = JSON.parse(typeof out === 'string' ? out : JSON.stringify(out));
const dir = process.env.SKYNET_DECK_DIR || join(process.cwd(), '.corrdeck');
mkdirSync(dir, { recursive: true });
for (const [name, b64] of Object.entries(data.crops || {})) writeFileSync(join(dir, name + '.png'), Buffer.from(b64, 'base64'));
delete data.crops;
console.log(JSON.stringify(data, null, 1));
console.error('crops → ' + dir);
try { proc.kill(); } catch {}
try { side.kill(); } catch {}
process.exit(0);
