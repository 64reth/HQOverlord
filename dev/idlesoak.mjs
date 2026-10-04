#!/usr/bin/env node
// dev/idlesoak.mjs — PROOF instrument for the IDLE LIFE pass (W1 subject-facing · W2 prop verbs ·
// W3 roam radius).
//
// None of these three can be judged from a screenshot: they are STATISTICS over minutes of an
// rAF-driven engine (where does the head point, how long is a body at a prop, does it ever leave
// its room). rAF does not run in the preview tab at all, so this boots the real app in headless
// Chrome, lets the world live, and samples World.bodies() on a fixed cadence.
//
// What it measures, per body:
//   FACING   — what is ONE TILE in front of the nose while idle and standing still:
//              wall | prop | belt | body | open. 'wall' is the defect this pass removed.
//   ROOM     — inOwnZone (containment must never break) and inHomeRoom (false = it walked next
//              door on its roam radius, which is the W3 promise).
//   BEATS    — the goals/quirks/prop-kinds actually reached, and gesture emotes actually played.
//
// Usage:  node dev/idlesoak.mjs [--port 8941] [--cdp 9341] [--minutes 4] [--crew 2]
// Exits nonzero if containment breaks or the wall-stare rate is above the bar.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { sleep, launchChrome, connectCDP, evalJS } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, isUp, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const arg = (flag, dflt) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : dflt; };
const PORT = arg('--port', '8941');
const CDP_PORT = Number(arg('--cdp', '9341'));
const MINUTES = Number(arg('--minutes', '4'));
const CREW = Number(arg('--crew', '2'));
const OUT = arg('--out', join(process.cwd(), '.idlesoak'));
const KITNAME = arg('--kit', 'mixed');   // 'lounge' = Andrew's own layout (one room; couch+tv, arcade, pinball, bar+stools)
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SCRATCH = join(OUT, '_seed-workspace');
mkdirSync(OUT, { recursive: true });

// ── the sample: one read of the whole floor, no side effects ────────────────────────────────────
const SAMPLE = `(() => {
  if (typeof World === 'undefined' || typeof World.bodies !== 'function') return { err: 'no World.bodies' };
  return { t: Math.round(performance.now()), bodies: World.bodies() };
})()`;

// BUILD MARKER — a live check must prove it is talking to MY build, not another agent's server that
// happens to answer on this port (the 2026-08-07 lesson: waitUp() true != your server).
const MARKER = `(() => { try {
  const b = (typeof World !== 'undefined' && World.bodies) ? World.bodies()[0] : null;
  return { roam: (typeof Zones !== 'undefined' && Zones.ROAM_RADIUS) || null, facing: !!(b && ('facing' in b)) };
} catch (e) { return { err: String(e) }; } })()`;

/* BUILD A REAL FLOOR before soaking. The dev seed's station is a SINGLE bare room with no leisure
   props, which cannot exercise W2 (per-prop beats) or W3 (roam into the next room) at all — a soak
   on it would report a green nothing. This lays a second room sharing an edge with the first (the
   model auto-opens a threshold on any zone seam) and scatters real catalog props through both,
   through the SAME validated mutation API the REFIT editor uses. */
