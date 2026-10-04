/* node test/talk-turn.test.js — TURN-TAKING in a two-agent exchange (W4, 2026-08-08).

   THE ASK: "we should allow agents to appear as if they are speaking to one another." The D3
   encounter already brought two idle bodies face to face; what it could not do was make the beat
   READ as a conversation — two motionless sprites a tile apart are indistinguishable from two
   stuck pathfinds. The speaking pose is art the sets already ship; the thing that turns two
   speaking poses into a conversation is that they ALTERNATE, with a beat of silence between.

   world.js is a browser IIFE (can't require under node) and an encounter is a rare, tick-driven,
   two-body event — so, exactly like test/chat-stare-throttle.test.js, this extracts the marked
   TALK-TURN-PURE block from the SOURCE and executes it (the shipped decision is under test, not a
   copy of it).

   Contract under test:
     • the two sides NEVER speak at the same instant (the property that makes it a conversation)
     • each side gets an equal share of the exchange (nobody monologues)
     • there is real SILENCE between turns (speakMs < slotMs is honoured, not rounded away)
     • both sides are silent in the same gaps, so the pair is never entirely mouth-moving
     • degenerate inputs (negative elapsed, zero slot) are silent rather than throwing */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');

// ---- extract + execute the marked pure block from the real source ----
const src = fs.readFileSync(path.join(__dirname, '../frontend/app/world.js'), 'utf8');
const BEGIN = 'TALK-TURN-PURE-BEGIN', END = 'TALK-TURN-PURE-END';
const i0 = src.indexOf(BEGIN), i1 = src.indexOf(END);
A.ok(i0 >= 0 && i1 > i0, 'world.js carries the TALK-TURN-PURE extraction markers');
const block = src.slice(src.indexOf('*/', i0) + 2, src.lastIndexOf('/*', i1));
A.ok(/function myTurn\(/.test(block), 'the marked block holds myTurn');
const codeOnly = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
A.ok(!/\bself\.|\bU\.|\bMath\.random|\bDate\b|\bdocument\b|\bwindow\b|\bsocialBeat\b/.test(codeOnly),
  'the block is PURE (no module state / RNG / DOM — safe to execute standalone)');
const { myTurn } = eval('(function(){' + block + '\nreturn { myTurn };})()');

// the shipped constants, read off the source so the test cannot drift from the tuning
const SLOT = Number((src.match(/TALK_SLOT_MS\s*=\s*(\d+)/) || [])[1]);
const SPEAK = Number((src.match(/TALK_SPEAK_MS\s*=\s*(\d+)/) || [])[1]);
A.ok(SLOT > 0 && SPEAK > 0, 'the shipped slot/speak constants are readable from world.js');
A.ok(SPEAK < SLOT, 'a turn is SHORTER than its slot — the remainder is the silence that reads as listening');

// ---- sweep a whole exchange at 10ms resolution ----
let bothTalking = 0, aOnly = 0, bOnly = 0, neither = 0, longestGap = 0, gap = 0;
// HALF-OPEN on purpose: sweeping [0, 8 slots] INCLUSIVE samples the first speaker's opening
// instant twice (t=0 and t=8*SLOT are the same phase), which shows up as a 1-sample "monologue".
for (let t = 0; t < SLOT * 8; t += 10) {
  const a = myTurn(t, true, SLOT, SPEAK);
  const b = myTurn(t, false, SLOT, SPEAK);
  if (a && b) bothTalking++;
  else if (a) aOnly++;
  else if (b) bOnly++;
  else { neither++; gap += 10; longestGap = Math.max(longestGap, gap); }
  if (a || b) gap = 0;
}
A.eq(bothTalking, 0, 'the two sides NEVER speak at the same instant — they take turns');
A.ok(aOnly > 0 && bOnly > 0, 'both sides actually get to speak');
A.eq(aOnly, bOnly, 'the exchange is even — neither body monologues');
A.ok(neither > 0, 'there is silence in the exchange (not a continuous drone of two mouths)');
A.ok(longestGap >= (SLOT - SPEAK) - 10, 'the silence between turns is the full slot remainder, not a rounding artefact');

// ---- the two sides are exact complements within a speaking window ----
A.eq(myTurn(0, true, SLOT, SPEAK), true, 'the FIRST speaker opens the exchange');
A.eq(myTurn(0, false, SLOT, SPEAK), false, 'the second body listens first');
A.eq(myTurn(SLOT, true, SLOT, SPEAK), false, 'and yields its turn at the slot boundary');
A.eq(myTurn(SLOT, false, SLOT, SPEAK), true, 'which is when the other body takes over');
A.eq(myTurn(SLOT * 2, true, SLOT, SPEAK), true, 'the turn comes back around');

// ---- the gap is per-turn, and BOTH are silent inside it ----
const inGap = SPEAK + Math.floor((SLOT - SPEAK) / 2);
A.eq(myTurn(inGap, true, SLOT, SPEAK), false, 'the speaker stops before its slot ends');
A.eq(myTurn(inGap, false, SLOT, SPEAK), false, '...and the other has not started yet — a real beat of silence');

// ---- THE REGRESSION THIS CAUGHT (live soak, 2026-08-08) ----
// The first build fed myTurn each body's OWN arrival time (pl.holdAt). The two bodies of a huddle
// arrive seconds apart, which puts both of them in "slot 0" — the soak printed a sample with BOTH
// bodies TALKING. The shipped call now passes the ENCOUNTER's start clock, identical for both. This
// case locks the property that failure violated: a SHARED origin always alternates, a per-body one
// can put both mouths open at once.
const skew = Math.floor(SPEAK / 2);
A.ok(myTurn(0, true, SLOT, SPEAK) && myTurn(0 + skew, false, SLOT, SPEAK) === false,
  'shared origin: at the same instant only one side speaks');
A.ok(myTurn(skew, true, SLOT, SPEAK) === true && myTurn(0, false, SLOT, SPEAK) === false,
  'and the other is still listening');
// with a per-body origin the SAME instant reads as slot 0 for BOTH — the bug, stated as a fact:
A.ok(myTurn(0, true, SLOT, SPEAK) === true && myTurn(0, true, SLOT, SPEAK) === true,
  'control: two bodies each measuring from their OWN arrival both compute a first turn — which is why the origin must be shared');

// ---- degenerate inputs are silent, never thrown ----
A.eq(myTurn(-50, true, SLOT, SPEAK), false, 'a negative elapsed (clock skew) is silent, not talking');
A.eq(myTurn(100, true, 0, SPEAK), false, 'a zero slot cannot divide — silent rather than NaN/Infinity');
A.eq(myTurn(100, true, SLOT, 0), false, 'a zero speak window never opens a mouth');

A.report('talk-turn.test');
