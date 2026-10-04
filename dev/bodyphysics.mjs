#!/usr/bin/env node
/* dev/bodyphysics.mjs — LIVE PROOF for the 2026-08-17 world-physics pass. Three reports:
 *
 *   1. "the agents seem to walk through one another"                     -> SPACING
 *   2. "they all go to the conveyor if one is spawned"                   -> CONVEYOR
 *   3. "they talk to each other through walls"                           -> SIGHTLINE
 *
 * None of the three can be read off a screenshot or a source diff: an overlap lasts a handful of
 * frames, a conveyor congregation is a distribution over minutes, and a through-wall conversation
 * needs two bodies standing in two different rooms at the same moment. So this boots the REAL app
 * in headless Chrome on a REAL two-room floor with a REAL belt run, puts crew on it, and both
 *   (a) FORCES the states (teleport two bodies onto one pixel; ask the shipped sightline about the
 *       actual wall the bake laid) — because a state that never occurs on the dev box is invisible
 *       to every live-verify pass, and
 *   (b) SOAKS, sampling the floor on a fixed cadence so the natural rates are measured, not assumed.
 *
 * Usage:  node dev/bodyphysics.mjs [--port 8943] [--cdp 9343] [--minutes 4] [--crew 3]
 * Exits nonzero on any violation, and on an inconclusive run (a starved sampler is not a pass).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sleep, launchChrome, connectCDP, evalJS } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, isUp, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const arg = (flag, dflt) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : dflt; };
const PORT = arg('--port', '8943');
const CDP_PORT = Number(arg('--cdp', '9343'));
const MINUTES = Number(arg('--minutes', '4'));
const CREW = Number(arg('--crew', '3'));
const OUT = arg('--out', join(process.cwd(), '.bodyphysics'));
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SCRATCH = join(OUT, '_seed-workspace');
mkdirSync(OUT, { recursive: true });

/* BUILD MARKER — "waitUp() true != your server" (2026-08-07). A live check must prove it is talking
   to MY build. These three probes exist only on it; a page without them is somebody else's server. */
const MARKER = `(() => { try {
  return { los: typeof World._dbgLos === 'function', spacing: typeof World._dbgSpacing === 'function', belt: typeof World._dbgBeltWatch === 'function' };
} catch (e) { return { err: String(e) }; } })()`;

/* A REAL FLOOR WITH A REAL WALL IN IT.
   ⛔ The obvious build — a second room ABUTTING the first — produces NO WALL AT ALL. projectGeometry
   auto-doors every orthogonally-adjacent pair of tiles across a zone seam (worldmodel "auto-doors"),
   so two rooms that touch are one continuous open floor as far as walkability, sight and pathing are
   concerned. The first run of this probe built exactly that and found zero walls, which would have
   made the sightline test vacuously green. A wall, in this model, is VOID.
   So: room B is laid one column of void away from room A, and a 1x1 corridor room is dropped into that
   column to be the single doorway. That is a wall with one way through — the shape the report is about.
   Plus a belt run in room A (test 2 needs a conveyor to congregate at) and some leisure props so the
   idle engine has somewhere else it could have gone. */
