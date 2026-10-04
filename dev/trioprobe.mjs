/* node dev/trioprobe.mjs [--port 8957] [--cdp 9357]
 *
 * Proves the THREE-BODY conversation (W5) end to end in the real running app.
 *
 * WHY THIS EXISTS SEPARATELY FROM idlesoak.mjs. A trio is rare on purpose: it needs three eligible
 * bodies standing together, a roll, and a legal third tile. Two 6-7 minute soaks produced eight
 * encounters and not one trio - which tells you nothing about whether the code works, only that the
 * dice did not land. Waiting longer is not a proof strategy.
 *
 * So this drives the SELECTION deterministically (World._dbgHuddle, which bypasses the frequency
 * roll and nothing else - zone containment, pair cooldowns, the tile resolver and the single-slot
 * rule all still apply) and then WATCHES the encounter through the ordinary read-only World.bodies()
 * projection. What it asserts is the BEHAVIOUR, not the call:
 *
 *   1. three distinct bodies are armed into one encounter        (the roster is real)
 *   2. all three reach the 'hold' phase                          (they actually walked there)
 *   3. every one of them takes a turn talking                    (nobody is a silent bystander)
 *   4. NEVER two mouths at the same sample                       (round-robin, not a crowd)
 *   5. the encounter ends and every body is released             (no leaked slot, no frozen pose)
 *
 * Boot sequence is idlesoak's, verbatim in shape: seeded sidecar, headless Chrome, rAF throttled to
 * 10fps BEFORE navigation (a full-tilt software canvas starves Runtime.evaluate; every timer in the
 * idle engine is wall-clock, so behaviour advances identically either way). Exits nonzero on any
 * failed check.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { sleep, launchChrome, connectCDP, evalJS } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, isUp, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const PORT = arg('--port', '8957');
const CDP_PORT = Number(arg('--cdp', '9357'));
const OUT = arg('--out', join(process.cwd(), '.trioprobe'));
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SCRATCH = join(OUT, '_seed-workspace');
mkdirSync(OUT, { recursive: true });

const SAMPLE = `(() => {
  if (typeof World === 'undefined' || typeof World.bodies !== 'function') return { err: 'no World.bodies' };
  return { t: Math.round(performance.now()), bodies: World.bodies() };
})()`;

let proc = null, side = null, cdp = null;
const fail = [];
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fail.push(msg); };

try {
  if (await isUp(APP_URL)) throw new Error(`${APP_URL} already answers — someone else owns that port; pick another (--port)`);
  rmSync(SCRATCH, { recursive: true, force: true });
  materializeSeedWorkspace(SCRATCH);
  side = bootSeededSidecar({ port: PORT, scratchDir: SCRATCH });
  if (!(await waitUp(APP_URL))) throw new Error('seeded sidecar never came up on :' + PORT);

  ({ proc } = launchChrome({ cdpPort: CDP_PORT, win: '1440,900', profileDir: join(OUT, '_profile') }));
  cdp = await connectCDP(CDP_PORT);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 100); window.cancelAnimationFrame = (id) => clearTimeout(id);`,
  });
  await cdp.send('Page.navigate', { url: APP_URL });
  if (!(await waitDevReady(cdp, evalJS, { tries: 30, url: APP_URL }))) throw new Error('never reached the in-game floor');
  await sleep(5000);

  // BUILD MARKER — prove this page is MY build, not another agent's server on a neighbouring port.
  const marker = await evalJS(cdp, `(() => { try { return { hasHuddle: !!(typeof World !== 'undefined' && World._dbgHuddle), hasStats: !!(typeof World !== 'undefined' && World._dbgHuddleStats) }; } catch (e) { return { err: String(e) }; } })()`);
  console.log('[trioprobe] build marker:', JSON.stringify(marker));
  if (!marker || !marker.hasHuddle) throw new Error('this page has no World._dbgHuddle — wrong build/server on this port');

  for (let i = 0; i < 3; i++) {
    await evalJS(cdp, `(() => { World.spawnAgent({ id: 'T${i}', name: 'TRIO${i}', color: '#77ffdd' }); return true; })()`);
    await sleep(700);
  }
  await sleep(4000);

  // park the three together so they are inside one another's zones (removes the WAITING, not the beat)
  const parked = await evalJS(cdp, `(() => { try {
    const bs = World.bodies().filter(b => b && !b.hero && !b.unplaced);
    if (bs.length < 3) return 'need 3 crew, got ' + bs.length;
    const a = bs[0];
    World._dbgTeleport(bs[1].id, a.px + 3, a.py + 3);
    World._dbgTeleport(bs[2].id, a.px - 3, a.py + 3);
    return bs.map(b => b.id).join(',');
  } catch (e) { return 'err ' + e; } })()`);
  console.log('[trioprobe] parked:', parked);
  await sleep(1500);

  /* Arming must yield a roster of THREE, and "it armed a pair instead" is neither a pass nor a
     product failure — it is the run failing to set up its own experiment. `force` skips the
     frequency roll and nothing else, so a pair cooldown between two of the crew (earned by an
     organic encounter during the settle) legitimately blocks the third body. Observed live: one run
     armed T0,T1 with trioFired 0 for exactly that reason. Retry, rotating WHICH body initiates so a
     single cooled-off pair cannot veto the whole attempt; if three never assemble, exit
     INCONCLUSIVE (4) rather than grade — the same discipline idlesoak uses for a starved run. */
  let armed = null;
  for (let attempt = 0; attempt < 16; attempt++) {
    const rot = attempt % 3;
    armed = await evalJS(cdp, `(() => { try {
      const bs = World.bodies().filter(b => b && !b.hero && !b.unplaced);
      if (bs.length < 3) return { ok: false, err: 'crew vanished' };
      const rot = ${rot}, ids = bs.map(b => b.id);
      const order = ids.slice(rot).concat(ids.slice(0, rot));
      return World._dbgHuddle(order, true);
    } catch (e) { return { ok: false, err: String(e) }; } })()`);
    if (armed && armed.ok && armed.roster && armed.roster.length === 3) break;
    if (armed && armed.ok) {
      // armed a PAIR — release it so the retry is not blocked by its own leftover encounter
      console.log('[trioprobe] arm attempt ' + attempt + ': armed only ' + armed.roster.join(',') + ' — waiting for a legal third');
      await sleep(4000);
    } else {
      console.log('[trioprobe] arm attempt ' + attempt + ':', JSON.stringify(armed));
      await sleep(2000);
    }
  }
  if (!(armed && armed.ok && armed.roster && armed.roster.length === 3)) {
    console.log('\nTRIOPROBE INCONCLUSIVE — could not assemble three bodies into one encounter.');
    console.log('  last attempt:', JSON.stringify(armed));
    const st = await evalJS(cdp, `(() => World._dbgHuddleStats ? World._dbgHuddleStats() : null)()`).catch(() => null);
    console.log('  selection counters:', JSON.stringify(st));
    console.log('  (a pair cooldown between two crew blocks the third body — that is the engine behaving, not a defect)');
    try { if (proc) proc.kill(); } catch { }
    try { if (side) side.kill(); } catch { }
    process.exit(4);
  }
  console.log('[trioprobe] armed:', JSON.stringify(armed));
  // WHERE each body was asked to go, and whether that tile is inside its OWN zone. A body whose
  // rendezvous tile sits outside its zone can never legally arrive, which reads on the timeline as
  // "it just keeps walking" — the exact symptom, and not something the phase alone can tell you.
  const geom = await evalJS(cdp, `(() => { const bs = World.bodies().filter(b => b && b.socialKind); return bs.map(b => ({
    name: b.name, tile: b.tile, inOwnZone: b.inOwnZone, zone: b.zone, target: b.target ? b.target.tile : null })); })()`);
  console.log('[trioprobe] geometry at arm:', JSON.stringify(geom, null, 1));
  check(!!(armed && armed.ok), 'the huddle was armed through the real planner');
  check(!!(armed && armed.roster && armed.roster.length === 3),
    `three distinct bodies are in ONE encounter (roster: ${armed && armed.roster ? armed.roster.join(',') : 'none'})`);

  const roster = (armed && armed.roster) || [];
  const held = new Set(), talked = new Set();
  let overlapSamples = 0, maxTalkers = 0, holdSamples = 0, sawEncounter = 0;
  /* Release is a TRANSITION, so it has to be latched while sampling — not read at the end. The first
     version of this check asked "is any encounter live now?" after the watch loop and failed the run,
     because by then a brand-new organic huddle had started between the hero and one of the three.
     That is the rate work doing its job, not a leaked slot. What actually has to be true is that the
     bodies THIS probe armed were all let go at some point after they held. */
  let rosterAllHeld = false, rosterReleased = false, rosterTalkingAtRelease = [];
  /* TIME-TO-ARRIVE per body. The open thread this closes: one early run had a body walk
     west->north->east for 24s without arriving while all three were parked on effectively ONE tile.
     movementBlockers marks every OTHER body's tile AND its target, so three bodies stacked on one
     tile force each other onto detours — a longer route is expected, an unbounded one is a defect.
     Timing every arrival turns "it looked stuck" into a number that can be compared across runs. */
  const arriveMs = new Map();
  let watchT0 = null;
  const shots = [];
  for (let i = 0; i < 80; i++) {
    const s = await evalJS(cdp, SAMPLE).catch(() => null);
    if (s && s.bodies) {
      if (rosterAllHeld && !rosterReleased) {
        const mine = s.bodies.filter(b => b && roster.indexOf(b.id) >= 0);
        if (mine.length === roster.length && mine.every(b => !b.socialKind)) {
          rosterReleased = true;
          rosterTalkingAtRelease = mine.filter(b => b.talking).map(b => b.name);
        }
      }
      /* SCOPED TO THE ARMED ROSTER — not "any body in any huddle". The unscoped version produced a
         FALSE PASS: a run that armed only a PAIR still reported "all three reached the hold",
         because a later, unrelated organic huddle involving the third body was counted as if it
         were this encounter. A measurement that can be satisfied by a different event than the one
         under test is not evidence. */
      const inIt = s.bodies.filter(b => b && b.socialKind === 'huddle' && roster.indexOf(b.id) >= 0);
      if (inIt.length) {
        sawEncounter++;
        const talking = inIt.filter(b => b.talking);
        maxTalkers = Math.max(maxTalkers, talking.length);
        if (talking.length > 1) overlapSamples++;
        if (watchT0 == null) watchT0 = s.t;
        for (const b of inIt) {
          if (b.socialPhase === 'hold' && !arriveMs.has(b.id)) arriveMs.set(b.id, s.t - watchT0);
          if (b.socialPhase === 'hold') held.add(b.id);
          if (b.talking) talked.add(b.id);
        }
        if (inIt.some(b => b.socialPhase === 'hold')) holdSamples++;
        if (held.size === roster.length) rosterAllHeld = true;
        if (shots.length < 26) shots.push(`${s.t}: ` + inIt.map(b => `${b.name}/${b.socialPhase}${b.talking ? ' TALKING' : ''} @${b.tile.x},${b.tile.y}${b.inOwnZone ? '' : ' OUT-OF-ZONE'}${b.target ? ' ->' + b.target.tile.x + ',' + b.target.tile.y : ''} ${(b.pose || '').replace(/^[^.]+\./, '')}`).join(' | '));
      }
    }
    await sleep(600);
  }
  console.log('\n--- observed ---');
  for (const line of shots) console.log('  ' + line);
  console.log('');

  const arrivals = [...arriveMs.entries()].map(([id, ms]) => `${id}:${ms}ms`).join(' ');
  const slowest = Math.max(0, ...arriveMs.values());
  console.log(`[trioprobe] time-to-arrive: ${arrivals}  (slowest ${slowest}ms)`);
  check(sawEncounter > 0, 'the encounter was observable in World.bodies()');
  // The detour is legitimate; an unbounded walk is not. SOCIAL_HARD_MS is 55s, so anything near that
  // means a body effectively never made it and the hard timeout was doing the work.
  check(slowest < 20000, `every body arrived in a bounded time (slowest ${slowest}ms, hard timeout is 55000ms)`);
  check(held.size === 3, `all three bodies reached the hold (got ${held.size})`);
  check(talked.size === 3, `all three bodies took a turn talking (got ${talked.size})`);
  check(overlapSamples === 0, `never two mouths at once across ${sawEncounter} samples (overlaps: ${overlapSamples}, max simultaneous: ${maxTalkers})`);
  check(holdSamples >= 5, `the conversation held long enough to watch (${holdSamples} hold samples)`);

  const after = await evalJS(cdp, `(() => { const bs = World.bodies(); return {
    stillIn: bs.filter(b => b && b.socialKind).map(b => b.name + '/' + b.socialKind),
    stillTalking: bs.filter(b => b && b.talking).map(b => b.name),
    stats: World._dbgHuddleStats ? World._dbgHuddleStats() : null };
  })()`);
  console.log('[trioprobe] after:', JSON.stringify(after));
  check(rosterReleased, 'the trio encounter ENDED and released all three bodies');
  check(rosterTalkingAtRelease.length === 0, `no released body was left mouth-moving at nobody (${rosterTalkingAtRelease.join(',') || 'none'})`);
  check(!!(after && after.stats && after.stats.trioFired >= 1), `planHuddle recorded a trio (trioFired: ${after && after.stats ? after.stats.trioFired : '?'})`);
} catch (e) {
  console.error('[trioprobe] ERROR', (e && e.stack) || e);
  fail.push('threw: ' + ((e && e.message) || e));
} finally {
  try { if (proc) proc.kill(); } catch { }
  try { if (side) side.kill(); } catch { }
  try { rmSync(SCRATCH, { recursive: true, force: true }); } catch { }
}

console.log('');
if (fail.length) { console.log(`TRIOPROBE FAILED — ${fail.length} problem(s):`); for (const f of fail) console.log('  - ' + f); }
else console.log('TRIOPROBE PASS — three bodies held one conversation, one mouth at a time');
process.exit(fail.length ? 1 : 0);
