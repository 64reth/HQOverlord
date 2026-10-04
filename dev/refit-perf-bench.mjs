#!/usr/bin/env node
/* dev/refit-perf-bench.mjs — REPEATABLE frame-cost benchmark for REFIT (build.js).
 *
 * WHY IT EXISTS: "REFIT stutters on a big floor" is not a claim until two numbers exist for the
 * SAME scene. This builds a deterministic synthetic station (42 rooms / 336 props / 756 belt
 * tiles), drives the real app through CDP, and reports per-frame cost three ways:
 *
 *   1. rAF WALL TIME — every requestAnimationFrame callback is wrapped and timed. This works on an
 *      UNMODIFIED tree, which is what makes a BEFORE run possible at all: run it on the baseline,
 *      stash nothing, get a number; run it again on the optimized tree, compare like for like.
 *   2. LAYER BREAKDOWN — Build.__test__.perf(), when the tree carries the frame instrument. Absent
 *      on an old tree; reported as null rather than faked.
 *   3. MODEL MICRO-BENCHES — the individual calls the audit named (bayObjects / belts / bounds /
 *      mountOf / canPlaceBlueprint / lineFits / lineField), timed directly. These run on any tree.
 *
 * It also captures proof shots of the same scenes so a perf change can be shown NOT to have
 * changed a pixel of the overlay.
 *
 *   node dev/refit-perf-bench.mjs                     (label: "run")
 *   SKYNET_BENCH_LABEL=before node dev/refit-perf-bench.mjs
 *   SKYNET_BENCH_LABEL=after  node dev/refit-perf-bench.mjs
 *
 * Ports: SKYNET_SHOT_PORT (9498 — NEVER 9496, that is Andrew's demo) / SKYNET_CDP_PORT (9499).
 * Output: dev/.shots-refit-perf/<label>/ (shots + bench-<label>.json)
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9498';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9499);
const URL = `http://127.0.0.1:${PORT}/`;
const LABEL = process.env.SKYNET_BENCH_LABEL || 'run';
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-refit-perf', LABEL);
const SAMPLE_MS = Number(process.env.SKYNET_BENCH_MS || 7000);

const OPEN_REFIT = `(() => {
  if (typeof Build === 'undefined') return 'no-build';
  if (!Build.isOpen()) Build.open();
  const card = document.querySelector('.refit-firstrun');
  if (card) { const go = card.querySelector('#refit-guide-go'); if (go) go.click(); }
  return Build.isOpen() ? 'open' : 'failed';
})()`;

/* ---------- THE SYNTHETIC FLOOR ----------
   Deterministic by construction (no RNG, no clock): the same grid every run, so BEFORE and AFTER
   are measured on a scene that is identical tile for tile. 7x6 rooms of 9x7 on an 11x9 pitch. */
const BUILD_FLOOR = `(() => {
  const st = Build.__test__.station();
  /* The seed's own station STAYS (removeRoom refuses the spawn room, and demolishing the hero's
     desk would change what the validation layer has to say). The grid is laid clear to its east,
     so every run measures the seed floor PLUS exactly the same synthetic extension. */
  const b0 = st.bounds();
  const OX = b0.maxTx + 4, OY = b0.minTy;
  const COLS = 7, ROWS = 6, RW = 9, RH = 7, PX = 11, PY = 9;
  const rooms = [];
  for (let ry = 0; ry < ROWS; ry++) for (let rx = 0; rx < COLS; rx++) {
    const x = OX + rx * PX, y = OY + ry * PY;
    const res = st.addRoom({ kind: (rx + ry) % 5 === 0 ? 'lab' : 'hab', rect: { x1: x, y1: y, x2: x + RW - 1, y2: y + RH - 1 } });
    if (res && res.ok) rooms.push({ id: res.id, x, y });
  }
  // 8 props a room: a bay, a PC, files, web, memory, a table and two things standing ON the table
  const PLAN = [
    ['bay', 0, 0, 2, 2], ['console', 3, 0, 2, 1], ['rack', 6, 0, 2, 1],
    ['comms_dish', 0, 2, 2, 2], ['core', 3, 2, 1, 2],
    ['longtable', 5, 2, 3, 1], ['mug', 5, 2, 1, 1], ['plant', 6, 2, 1, 1],
  ];
  let props = 0, bays = 0, belts = 0, refused = 0;
  rooms.forEach((rm, i) => {
    for (const [t, dx, dy, w, h] of PLAN) {
      const res = st.addProp({ t, x: rm.x + dx, y: rm.y + dy, w, h });
      if (res && res.ok) { props++; if (t === 'bay') { st.assignPropAgent(res.id, 'agent-' + i); bays++; } }
      else refused++;
    }
    // two full belt rows a room — real conveyor topology under the props
    for (const by of [4, 5]) for (let bx = 0; bx < RW; bx++) {
      const r = st.setBelt(rm.x + bx, rm.y + by, bx === RW - 1 ? 'S' : 'E');
      if (r && r.ok) belts++;
    }
  });
  const b = st.bounds();
  return { rooms: st.rooms().length, props: st.props().length, bays, belts: st.belts().length,
           refused, bounds: b, deckTiles: st.rooms().reduce((n, r) => n + r.rects.reduce((m, q) => m + (q.x2-q.x1+1)*(q.y2-q.y1+1), 0), 0) };
})()`;