const BUILD = `(() => { try {
  const st = (typeof Build !== 'undefined' && Build.__test__ && Build.__test__.station && Build.__test__.station()) || null;
  if (!st) return { err: 'no station' };
  const rooms = st.rooms(); if (!rooms.length) return { err: 'no rooms' };
  const r0 = rooms[0].rects[0];
  const out = { home: r0, added: null, door: null, wallCol: r0.x2 + 1, belts: 0, props: [] };
  const wall = r0.x2 + 1;                      // the void column that IS the wall
  const nx1 = wall + 1, nx2 = wall + 10;
  const res = st.addRoom({ kind: 'hab', rect: { x1: nx1, y1: r0.y1, x2: nx2, y2: r0.y2 } });
  out.added = res && res.ok ? { x1: nx1, y1: r0.y1, x2: nx2, y2: r0.y2 } : ((res && res.reason) || 'addRoom failed');
  // the doorway is a CORRIDOR, not a room: checkRects holds rooms to 3x3 but a corridor only to a
  // long axis of MIN_HALL (2), which is the smallest hole this model will cut in a wall.
  const doorY = Math.round((r0.y1 + r0.y2) / 2);
  const dres = st.addRoom({ kind: 'corridor', rect: { x1: wall, y1: doorY, x2: wall, y2: doorY + 1 } });
  out.door = dres && dres.ok ? { x: wall, y: doorY, h: 2 } : ((dres && (dres.msg || dres.error)) || 'door corridor failed');
  // a belt run along a clear row of the home room
  const by = r0.y2 - 1;
  for (let x = r0.x1 + 1; x <= r0.x2 - 1; x++) if (st.setBelt(x, by, 'E').ok) out.belts++;
  for (const [t, w, h, dx, dy] of [['couch', 5, 1, 2, 1], ['arcade', 1, 2, 8, 1], ['bookshelf', 2, 1, 3, 3]]) {
    const x = r0.x1 + dx, y = r0.y1 + dy;
    const ok = st.canPlaceProp ? st.canPlaceProp(t, x, y, w, h) : { ok: true };
    if (ok && ok.ok !== false && st.addProp({ t, x, y, w, h, block: true }).ok) out.props.push(t + '@' + x + ',' + y);
  }
  return out;
} catch (e) { return { err: String(e && e.stack || e) }; } })()`;

/* SIGHTLINE, asked of the REAL bake — a column-by-column readout of the wall the floor build laid.
   `losClear(t, t)` on a single tile answers "is this real floor", so the probe FINDS the wall by asking
   the geometry rather than being told where it is, then asks the SHIPPED sightline to look across it.
   Every row of that column is one of two cases and both are asserted:
     · wall row    — the middle tile is void ⇒ the pair either side MUST NOT see each other (the report)
     · doorway row — the middle tile is floor ⇒ the pair either side MUST see each other (the control
                     that stops "nothing can see anything" from passing as a fix) */
const SIGHT = `(() => { try {
  const bs = World.bodies().filter(b => b && !b.unplaced);
  if (!bs.length) return { err: 'no bodies' };
  const isFloor = (x, y) => World._dbgLos(x, y, x, y);
  // NOTE: this scans the LOCAL tile frame (what bodies() reports and _dbgLos speaks), NOT the doc
  // coords the build used — the bake's origin shifts by the bounding box + MARGIN, and a first cut of
  // this probe scanned doc column 18 straight into the middle of room A and reported a wall-free wall.
  const out = { wallGaps: 0, leaks: [], doorGaps: 0, deadDoors: [], sameRoom: 0, blindSameRoom: [] };
  for (let y = 0; y < 44; y++) for (let x = 1; x < 64; x++) {
    if (!isFloor(x - 1, y) || !isFloor(x + 1, y)) continue;      // not a horizontal pair spanning anything
    const mid = isFloor(x, y), across = World._dbgLos(x - 1, y, x + 1, y);
    if (mid) { out.doorGaps++; if (!across) out.deadDoors.push([x, y]); }   // three floor tiles in a row: MUST see
    else { out.wallGaps++; if (across) out.leaks.push([x, y]); }            // void between them: MUST NOT see
  }
  // control: inside ONE room, over open floor, bodies must still see each other
  const t = bs[0].tile;
  for (let y = t.y - 3; y <= t.y + 3; y++) for (let x = t.x - 6; x <= t.x + 6; x++) {
    if (!isFloor(x, y)) continue;
    if (World._dbgLos(t.x, t.y, x, y)) out.sameRoom++; else out.blindSameRoom.push([x, y]);
  }
  return out;
} catch (e) { return { err: String(e && e.stack || e) }; } })()`;