const BUILD = `(() => { try {
  const KIT_NAME = ${JSON.stringify(KITNAME)};
  const st = (typeof Build !== 'undefined' && Build.__test__ && Build.__test__.station && Build.__test__.station()) || null;
  if (!st) return { err: 'no station' };
  const rooms = st.rooms();
  if (!rooms.length) return { err: 'no rooms' };
  const r0 = rooms[0].rects[0];
  const out = { home: r0, added: null, props: [] };
  // a second room to the EAST, same height, 10 wide — sharing r0's east edge so a door opens
  const nx1 = r0.x2 + 1, nx2 = r0.x2 + 10;
  const oneRoom = KIT_NAME === 'lounge';   // Andrew's station is ONE room — don't add a second one for that case
  const can = oneRoom ? { ok: false } : st.canPlaceRoom ? st.canPlaceRoom([{ x1: nx1, y1: r0.y1, x2: nx2, y2: r0.y2 }], 'hab') : { ok: true };
  if (can && can.ok !== false) {
    const res = st.addRoom({ kind: 'hab', rect: { x1: nx1, y1: r0.y1, x2: nx2, y2: r0.y2 } });
    out.added = res && res.ok ? { x1: nx1, y1: r0.y1, x2: nx2, y2: r0.y2 } : (res && res.reason) || 'addRoom failed';
  } else out.added = 'canPlaceRoom: ' + JSON.stringify(can);
  // leisure kit, spread over BOTH rooms (each entry: type, w, h). KIT=lounge mirrors Andrew's own
  // station (2026-08-08): one room, couch+tv, arcade, pinball, bar + stools — the layout the
  // "they never use my lounge" report came from, so the measurement is of HIS case, not a fixture's.
  const LOUNGE = [['couch',5,1],['tv',3,1],['arcade',1,2],['pinball',1,2],['longtable',3,1],['chair',1,1]];   // bar + its stools are placed adjacently below
  const MIXED = [['bookshelf',2,1],['arcade',1,2],['fishtank',2,1],['coffee',1,1],['jukebox',1,2],['pinball',1,2],['terrarium',1,1],['quarters_vending',1,2]];
  const KIT = KIT_NAME === 'lounge' ? LOUNGE : MIXED;
  const spotGroups = [r0, out.added && out.added.x1 != null ? out.added : null].filter(Boolean).map(rr => {
    const group = [];
    for (let i = 0; i < 8; i++) group.push({ x: rr.x1 + 2 + ((i * 3) % Math.max(1, rr.x2 - rr.x1 - 3)), y: rr.y1 + 1 + (i % Math.max(1, rr.y2 - rr.y1 - 1)) });
    return group;
  });
  // Interleave rooms. The old room-major list put all eight MIXED props in the first room, so its
  // supposedly cross-room soak could pass without a single attractive destination next door.
  const spots = [];
  for (let i = 0; i < 8; i++) for (const group of spotGroups) spots.push(group[i]);
  let si = 0;
  // the LOUNGE kit lays its stools directly against the bar, the way a person actually builds a bar
  // — that adjacency is what routes an agent to SIT at it (stoolAt/counterFace) rather than stand.
  if (KIT_NAME === 'lounge') {
    const bx = r0.x1 + 3, by = r0.y1 + 1;
    if (st.addProp({ t: 'bar', x: bx, y: by, w: 4, h: 1, block: true }).ok) {
      out.props.push('bar@' + bx + ',' + by);
      for (let i = 0; i < 3; i++) {
        const sx = bx + i, sy = by + 1;
        const ok = st.canPlaceProp ? st.canPlaceProp('stool', sx, sy, 1, 1) : { ok: true };
        if (ok && ok.ok !== false && st.addProp({ t: 'stool', x: sx, y: sy, w: 1, h: 1, block: true }).ok) out.props.push('stool@' + sx + ',' + sy);
      }
    }
  }
  for (const [t, w, h] of KIT) {
    for (let tries = 0; tries < spots.length; tries++) {
      const s = spots[(si++) % spots.length];
      const ok = st.canPlaceProp ? st.canPlaceProp(t, s.x, s.y, w, h) : { ok: true };
      if (!ok || ok.ok === false) continue;
      const res = st.addProp({ t, x: s.x, y: s.y, w, h, block: true });
      if (res && res.ok) { out.props.push(t + '@' + s.x + ',' + s.y); break; }
    }
  }
  return out;
} catch (e) { return { err: String(e && e.stack || e) }; } })()`;

const pct = (n, d) => (d ? +(100 * n / d).toFixed(1) : 0);

