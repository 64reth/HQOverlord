/* node test/social-trio.test.js — W5 (2026-08-14): MORE conversations, and a THREE-body one.

   THE ASK, verbatim: "I really like when the agent sprites talk to one another but it seems to very
   very rarely happen... sometimes 2, or maybe even 3 of them just start communicating."

   Two separate claims, and this file locks both, because each has a way of silently reverting:

   RATE — the encounter was governed by four multiplying gates, and tuning only the obvious one is
   how W4 already failed to fix this once. The locks below pin the three NON-obvious halves: the
   silent kinds draw their own short cooldown instead of spending the conversation budget, the
   talking kinds are selected FIRST, and the candidate radius is wider than the distance between two
   desks. A future "simplify the tuning" pass that folds the two lanes back into one, or restores the
   old kind order, puts the rarity straight back — so those are assertions, not comments.

   TRIO — turn-taking generalised from a boolean (am I the first speaker?) to a seat in a roster.
   The property that makes a conversation legible is that exactly ONE mouth moves at a time, and with
   three bodies that is no longer nearly-free: a naive "everyone talks while held" reads as a crowd.
   `% n` round-robin makes overlap unrepresentable, and this file sweeps it to prove that for n=3 and
   n=2 alike — including that n=2 is byte-identical to the shipped W4 alternation, since a pair is
   the common case and must not regress in the name of the rare one.

   Same extraction discipline as test/talk-turn.test.js: world.js is a browser IIFE, so the marked
   TALK-TURN-PURE block is sliced out of the SOURCE and executed — the shipped decision is under
   test, not a copy of it. */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');

const src = fs.readFileSync(path.join(__dirname, '../frontend/app/world.js'), 'utf8');