// wrap rAF once; works on ANY tree (this is what makes the BEFORE run possible)
const INSTALL_RAF = `(() => {
  if (!window.__benchPatched) {
    window.__benchPatched = 1;
    window.__benchSamples = [];
    window.__benchOn = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (cb) {
      return raf(function (ts) {
        const a = performance.now();
        try { return cb(ts); } finally { if (window.__benchOn) window.__benchSamples.push(performance.now() - a); }
      });
    };
  }
  return 'patched';
})()`;

const START = `(() => {
  window.__benchSamples.length = 0; window.__benchOn = 1; window.__benchT0 = performance.now();
  if (Build.__test__.perf) Build.__test__.perf(true);
  return 'on';
})()`;

const STOP = `JSON.stringify((() => {
  window.__benchOn = 0;
  const wall = performance.now() - window.__benchT0;
  const s = window.__benchSamples.slice().sort((a, b) => a - b);
  const q = p => s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
  const sum = s.reduce((a, b) => a + b, 0);
  /* THIS BOX IS SHARED WITH OTHER AGENT SESSIONS, so wall-clock frame time carries their load as
     noise — run to run, p50 moved further than the change being measured. minMs (the cleanest frame
     observed) and trim20 (the mean of the fastest 80%) are the load-robust readings: an unrelated
     CPU spike can only ever make a frame SLOWER, so the floor of the distribution is the honest
     estimate of what the code costs. p50/p90 stay in the report; they are just not the headline. */
  const keep = s.slice(0, Math.max(1, Math.floor(s.length * 0.8)));
  const layers = (Build.__test__.perf) ? Build.__test__.perf(false) : null;
  return {
    wallMs: +wall.toFixed(1), ticks: s.length,
    sumMs: +sum.toFixed(1), meanMs: +(s.length ? sum / s.length : 0).toFixed(3),
    minMs: +(s[0] || 0).toFixed(3), trim20: +(keep.reduce((a, b) => a + b, 0) / keep.length).toFixed(3),
    p50: +q(0.5).toFixed(3), p90: +q(0.9).toFixed(3), p99: +q(0.99).toFixed(3), maxMs: +(s[s.length-1] || 0).toFixed(3),
    workPerSec: +(sum / (wall / 1000)).toFixed(1),
    layers: layers ? Object.keys(layers).sort().reduce((o, k) => (o[k] = { n: layers[k].n, ms: +layers[k].ms.toFixed(1), perFrame: +(layers[k].ms / layers[k].n).toFixed(3) }, o), {}) : null,
  };
})())`;

