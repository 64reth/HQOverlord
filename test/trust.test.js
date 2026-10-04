/* node test/trust.test.js — the PURE earned-autonomy engine (frontend/app/trust.js), Growth Tier 3.
   Locks the performance→trust→offer loop's decision logic: fold (streaks/window off the same events xpstore
   folds), assess (threshold boundaries, ceilings, declined-rung negative state, grant offers), demote (earned-
   only, one rung, never below the manual floor), provenance honesty, and hydrate sanitization. All decisions
   deterministic — no clock/rng in the engine (earnedAt is injected). */
'use strict';
const A = require('./_assert.js');

const T = require('../frontend/app/trust.js');
const Autonomy = require('../frontend/app/autonomy.js');
const PG = require('../sidecar/permgrants.js');

/* ---------- 0. cross-locks: the inline axis + the grantable catalog stay in sync with their owners ---------- */
A.eq(T.INITIATIVE, Autonomy.INITIATIVE, 'trust.INITIATIVE mirrors autonomy.INITIATIVE (rung order is single-sourced by test)');
A.ok(Array.isArray(PG.GRANTABLE) && PG.GRANTABLE.indexOf('cabinet:write') >= 0, 'permgrants.GRANTABLE still carries cabinet:write (the only pre-blessable class)');

/* ---------- 1. fold: feedback drives the streaks; runs feed only the window ---------- */
let s = T.fresh();
A.eq([s.posStreak, s.negStreak, s.window.length, s.samples], [0, 0, 0, 0], 'fresh track record is clean');

const fb = (reason) => ({ name: 'memory.feedback', payload: { reason } });
const run = (reason) => ({ name: 'agent.run.end', payload: { reason } });

s = T.fold(s, fb('kept'));
s = T.fold(s, fb('work_great'));
A.eq([s.posStreak, s.negStreak, s.samples], [2, 0, 2], 'kept + work_great extend the positive streak');
s = T.fold(s, fb('work_ok'));
A.eq([s.posStreak, s.negStreak, s.samples], [2, 0, 2], 'a 👌 work_ok is NEUTRAL — it neither extends nor breaks a streak, and is not a sample');
s = T.fold(s, fb('work_miss'));
A.eq([s.posStreak, s.negStreak], [0, 1], 'a 👎 breaks the positive streak and starts the negative one');
s = T.fold(s, fb('discarded'));
A.eq(s.negStreak, 2, 'a discarded turn-in extends the negative streak');
s = T.fold(s, fb('edited'));
A.eq([s.posStreak, s.negStreak], [1, 0], 'an edited Keep is positive — it resets the negative streak');

// runs feed the window only — never the feedback streaks
const before = { pos: s.posStreak, neg: s.negStreak, win: s.window.length };
s = T.fold(s, run('done'));
A.eq([s.posStreak, s.negStreak], [before.pos, before.neg], 'a clean run never touches the feedback streaks (an unrated run is not approval)');
A.eq(s.window.length, before.win + 1, 'a clean run lands in the outcome window as a positive');
s = T.fold(s, run('error'));
A.eq(s.window[s.window.length - 1].ok, false, 'an errored run lands as a window negative');
A.eq([s.posStreak, s.negStreak], [before.pos, before.neg], '…but still never touches the feedback streaks');
const winBefore = s.window.length;
s = T.fold(s, run('cancelled'));
s = T.fold(s, run('budget'));
s = T.fold(s, run('max_iters'));
A.eq(s.window.length, winBefore, 'cancelled/budget/max_iters are not a clean signal either way (window untouched)');

// the window is FIFO-capped
let w = T.fresh();
for (let i = 0; i < T.WINDOW + 10; i++) w = T.fold(w, run('done'));
A.eq(w.window.length, T.WINDOW, 'the rolling window FIFO-caps at WINDOW');

// fold is pure — the input state is never mutated
const frozen = T.fresh();
const folded = T.fold(frozen, fb('kept'));
A.eq(frozen.posStreak, 0, 'fold never mutates its input (pure)');
A.eq(folded.posStreak, 1, '…and returns the new state');

/* ---------- 1b. the streak is capped at ONE move per runId (review fix 3) ----------
   A single turn-in deck can fold five keeps from one run — five APPROVALS, not five runs. Only the FIRST
   feedback carrying a runId moves the streak for that run; the window + samples still record every verdict. */