class SoakExit extends Error { constructor(code, message) { super(message); this.code = code; } }
const stop = (code, message) => { throw new SoakExit(code, message); };
let proc = null, side = null, cdp = null, builtFloor = null, exitCode = null;
const fail = [];
try {
  if (await isUp(APP_URL)) stop(2, `[idlesoak] ${APP_URL} already answers — someone else owns that port; pick another (--port)`);
  rmSync(SCRATCH, { recursive: true, force: true });
  materializeSeedWorkspace(SCRATCH);
  side = bootSeededSidecar({ port: PORT, scratchDir: SCRATCH });
  if (!(await waitUp(APP_URL))) throw new Error('seeded sidecar never came up on :' + PORT);

  ({ proc } = launchChrome({ cdpPort: CDP_PORT, win: '1440,900', profileDir: join(OUT, '_profile') }));
  cdp = await connectCDP(CDP_PORT);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  /* Throttle rAF BEFORE boot: a software-rendered station canvas at full tilt starves every
     Runtime.evaluate (the documented headless gotcha). 10fps is deliberate and costs nothing in
     fidelity — every timer in the idle engine is WALL-CLOCK (performance.now), not frame-counted,
     so behaviour advances at the same rate either way; the frames we skip are only redraws. The
     cheaper draw loop is what keeps the sampler responsive when the machine is busy (see the
     starvation guard at the end: a starved run reports INCONCLUSIVE, never a green nothing). */
  const FRAME_MS = Number(arg('--frame-ms', '100'));
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), ${FRAME_MS}); window.cancelAnimationFrame = (id) => clearTimeout(id);`,
  });
  await cdp.send('Page.navigate', { url: APP_URL });
  if (!(await waitDevReady(cdp, evalJS, { tries: 30, url: APP_URL }))) throw new Error('never reached the in-game floor');
  await sleep(5000);

  const marker = await evalJS(cdp, MARKER);
  if (!marker || !marker.roam || !marker.facing) {
    stop(3, '[idlesoak] BUILD MARKER MISSING — this page is not the idle-life build: ' + JSON.stringify(marker));
  }
  console.log(`[idlesoak] build marker ok (Zones.ROAM_RADIUS=${marker.roam}, bodies().facing present)`);

  // lay a real floor (a second room + leisure kit) unless told not to
  if (process.argv.indexOf('--no-build') < 0) {
    builtFloor = await evalJS(cdp, BUILD);
    console.log('[idlesoak] floor:', JSON.stringify(builtFloor));
    if (!builtFloor || builtFloor.err) throw new Error('floor build failed: ' + JSON.stringify(builtFloor));
    if (KITNAME !== 'lounge' && !(builtFloor.added && builtFloor.added.x1 != null)) {
      throw new Error('mixed soak requires a real second room: ' + JSON.stringify(builtFloor.added));
    }
    await sleep(2500);
  }

  // put crew on the floor so the roam radius + neighbour-facing have something to be true about
  for (let i = 0; i < CREW; i++) {
    await evalJS(cdp, `(() => { World.spawnAgent({ id: 'probe${i}', name: 'PROBE${i}', color: '#77ffdd' }); return true; })()`);
    await sleep(500);
  }

  /* --pair: keep nudging two crew bodies together until an encounter fires. W4's beat needs two
     eligible bodies within SOCIAL_NEAR_RADIUS at the moment one of them re-decides; waiting for
     that to happen by chance costs many minutes of soak, and on a loaded machine (other agents'
     gates competing for the CPU) the world ticks slowly enough that it may not happen at all. This
     removes the WAITING, not the beat: the encounter still has to be selected, planned, walked and
     held by the shipped engine — we only put the two of them in the same place. */
  const PAIR = process.argv.indexOf('--pair') > -1;
  /* W5: gather EVERY free crew body around the first one, not just one partner. A trio needs three
     bodies inside SOCIAL_NEAR_RADIUS of the decider at the same instant; nudging only one of them
     would mean the third-body branch is never even reachable and the run could not tell "the trio
     code is broken" apart from "the third body was across the room". Offsets are the same few pixels
     the proven two-body nudge used, just distinct per body; containBody and the huddle planner are
     what resolve them onto real walkable tiles. The engine still has to select, plan, walk and hold
     the encounter — this removes the WAITING, not the beat. */
  const NUDGE = `(() => { try {
    const bs = World.bodies().filter(b => b && !b.hero && !b.unplaced);
    if (bs.length < 2) return 'need 2 crew';
    if (bs.some(b => b.socialKind)) return 'in encounter';
    const [a, ...rest] = bs;
    if (a.working || a.sitting) return 'busy';
    const off = [[3, 3], [-3, 3], [3, -3], [-3, -3]];
    let moved = 0;
    rest.forEach((b, i) => {
      if (b.working || b.sitting) return;
      const o = off[i % off.length];
      if (World._dbgTeleport(b.id, a.px + o[0], a.py + o[1])) moved++;
    });
    return moved ? ('nudged ' + moved) : 'teleport refused';
  } catch (e) { return 'err ' + e; } })()`;

  const t0 = Date.now(), END = t0 + MINUTES * 60000, samples = [];
  let seenEncounter = false, nextNudge = t0 + 8000;
  while (Date.now() < END) {
    const s = await evalJS(cdp, SAMPLE).catch(() => null);
    if (s && s.bodies) {
      samples.push(s);
      if (s.bodies.some(b => b && b.socialKind)) seenEncounter = true;
      /* Nudge for the WHOLE run, not only until the first encounter. The original stopped at
         `!seenEncounter`, which was right when the question was "does a meeting ever happen" — but
         a 3-crew floor answers that within seconds (the first run of this soak fired a huddle at
         ~10s and so never nudged at all), and then the bodies drift apart again and no THIRD body
         is ever standing near a huddle. NUDGE self-guards: it returns 'in encounter' while one is
         live, so re-arming it cannot interrupt a beat. */
      if (PAIR && Date.now() >= nextNudge) {
        nextNudge = Date.now() + 8000;
        const r = await evalJS(cdp, NUDGE).catch(() => 'eval failed');
        console.log('[idlesoak] nudge:', r);
      }
    }
    if (samples.length % 40 === 0) console.log(`[idlesoak] ${samples.length} samples · ${Math.round((END - Date.now()) / 1000)}s left`);
    await sleep(900);
  }

  // ── reduce ──────────────────────────────────────────────────────────────────────────────────
  // W4 encounters are counted as EDGES, not samples: a body is credited with one encounter each time
  // its socialKind goes null -> set, and one CONVERSATION each time its phase reaches 'hold' on a
  // two-sided kind. Sample counts alone would just report "how long they stood there".
  const prevSocial = new Map();
  const encounters = { total: 0, byKind: {}, conversations: 0 };
  for (const s of samples) {
    for (const b of s.bodies) {
      if (!b) continue;
      const was = prevSocial.get(b.id) || { kind: null, held: false };
      if (b.socialKind && !was.kind) { encounters.total++; encounters.byKind[b.socialKind] = (encounters.byKind[b.socialKind] || 0) + 1; }
      const held = !!(b.socialKind && b.socialPhase === 'hold');
      if (held && !was.held && (b.socialKind === 'huddle' || b.socialKind === 'border')) encounters.conversations++;
      prevSocial.set(b.id, { kind: b.socialKind || null, held });
    }
  }

  /* W5 — the counters above are PER BODY, which is exactly the wrong unit once an encounter can hold
     three of them: a trio would post 3 "conversations" and read as 50% more social life than a pair
     when it is ONE conversation with an extra mouth in it. These are per-EVENT, keyed off the run of
     samples in which any body is in a talking beat:
       parties        how many talking encounters happened, bucketed by how many bodies were in them
       maxTalkers     the most bodies ever simultaneously mouth-moving — MUST be 1. A trio's whole
                      claim is round-robin turn-taking; 2 here means they talk over each other and
                      the beat is a crowd, not a conversation. This is a violation, not a stat.
       trioProved     a talking encounter with 3 distinct bodies actually reached the hold */
  const parties = {}; let maxTalkers = 0, trioProved = false, cur = null;
  const flush = () => {
    if (cur && cur.held) {
      parties[cur.ids.size] = (parties[cur.ids.size] || 0) + 1;
      if (cur.ids.size >= 3) trioProved = true;
    }
    cur = null;
  };
  for (const s of samples) {
    const talkers = s.bodies.filter(b => b && (b.socialKind === 'huddle' || b.socialKind === 'border'));
    if (!talkers.length) { flush(); continue; }
    maxTalkers = Math.max(maxTalkers, talkers.filter(b => b.talking).length);
    if (!cur) cur = { ids: new Set(), held: false };
    for (const b of talkers) cur.ids.add(b.id);
    if (talkers.some(b => b.socialPhase === 'hold')) cur.held = true;
  }
  flush();
  encounters.parties = parties;                 // { "2": n, "3": n }
  encounters.maxSimultaneousTalkers = maxTalkers;
  encounters.trioProved = trioProved;

  /* WAS A TRIO EVEN POSSIBLE? Without this the run cannot tell "the third-body code never fires"
     apart from "three bodies were never standing together", and those two call for opposite next
     moves. A trio needs three bodies that are all eligible AND all within SOCIAL_NEAR_RADIUS of the
     one deciding, at the same instant — so count the samples where some body had >= 2 eligible
     others inside that radius. Tile Chebyshev distance, matching neighborsOf's own radius test.
     (This is an UPPER bound: it ignores the same-zone requirement, which it cannot see from here.
     A zero here means the opportunity provably never arose; a non-zero does not by itself mean it
     did — so it can falsify, never confirm.) */
  const NEAR = 8;
  let trioOpportunities = 0, maxCluster = 0;
  const eligible = (b) => b && !b.unplaced && !b.working && !b.sitting && !b.socialKind && b.state !== 'walk';
  for (const s of samples) {
    const free = s.bodies.filter(eligible);
    let best = 0;
    for (const a of free) {
      const n = free.filter(o => o !== a
        && Math.max(Math.abs(o.tile.x - a.tile.x), Math.abs(o.tile.y - a.tile.y)) <= NEAR).length;
      best = Math.max(best, n + 1);
    }
    maxCluster = Math.max(maxCluster, best);
    if (best >= 3) trioOpportunities++;
  }
  encounters.trioOpportunitySamples = trioOpportunities;
  encounters.maxEligibleCluster = maxCluster;

  /* DUTY CYCLE — the number that decides whether the pace is right, and the one a per-encounter
     COUNT cannot tell you. "6 conversations in 7 minutes" sounds modest; if each runs 25s that is a
     third of the time with two agents standing around talking, which on a station whose whole point
     is that it does real work reads as slacking rather than as life. Counted over samples: the share
     of the run in which a talking encounter was live at all, and the share in which somebody was
     actually mouth-moving. */
  let convSamples = 0, mouthSamples = 0;
  for (const s of samples) {
    const talkers = s.bodies.filter(b => b && (b.socialKind === 'huddle' || b.socialKind === 'border'));
    if (talkers.length) convSamples++;
    if (talkers.some(b => b.talking)) mouthSamples++;
  }
  encounters.conversationDutyPct = pct(convSamples, samples.length);
  encounters.mouthMovingDutyPct = pct(mouthSamples, samples.length);

  // the SHAPE of the encounter, not just that one happened: who was in it, what phase, who had the
  // floor, and the sprite track each was drawn in. This is the W4 evidence — a conversation is a
  // sequence, so a count could never show it.
  const timeline = [];
  for (const s of samples) {
    const inIt = s.bodies.filter(b => b && b.socialKind);
    if (!inIt.length || timeline.length >= 80) continue;
    timeline.push({
      t: s.t,
      who: inIt.map(b => `${b.name}:${b.socialKind}/${b.socialPhase}${b.talking ? ' TALKING' : ''} ${(b.pose || '').replace(/^[^.]+\./, '')}`),
    });
  }

  const per = new Map();
  let couchTvSeatSamples = 0, sharedBarSamples = 0, maxBarSitters = 0;
  // ONE MACHINE, ONE PLAYER (2026-08-10): two bodies sharing the same usingProp id at the same
  // instant is the shoulder-to-shoulder-at-the-arcade bug. A couch legitimately shares its id
  // (several cushions, one prop); every other kind is single-occupant, seats included (one stool,
  // one id). Recorded as a hard violation, not a stat.
  const sharedMachine = new Map();   // propId -> worst simultaneous occupant count
  for (const s of samples) {
    const barSitters = s.bodies.filter(b => b && b.sitting && b.seated && b.facingProp && b.facingProp.useKind === 'bar');
    maxBarSitters = Math.max(maxBarSitters, barSitters.length);
    if (barSitters.length >= 2) sharedBarSamples++;
    const users = new Map();
    for (const b of s.bodies) {
      if (!b || b.unplaced || !b.usingProp || b.useKind === 'couch') continue;
      users.set(b.usingProp, (users.get(b.usingProp) || 0) + 1);
    }
    for (const [pid, n] of users) if (n >= 2) sharedMachine.set(pid, Math.max(sharedMachine.get(pid) || 0, n));
    for (const b of s.bodies) {
      if (!b || b.unplaced) continue;
      if (b.goal === 'lounge' && b.useKind === 'couch' && b.sitting && b.seated) couchTvSeatSamples++;
      b.__t = s.t;
      let r = per.get(b.id);
      if (!r) { r = { id: b.id, name: b.name, n: 0, still: 0, wallDirSum: 0, facing: {}, goals: {}, quirks: {}, useKinds: {}, emotes: 0, talking: 0, posesGesture: 0, posesTalk: 0, visits: {}, dwellMs: {}, prevUse: null, visitStart: null, seatSamples: 0, seatFacingCounter: 0, outZone: 0, nextDoor: 0, tiles: new Set() }; per.set(b.id, r); }
      r.n++;
      r.tiles.add(b.tile.x + ',' + b.tile.y);
      if (!b.inOwnZone) r.outZone++;
      if (b.inOwnZone && b.inHomeRoom === false) r.nextDoor++;
      if (b.emote) r.emotes++;
      if (b.talking) r.talking++;
      // RENDER TRUTH: the pose the body was last actually drawn in (assets.js records it).
      if (b.pose && b.pose.indexOf('.gesture.') !== -1) r.posesGesture++;
      if (b.pose && b.pose.indexOf('.talk.') !== -1) r.posesTalk++;
      if (b.goal) r.goals[b.goal] = (r.goals[b.goal] || 0) + 1;
      if (b.quirkKind) r.quirks[b.quirkKind] = (r.quirks[b.quirkKind] || 0) + 1;
      if (b.useKind) r.useKinds[b.useKind] = (r.useKinds[b.useKind] || 0) + 1;
      // VISITS, not samples: "does it stay at the arcade for more than five seconds" is a question
      // about one visit, and a sample count conflates ten short visits with one long one.
      const prevK = r.prevUse || null, curK = b.useKind || null;
      if (curK && curK !== prevK) { r.visits[curK] = (r.visits[curK] || 0) + 1; r.visitStart = b.__t; }
      if (prevK && curK !== prevK && r.visitStart != null) {
        const ms = (b.__t - r.visitStart);
        if (ms > 0) { r.dwellMs[prevK] = (r.dwellMs[prevK] || 0) + ms; }
        r.visitStart = curK ? b.__t : null;
      }
      r.prevUse = curK;
      // a body sitting AT a counter (stool) with the counter in front of it — the bar-stool proof
      if (b.useKind === 'seat' && b.sitting) { r.seatSamples++; if (b.facingCounter) r.seatFacingCounter++; }
      // FACING is only meaningful for a body STANDING STILL and not working: a walker's facing is
      // its heading, and a seated worker faces its own desk by design (out of scope for this pass).
      if (!b.moving && b.state !== 'walk' && !b.working && !b.sitting && b.facing) {
        r.still++; r.facing[b.facing] = (r.facing[b.facing] || 0) + 1;
        if (b.wallDirs != null) r.wallDirSum += b.wallDirs;   // the blind-pick control (see wallDirsAt)
      }
    }
  }

  const report = {
    minutes: MINUTES, samples: samples.length, floor: builtFloor, encounters, encounterTimeline: timeline,
    requestedBehaviors: { couchTvSeatSamples, sharedBarSamples, maxBarSitters },
    sharedMachines: Object.fromEntries(sharedMachine),   // propId -> worst simultaneous occupants (must be empty)
    bodies: []
  };
  for (const r of per.values()) {
    report.bodies.push({
      id: r.id, name: r.name, samples: r.n, stillSamples: r.still,
      wallPct: pct(r.facing.wall || 0, r.still),
      blindPickWallPct: r.still ? +(100 * (r.wallDirSum / r.still) / 4).toFixed(1) : 0,   // what a blind cardinal pick WOULD have scored on these same tiles
      facing: r.facing,
      distinctTiles: r.tiles.size, outOfZone: r.outZone, nextDoorSamples: r.nextDoor,
      goals: r.goals, quirks: r.quirks, useKinds: r.useKinds, emoteSamples: r.emotes, talkingSamples: r.talking, drawnGesture: r.posesGesture, drawnTalk: r.posesTalk,
        visits: r.visits, meanDwellSec: Object.fromEntries(Object.entries(r.dwellMs).map(([k,v]) => [k, +(v/1000/Math.max(1,r.visits[k]||1)).toFixed(1)])),
        seatSamples: r.seatSamples, seatFacingCounter: r.seatFacingCounter,
    });
  }
  report.samplesPerMin = +(report.samples / MINUTES).toFixed(1);   // stamped BEFORE the write, or the saved report lies about its own health
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log('\n=== IDLE SOAK ===');
  console.log(JSON.stringify(report, null, 2));

  /* STARVATION GUARD. This harness competes with whatever else the machine is running (on this
     project, other agents' full test gates), and a starved page ticks the world far slower than the
     wall clock: a run that managed 394 samples in 6 minutes when the box was free managed 66 in the
     same 6 minutes when it was not. A starved run is NOT a green run — the beats simply never got
     the CPU to happen — so it must report INCONCLUSIVE rather than let a wall-stare rate of 0% over
     nine idle bodies-worth of nothing read as proof. */
  const rate = report.samplesPerMin;
  if (rate < 25) {
    console.log(`\nINCONCLUSIVE: ${report.samplesPerMin} samples/min (healthy is 60+). The page was starved — the world barely ticked, so an empty report means nothing. Re-run when the machine is free.`);
    exitCode = 4;
  } else {
    for (const b of report.bodies) {
      if (b.outOfZone > 0) fail.push(`${b.name}: ${b.outOfZone} samples OUT of its zone (containment)`);
      if (b.stillSamples >= 20 && b.wallPct > 12) fail.push(`${b.name}: ${b.wallPct}% of still samples nose-to-wall (bar: <=12%)`);
    }
    for (const [pid, n] of sharedMachine) fail.push(`${n} bodies shared machine ${pid} at the same instant (one machine, one player)`);
    if (KITNAME !== 'lounge' && builtFloor && builtFloor.added && !report.bodies.some(b => b.nextDoorSamples > 0)) {
      fail.push('mixed two-room soak observed no body cross into the directly connected room (W3 unproven)');
    }
    // W4/W5 bars — only meaningful on a multi-body floor of a decent length
    if (CREW >= 2 && MINUTES >= 5) {
      if (!encounters.total) fail.push('no social encounter fired at all in ' + MINUTES + ' minutes on a ' + (CREW + 1) + '-body floor');
      const talked = report.bodies.reduce((n, b) => n + b.talkingSamples, 0);
      if (encounters.conversations > 0 && !talked) fail.push('a two-sided encounter reached its hold but NOBODY ever took a turn (the talk pose never fired)');
    }
  }
  if (exitCode == null) console.log(fail.length ? `\nFAIL:\n - ${fail.join('\n - ')}` : '\nPASS: no containment breaks, wall-stare under the bar');
} catch (e) {
  console.error(e instanceof SoakExit ? e.message : '[idlesoak]', e instanceof SoakExit ? '' : e);
  if (e instanceof SoakExit) exitCode = e.code;
  else fail.push(String(e && e.message || e));
} finally {
  try { if (proc) proc.kill(); } catch { }
  try { if (side) side.kill(); } catch { }
}
process.exit(exitCode != null ? exitCode : (fail.length ? 1 : 0));