// the individual calls the audit named, timed directly — tree-agnostic
const MICRO = `JSON.stringify((() => {
  const st = Build.__test__.station();
  const t = (label, reps, fn) => { const a = performance.now(); for (let i = 0; i < reps; i++) fn(i); const ms = performance.now() - a; return { reps, totalMs: +ms.toFixed(2), perCallUs: +((ms / reps) * 1000).toFixed(1) }; };
  const bays = st.props().filter(p => p.t === 'bay' && p.agentId);
  const props = st.props();
  const out = {};
  // ONE frame's worth of the old bayObjects work = every bound bay, once
  out.bayObjectsSweep = t('bayObjects', 20, () => { for (const b of bays) st.bayObjects(b.agentId); });
  out.belts = t('belts', 200, () => st.belts());
  out.bounds = t('bounds', 500, () => st.bounds());
  out.mountOfSweep = t('mountOf', 10, () => { for (const p of props) st.mountOf(p); });
  out.roomAt = t('roomAt', 20000, (i) => st.roomAt(2 + (i % 70), 2 + (i % 50)));
  out.canPlaceBlueprint = t('canPlaceBlueprint', 500, (i) => st.canPlaceBlueprint('research_line', 2 + (i % 60), 2 + (i % 45)));
  out.bays = bays.length; out.props = props.length;
  return out;
})())`;

// finding 8 + 9: the cost paid on the FIRST frame after an edit, and by the shelf
const RESCAN = `JSON.stringify((() => {
  const st = Build.__test__.station();
  const BPS = ['research_line', 'sorting_office', 'parallel_crew', 'ship_out'];
  /* invalidate WITHOUT changing the floor: flip one existing belt tile and flip it straight back,
     so every measurement below runs on a scene that is identical to the one just photographed. */
  const b1 = st.belts()[0];
  const bump = () => { if (!b1) return; const d = st.beltAt(b1.x, b1.y); st.setBelt(b1.x, b1.y, d === 'E' ? 'W' : 'E'); st.setBelt(b1.x, b1.y, d); };
  bump();
  const a0 = performance.now();
  const fits = BPS.map(id => { try { return Build.__test__.lineFits(id); } catch (_) { return null; } });
  const fitMs = performance.now() - a0;
  bump();
  const b0 = performance.now();
  const f = Build.__test__.lineField('research_line');
  const fieldMs = performance.now() - b0;
  return { shelfFitsMs: +fitMs.toFixed(1), fieldScanMs: +fieldMs.toFixed(1), fits, field: f };
})())`;

const PARK = `(() => { const cv = document.querySelector('.refit-canvas'); cv.dispatchEvent(new PointerEvent('pointerleave', { pointerId: 1, bubbles: true })); return 1; })()`;
const hoverTile = (tx, ty) => `(() => {
  const cv = document.querySelector('.refit-canvas');
  const ev = Build.__test__._tileEvent([${tx}, ${ty}], 0);
  cv.dispatchEvent(new PointerEvent('pointermove', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, bubbles: true }));
  return 1;
})()`;