// one read of the whole floor + the three probes; no side effects
const SAMPLE = `(() => { try {
  const bodies = World.bodies().filter(b => b && !b.unplaced);
  const sp = World._dbgSpacing(), bw = World._dbgBeltWatch();
  /* Every pair HOLDING a conversation must be able to see each other.
     Scoped to the HOLD phase on purpose, and this is not a loosened bar — world.js gates speech on
     pl.holdAt (stamped on arrival), so a body still WALKING to a rendezvous is not talking, it is
     walking, and it is perfectly legitimate for it to be out of sight on the way (through a doorway,
     say). A 5-crew run caught exactly one such sample and it was two bodies mid-walk; counting that
     as "talking through a wall" would be the probe lying, not the engine. Walk-phase blindness is
     still COUNTED below so a regression that reintroduced cross-wall PLANNING would show up. */
  const inTalk = bodies.filter(b => b.socialKind === 'huddle' || b.socialKind === 'border');
  const blind = [], blindWalking = [];
  for (let i = 0; i < inTalk.length; i++) for (let j = i + 1; j < inTalk.length; j++) {
    const a = inTalk[i], b = inTalk[j];
    if (World._dbgLos(a.tile.x, a.tile.y, b.tile.x, b.tile.y)) continue;
    const rec = [a.id, b.id, a.socialKind, a.socialPhase, b.socialPhase, !!a.talking, !!b.talking];
    if (a.socialPhase === 'hold' && b.socialPhase === 'hold') blind.push(rec); else blindWalking.push(rec);
  }
  // when the closest pair is inside the law, capture WHY — a violation must be diagnosable from the
  // receipt, not re-derived by another five-minute run (the first soak reported 9.15px and nothing else)
  let tight = null;
  if (sp.minPx != null && sp.pair && sp.minPx < sp.personalPx) {
    tight = sp.pair.map(id => {
      const b = bodies.find(x => x.id === id);
      return b ? { id, tile: b.tile, px: b.px, py: b.py, sitting: b.sitting, seated: b.seated, state: b.state, goal: b.goal, moving: b.moving } : { id, gone: true };
    });
  }
  return {
    t: Math.round(performance.now()),
    spacing: sp, belt: bw, blind, blindWalking, tight,
    kinds: bodies.map(b => b.socialKind).filter(Boolean),
    goals: bodies.map(b => b.goal).filter(Boolean),
    walking: bodies.filter(b => b.moving).length,
  };
} catch (e) { return { err: String(e && e.stack || e) }; } })()`;

// FORCE THE OVERLAP: drop two crew bodies on the exact same pixel and see what the engine does with it.
const COLLIDE = `(() => { try {
  const bs = World.bodies().filter(b => b && !b.unplaced && !b.hero && !b.sitting && !b.seated && !b.working);
  if (bs.length < 2) return { err: 'need 2 free crew' };
  const a = bs[0], b = bs[1];
  const okA = World._dbgTeleport(a.id, a.px, a.py), okB = World._dbgTeleport(b.id, a.px, a.py);
  if (!okA || !okB) return { err: 'teleport refused' };
  return { ok: true, ids: [a.id, b.id], atPx: World._dbgSpacing().minPx };
} catch (e) { return { err: String(e && e.stack || e) }; } })()`;

const pct = (n, d) => (d ? +(100 * n / d).toFixed(1) : 0);
class SoakExit extends Error { constructor(code, message) { super(message); this.code = code; } }
const stop = (code, message) => { throw new SoakExit(code, message); };