const fbr = (reason, runId) => ({ name: 'memory.feedback', payload: { reason, runId } });
let cap = T.fresh();
for (let i = 0; i < 5; i++) cap = T.fold(cap, fbr('kept', 'run_A'));
A.eq(cap.posStreak, 1, '5 keeps in one run → streak 1 (one move per runId)');
A.eq(cap.samples, 5, '…but every verdict still counts as a satisfaction sample');
A.eq(cap.window.length, 5, '…and every verdict still lands in the outcome window');
cap = T.fold(cap, fbr('kept', 'run_B'));
A.eq(cap.posStreak, 2, 'a keep from a DIFFERENT run moves the streak (2 runs approved = streak 2)');
cap = T.fold(cap, fbr('work_miss', 'run_B'));
A.eq([cap.posStreak, cap.negStreak], [2, 0], 'a second verdict from the SAME run cannot move the streak either way (the first decided it)');
cap = T.fold(cap, fbr('work_miss', 'run_C'));
A.eq([cap.posStreak, cap.negStreak], [0, 1], 'a miss from a new run breaks the streak normally');
cap = T.fold(cap, fb('kept'));
A.eq(cap.posStreak, 1, 'feedback with NO runId still counts each (the sidecar turn-in path today — copy says "approvals in a row" to stay honest)');
A.eq(T.sanitize({ lastStreakRun: 'run_X' }).lastStreakRun, 'run_X', 'lastStreakRun survives sanitize (the cap persists across reloads)');

/* ---------- 2. assess: the INITIATIVE offer thresholds (exact boundaries) ---------- */
// a ready track record: streak 5, no negatives
let ready5 = T.fresh();
for (let i = 0; i < 5; i++) ready5 = T.fold(ready5, fb('kept'));

// xp shape: the compute() render-state carries level/confidence/samples/tasksDone flat
const xpAt = (level, confidence, tasksDone, samples) => ({ level, confidence, samples: samples == null ? 5 : samples, tasksDone });
const ctxAt = (xp, over) => Object.assign({ xp, currentInitiative: 'wait', grants: [], grantable: ['cabinet:write'], declined: {}, earnedAt: 1000 }, over || {});

A.eq(T.assess(ready5, ctxAt(xpAt(3, 70, 10))).offer.kind, 'initiative', 'AT the boundaries (L3, 70%, 10 tasks, streak 5) the initiative offer fires');
A.eq(T.assess(ready5, ctxAt(xpAt(3, 70, 10))).offer.to, 'propose', 'the offer proposes the NEXT rung up from wait (never a jump)');
A.eq(T.assess(ready5, ctxAt(xpAt(2, 99, 99))).offer, null, 'below the level gate (L2) no offer — level is the first mechanical consumer');
A.eq(T.assess(ready5, ctxAt(xpAt(3, 69, 10))).offer, null, 'confidence 69 (one below the bar) → no offer');
A.eq(T.assess(ready5, ctxAt(xpAt(3, 70, 9))).offer, null, '9 tasks (one below the bar) → no offer');
let ready4 = T.fresh();
for (let i = 0; i < 4; i++) ready4 = T.fold(ready4, fb('kept'));
A.eq(T.assess(ready4, ctxAt(xpAt(3, 70, 10))).offer, null, 'a 4-streak (one below the bar) → no offer');
// an un-calibrated confidence meter never offers, whatever the numbers claim
A.eq(T.assess(ready5, ctxAt(xpAt(3, 90, 50, 2))).offer, null, 'below MIN_CONF_SAMPLES (calibrating) no offer ever fires');
// any active negative streak blocks an offer
let mixed = T.fresh();
for (let i = 0; i < 6; i++) mixed = T.fold(mixed, fb('kept'));
mixed = T.fold(mixed, fb('work_miss'));
A.eq(T.assess(mixed, ctxAt(xpAt(9, 95, 99))).offer, null, 'a live negative streak blocks any offer (recent approval must be clean)');

/* ---------- 3. assess: ceilings are HARD ---------- */
A.eq(T.assess(ready5, ctxAt(xpAt(9, 95, 99), { currentInitiative: 'free' })).offer.kind, 'grant', 'at free (the top rung) there is no higher initiative rung — only the grant path remains');
A.eq(T.assess(ready5, ctxAt(xpAt(4, 75, 15), { currentInitiative: 'free' })).offer, null, 'at free with the grant bars NOT met, nothing is offered');
A.eq(T.assess(ready5, ctxAt(xpAt(3, 75, 15), { currentInitiative: 'leash', ceilingInitiative: 'leash' })).offer, null, 'the caller ceiling caps the offer — never past it');
A.eq(T.assess(ready5, ctxAt(xpAt(3, 75, 15), { currentInitiative: 'propose' })).offer.to, 'leash', 'from propose the next rung is leash');
// reach is simply not a thing this engine can offer: no code path emits a reach offer
const allOffers = [
  T.assess(ready5, ctxAt(xpAt(9, 95, 99), { currentInitiative: 'wait' })).offer,
  T.assess(ready5, ctxAt(xpAt(9, 95, 99), { currentInitiative: 'leash' })).offer
].filter(Boolean);
A.ok(allOffers.every(o => o.kind === 'initiative' || o.kind === 'grant'), 'every offer is initiative|grant — reach is never offered (out of scope by construction)');