async function scene(cdp, name, setup) {
  if (setup) { await evalJS(cdp, setup); await sleep(500); }
  await evalJS(cdp, START);
  await sleep(SAMPLE_MS);
  return JSON.parse(await evalJS(cdp, STOP));
}

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'refitperf-'));
  materializeSeedWorkspace(join(scratch, 'ws'));
  const side = bootSeededSidecar({ port: PORT, scratchDir: join(scratch, 'ws') });
  let chrome = null, cdp = null;
  const report = { label: LABEL, at: new Date().toISOString(), sampleMs: SAMPLE_MS };
  const shots = [];
  try {
    if (!(await waitUp(URL))) throw new Error('sidecar never came up on ' + URL);
    chrome = launchChrome({ cdpPort: CDP_PORT, win: '1440,1040', profileDir: join(scratch, 'chrome') });
    await sleep(1200);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Runtime.enable');
    const diag = collectDiagnostics(cdp);
    await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never reached the game screen');
    await sleep(1500);
    mkdirSync(OUT, { recursive: true });

    // pin the text size (the shelf harness's known zoom trap) — every run measures the same glass
    await evalJS(cdp, `(() => {
      const KEY = 'starnet.station.v1';
      const r = JSON.parse(localStorage.getItem(KEY) || '{"v":1}');
      r.settings = Object.assign({}, r.settings, { textScale: 100 });
      localStorage.setItem(KEY, JSON.stringify(r));
      location.reload();
      return 'reloading';
    })()`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never came back after the text-size reload');
    await sleep(1500);

    const opened = await evalJS(cdp, OPEN_REFIT);
    if (opened !== 'open') throw new Error('REFIT did not open: ' + opened);
    await sleep(600);
    await evalJS(cdp, INSTALL_RAF);

    report.floor = await evalJS(cdp, BUILD_FLOOR);
    console.log('SCENE:', JSON.stringify(report.floor));
    if (report.floor.props < 300) throw new Error('synthetic floor is too small: ' + JSON.stringify(report.floor));
    await sleep(1200);
    await evalJS(cdp, `(() => { const b = document.querySelector('#refit-fit'); if (b) b.click(); return 1; })()`);
    await sleep(900);
    await evalJS(cdp, PARK);
    await sleep(600);

    // ---- SCENE A: SELECT at rest (the baseline frame) ----
    report.selectRest = await scene(cdp, 'selectRest', `(() => { const b = document.querySelector('.refit-tool[data-tool="select"]'); if (b) b.click(); return 1; })()`);
    console.log('A selectRest:', JSON.stringify(report.selectRest.workPerSec) + ' ms-work/s, p50', report.selectRest.p50);
    shots.push(await capture(cdp, OUT, 'a-select-rest'));

    // ---- SCENE B: LINES armed, pointer on the deck (candidate wash + ghost + snap) ----
    const armLines = `(() => {
      const b = document.querySelector('.refit-tool[data-tool="line"]'); if (b) b.click();
      const tile = document.querySelector('.refit-linetile[data-line="research_line"]'); if (tile) tile.click();
      return 1;
    })()`;
    await evalJS(cdp, armLines);
    await sleep(900);
    const bnds = report.floor.bounds;
    await evalJS(cdp, hoverTile(Math.round((bnds.minTx + bnds.maxTx) / 2), Math.round((bnds.minTy + bnds.maxTy) / 2)));
    report.linesArmed = await scene(cdp, 'linesArmed', null);
    console.log('B linesArmed:', JSON.stringify(report.linesArmed.workPerSec) + ' ms-work/s, p50', report.linesArmed.p50);
    shots.push(await capture(cdp, OUT, 'b-lines-armed'));

    // ---- the per-edit rescan + the shelf's four fit probes ----
    report.rescan = JSON.parse(await evalJS(cdp, RESCAN));
    console.log('RESCAN:', JSON.stringify({ shelfFitsMs: report.rescan.shelfFitsMs, fieldScanMs: report.rescan.fieldScanMs, fits: report.rescan.fits, field: report.rescan.field && { count: report.rescan.field.count, runs: report.rescan.field.runs } }));

    // ---- the named model calls ----
    report.micro = JSON.parse(await evalJS(cdp, MICRO));
    console.log('MICRO:', JSON.stringify(report.micro));

    // ---- SCENE C: back to SELECT, hovering a bound bay (validation + hover + agent tag) ----
    await evalJS(cdp, `(() => { const b = document.querySelector('.refit-tool[data-tool="select"]'); if (b) b.click(); return 1; })()`);
    await sleep(400);
    await evalJS(cdp, hoverTile(bnds.minTx + 0, bnds.minTy + 0));
    report.selectHover = await scene(cdp, 'selectHover', null);
    console.log('C selectHover:', JSON.stringify(report.selectHover.workPerSec) + ' ms-work/s, p50', report.selectHover.p50);
    shots.push(await capture(cdp, OUT, 'c-select-hover-bay'));

    /* ---- SCENE D: the WORKING zoom (100% = the zoom REFIT actually opens at). SELECT-at-rest and
       LINES-armed above are shot at FIT, i.e. the whole 96x52 floor on the glass — the honest worst
       case, where nothing can be culled. This is the view a Commander actually edits in. ---- */
    await evalJS(cdp, `(() => { const b = document.querySelector('#refit-zlvl'); if (b) b.click(); return 1; })()`);
    await sleep(700);
    await evalJS(cdp, PARK);
    report.zoomWorking = await scene(cdp, 'zoomWorking', null);
    report.zoomWorkingCamera = JSON.parse(await evalJS(cdp, `JSON.stringify(Build.__test__.camera())`));
    console.log('D zoomWorking:', JSON.stringify(report.zoomWorking.workPerSec) + ' ms-work/s, p50', report.zoomWorking.p50, 'zoom', report.zoomWorkingCamera.zoom);
    shots.push(await capture(cdp, OUT, 'd-zoom-working'));

    /* ---- SCENE E: zoomed IN (the state you place props from). Most of a large deck is off the
       glass here, which is exactly the case a viewport cull exists for. ---- */
    await evalJS(cdp, `(() => { const b = document.querySelector('#refit-zin'); for (let i = 0; i < 3; i++) if (b) b.click(); return 1; })()`);
    await sleep(700);
    await evalJS(cdp, PARK);
    report.zoomClose = await scene(cdp, 'zoomClose', null);
    report.zoomCloseCamera = JSON.parse(await evalJS(cdp, `JSON.stringify(Build.__test__.camera())`));
    console.log('E zoomClose:', JSON.stringify(report.zoomClose.workPerSec) + ' ms-work/s, p50', report.zoomClose.p50, 'zoom', report.zoomCloseCamera.zoom);
    shots.push(await capture(cdp, OUT, 'e-zoom-close'));

    // back to FIT for the identity dump + the closing shot, so both labels compare the same frame
    await evalJS(cdp, `(() => { const b = document.querySelector('#refit-fit'); if (b) b.click(); return 1; })()`);
    await sleep(700);

    /* SNAP IDENTITY: the exact tiles the wash reports legal and the exact anchor a click would
       commit, over a deterministic sweep. This is the file that proves a perf change did not move
       a single candidate — diff it between BEFORE and AFTER. */
    report.identity = JSON.parse(await evalJS(cdp, `JSON.stringify((() => {
      const out = { fields: {}, snaps: [] };
      for (const id of ['research_line', 'sorting_office', 'parallel_crew', 'ship_out']) {
        const f = Build.__test__.lineField(id);
        out.fields[id] = f ? { count: f.count, runs: f.runs, sample: f.sample } : null;
      }
      const b = Build.__test__.station().bounds();
      for (let ty = b.minTy - 2; ty <= b.maxTy + 2; ty += 3)
        for (let tx = b.minTx - 2; tx <= b.maxTx + 2; tx += 3)
          out.snaps.push([tx, ty, Build.__test__.lineSnapAt(tx, ty)]);
      return out;
    })())`));
    console.log('IDENTITY: fields', JSON.stringify(Object.keys(report.identity.fields).map(k => k + '=' + (report.identity.fields[k] ? report.identity.fields[k].count : 'null'))), 'snaps', report.identity.snaps.length);

    report.degraded = await evalJS(cdp, `JSON.stringify(Build.__test__.degradedLayers())`);
    report.renderState = await evalJS(cdp, `document.querySelector('.refit-overlay').dataset.renderState`);
    report.consoleErrors = diag.consoleMsgs.slice(0, 10);
    report.exceptions = diag.exceptions.slice(0, 10);
    report.shots = shots.map(s => s.path);

    const file = join(OUT, 'bench-' + LABEL + '.json');
    writeFileSync(file, JSON.stringify(report, null, 2));
    console.log('\n=== BENCH ' + LABEL + ' ===');
    console.log('scene           :', report.floor.rooms + ' rooms, ' + report.floor.props + ' props, ' + report.floor.belts + ' belts, ' + report.floor.deckTiles + ' deck tiles');
    for (const k of ['selectRest', 'linesArmed', 'selectHover', 'zoomWorking', 'zoomClose']) {
      const r = report[k];
      if (!r) continue;
      console.log(k.padEnd(16) + ': MIN ' + String(r.minMs).padStart(7) + 'ms  trim20 ' + String(r.trim20).padStart(7) + 'ms  p50 ' + r.p50 + 'ms  p90 ' + r.p90 + 'ms  ticks ' + r.ticks + (r.layers ? '  [instr FRAME ' + (r.layers['=FRAME'] ? r.layers['=FRAME'].perFrame : '?') + 'ms, props ' + (r.layers.props ? r.layers.props.perFrame : '?') + 'ms]' : '  (no layer instrument)'));
    }
    console.log('shelf lineFits  :', report.rescan.shelfFitsMs + 'ms   field rescan: ' + report.rescan.fieldScanMs + 'ms');
    console.log('degraded layers :', report.degraded, ' renderState:', report.renderState);
    console.log('report          :', file);
    console.log('shots           :', JSON.stringify(report.shots, null, 2));
  } finally {
    try { if (cdp) cdp.close(); } catch {}
    try { if (chrome) chrome.proc ? chrome.proc.kill() : chrome.kill(); } catch {}
    try { side.kill(); } catch {}
  }
}

main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
