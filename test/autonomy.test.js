/* node test/autonomy.test.js — the PURE autonomy-posture engine (frontend/app/autonomy.js), Slice 1 of the
   "alive between sessions" autonomy layer.

   Locks the posture model: the two independent axes (Initiative wait→propose→leash→free × Reach
   observe→sandbox→reach), the safe default floor, tolerant clamping of corrupt/old saves, the four concrete
   awakening cadence presets (and the deliberate rule that even 'free' caps Reach at 'sandbox'), and the derived
   read surface (summary booleans + describe line). Pure + deterministic — no clock, no RNG. */
'use strict';
const A = require('./_assert.js');
const Au = require('../frontend/app/autonomy.js');

/* ---------- the axes are ascending + exported ---------- */
A.eq(Au.INITIATIVE, ['wait', 'propose', 'leash', 'free'], 'Initiative axis is wait→propose→leash→free (ascending)');
A.eq(Au.REACH, ['observe', 'sandbox', 'reach'], 'Reach axis is observe→sandbox→reach (ascending)');

/* ---------- fresh(): the safe default floor ---------- */
A.eq(Au.fresh(), { v: 1, initiative: 'wait', reach: 'sandbox', leashPerDay: 3 }, 'fresh() = fully wait-for-me, Sandbox ceiling, leash 3');

/* ---------- normalize(): tolerant hydrate, clamps to the floor per field ---------- */
A.eq(Au.normalize(null), Au.fresh(), 'normalize(null) → the safe floor, never throws');
A.eq(Au.normalize({}).initiative, 'wait', 'an empty object hydrates to the floor');
A.eq(Au.normalize({ initiative: 'bogus', reach: 'nope' }), Au.fresh(), 'out-of-enum values fall back to the floor (never an invalid posture)');
A.eq(Au.normalize({ initiative: 'free', reach: 'reach', leashPerDay: 5 }), { v: 1, initiative: 'free', reach: 'reach', leashPerDay: 5 }, 'valid values are kept');
A.eq(Au.normalize({ leashPerDay: 0 }).leashPerDay, 1, 'leashPerDay clamps up to the min (1)');
A.eq(Au.normalize({ leashPerDay: 999 }).leashPerDay, 12, 'leashPerDay clamps down to the max (12)');
A.eq(Au.normalize({ leashPerDay: 'x' }).leashPerDay, 3, 'a non-numeric leash falls back to the default (3)');
A.eq(Au.normalize({ leashPerDay: 4.6 }).leashPerDay, 5, 'a fractional leash rounds');

/* ---------- atLeast(): the ordered axis predicate the runtime gates read through ---------- */
const free = { initiative: 'free', reach: 'reach', leashPerDay: 3 };
A.eq(Au.atLeast(free, 'initiative', 'leash'), true, 'free is at-least leash');
A.eq(Au.atLeast({ initiative: 'propose' }, 'initiative', 'leash'), false, 'propose is NOT at-least leash');
A.eq(Au.atLeast({ reach: 'sandbox' }, 'reach', 'sandbox'), true, 'sandbox is at-least sandbox (inclusive)');
A.eq(Au.atLeast({ reach: 'sandbox' }, 'reach', 'reach'), false, 'sandbox is NOT at-least reach');
A.eq(Au.atLeast(free, 'bogus-axis', 'x'), false, 'an unknown axis is false, never throws');
A.eq(Au.atLeast(free, 'reach', 'bogus-level'), false, 'an unknown level is false (never accidentally true)');

/* ---------- setters: valid changes stick, invalid are ignored (posture stays valid) ---------- */
A.eq(Au.setInitiative(Au.fresh(), 'free').initiative, 'free', 'setInitiative applies a valid level');
A.eq(Au.setInitiative(Au.fresh(), 'ludicrous').initiative, 'wait', 'setInitiative ignores an invalid level');
A.eq(Au.setReach(Au.fresh(), 'reach').reach, 'reach', 'setReach applies a valid level');
A.eq(Au.setReach(Au.fresh(), 'orbit').reach, 'sandbox', 'setReach ignores an invalid level');
A.eq(Au.setLeash(Au.fresh(), 8).leashPerDay, 8, 'setLeash applies a clamped value');
A.eq(Au.setLeash(Au.fresh(), 50).leashPerDay, 12, 'setLeash clamps to the max');

