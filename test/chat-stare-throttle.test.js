/* node test/chat-stare-throttle.test.js — the chat-stare cursor-follow THROTTLE (2026-07-08).

   THE ASK: "when the user communicates with the agent it follows the mouse every single time —
   reduce how often that happens significantly." The COMMS-focused agent used to point at the
   cursor on EVERY re-affirm of the warm chat-stare (the hero re-affirms every tick), so an
   actively-moving mouse made it track the cursor continuously for the whole warm window. The fix
   (chatStareTrack) holds the gaze on the Commander (south) and only opens a brief, cooldown-gated
   follow beat now and then.

   world.js is a browser IIFE (can't require under node), and the behavior is tick-driven (rAF),
   which a backgrounded CDP/preview tab freezes to 0fps — so it can't be watched live. So, exactly
   like test/social-border.test.js, this test extracts the marked CHAT-STARE-TRACK-PURE block from
   the SOURCE and executes it (the shipped decision is under test, not a copy) with a deterministic
   injected rnd.

   Contract under test:
     • reduceMotion → always 'commander' (never chases the cursor), no schedule mutation
     • the FIRST hold does not pounce: it seeds a delayed cooldown and faces 'commander'
     • a fresh cursor BEFORE the cooldown elapses → still 'commander' (the fix: not every tick)
     • cooldown elapsed + fresh → ONE 'cursor' beat, which then pushes the cooldown far out
     • during the brief beat window → 'cursor'; after it → 'commander' until the next cooldown
     • a STALE cursor never follows, even past the cooldown
     • over a long stream of ticks under CONSTANT mousing, 'cursor' is a small minority of ticks
       (a flick, not a track) — the whole point of the change */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');

// ---- extract + execute the marked pure block from the real source ----
const src = fs.readFileSync(path.join(__dirname, '../frontend/app/world.js'), 'utf8');
const BEGIN = 'CHAT-STARE-TRACK-PURE-BEGIN', END = 'CHAT-STARE-TRACK-PURE-END';
const i0 = src.indexOf(BEGIN), i1 = src.indexOf(END);
A.ok(i0 >= 0 && i1 > i0, 'world.js carries the CHAT-STARE-TRACK-PURE extraction markers');
const block = src.slice(src.indexOf('*/', i0) + 2, src.lastIndexOf('/*', i1));
A.ok(/function chatStareTrack\(/.test(block), 'the marked block holds chatStareTrack');
const codeOnly = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');   // purity is a CODE property — comments may name U/self freely
A.ok(!/\bself\.|\bU\.|\bMath\.random|\bDate\b|\bdocument\b|\bwindow\b|\blastCursor\b/.test(codeOnly), 'the block is PURE (no module state / RNG / DOM — safe to execute standalone)');
const { chatStareTrack } = eval('(function(){' + block + '\nreturn { chatStareTrack };})()');

// deterministic rnd: always the LOW bound, so windows/cooldowns are exact.
// init delay = 8000, beat = 1200, post-beat cooldown = +16000.
const lo = (a) => a;

// ---- reduceMotion: never chase, never schedule ----
{
  const b = {};
  A.eq(chatStareTrack(b, 5000, true, true, lo), 'commander', 'reduceMotion → faces the Commander');
  A.eq(b.chatTrackCd, undefined, 'reduceMotion does not arm the follow schedule');
  A.eq(b.chatTrackUntil, undefined, 'reduceMotion leaves the beat window untouched');
}

// ---- first hold does not pounce (delayed first beat) ----
const b = {};
A.eq(chatStareTrack(b, 0, true, false, lo), 'commander', 'first hold faces the Commander even with a fresh cursor');
A.eq(b.chatTrackCd, 8000, 'first hold seeds a delayed cooldown (now + 8000), not an immediate follow');
A.eq(b.chatTrackUntil, undefined, 'first hold opens no beat');

// ---- fresh cursor BEFORE the cooldown → still no follow (THE FIX) ----
A.eq(chatStareTrack(b, 5000, true, false, lo), 'commander', 'fresh cursor before cooldown → Commander, NOT the cursor (no per-tick tracking)');
A.eq(b.chatTrackUntil, undefined, 'no beat opened before the cooldown elapses');

// ---- cooldown elapsed + fresh → ONE beat, cooldown pushed far out ----
A.eq(chatStareTrack(b, 8000, true, false, lo), 'cursor', 'cooldown elapsed + fresh → a follow beat opens');
A.eq(b.chatTrackUntil, 9200, 'beat runs now + 1200 (=9200)');
A.eq(b.chatTrackCd, 25200, 'next follow is gated far out: beat-end + 16000 (=25200)');

// ---- during the beat window → cursor; after → Commander ----
A.eq(chatStareTrack(b, 8600, true, false, lo), 'cursor', 'mid-beat (t<until) → keep following the cursor');
A.eq(chatStareTrack(b, 9200, true, false, lo), 'commander', 'beat ended (t==until) → back to the Commander');
A.eq(chatStareTrack(b, 20000, true, false, lo), 'commander', 'still inside the cooldown → Commander');

// ---- a STALE cursor never follows, even past the cooldown ----
{
  const s = { chatTrackCd: 100, chatTrackUntil: 0 };
  A.eq(chatStareTrack(s, 50000, false, false, lo), 'commander', 'stale cursor past the cooldown → never follows');
  A.eq(s.chatTrackUntil, 0, 'a stale cursor opens no beat');
}

// ---- the whole point: under CONSTANT mousing, following is a small minority of ticks ----
{
  const stream = {};
  let cursorTicks = 0, total = 0;
  for (let t = 0; t <= 120000; t += 250) {   // 120s of holds at 250ms cadence, cursor always fresh (constant mousing)
    total++;
    if (chatStareTrack(stream, t, true, false, lo) === 'cursor') cursorTicks++;
  }
  const pct = Math.round(100 * cursorTicks / total);
  A.ok(cursorTicks > 0, 'it STILL follows occasionally — the noticing is preserved, not deleted');
  A.ok(pct <= 15, 'under constant mousing following is a small minority of ticks (' + pct + '% <= 15%) — a flick, not a track');
  A.ok(pct < 100, 'it is emphatically NOT the old always-track behavior (which was ~100% while the cursor was fresh)');
}

// ---- source lock: chatStareHold wires the helper in and maps 'cursor' → the live cursor dir ----
A.ok(/chatStareTrack\(self, now, fresh, reduceMotion\(\), U\.irnd\)/.test(src), 'chatStareHold calls chatStareTrack with reduceMotion + U.irnd injected');
A.ok(/face === 'cursor' \? dirToward\(self\.px, self\.py, lastCursor\.wx, lastCursor\.wy\) : 'south'/.test(src), "a 'cursor' beat faces the live cursor; otherwise south (at the Commander)");

A.report('chat-stare-throttle.test');