/* ---------- 4. assess: the declined-rung negative state (per level band) ---------- */
const declinedAt3 = { 'initiative:propose': 3 };
A.eq(T.assess(ready5, ctxAt(xpAt(3, 80, 20), { declined: declinedAt3 })).offer, null, 'a rung declined in this level band never re-offers in it');
A.eq(T.assess(ready5, ctxAt(xpAt(4, 80, 20), { declined: declinedAt3 })).offer.to, 'propose', 'a NEW level band re-opens the offer (earning a level is a fresh mandate)');
A.ok(T.isRungDeclined(declinedAt3, 'initiative', 'propose', 3), 'isRungDeclined: suppressed at the declined band');
A.ok(!T.isRungDeclined(declinedAt3, 'initiative', 'propose', 4), 'isRungDeclined: open at a higher band');
A.ok(!T.isRungDeclined(declinedAt3, 'initiative', 'leash', 3), 'a different rung is unaffected by the decline');

/* ---------- 5. assess: the GRANT offer (higher bars; only GRANTABLE keys; only when initiative is settled) ---------- */
const grantCtx = (xp, over) => ctxAt(xp, Object.assign({ currentInitiative: 'free' }, over || {}));   // initiative maxed → the grant path is considered
A.eq(T.assess(ready5, grantCtx(xpAt(5, 80, 20))).offer.kind, 'grant', 'AT the grant boundaries (L5, 80%, 20 tasks) the grant offer fires');
A.eq(T.assess(ready5, grantCtx(xpAt(5, 80, 20))).offer.to, 'cabinet:write', 'the grant offer proposes a GRANTABLE key only');
A.eq(T.assess(ready5, grantCtx(xpAt(4, 95, 99))).offer, null, 'below the grant level gate (L4) no grant offer');
A.eq(T.assess(ready5, grantCtx(xpAt(5, 79, 20))).offer, null, 'confidence 79 (one below the grant bar) → no grant offer');
A.eq(T.assess(ready5, grantCtx(xpAt(5, 80, 19))).offer, null, '19 tasks (one below the grant bar) → no grant offer');
A.eq(T.assess(ready5, grantCtx(xpAt(5, 80, 20), { grants: ['cabinet:write'] })).offer, null, 'an already-held grant is never re-offered');
A.eq(T.assess(ready5, grantCtx(xpAt(5, 80, 20), { grantable: [] })).offer, null, 'an empty grantable list means no grant offer ever (the curated catalog is the boundary)');
A.eq(T.assess(ready5, grantCtx(xpAt(5, 80, 20), { declined: { 'grant:cabinet:write': 5 } })).offer, null, 'a grant declined in this band never re-offers in it');
A.eq(T.assess(mixed, grantCtx(xpAt(9, 95, 99))).offer, null, 'a live negative streak blocks the grant offer too');
// the initiative raise takes precedence when both are ready (the common path first)
A.eq(T.assess(ready5, ctxAt(xpAt(6, 90, 30), { currentInitiative: 'leash' })).offer.kind, 'initiative', 'when an initiative raise is still available it is offered BEFORE a grant');

/* ---------- 6. provenance honesty ---------- */
const off = T.assess(ready5, ctxAt(xpAt(3, 82, 45), { earnedAt: 777 })).offer;
A.eq(off.provenance, { earnedAt: 777, runs: 45, confidence: 82, streak: 5 }, 'provenance = {earnedAt, runs, confidence, streak} read straight off the real state (nothing fabricated)');
A.ok(off.why.indexOf('45 tasks') >= 0 && off.why.indexOf('82%') >= 0, 'the why line quotes the real track record');
const offNoClock = T.assess(ready5, ctxAt(xpAt(3, 82, 45), { earnedAt: undefined })).offer;
A.eq(offNoClock.provenance.earnedAt, null, 'no injected clock → earnedAt is null, never a fabricated time');