/* ---------- cadencePresets(): the four concrete awakening choices ---------- */
const presets = Au.cadencePresets();
A.eq(presets.length, 4, 'exactly four cadence presets');
A.eq(presets.map(p => p.id), ['wait', 'suggest', 'build', 'free'], 'presets run least → most autonomous');
A.eq(presets.map(p => p.initiative), ['wait', 'propose', 'leash', 'free'], 'each preset maps to an ascending Initiative');
// the deliberate safety rule: even the most autonomous opening posture caps Reach at sandbox (never reach-out).
A.eq(presetsReachById('free'), 'sandbox', "'free' caps Reach at sandbox — running free never silently sends/spends");
A.eq(presetsReachById('build'), 'sandbox', "'build' writes locally (sandbox)");
A.eq(presetsReachById('suggest'), 'observe', "'suggest' only observes (proposing needs no write)");
A.eq(presetsReachById('wait'), 'observe', "'wait' observes nothing-runs");
A.ok(presets.every(p => p.label && p.label.length > 0 && Au.INITIATIVE.indexOf(p.initiative) >= 0 && Au.REACH.indexOf(p.reach) >= 0), 'every preset has a concrete label and valid axes');
function presetsReachById(id) { return Au.presetById(id).reach; }

/* ---------- applyPreset / matchPreset: round-trip ---------- */
A.eq(Au.applyPreset(Au.fresh(), 'build'), { v: 1, initiative: 'leash', reach: 'sandbox', leashPerDay: 3 }, "applyPreset('build') sets leash+sandbox, keeps leashPerDay");
A.eq(Au.applyPreset(Au.fresh(), 'ghost'), Au.fresh(), 'applyPreset(unknown id) leaves the posture unchanged (normalized)');
A.eq(Au.matchPreset(Au.applyPreset(Au.fresh(), 'free')), 'free', 'matchPreset round-trips an applied preset');
A.eq(Au.matchPreset({ initiative: 'free', reach: 'reach' }), null, 'a hand-tuned posture off any preset → matchPreset null (custom is legitimate)');
A.eq(Au.presetById('nope'), null, 'presetById(unknown) → null');

/* ---------- summary(): the derived read surface (AND of both axes, honest) ---------- */
A.eq(Au.summary(Au.fresh()).enabled, false, 'the default posture does nothing unattended (enabled:false)');
const sFree = Au.summary({ initiative: 'free', reach: 'reach' });
A.eq([sFree.actsUnattended, sFree.buildsUnattended, sFree.reachesOut], [true, true, true], 'free+reach: acts, builds, and reaches out unattended');
const sBuild = Au.summary({ initiative: 'leash', reach: 'sandbox', leashPerDay: 2 });
A.eq([sBuild.actsUnattended, sBuild.buildsUnattended, sBuild.reachesOut], [true, true, false], 'leash+sandbox: acts + builds, but never reaches out');
A.eq(sBuild.leashPerDay, 2, 'summary carries the leash allowance');
A.eq(Au.summary(Au.setLeash(Au.fresh(), 6)).leashPerDay, 6, 'a setLeash change is reflected in summary().leashPerDay (the dial reads it back)');
const sProp = Au.summary({ initiative: 'propose', reach: 'sandbox' });
A.eq([sProp.proposesOnly, sProp.actsUnattended], [true, false], 'propose: proposes only, never acts unattended (even with a sandbox ceiling)');
// the key coexistence guarantee: free INITIATIVE but only sandbox REACH → builds all day, never sends/spends.
const sFreeSandbox = Au.summary({ initiative: 'free', reach: 'sandbox' });
A.eq([sFreeSandbox.actsUnattended, sFreeSandbox.buildsUnattended, sFreeSandbox.reachesOut], [true, true, false], 'free+sandbox = productive all day, never anything irreversible (the headline coexistence)');

/* ---------- describe(): a non-empty honest line at every level ---------- */
A.ok(/waiting/i.test(Au.describe({ initiative: 'wait' })), 'describe(wait) says it waits');
A.ok(/approve|suggestions/i.test(Au.describe({ initiative: 'propose' })), 'describe(propose) says it only suggests');
A.ok(/3 small jobs/i.test(Au.describe({ initiative: 'leash', reach: 'sandbox', leashPerDay: 3 })), 'describe(leash) names the daily allowance');
A.ok(/freely toward your goals/i.test(Au.describe({ initiative: 'free', reach: 'sandbox' })), 'describe(free) says it works freely');
A.ok(/up to 7 jobs a day/i.test(Au.describe({ initiative: 'free', reach: 'sandbox', leashPerDay: 7 })), 'describe(free) also names the daily leash cap (full autonomy is honest about the pace)');
A.ok(/nothing leaves the machine/i.test(Au.describe({ initiative: 'free', reach: 'sandbox' })), 'describe(sandbox) is explicit that nothing leaves');
A.ok(/send|publish|external/i.test(Au.describe({ initiative: 'free', reach: 'reach' })), 'describe(reach) is explicit it can act externally');
A.ok(Au.describe({ initiative: 'free', reach: 'reach' }).indexOf('see everything it did') >= 0, 'describe always promises legibility (you see everything)');

/* ---------- purity / determinism ---------- */
A.eq(Au.cadencePresets(), Au.cadencePresets(), 'cadencePresets() is deterministic (no clock/RNG)');
const snap = Au.fresh(); Au.setInitiative(snap, 'free');
A.eq(snap.initiative, 'wait', 'setters do not mutate their input (return a fresh posture)');

A.report('autonomy.test');
