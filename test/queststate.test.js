/* node test/queststate.test.js — the pure durable-quest-memory engine (frontend/app/queststate.js).
   Locks the G1a contract: first sight is baseline (a quest already done backfills completedAt, NEVER
   celebrates — no celebration storm on resume); an open→done diff celebrates exactly once and stamps
   completedAt; dismissed = stop forever (never re-renders, never re-fires, even when the underlying thing
   later completes); only dossier "get to know you" quests are dismissible — milestones are achievements.
   Pure + deterministic: the clock is injected, so every timestamp is asserted exactly. */
'use strict';
const A = require('./_assert.js');
const QS = require('../frontend/app/queststate.js');

const q = (id, status, kind) => ({ id, status, kind: kind || (id.indexOf('dim:') === 0 ? 'dossier' : 'milestone'), title: 'T ' + id, reward: 'real work' });

/* ---------- fresh / hydrate are defensive ---------- */
let s = QS.hydrate(null);
A.ok(s && s.v === 1 && s.seen && s.dismissed, 'hydrate(null) → a fresh, well-formed state');
const junk = QS.hydrate({ v: 9, seen: { a: null, b: {}, c: { firstSeenAt: 'x' }, ok: { firstSeenAt: 5, completedAt: 'nope', lastStatus: 'weird' } }, dismissed: { d: 'NaN', e: 7 } });
A.eq(Object.keys(junk.seen), ['ok'], 'hydrate drops malformed seen entries, keeps the valid one');
A.eq(junk.seen.ok, { firstSeenAt: 5, completedAt: null, lastStatus: 'open' }, 'hydrate sanitizes completedAt/lastStatus');
A.eq(Object.keys(junk.dismissed), ['e'], 'hydrate drops non-numeric dismissal stamps');

/* ---------- epoch-0 hydrate fix: a null/undefined/junk completedAt is ABSENT, never resurrected to 1969 ----------
   The bug: Number(null)===0 (finite), so the old hydrate kept 0 — a never-completed quest rendered as
   "completed 1969". A stored 0 from that bug window must migrate to null (done, DATE UNKNOWN), not 1969. */
const nul = QS.hydrate({ seen: {
  openNull:  { firstSeenAt: 100, completedAt: null,      lastStatus: 'open' },   // never completed → stays absent
  openUndef: { firstSeenAt: 100,                          lastStatus: 'open' },   // undefined → absent
  bugZero:   { firstSeenAt: 100, completedAt: 0,         lastStatus: 'done' },   // pre-fix persisted 0 → absent (done, date unknown)
  realDone:  { firstSeenAt: 100, completedAt: 1751000000000, lastStatus: 'done' } // a genuine ms stamp → preserved exactly
} });
A.eq(nul.seen.openNull.completedAt, null, 'a null completedAt hydrates as absent (not epoch-0 → not 1969)');
A.eq(nul.seen.openUndef.completedAt, null, 'an undefined completedAt hydrates as absent');
A.eq(nul.seen.bugZero.completedAt, null, 'a pre-fix persisted 0 migrates to absent — "completed, date unknown", never 1969');
A.eq(nul.seen.bugZero.lastStatus, 'done', '…and the bug-window quest stays DONE (only the fabricated date is dropped)');
A.eq(nul.seen.realDone.completedAt, 1751000000000, 'a genuine completedAt survives untouched');
// a migrated 0 must not be re-stamped by the next fold (the quest is already done — no phantom re-completion)
const mig = QS.hydrate({ seen: { 'ms:x': { firstSeenAt: 100, completedAt: 0, lastStatus: 'done' } } });
const rmig = QS.fold(mig, [q('ms:x', 'done')], 5000);
A.eq(rmig.completions, [], 're-folding a migrated (done, date-unknown) quest never celebrates or re-stamps');
A.eq(QS.stateOf(mig, 'ms:x').completedAt, null, '…and its completedAt stays absent (honest: date unknown, not now)');

/* ---------- first sight = baseline, never a celebration ---------- */
s = QS.fresh();
let r = QS.fold(s, [q('dim:goals', 'open'), q('ms:first_light', 'done')], 1000);
A.eq(r.completions, [], 'first sight never celebrates — even a quest first seen done (resume backfill)');
A.eq(QS.stateOf(s, 'dim:goals'), { firstSeenAt: 1000, completedAt: null, lastStatus: 'open', dismissedAt: null }, 'an open quest records firstSeenAt only');
A.eq(QS.stateOf(s, 'ms:first_light').completedAt, 1000, 'done-at-first-sight backfills completedAt for the future trophy case');