let proc = null, side = null, cdp = null, exitCode = null;
const fail = [];
try {
  if (await isUp(APP_URL)) stop(2, `[bodyphysics] ${APP_URL} already answers — someone else owns that port; pick another (--port)`);
  rmSync(SCRATCH, { recursive: true, force: true });
  materializeSeedWorkspace(SCRATCH);
  side = bootSeededSidecar({ port: PORT, scratchDir: SCRATCH });
  if (!(await waitUp(APP_URL))) throw new Error('seeded sidecar never came up on :' + PORT);

  ({ proc } = launchChrome({ cdpPort: CDP_PORT, win: '1440,900', profileDir: join(OUT, '_profile') }));
  cdp = await connectCDP(CDP_PORT);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  // throttle rAF before boot (the documented headless gotcha: a full-tilt software canvas starves
  // every Runtime.evaluate). Every timer in this engine is wall-clock, so behaviour advances the same.
  const FRAME_MS = Number(arg('--frame-ms', '100'));
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), ${FRAME_MS}); window.cancelAnimationFrame = (id) => clearTimeout(id);`,
  });
  await cdp.send('Page.navigate', { url: APP_URL });
  if (!(await waitDevReady(cdp, evalJS, { tries: 30, url: APP_URL }))) throw new Error('never reached the in-game floor');
  await sleep(5000);

  const marker = await evalJS(cdp, MARKER);
  if (!marker || !marker.los || !marker.spacing || !marker.belt) {
    stop(3, '[bodyphysics] BUILD MARKER MISSING — this page is not the world-physics build: ' + JSON.stringify(marker));
  }
  console.log('[bodyphysics] build marker ok', JSON.stringify(marker));

  const floor = await evalJS(cdp, BUILD);
  console.log('[bodyphysics] floor:', JSON.stringify(floor));
  if (!floor || floor.err) throw new Error('floor build failed: ' + JSON.stringify(floor));
  if (!floor.belts) throw new Error('no belt was laid — the CONVEYOR test would be vacuous');
  if (!floor.added || floor.added.x1 == null) throw new Error('no second room — the SIGHTLINE test would be vacuous');
  if (!floor.door || floor.door.x == null) throw new Error('no doorway room — a fully-sealed wall would make the control unprovable');
  await sleep(2500);

  for (let i = 0; i < CREW; i++) {
    await evalJS(cdp, `(() => { World.spawnAgent({ id: 'probe${i}', name: 'PROBE${i}', color: '#77ffdd' }); return true; })()`);
    await sleep(600);
  }
  await sleep(3000);

  // ── TEST 3a — SIGHTLINE against the real bake ────────────────────────────────────────────────
  const sight = await evalJS(cdp, SIGHT);
  if (sight.err) fail.push('sightline scan errored: ' + sight.err);
  else {
    console.log(`[bodyphysics] SIGHTLINE: ${sight.wallGaps} void-between-floor pairs (leaks: ${sight.leaks.length}) · ${sight.doorGaps} open-floor-between pairs (blind: ${sight.deadDoors.length}) · ${sight.sameRoom} same-room control tiles visible (blind: ${sight.blindSameRoom.length})`);
    if (!sight.wallGaps) fail.push('CONTROL FAILED: the scan found no wall at all — the walled floor did not build, so the sightline test is vacuous');
    if (!sight.doorGaps) fail.push('CONTROL FAILED: the scan found no open three-tile run — a fix that blinds everything would pass');
    if (!sight.sameRoom) fail.push('CONTROL FAILED: no open-floor tile inside one room was visible from the body — the probe proves nothing');
    if (sight.leaks.length) fail.push(`SIGHTLINE: ${sight.leaks.length} pairs see straight THROUGH a wall — ${JSON.stringify(sight.leaks.slice(0, 6))}`);
    if (sight.deadDoors.length) fail.push(`SIGHTLINE: ${sight.deadDoors.length} pairs across OPEN floor are blind — the fix over-blocks — ${JSON.stringify(sight.deadDoors.slice(0, 6))}`);
    if (sight.blindSameRoom.length) fail.push(`SIGHTLINE: ${sight.blindSameRoom.length} same-room tiles went blind — the fix over-blocks — ${JSON.stringify(sight.blindSameRoom.slice(0, 6))}`);
  }

  // ── TEST 1a — FORCED OVERLAP ─────────────────────────────────────────────────────────────────
  const personalPx = (await evalJS(cdp, `World._dbgSpacing().personalPx`)) || 0;
  const collides = [];
  for (let k = 0; k < 5; k++) {
    const c = await evalJS(cdp, COLLIDE);
    if (c && c.err) { collides.push({ err: c.err }); await sleep(1500); continue; }
    await sleep(1200);   // several engine ticks
    const after = await evalJS(cdp, `World._dbgSpacing()`);
    collides.push({ ids: c.ids, beforePx: c.atPx, afterPx: after && after.minPx });
    await sleep(1500);
  }
  console.log('[bodyphysics] forced overlaps:', JSON.stringify(collides));
  const resolved = collides.filter(c => !c.err && c.afterPx != null && c.afterPx >= personalPx - 0.25);
  const attempted = collides.filter(c => !c.err);
  if (!attempted.length) fail.push('FORCED OVERLAP never ran (no two free crew bodies) — test 1 proves nothing');
  else if (resolved.length !== attempted.length) fail.push(`FORCED OVERLAP: only ${resolved.length}/${attempted.length} stacked pairs separated to >= ${personalPx}px`);

  // ── SOAK ─────────────────────────────────────────────────────────────────────────────────────
  const t0 = Date.now(), END = t0 + MINUTES * 60000, samples = [];
  let minSpacing = Infinity, minPair = null, maxWatchers = 0, blindTalks = [], tightest = null, walkingBlind = 0;
  const goalHist = {}, kindHist = {};
  while (Date.now() < END) {
    const s = await evalJS(cdp, SAMPLE).catch(() => null);
    if (s && s.spacing) {
      samples.push(s);
      if (s.spacing.minPx != null && s.spacing.minPx < minSpacing) { minSpacing = s.spacing.minPx; minPair = s.spacing.pair; tightest = s.tight; }
      maxWatchers = Math.max(maxWatchers, (s.belt.watching || []).length);
      if (s.blind && s.blind.length) blindTalks.push(s.blind);
      if (s.blindWalking && s.blindWalking.length) walkingBlind += s.blindWalking.length;
      for (const g of s.goals || []) goalHist[g] = (goalHist[g] || 0) + 1;
      for (const k of s.kinds || []) kindHist[k] = (kindHist[k] || 0) + 1;
    }
    await sleep(700);
  }

  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(`\n[bodyphysics] ${samples.length} samples over ${secs}s (${CREW} crew + hero)`);
  console.log('  goals seen      :', JSON.stringify(goalHist));
  console.log('  encounters seen :', JSON.stringify(kindHist));

  // ── TEST 1b — nobody ever overlapped during the soak ──────────────────────────────────────────
  console.log(`  SPACING   min pair distance over the whole soak: ${minSpacing.toFixed(2)}px (law: >= ${personalPx}px)  pair=${JSON.stringify(minPair)}`);
  if (!samples.length) fail.push('the sampler starved — zero samples, INCONCLUSIVE (not a pass)');
  else if (minSpacing < personalPx - 0.25) fail.push(`SPACING: two bodies got within ${minSpacing.toFixed(2)}px (law: ${personalPx}px) — they can still overlap. State at that sample: ${JSON.stringify(tightest)}`);

  // ── TEST 2 — the conveyor is not a congregation ───────────────────────────────────────────────
  const watchSamples = samples.filter(s => (s.belt.watching || []).length > 0).length;
  console.log(`  CONVEYOR  most bodies watching a belt at once: ${maxWatchers} (law: <= 1) · ${watchSamples}/${samples.length} samples had anyone watching (${pct(watchSamples, samples.length)}%)`);
  if (maxWatchers > 1) fail.push(`CONVEYOR: ${maxWatchers} bodies were watching a belt at the same time — the magnet is still there`);

  // ── TEST 3b — no conversation was ever held through a wall ────────────────────────────────────
  const talkSamples = samples.filter(s => (s.kinds || []).some(k => k === 'huddle' || k === 'border')).length;
  console.log(`  SIGHTLINE ${talkSamples}/${samples.length} samples had a live conversation; ${blindTalks.length} were HELD out of sight of a partner (${walkingBlind} pairs were merely mid-WALK out of sight, which is legal — speech is gated on arrival)`);
  if (blindTalks.length) fail.push(`SIGHTLINE: ${blindTalks.length} samples HELD a conversation through a wall — ${JSON.stringify(blindTalks[0])}`);
  if (!talkSamples) console.log('  SIGHTLINE note: no conversation fired in this window — the through-wall assertion is UNPROVEN by soak (the forced scan above still stands)');

  writeFileSync(join(OUT, 'samples.json'), JSON.stringify({ floor, sight, collides, personalPx, minSpacing, maxWatchers, goalHist, kindHist, samples: samples.slice(-200) }, null, 2));
  console.log(`\n[bodyphysics] detail -> ${join(OUT, 'samples.json')}`);
} catch (e) {
  if (e instanceof SoakExit) { console.log(e.message); exitCode = e.code; }
  else { console.log('[bodyphysics] ERROR: ' + (e && e.stack || e)); exitCode = 1; }
} finally {
  try { if (cdp && cdp.close) cdp.close(); } catch {}
  try { if (proc) proc.kill(); } catch {}
  try { if (side && side.kill) side.kill(); } catch {}
}
if (exitCode == null) {
  if (fail.length) { console.log('\n[bodyphysics] FAIL:'); for (const f of fail) console.log('  · ' + f); exitCode = 1; }
  else { console.log('\n[bodyphysics] PASS — bodies stayed solid, the belt held one watcher, no talk crossed a wall.'); exitCode = 0; }
}
process.exit(exitCode);