// ---- extract + execute the marked pure block from the real source ----
const BEGIN = 'TALK-TURN-PURE-BEGIN', END = 'TALK-TURN-PURE-END';
const i0 = src.indexOf(BEGIN), i1 = src.indexOf(END);
A.ok(i0 >= 0 && i1 > i0, 'world.js carries the TALK-TURN-PURE extraction markers');
const block = src.slice(src.indexOf('*/', i0) + 2, src.lastIndexOf('/*', i1));
A.ok(/function myTurnN\(/.test(block), 'the marked block holds the N-speaker turn function');
const codeOnly = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
A.ok(!/\bself\.|\bU\.|\bMath\.random|\bDate\b|\bdocument\b|\bwindow\b|\bsocialBeat\b/.test(codeOnly),
  'the block is still PURE after the generalisation (no module state / RNG / DOM)');
const { myTurnN, myTurn } = eval('(function(){' + block + '\nreturn { myTurnN, myTurn };})()');

const SLOT = Number((src.match(/TALK_SLOT_MS\s*=\s*(\d+)/) || [])[1]);
const SPEAK = Number((src.match(/TALK_SPEAK_MS\s*=\s*(\d+)/) || [])[1]);
A.ok(SLOT > 0 && SPEAK > 0 && SPEAK < SLOT, 'the shipped slot/speak constants are readable and leave a silence');

// ---- sweep a THREE-body exchange: the crowd property ----
// 12 slots = 4 full rotations of 3 speakers. Half-open for the same reason talk-turn.test.js is:
// sampling t=0 and t=12*SLOT would count the first speaker's opening instant twice.
const spoke = [0, 0, 0];
let overlap = 0, silent = 0, longestGap = 0, gap = 0;
for (let t = 0; t < SLOT * 12; t += 10) {
  const on = [0, 1, 2].map(i => myTurnN(t, i, 3, SLOT, SPEAK));
  const n = on.filter(Boolean).length;
  if (n > 1) overlap++;
  if (n === 0) { silent++; gap += 10; longestGap = Math.max(longestGap, gap); } else gap = 0;
  on.forEach((v, i) => { if (v) spoke[i] += 10; });
}
A.eq(overlap, 0, 'THREE bodies never speak at the same instant — one mouth at a time, always');
A.ok(spoke[0] > 0 && spoke[1] > 0 && spoke[2] > 0, 'all three actually get the floor (nobody is a silent bystander)');
A.eq(spoke[0], spoke[1], 'the first two share the exchange evenly');
A.eq(spoke[1], spoke[2], 'and so does the third — no monologue, no ignored body');
A.ok(silent > 0, 'there is real silence in a three-way exchange too');
A.ok(longestGap >= (SLOT - SPEAK) - 10, 'the gap between turns survives the extra speaker (not rounded away)');

// the floor passes in roster order and comes back around — a rotation, not a random scatter
A.eq(myTurnN(0, 0, 3, SLOT, SPEAK), true, 'seat 0 opens');
A.eq(myTurnN(SLOT, 1, 3, SLOT, SPEAK), true, 'seat 1 takes the second slot');
A.eq(myTurnN(SLOT * 2, 2, 3, SLOT, SPEAK), true, 'seat 2 takes the third');
A.eq(myTurnN(SLOT * 3, 0, 3, SLOT, SPEAK), true, 'and it returns to seat 0');
A.eq(myTurnN(SLOT, 0, 3, SLOT, SPEAK), false, 'a body that has yielded is silent, not merely quieter');

// ---- a body NOT in the roster is silent (the torn-down-encounter race) ----
A.eq(myTurnN(0, -1, 3, SLOT, SPEAK), false, 'an id missing from the roster (indexOf → -1) never speaks');
A.eq(myTurnN(0, 3, 3, SLOT, SPEAK), false, 'a seat past the end of the roster never speaks');
A.eq(myTurnN(0, 0, 0, SLOT, SPEAK), false, 'an empty roster cannot produce a speaker');
A.eq(myTurnN(-50, 0, 3, SLOT, SPEAK), false, 'a negative elapsed (clock skew) is silent, not talking');
A.eq(myTurnN(100, 0, 3, 0, SPEAK), false, 'a zero slot cannot divide — silent rather than NaN/Infinity');

// ---- the PAIR case is unchanged (a rare feature must not tax the common one) ----
for (let t = 0; t < SLOT * 8; t += 10) {
  A.ok(myTurn(t, true, SLOT, SPEAK) === myTurnN(t, 0, 2, SLOT, SPEAK), 'pair: the first speaker is seat 0 at t=' + t);
  A.ok(myTurn(t, false, SLOT, SPEAK) === myTurnN(t, 1, 2, SLOT, SPEAK), 'pair: the second is seat 1 at t=' + t);
}

// ---- RATE: the three non-obvious governors, pinned ----
// (a) the silent kinds must NOT spend the conversation budget
A.ok(/SOCIAL_QUIET_CD_MIN\s*=\s*(\d+),\s*SOCIAL_QUIET_CD_MAX\s*=\s*(\d+)/.test(src), 'a separate QUIET lane exists for the non-talking beats');
const conv = src.match(/SOCIAL_STATION_CD_MIN\s*=\s*(\d+),\s*SOCIAL_STATION_CD_MAX\s*=\s*(\d+)/);
const quiet = src.match(/SOCIAL_QUIET_CD_MIN\s*=\s*(\d+),\s*SOCIAL_QUIET_CD_MAX\s*=\s*(\d+)/);
A.ok(Number(quiet[2]) < Number(conv[1]), 'the quiet lane is strictly shorter than the conversation lane (a silent beat cannot gate a talk)');
A.ok(/function isTalkKind\(kind\) \{ return kind === 'huddle' \|\| kind === 'border'; \}/.test(src), 'one predicate decides which kinds are conversations');
A.ok(/armSocialBudget\(now, kind\)/.test(src), 'the coordinator tells the budget WHICH kind fired');
A.ok(/armSocialBudget\(now, 'watch'\)/.test(src) && /armSocialBudget\(now, 'follow'\)/.test(src), 'both one-sided fire sites declare themselves quiet');
A.ok(/isTalkKind\(kind\)\s*\?\s*U\.irnd\(SOCIAL_STATION_CD_MIN, SOCIAL_STATION_CD_MAX\)/.test(src.replace(/\s+/g, ' ')), 'only a talking kind draws the conversation cooldown');

// (b) the talking kinds are SELECTED first — a working neighbour must not pre-empt a conversation
const sel = src.slice(src.indexOf('function maybeSocial('), src.indexOf('function planHuddle('));
const iHuddle = sel.indexOf('planHuddle('), iBorder = sel.indexOf('planBorderMeeting('), iWatch = sel.indexOf('planWatch('), iFollow = sel.indexOf('planFollow(');
A.ok(iHuddle > 0 && iBorder > 0 && iWatch > 0 && iFollow > 0, 'all four kinds are still selected in maybeSocial');
A.ok(iHuddle < iWatch && iHuddle < iFollow, 'HUDDLE (the conversation) is tried before both silent kinds');
A.ok(iBorder < iWatch && iBorder < iFollow, 'BORDER (the other conversation) is too');

// (c) the candidate radius must exceed the old value that was smaller than a desk gap
A.ok(Number((src.match(/SOCIAL_NEAR_RADIUS\s*=\s*(\d+)/) || [])[1]) >= 8, 'the neighbour radius reaches past an adjacent desk');
// and the hold is long enough that a human looking at the station can actually watch it happen
const hold = src.match(/SOCIAL_HOLD_MIN\s*=\s*(\d+),\s*SOCIAL_HOLD_MAX\s*=\s*(\d+)/);
A.ok(Number(hold[1]) >= 8000, 'a conversation holds long enough to be noticed (not the old 3s blink)');
A.ok(Number((src.match(/SOCIAL_HARD_MS\s*=\s*(\d+)/) || [])[1]) > Number(hold[2]),
  'the hard timeout still outlasts the longest hold — the cap must never be what ends a normal talk');

// ---- TRIO WIRING: the roster is real, bounded, and released as a whole ----
A.ok(/function participantIds\(s\)/.test(src) && /function participantBodies\(s\)/.test(src), 'the encounter exposes its full roster');
A.ok(/\(s && s\.ids && s\.ids\.length\) \? s\.ids : \(s \? \[s\.aId, s\.bId\] : \[\]\)/.test(src), 'the roster falls back to aId/bId so every older slot still reads as complete');
A.ok(/socialBeat = \{ kind, aId: a\.id, bId: b\.id, until: now \+ SOCIAL_HARD_MS, startedAt: now, ids: ids \}/.test(src), 'the slot carries the roster, with aId/bId retained as its first two entries');
A.ok(/const SOCIAL_MAX_PARTY = 3/.test(src), 'a party is capped at three — four sprites cannot ring one tile without talking to a back');
A.ok(/\.slice\(0, SOCIAL_MAX_PARTY\)/.test(src), 'the cap is enforced on the party, not merely declared');
A.ok(/for \(const body of participantBodies\(s\)\)/.test(src), 'teardown releases EVERY participant, not just the named pair');
const endFn = src.slice(src.indexOf('function endEncounter('), src.indexOf('function encounterBroken('));
A.ok(/for \(let i = 0; i < ids\.length; i\+\+\) for \(let j = i \+ 1; j < ids\.length; j\+\+\) armPairCd/.test(endFn),
  'a trio arms all three pair cooldowns (or the two non-named bodies could instantly re-huddle)');
const brokenFn = src.slice(src.indexOf('function encounterBroken('), src.indexOf('/* startEncounter'));
A.ok(/for \(let i = 1; i < bodies\.length; i\+\+\)/.test(brokenFn) && /o\.working/.test(brokenFn),
  'a seized THIRD body tears the encounter down too — work seizing instantly (G2/K3) outranks the conversation');
A.ok(/bodies\.some\(x => !x \|\| x\.unplaced\)/.test(brokenFn), 'any despawned participant breaks the beat, whichever seat it held');

// the third body is recruited only when a legal, distinct, in-zone tile exists for it
const huddleFn = src.slice(src.indexOf('function planHuddle('), src.indexOf('// WATCH-A-PEER-WORK:'));
A.ok(/const tc = nearestWalkableInZone\(zoneFor\(c\), ta\.x, ta\.y, cc, 4, ta, tb\)/.test(huddleFn),
  'the third tile is resolved in the THIRD body\'s own zone and excludes both taken tiles (G3)');
A.ok(/if \(tc && losClear\([\s\S]{0,120}\) extras\.push/.test(huddleFn), 'no legal third tile ⇒ no third body (the huddle falls back to the pair, never fails)');
// SIGHTLINE (2026-08-17): "legal" now includes being able to SEE the other two. Each of the three tiles
// is resolved inside its OWN body's zone, so a trio straddling a room boundary could put the recruit on
// the far side of a wall — a body silently talking to plaster. It must see BOTH, or it isn't recruited.
A.ok(/losClear\(tc\.x, tc\.y, ta\.x, ta\.y\)/.test(huddleFn) && /losClear\(tc\.x, tc\.y, tb\.x, tb\.y\)/.test(huddleFn),
  'the third body must have a wall-free sightline to BOTH of the other two');
// (the roll's argument grew a COMPANIONS bonus in 2026-08-16, so these match the call up to the
// constant and assert the bonus separately below — the ORDERING law under test is unchanged)
A.ok(huddleFn.indexOf('if (!tb) return false;') < huddleFn.indexOf('U.chance(SOCIAL_TRIO_CHANCE'),
  'the pair is resolved BEFORE the trio is rolled — the third body can only ever ADD to a huddle that was already legal');
A.ok(/!pairOnCd\(b\.id, o\.id, now\)/.test(huddleFn), 'the recruit must also be off cooldown with the PARTNER, not just with the initiator');
A.ok(/function nearestWalkableInZone\(zone, tx, ty, cur, radius, \.\.\.excl\)/.test(src), 'the tile picker takes multiple exclusions (a trio has two tiles already spoken for)');

// facing: a body in a trio looks at the group, and the one-sided beats keep their single partner
A.ok(/\(pl\.partnerIds \|\| \[pl\.partnerId\]\)/.test(src), 'facing falls back to the single partner for watch/follow, which carry no roster');
A.ok(/self\.dir = dirToward\(self\.px, self\.py, sx \/ others\.length, sy \/ others\.length\)/.test(src),
  'a participant faces the CENTROID of the others — with two that is the partner, with three it is the circle');

/* ---- the live proof hooks (dev/trioprobe.mjs) ----
   A trio is rare by construction, so the three-body conversation cannot be proven by waiting: two
   7-minute soaks produced eight encounters and zero trios. dev/trioprobe.mjs drives the selection
   instead and watches the result. These locks exist because the hook's VALUE is entirely in what it
   does NOT bypass — if `force` ever grew to skip a legality gate, the probe would keep printing PASS
   while proving something staged. */
A.ok(/_dbgHuddle: \(ids, force\) =>/.test(src), 'the debug hook to arm a huddle from named bodies exists');
A.ok(/if \(socialBeat\) return \{ ok: false, err: 'an encounter is already live' \}/.test(src), 'the hook still respects the single-slot rule (G4)');
A.ok(/const keep = self[\s\S]{0,400}\} finally \{ self = keep; \}/.test(src.slice(src.indexOf('_dbgHuddle:'))), 'the hook restores the borrowed `self` in a finally (B1)');
const hookFn = src.slice(src.indexOf('_dbgHuddle: (ids, force)'), src.indexOf('_dbgSit:'));
A.ok(/planHuddle\(bodies\[0\], bodies\.slice\(1\), now, !!force\)/.test(hookFn), 'the hook goes through the REAL planHuddle, not a staged copy');
A.ok(/forceTrio \|\| U\.chance\(SOCIAL_TRIO_CHANCE/.test(src), 'force bypasses the frequency ROLL only — every legality gate still runs');
/* COMPANIONS (2026-08-16): the roll's argument gained a bond bonus so a third body bonded to BOTH
   others turns a pair into the friend GROUP more often. It must only ever ADD — a MINUS here would
   let the social graph SUPPRESS trios, silently undoing the W5 ask ("maybe even 3 of them"), and it
   must stay inside the roll so it can never reach a legality gate. */
A.ok(/U\.chance\(SOCIAL_TRIO_CHANCE \+ BOND_TRIO_BONUS \* bestGroupBond\)/.test(src),
  'the companions bonus only ADDS to the trio roll — it can never suppress a trio');
A.ok(/const BOND_TRIO_BONUS = 0?\.\d+/.test(src), 'and that bonus is a positive constant');
// the roll is the ONLY thing force can skip: the tile resolver must still be consulted after it
const trioBranch = src.slice(src.indexOf('forceTrio || U.chance(SOCIAL_TRIO_CHANCE'), src.indexOf('return startEncounter(a, b, \'huddle\''));
A.ok(/nearestWalkableInZone\(zoneFor\(c\)/.test(trioBranch), 'even a forced trio must still resolve a legal in-zone tile for the third body');
A.ok(/_dbgHuddleStats: \(\) => JSON\.parse\(JSON\.stringify\(huddleStats\)\)/.test(src), 'the selection counters are exposed as a read-only copy (a caller cannot mutate live engine state)');
A.ok(/huddleStats\.candCounts\[list\.length\]/.test(src), 'the counters record how many candidates each huddle actually saw — the number that explains a missing trio');

A.report('social-trio.test');
