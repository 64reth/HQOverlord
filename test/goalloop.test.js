/* node test/goalloop.test.js — the PURE GOAL-LOOP state machine (frontend/app/goalloop.js).

   StarNet's "Ralph loop": set a standing goal, judge after each turn, auto-queue a continuation until the judge
   says done / the budget is spent / a user message preempts / the Commander pauses. Deterministic (injected
   clock), fail-open on a garbage judge reply. Mirrors goals.test.js: pure, node-loaded, value floors + caps. */
'use strict';
const A = require('./_assert.js');
const L = require('../frontend/app/goalloop.js');

/* ============================ 1. VERDICT PARSE (fail-open) ============================ */

let v = L.parseVerdict('{"verdict":"done","reason":"the file was written"}');
A.eq(v.verdict, 'done', 'clean done verdict parses');
A.eq(v.parseFailed, false, 'a clean reply is not a parse failure');
A.ok(v.reason.indexOf('file was written') >= 0, 'the reason survives');

A.eq(L.parseVerdict('{"verdict":"continue","reason":"more to do"}').verdict, 'continue', 'continue verdict parses');
// legacy {done:<bool>} shape
A.eq(L.parseVerdict('{"done":true,"reason":"ok"}').verdict, 'done', 'legacy done:true → done');
A.eq(L.parseVerdict('{"done":false,"reason":"nope"}').verdict, 'continue', 'legacy done:false → continue');
A.eq(L.parseVerdict('{"done":"yes","reason":"x"}').verdict, 'done', 'legacy string done:"yes" → done');
// a code fence + prose around the object
A.eq(L.parseVerdict('```json\n{"verdict":"done","reason":"y"}\n```').verdict, 'done', 'a fenced verdict parses');
A.eq(L.parseVerdict('Sure! {"verdict":"continue","reason":"z"} hope that helps').verdict, 'continue', 'a verdict embedded in prose parses');
// an unknown verdict falls open to continue (never wedge)
A.eq(L.parseVerdict('{"verdict":"maybe","reason":"?"}').verdict, 'continue', 'an unknown verdict falls open to continue');
A.eq(L.parseVerdict('{"verdict":"maybe","reason":"?"}').parseFailed, false, 'a well-formed unknown verdict is NOT a parse failure');
// FAIL-OPEN: empty / prose / malformed → continue + parseFailed
A.eq(L.parseVerdict('').verdict, 'continue', 'empty reply → continue');
A.eq(L.parseVerdict('').parseFailed, true, 'empty reply is a parse failure');
A.eq(L.parseVerdict('the goal is definitely complete now').parseFailed, true, 'prose (no JSON) is a parse failure');
A.eq(L.parseVerdict('the goal is definitely complete now').verdict, 'continue', 'prose fails OPEN to continue (never claims done)');
A.eq(L.parseVerdict('{broken json').parseFailed, true, 'malformed JSON is a parse failure');
A.eq(L.parseVerdict(null).parseFailed, true, 'null reply is a parse failure');
A.eq(L.parseVerdict('[1,2,3]').parseFailed, true, 'a JSON array (not an object) is a parse failure');

/* ============================ 2. CREATE + NORMALIZE ============================ */

A.eq(L.create('   '), null, 'an empty/whitespace goal makes no loop');
let s = L.create('ship the release', { now: 1000 });
A.eq(s.status, 'active', 'a new loop is active');
A.eq(s.turnsUsed, 0, 'starts at 0 turns');
A.eq(s.maxTurns, L.DEFAULT_MAX_TURNS, 'default budget applied');
A.eq(s.createdAt, 1000, 'the injected clock stamps createdAt');
A.eq(L.create('x', { maxTurns: 5 }).maxTurns, 5, 'a custom budget is honored');
A.eq(L.create('x', { maxTurns: -3 }).maxTurns, L.DEFAULT_MAX_TURNS, 'a bad budget falls back to the default');

A.eq(L.normalize(null), null, 'normalize(null) → null');
A.eq(L.normalize({ goal: '' }), null, 'normalize of a goal-less row → null');
let n = L.normalize({ goal: 'g', status: 'bogus', turnsUsed: -4, maxTurns: 0, subgoals: ['a', '', 'b'], parseFails: 2 });
A.eq(n.status, 'active', 'a bad status normalizes to active');
A.eq(n.turnsUsed, 0, 'a negative turnsUsed clamps to 0');
A.eq(n.maxTurns, L.DEFAULT_MAX_TURNS, 'a 0 maxTurns falls back to default');
A.eq(n.subgoals.length, 2, 'blank subgoals are dropped on normalize');

/* ============================ 3. SUBGOALS ============================ */

s = L.create('build a dashboard', { now: 0 });
A.eq(L.addSubgoal(s, 'has a dark mode'), 'has a dark mode', 'addSubgoal returns the cleaned text');
A.eq(s.subgoals.length, 1, 'the subgoal is appended');
A.eq(L.addSubgoal(s, '   '), null, 'a blank subgoal is rejected');
A.ok(L.continuationPrompt(s).indexOf('has a dark mode') >= 0, 'the continuation prompt carries the subgoal');
A.ok(L.judgeUser(s, 'reply').indexOf('has a dark mode') >= 0, 'the judge prompt carries the subgoal');
A.ok(L.judgeUser(s, 'reply').indexOf('concrete evidence') >= 0, 'the subgoal judge prompt demands per-criterion evidence');