/* ---------- D3: first-seen-DONE — silent on a FRESH state, celebrated on an EXISTING one ----------
   The discriminator is state freshness (seen empty before the fold). A first-ever sync backfills old history
   SILENTLY (no 15-celebration storm on first boot / on resuming a save). But once the state exists, a quest
   that appears already done is an AWAY completion the fold never saw open→done live — it IS a completion the
   Commander earned, so it celebrates exactly once (the persistent notify record is its receipt). */
(() => {
  // FRESH state: every already-done quest is silent baseline (this is the first sync — it's all old history).
  const fresh = QS.fresh();
  const rf = QS.fold(fresh, [q('ms:a', 'done'), q('ms:b', 'done'), q('dim:x', 'open')], 1000);
  A.eq(rf.completions, [], 'a fresh state backfills first-seen-done quests SILENTLY (no first-boot celebration storm)');
  A.eq(QS.stateOf(fresh, 'ms:a').completedAt, 1000, '…but still records completedAt for the trophy case');
})();
(() => {
  // EXISTING state: one quest already tracked, then a NEW quest shows up already done → an away completion.
  const existing = QS.fresh();
  QS.fold(existing, [q('dim:x', 'open')], 1000);                       // state is now non-fresh (has a seen entry)
  const re = QS.fold(existing, [q('dim:x', 'open'), q('ms:away', 'done')], 2000);
  A.eq(re.completions.length, 1, 'on an EXISTING state a first-seen-done quest celebrates (an away completion)');
  A.eq(re.completions[0].id, 'ms:away', '…and it is the away-completed quest that is returned');
  A.eq(QS.stateOf(existing, 'ms:away').completedAt, 2000, '…with completedAt stamped at the fold that observed it');
  const re2 = QS.fold(existing, [q('ms:away', 'done')], 3000);
  A.eq(re2.completions, [], '…and it never celebrates again (one completion per away edge)');
})();

/* ---------- open→done celebrates exactly once, with completedAt ---------- */
r = QS.fold(s, [q('dim:goals', 'done'), q('ms:first_light', 'done')], 2000);
A.eq(r.completions.length, 1, 'exactly one completion on the open→done edge');
A.eq(r.completions[0].id, 'dim:goals', 'the transitioned quest is the completion');
A.eq(QS.stateOf(s, 'dim:goals').completedAt, 2000, 'completedAt is stamped at the transition');
r = QS.fold(s, [q('dim:goals', 'done'), q('ms:first_light', 'done')], 3000);
A.eq(r.completions, [], 'the same projection folded again is silent — one celebration per completion');
A.eq(QS.stateOf(s, 'dim:goals').completedAt, 2000, 'completedAt is not re-stamped by a repeat fold');

/* ---------- FIX 3: several gaps closing in ONE fold each celebrate individually (fast placement burst) ----
   two station gaps first seen open, then both done in the same fold — the fold must return BOTH as separate
   completions (never coalesced into one), so each rides its own celebrate() call. This is why a placement can
   drive pokeQuests() the instant a prop lands even when a burst closes several quests together. */
(() => {
  const s2 = QS.hydrate(null);
  QS.fold(s2, [q('sq:a:dish', 'open'), q('sq:b:cabinet', 'open')], 1000);   // baseline: both open
  const burst = QS.fold(s2, [q('sq:a:dish', 'done'), q('sq:b:cabinet', 'done')], 1100);
  A.eq(burst.completions.length, 2, 'two gaps closing in the same fold → TWO completions, each celebrated on its own');
  A.ok(burst.completions.some(c => c.id === 'sq:a:dish') && burst.completions.some(c => c.id === 'sq:b:cabinet'), 'both transitioned quests are returned individually (never coalesced)');
})();

/* ---------- a real regression then a real re-completion celebrates again ---------- */
r = QS.fold(s, [q('dim:goals', 'open')], 4000);
A.eq(r.completions, [], 'done→open (e.g. a forgotten belief) never celebrates');
A.eq(QS.stateOf(s, 'dim:goals').completedAt, 2000, 'the regression keeps the LAST real completion time');
r = QS.fold(s, [q('dim:goals', 'done')], 5000);
A.eq(r.completions.length, 1, 'a genuinely new open→done edge celebrates again');
A.eq(QS.stateOf(s, 'dim:goals').completedAt, 5000, '…and re-stamps completedAt');

/* ---------- a quest may vanish and return without a phantom celebration ---------- */
r = QS.fold(s, [], 5500);
A.eq(r.completions, [], 'an empty projection is silent');
r = QS.fold(s, [q('dim:goals', 'done')], 5600);
A.eq(r.completions, [], 'reappearing still-done is not a new completion');