/* ---------- 7. demote: earned-only, one rung, never below the manual floor ---------- */
let bad3 = T.fresh();
for (const r of ['work_miss', 'work_miss', 'work_miss']) bad3 = T.fold(bad3, fb(r));
A.eq(bad3.negStreak, 3, 'three misses = a 3 negative streak');

// no earned rung → nothing to demote, however bad the streak
A.eq(T.demote(bad3, { earned: null, xp: xpAt(3, 20, 10) }).demote, null, 'demotion only ever takes back an EARNED rung — a manual posture is untouchable');
// an earned free rung over a leash floor demotes ONE rung
const dem = T.demote(bad3, { earned: { initiative: { to: 'free', floor: 'leash' } }, xp: xpAt(3, 60, 10) }).demote;
A.eq([dem.from, dem.to], ['free', 'leash'], 'a 3-negative-streak demotes the earned rung one step');
A.ok(/rough results/.test(dem.why), "the demotion carries an explicit, honest why (never silent)");
// never below the floor: earned propose over a propose floor cannot demote below propose
A.eq(T.demote(bad3, { earned: { initiative: { to: 'propose', floor: 'propose' } }, xp: xpAt(3, 60, 10) }).demote, null, 'a rung already at the manual floor cannot demote below it');
// earned free over a WAIT floor: one rung at a time (free→leash), not a collapse to the floor
A.eq(T.demote(bad3, { earned: { initiative: { to: 'free', floor: 'wait' } }, xp: xpAt(3, 60, 10) }).demote.to, 'leash', 'demotion steps ONE rung, never a collapse');
// a 2-streak does not demote
let bad2 = T.fresh();
for (const r of ['work_miss', 'work_miss']) bad2 = T.fold(bad2, fb(r));
A.eq(T.demote(bad2, { earned: { initiative: { to: 'free', floor: 'wait' } }, xp: xpAt(3, 60, 10) }).demote, null, 'a 2-negative-streak (below the bar) does not demote');
// confidence collapse demotes even with a clean streak — but only once CALIBRATED
const calm = T.fresh();
A.eq(T.demote(calm, { earned: { initiative: { to: 'free', floor: 'wait' } }, xp: xpAt(3, 39, 10) }).demote.to, 'leash', 'a calibrated confidence collapse below 40 demotes the earned rung');
A.ok(/confidence|easing/i.test(T.demote(calm, { earned: { initiative: { to: 'free', floor: 'wait' } }, xp: xpAt(3, 39, 10) }).demote.why), 'the collapse demotion names confidence in its why');
A.eq(T.demote(calm, { earned: { initiative: { to: 'free', floor: 'wait' } }, xp: xpAt(3, 39, 10, 2) }).demote, null, 'an UN-calibrated meter (samples < MIN) never triggers a collapse demotion');
A.eq(T.demote(calm, { earned: { initiative: { to: 'free', floor: 'wait' } }, xp: xpAt(3, 40, 10) }).demote, null, 'confidence AT 40 (the floor) does not demote — strictly below only');

/* ---------- 8. xpSnapshot: reads both the raw-stats and the compute() render-state shapes ---------- */
A.eq(T.xpSnapshot({ level: 4, confidence: 71.6, samples: 5, counters: { tasksDone: 12 } }),
  { level: 4, confidence: 72, samples: 5, tasksDone: 12, known: true }, 'raw xp stats (counters.tasksDone) read correctly');
A.eq(T.xpSnapshot({ level: 4, confidence: 72, samples: 5, tasksDone: 12 }).tasksDone, 12, 'compute() render-state (flat tasksDone) reads the same');
A.eq(T.xpSnapshot(null), { level: 1, confidence: 0, samples: 0, tasksDone: 0, known: false }, 'a missing xp degrades to a level-1, unknown snapshot (fail-open: no offer)');

/* ---------- 9. hydrate sanitization: a corrupt save can never poison a decision ---------- */
const dirty = T.sanitize({ posStreak: 'lots', negStreak: -4, samples: NaN, lastConf: 900, window: [null, { ok: 'yes' }, 'x', { ok: false }] });
A.eq([dirty.posStreak, dirty.negStreak, dirty.samples, dirty.lastConf], [0, 0, 0, 100], 'non-finite / negative fields clamp clean');
A.eq(dirty.window, [{ ok: true }, { ok: false }], 'the window keeps only well-formed {ok} entries');
A.eq(T.assess({ posStreak: 1e9, negStreak: -1, window: 'junk' }, ctxAt(xpAt(3, 80, 20))).offer.kind, 'initiative', 'assess sanitizes its state input (a hand-edited save still decides sanely)');

A.report('trust.test');
