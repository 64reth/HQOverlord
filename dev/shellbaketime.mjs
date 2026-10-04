#!/usr/bin/env node
// dev/shellbaketime.mjs — what the own-corners restore COSTS.
//
// The restore adds one full-canvas scratch per rect (per group for the silhouette, plus one pass
// for the ownership raster). On a 15-room station that is real allocation, and bakeHullExtrusion
// runs again for every dirty CHUNK on a refit. This times the shipped bake against the patched one
// on Andrew's own save, by loading BOTH copies of stationbake.js into the page.
//
//   node dev/shellbaketime.mjs
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8991';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9391);
const URL = `http://127.0.0.1:${PORT}/`;
const N = Number(process.env.SKYNET_BAKE_N || 12);

const savePath = join(process.env.APPDATA, 'ai.skynet.harness', 'workspaces', 'agent.save.json');
const stationDoc = JSON.parse(readFileSync(savePath, 'utf8')).doc?.station;
if (!stationDoc) { console.error('no .doc.station in save'); process.exit(2); }

// the SHIPPED module source straight out of trunk, evaluated beside the patched one
const trunkSrc = execFileSync('git', ['show', 'feat/harness-backend:frontend/app/stationbake.js'], { encoding: 'utf8', maxBuffer: 64 << 20 });

const PROBE = `(() => {
  const DOC = JSON.parse(${JSON.stringify(JSON.stringify(stationDoc))});
  const N = ${N};
  const mkGeo = () => WorldModel.deserialize(JSON.parse(JSON.stringify(DOC))).projectGeometry();

  // load trunk's module in an isolated scope with the same globals the shipped one sees
  const TRUNK_SRC = ${JSON.stringify(trunkSrc)};
  let trunkBake = null;
  try {
    const mod = { exports: {} };
    // do NOT pass U — the page declares it with const at script scope, so it is not on window;
    // shadowing it with an undefined param is what made the trunk copy throw on hullPal
    new Function('module', 'exports', TRUNK_SRC)(mod, mod.exports);
    trunkBake = mod.exports && mod.exports.bake ? mod.exports : (window.StationBake === mod.exports ? mod.exports : null);
  } catch (e) { trunkBake = { err: String(e && e.message || e) }; }

  const time = (fn) => {
    fn(); fn();                                   // warm the JIT + any lazy strip caches
    const t = [];
    for (let i = 0; i < N; i++) { const a = performance.now(); fn(); t.push(performance.now() - a); }
    t.sort((x, y) => x - y);
    return { median: +t[(t.length >> 1)].toFixed(1), min: +t[0].toFixed(1), max: +t[t.length - 1].toFixed(1) };
  };

  const out = { rooms: Object.keys(DOC.rooms || {}).length, n: N };
  const geo = mkGeo();
  out.patched = time(() => StationBake.bake(mkGeo()));
  if (trunkBake && trunkBake.bake) out.trunk = time(() => trunkBake.bake(mkGeo()));
  else out.trunkError = (trunkBake && trunkBake.err) || 'trunk module did not export bake';

  // and the refit path: one dirty chunk re-bake, which is what a REFIT drag actually pays
  try {
    const full = StationBake.bake(mkGeo());
    const rect = { x1: geo.allRects[0].x1, y1: geo.allRects[0].y1, x2: geo.allRects[0].x2, y2: geo.allRects[0].y2 };
    out.incremental = time(() => StationBake.bakeIncremental(mkGeo(), full, [rect], {}));
  } catch (e) { out.incrementalError = String(e && e.message || e); }
  return JSON.stringify(out);
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'baketime-'));
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
  console.error('shellbaketime: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {}
  try { side.kill(); } catch {}
  process.exit(2);
}
console.log(JSON.stringify(JSON.parse(await evalJS(cdp, PROBE)), null, 1));
try { proc.kill(); } catch {}
try { side.kill(); } catch {}
