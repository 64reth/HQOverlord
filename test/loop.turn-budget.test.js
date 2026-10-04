/* node test/loop.turn-budget.test.js — the PER-TURN aggregate tool-output budget.

   tools/registry.js caps each result on its own at 80k. That was sufficient while tool calls ran strictly one
   at a time: the model saw one big result and could narrow its NEXT call. Parallel batches deleted that
   feedback loop — N results land together, so N x 80k arrives in a single turn with no decision point in
   between, and a few wide greps blow the context window the loop was supposed to be reasoning inside.

   The shrink is WATER-FILLED rather than proportional, and that is the part worth pinning: a proportional cut
   punishes a 900-character result to make room for a 300k one, and the short result is usually the answer. */
'use strict';
const A = require('./_assert.js');
const { applyTurnBudget, squeeze } = require('../sidecar/loop.js')._internals;

const mk = (id, n, parked) => ({ callId: id, ok: true, isError: false, content: 'x'.repeat(n), parkedPath: parked || null });
const total = rs => rs.reduce((a, r) => a + (typeof r.content === 'string' ? r.content.length : 0), 0);

// ---- a turn that fits is untouched ----
{
  const out = applyTurnBudget([mk('a', 100), mk('b', 200)], 200000);
  A.eq(total(out), 300, 'a turn under budget is passed through byte-identical');
  A.ok(!out.some(r => r.turnClamped), 'and nothing is marked clamped');
}

// ---- WATER-FILL: the small results survive whole ----
{
  const out = applyTurnBudget([mk('big', 300000), mk('sm1', 900), mk('sm2', 300)], 200000);
  A.ok(total(out) <= 200000, 'the turn total is brought under the cap');
  A.eq(out[1].content.length, 900, 'a small result keeps ALL of its text (a proportional cut would have shaved it)');
  A.eq(out[2].content.length, 300, 'and so does a smaller one');
  A.ok(out[0].turnClamped, 'the huge result is the one that gives ground');
  A.ok(!out[1].turnClamped && !out[2].turnClamped, 'the small ones are not marked clamped');
}

// ---- equal offenders split evenly ----
{
  const out = applyTurnBudget([mk('a', 100000), mk('b', 100000), mk('c', 100000), mk('d', 100000)], 200000);
  A.eq(out.map(r => r.content.length), [50000, 50000, 50000, 50000], 'four equally large results get an equal share');
}

// ---- WIDE PARALLEL BATCH: shares smaller than the explanatory note must still respect the cap ----
// squeeze() used to return the full ~330-char note whenever the share couldn't hold it, so a 900-result
// batch of 250-char outputs "clamped" 225k of input into 297k of output — 48% OVER the cap it was
// enforcing, with 100% of every result's content destroyed. The short marker must FIT the share.
{
  const rs = []; for (let i = 0; i < 900; i++) rs.push(mk('c' + i, 250));
  const out = applyTurnBudget(rs, 200000);
  A.ok(total(out) <= 200000, 'a wide batch of small results lands UNDER the cap (was 297k for a 200k cap)');
  A.ok(out.every(r => r.content.length <= 250), 'no squeezed result GREW past its original content');
  A.ok(out.every(r => /elided/.test(r.content)), 'each clamped result still carries an elision marker');
  A.ok(out.every(r => /do not repeat this call/.test(r.content)), 'the marker keeps the do-not-repeat instruction — the feedback signal that stops the model re-issuing the same wide calls');
}

// ---- the note survives a SECOND clamp, and still points at the parked file ----
{
  const out = applyTurnBudget([mk('p', 300000, 'parked/out-1.log'), mk('q', 300000)], 200000);
  A.ok(out[0].content.indexOf('parked/out-1.log') >= 0,
    'a re-clamped result still names the file its full output was parked to — the first clamp put that pointer in the MIDDLE, which is exactly what a second head+tail cut would eat');
  A.ok(/narrow it, or make fewer calls/.test(out[1].content), 'an unparked result is told what to do instead');
  A.ok(out[0].content.startsWith('x') && out[0].content.endsWith('x'),
    'head AND tail are kept — an exit line and a stack trace live at the END of command output');
}

// ---- degenerate inputs must not throw ----
{
  const off = applyTurnBudget([mk('a', 300000)], 0);
  A.eq(off[0].content.length, 300000, 'a zero budget disables the cap entirely');

  const tiny = applyTurnBudget([mk('a', 300000)], 300);
  A.ok(/per-TURN output cap/.test(tiny[0].content), 'a budget too small for head+tail still keeps the NOTE — the note is what tells the model this is not the whole answer');

  const mixed = applyTurnBudget([{ callId: 'z', content: null }, mk('a', 300000)], 200000);
  A.ok(typeof mixed[1].content === 'string', 'a non-string content is skipped rather than crashing the turn');
  A.eq(mixed[0].content, null, 'and left alone');

  A.eq(applyTurnBudget([], 200000).length, 0, 'an empty turn is fine');
}

// ---- squeeze keeps both ends ----
{
  const s = squeeze('A'.repeat(1000) + 'Z'.repeat(1000), 1400, null);
  A.ok(s.indexOf('A') === 0, 'squeeze keeps the head');
  A.ok(s[s.length - 1] === 'Z', 'squeeze keeps the tail');
  A.ok(s.length <= 1400, 'and respects the budget it was given');
  A.eq(squeeze('short', 1000, null), 'short', 'content already inside its budget is returned unchanged');
}

A.report('loop.turn-budget');