/* ============================ 4. THE STATE MACHINE ============================ */

// CONTINUE → queues a continuation, increments the turn, message shows turn N/M + reason
s = L.create('write the report', { now: 0 });
let d = L.evaluate(s, { verdict: 'continue', reason: 'draft only', parseFailed: false }, { now: 10 });
A.eq(d.shouldContinue, true, 'a continue verdict fires the next turn');
A.ok(d.continuation && d.continuation.indexOf('write the report') >= 0, 'the continuation prompt carries the goal');
A.eq(s.turnsUsed, 1, 'the turn counter advanced');
A.ok(d.message.indexOf('turn 1/20') >= 0 && d.message.indexOf('draft only') >= 0, 'the localLine shows turn N/M + the judge reason');

// DONE → stops, status done, no continuation
d = L.evaluate(s, { verdict: 'done', reason: 'report shipped', parseFailed: false }, { now: 20 });
A.eq(d.shouldContinue, false, 'a done verdict stops the loop');
A.eq(s.status, 'done', 'the loop is marked done');
A.eq(d.continuation, null, 'no continuation after done');
A.ok(d.message.indexOf('done') >= 0, 'the done message is user-visible');
// a done loop is inert: evaluate again is a no-op
A.eq(L.evaluate(s, { verdict: 'continue', reason: 'x', parseFailed: false }).verdict, 'inactive', 'a finished loop evaluates inactive');

// BUDGET backstop: exhausting maxTurns auto-pauses (resumable)
s = L.create('endless task', { maxTurns: 3 });
L.evaluate(s, { verdict: 'continue', reason: 'a', parseFailed: false });
L.evaluate(s, { verdict: 'continue', reason: 'b', parseFailed: false });
d = L.evaluate(s, { verdict: 'continue', reason: 'c', parseFailed: false });
A.eq(s.status, 'paused', 'the budget backstop pauses the loop');
A.eq(d.shouldContinue, false, 'no continuation once the budget is spent');
A.ok(s.pausedReason.indexOf('budget') >= 0, 'the pause reason names the budget');
A.eq(s.turnsUsed, 3, 'exactly maxTurns turns were counted');

// PARSE-FAILURE auto-pause: 3 consecutive unparseable replies → pause BEFORE the budget runs out
s = L.create('with a weak judge', { maxTurns: 20 });
L.evaluate(s, { verdict: 'continue', reason: 'x', parseFailed: true });
L.evaluate(s, { verdict: 'continue', reason: 'x', parseFailed: true });
d = L.evaluate(s, { verdict: 'continue', reason: 'x', parseFailed: true });
A.eq(s.status, 'paused', '3 consecutive parse failures auto-pause');
A.ok(s.pausedReason.indexOf('unparseable') >= 0, 'the pause reason names the unparseable judge');
A.ok(d.message.indexOf('stronger model') >= 0 || d.message.indexOf('JSON') >= 0, 'the message points at the judge model');

// a single usable reply RESETS the parse-fail streak (a flaky judge doesn't trip the guard)
s = L.create('flaky judge', { maxTurns: 20 });
L.evaluate(s, { verdict: 'continue', reason: 'x', parseFailed: true });
L.evaluate(s, { verdict: 'continue', reason: 'x', parseFailed: true });
L.evaluate(s, { verdict: 'continue', reason: 'real', parseFailed: false });   // resets
A.eq(s.parseFails, 0, 'a usable reply resets the parse-fail streak');
L.evaluate(s, { verdict: 'continue', reason: 'x', parseFailed: true });
L.evaluate(s, { verdict: 'continue', reason: 'x', parseFailed: true });
A.eq(s.status, 'active', 'a reset streak means 2 more fails does not yet pause');

/* ============================ 5. PREEMPTION + PAUSE/RESUME/CLEAR ============================ */

// a real user message preempts: PAUSE the loop, judge nothing, queue nothing, don't burn a turn
s = L.create('background goal', { maxTurns: 20 });
d = L.evaluate(s, null, { preempt: true });
A.eq(d.verdict, 'preempted', 'a user message preempts the loop');
A.eq(s.status, 'paused', 'preemption pauses the loop');
A.eq(s.turnsUsed, 0, 'a preempt does NOT burn a turn');
A.eq(d.shouldContinue, false, 'a preempt queues no continuation');

// resume re-arms it with a fresh budget window
L.resume(s);
A.eq(s.status, 'active', 'resume re-activates');
A.eq(s.turnsUsed, 0, 'resume resets the budget window');

// pause then a continue-evaluate is inert until resumed
L.pause(s, 'manual');
A.eq(L.evaluate(s, { verdict: 'continue', reason: 'x', parseFailed: false }).shouldContinue, false, 'a paused loop does not continue');
A.eq(s.turnsUsed, 0, 'a paused loop burns no turns on evaluate');

// clear makes it inert + statusLine reflects "no loop"
L.clear(s);
A.eq(s.status, 'cleared', 'clear marks the loop cleared');
A.ok(L.statusLine(s).indexOf('No goal loop') >= 0, 'a cleared loop reads as no loop');
A.eq(L.hasGoal(s), false, 'a cleared loop has no goal');

// statusLine variants
A.ok(L.statusLine(L.create('sl', { maxTurns: 9 })).indexOf('active') >= 0, 'active status line');

A.report('goalloop');