/* ---------- dismissibility (GB-24 — dismiss everywhere): QuestState owns the kinds with no external denylist ----
   dossier/milestone/station now all take here; the kinds with their OWN store denylist (station-gap/work/
   maintenance/ledger) and the coupled/owned kinds (idea, arc-goal, arc-step) are excluded on purpose. */
A.eq(QS.dismissible({ kind: 'dossier' }), true, 'get-to-know-you quests are dismissible');
A.eq(QS.dismissible({ kind: 'milestone' }), true, 'GB-24: milestones are now dismissible (QuestState is their denylist)');
A.eq(QS.dismissible({ kind: 'station' }), true, 'GB-24: station-arc quests are now dismissible');
A.eq(QS.dismissible({ kind: 'idea' }), false, 'the idea quest is owned by the COMMS suggestion cadence — not dismissible here');
A.eq(QS.dismissible({ kind: 'arc-goal' }), false, 'the goal-arc header is a coupled path, not a standalone nag — not dismissible');
A.eq(QS.dismissible({ kind: 'arc-step' }), false, 'a goal-arc step retires on drift, never a wave-off — not dismissible');
A.eq(QS.dismissible({ kind: 'station-gap' }), false, 'station-gap owns its own store denylist — not routed through QuestState');
A.eq(QS.dismissible({ kind: 'work' }), false, 'work owns its own store denylist — not routed through QuestState');
A.eq(QS.dismissible({ kind: 'maintenance' }), false, 'maintenance owns its own store denylist — not routed through QuestState');
A.eq(QS.dismissible({ kind: 'ledger' }), false, 'a ledger quest dismisses on the sidecar backend — not routed through QuestState');
A.eq(QS.dismissible(null), false, 'dismissible(null) never throws');

/* ---------- dismiss: only dismissible kinds take; idempotent ---------- */
A.eq(QS.dismiss(s, q('idea', 'open', 'idea'), 6000), false, 'dismissing the SuggestStore-owned idea quest is refused (not QuestState-owned)');
A.eq(QS.isDismissed(s, 'idea'), false, '…and leaves no mark');
A.eq(QS.dismiss(s, q('ms:pack_rat', 'open', 'milestone'), 5900), true, 'GB-24: dismissing an open milestone now takes (QuestState is its denylist)');
A.eq(QS.isDismissed(s, 'ms:pack_rat'), true, '…and is recorded');
A.eq(QS.dismiss(s, q('dim:stack', 'open'), 6000), true, 'dismissing an open dossier quest takes');
A.eq(QS.isDismissed(s, 'dim:stack'), true, '…and is recorded');
A.eq(QS.stateOf(s, 'dim:stack').dismissedAt, 6000, 'dismissedAt is stamped');
A.eq(QS.dismiss(s, q('dim:stack', 'open'), 7000), false, 'a second dismiss is a no-op');
A.eq(QS.stateOf(s, 'dim:stack').dismissedAt, 6000, '…and never re-stamps');

/* ---------- dismissed = never re-renders ---------- */
const vis = QS.visible(s, [q('dim:stack', 'open'), q('dim:goals', 'done'), q('ms:first_light', 'done')]);
A.eq(vis.map(x => x.id), ['dim:goals', 'ms:first_light'], 'visible() drops the dismissed quest, keeps the rest');

/* ---------- dismissed = never re-fires (the anti-nag law) ---------- */
r = QS.fold(s, [q('dim:stack', 'done')], 8000);
A.eq(r.completions, [], 'even a REAL completion of a dismissed quest stays silent forever');

/* ---------- malformed input never crashes ---------- */
A.notThrows(() => QS.fold(s, [null, {}, { id: '' }, { id: 'x' }], 9000), 'malformed quests are skipped, never a crash');
A.eq(QS.fold(null, [q('dim:goals', 'done')], 9100).completions, [], 'fold(null state) degrades to no completions');
A.eq(QS.visible(null, [q('a', 'open', 'dossier')]).length, 1, 'visible(null state) passes quests through');
A.eq(QS.stateOf(s, null), null, 'stateOf(null id) is null');
A.eq(QS.stateOf(s, 'never-seen'), null, 'stateOf(unknown id) is null');

/* ---------- persistence round-trip ---------- */
const back = QS.hydrate(JSON.parse(JSON.stringify(s)));
A.eq(back.seen['dim:goals'], s.seen['dim:goals'], 'seen records survive a JSON round-trip');
A.eq(QS.isDismissed(back, 'dim:stack'), true, 'dismissals survive a JSON round-trip');
r = QS.fold(back, [q('dim:goals', 'done'), q('dim:stack', 'done')], 10000);
A.eq(r.completions, [], 'a rehydrated state stays silent for already-done and dismissed quests alike');

A.report('queststate.test');
