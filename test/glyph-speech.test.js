/* node test/glyph-speech.test.js — THE STATION'S OWN TONGUE (W6, 2026-08-16).

   THE ASK: "when the agents appear to interact with each other, a speech bubble pops up above
   their heads with language that can't be transcripted." W4/W5 already made two (or three) idle
   bodies meet, face each other and take turns mouthing. What was missing was the bubble.

   THE PROPERTY THAT MATTERS MOST IS THE UNREADABILITY, and it is not a joke — it is the honest
   register. A social beat is ambient station LIFE: no message crossed the bus, no run happened,
   nothing was said. A bubble carrying words would be the app asserting content the harness
   cannot prove, which is the one thing this product never does. A script that is not a language
   asserts only the true part: these two are talking, right now. So the rule this file exists to
   defend is that NOTHING ON THIS PATH IS TEXT — a rune is geometry, and if a later change ever
   swaps in characters (a font, a codepoint, a canned phrase list) this test goes red.

   world.js is a browser IIFE (can't require under node), so — exactly like talk-turn.test.js —
   this extracts the marked pure block from the SOURCE and executes it: the shipped alphabet is
   under test, not a copy of it.

   Contract under test:
     • the alphabet is pure geometry (no strings, no codepoints, nothing transcribable)
     • every stroke stays inside its own 4x6 cell (a glyph can never bleed onto its neighbour)
     • strokes are horizontal / vertical / true 45° only (anything else is fuzzy at 1px)
     • one seed ⇒ one phrase, always (a line holds still for the turn it is on screen)
     • different speakers/turns ⇒ different lines (it is not one canned string)
     • a speaker only ever draws runes from its OWN dialect, and dialects actually differ
     • phrase size is bounded, so the bubble it feeds cannot overflow
     • the WIRING: the line is rolled on the turn's rising edge, refuses the silent beat kinds,
       is cleared when the encounter ends, and never outranks a REAL spoken line */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');

// ---- extract + execute the marked pure block from the real source ----
const src = fs.readFileSync(path.join(__dirname, '../frontend/app/world.js'), 'utf8');
const BEGIN = 'GLYPH-SPEECH-PURE-BEGIN', END = 'GLYPH-SPEECH-PURE-END';
const i0 = src.indexOf(BEGIN), i1 = src.indexOf(END);
A.ok(i0 >= 0 && i1 > i0, 'world.js carries the GLYPH-SPEECH-PURE extraction markers');
const block = src.slice(src.indexOf('*/', i0) + 2, src.lastIndexOf('/*', i1));
A.ok(/const RUNES = \[/.test(block) && /function glyphPhrase\(/.test(block), 'the marked block holds the alphabet and the phrase builder');
const codeOnly = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
A.ok(!/\bself\.|\bU\.|\bMath\.random|\bDate\b|\bdocument\b|\bwindow\b|\bctx\b|\bsocialBeat\b/.test(codeOnly),
  'the block is PURE (no module state / ambient RNG / DOM — safe to execute standalone)');
const { RUNES, RUNE_W, RUNE_H, DIALECT_SIZE, glyphDialect, glyphPhrase, glyphRnd, chatterWindow,
        PHRASE_WORDS_MIN, PHRASE_WORDS_MAX, WORD_RUNES_MIN, WORD_RUNES_MAX } =
  eval('(function(){' + block + '\nreturn { RUNES, RUNE_W, RUNE_H, DIALECT_SIZE, glyphDialect, glyphPhrase, glyphRnd, chatterWindow,'
     + ' PHRASE_WORDS_MIN, PHRASE_WORDS_MAX, WORD_RUNES_MIN, WORD_RUNES_MAX };})()');

// ---- THE ALPHABET IS GEOMETRY, NOT TEXT (the whole point) ----
A.ok(Array.isArray(RUNES) && RUNES.length >= 12, 'there is a real alphabet, not a handful of squiggles');
A.ok(RUNES.length <= 24, 'and a small one — a huge glyph set reads as noise, a small one reads as a script');
let strokes = 0;
for (let i = 0; i < RUNES.length; i++) {
  const rune = RUNES[i];
  A.ok(Array.isArray(rune) && rune.length > 0, 'rune ' + i + ' is a non-empty stroke list');
  for (const s of rune) {
    strokes++;
    A.ok(Array.isArray(s) && s.length === 4 && s.every(n => typeof n === 'number' && Number.isInteger(n)),
      'rune ' + i + ' stroke is four integer lattice coordinates — geometry, never a character');
    const [x1, y1, x2, y2] = s;
    // INSIDE ITS OWN CELL: a stroke that left the lattice would paint over the neighbouring rune
    A.ok(x1 >= 0 && x1 <= RUNE_W && x2 >= 0 && x2 <= RUNE_W, 'rune ' + i + ' stays within the cell horizontally');
    A.ok(y1 >= 0 && y1 <= RUNE_H && y2 >= 0 && y2 <= RUNE_H, 'rune ' + i + ' stays within the cell vertically');
    // ONLY H / V / TRUE 45°: any other slope is a fuzzy staircase at one-pixel stroke weight
    const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
    A.ok(dx === 0 || dy === 0 || dx === dy, 'rune ' + i + ' stroke is horizontal, vertical or a true 45° — never a fuzzy slope');
    A.ok(dx + dy > 0, 'rune ' + i + ' has no zero-length stroke (a stray dot is not a mark)');
  }
}
A.ok(strokes >= RUNES.length * 2, 'the runes carry real structure (more than one stroke each on average)');
// no rune is describable as a character anywhere on the path — the source block holds no glyph literals
A.ok(!/['"`]/.test(codeOnly.replace(/RUNE|GLYPH|DIALECT|PHRASE|WORD/g, '')),
  'the pure block contains NO string literals at all — there is literally nothing here to transcribe');

// ---- SEEDED, SO A LINE HOLDS STILL WHILE IT IS ON SCREEN ----
const dA = glyphDialect(0x1234abcd);
const p1 = glyphPhrase(777, dA), p2 = glyphPhrase(777, dA);
A.eq(JSON.stringify(p1), JSON.stringify(p2), 'the same seed yields the SAME phrase — a turn does not shimmer between frames');
A.ok(JSON.stringify(glyphPhrase(778, dA)) !== JSON.stringify(p1), 'a different turn yields a different line — not one canned string');

// a broad sweep: the tongue must not collapse onto a couple of favourite phrases
const seen = new Set();
for (let s = 0; s < 400; s++) seen.add(JSON.stringify(glyphPhrase(s * 2654435761 >>> 0, dA)));
A.ok(seen.size > 300, 'the phrase space is wide (' + seen.size + '/400 distinct) — it reads as speech, not a loop');

// ---- BOUNDED, SO THE BUBBLE IT FEEDS CANNOT OVERFLOW ----
let maxWords = 0, maxRunes = 0, minWords = 99;
for (let s = 0; s < 2000; s++) {
  const ph = glyphPhrase(s + 1, dA);
  A.ok(Array.isArray(ph), 'a phrase is always a list of words');
  maxWords = Math.max(maxWords, ph.length); minWords = Math.min(minWords, ph.length);
  for (const w of ph) {
    maxRunes = Math.max(maxRunes, w.length);
    A.ok(w.length >= WORD_RUNES_MIN, 'a word is never a single lonely mark');
    for (const idx of w) A.ok(Number.isInteger(idx) && idx >= 0 && idx < RUNES.length, 'every rune index is a real rune');
  }
}
A.eq(maxWords, PHRASE_WORDS_MAX, 'the longest line hits the declared word ceiling...');
A.eq(minWords, PHRASE_WORDS_MIN, '...and the shortest hits the floor — the whole declared range is reachable');
A.eq(maxRunes, WORD_RUNES_MAX, 'a word never exceeds the declared rune ceiling — the bubble width is bounded by construction');
A.eq(glyphPhrase(1, []).length, 0, 'an empty dialect yields no phrase (silence) rather than throwing');
A.eq(glyphPhrase(1, null).length, 0, 'a missing dialect is silence too');

// ---- DIALECT: each speaker keeps to its own alphabet, and speakers actually differ ----
const dB = glyphDialect(0xfeedface);
A.eq(dA.length, DIALECT_SIZE, 'a dialect is the declared size');
A.ok(DIALECT_SIZE < RUNES.length, 'a dialect is a strict SUBSET — no speaker uses the whole alphabet');
A.eq(new Set(dA).size, dA.length, 'a dialect has no repeated runes');
A.ok(dA.every(i => Number.isInteger(i) && i >= 0 && i < RUNES.length), 'a dialect names only real runes');
A.eq(JSON.stringify(glyphDialect(0x1234abcd)), JSON.stringify(dA), 'a speaker keeps the SAME dialect every time it is asked');
A.ok(JSON.stringify(dA) !== JSON.stringify(dB), 'two speakers get different dialects — a trio reads as three voices, not one noise source');
for (let s = 0; s < 500; s++) for (const w of glyphPhrase(s, dA)) for (const idx of w) {
  A.ok(dA.indexOf(idx) >= 0, 'a speaker only ever draws runes from its OWN dialect');
}
// dialects must not all converge on the same subset
const dialects = new Set();
for (let s = 1; s <= 60; s++) dialects.add(glyphDialect(s * 2654435761 >>> 0).join(','));
A.ok(dialects.size > 40, 'dialects are genuinely varied across speakers (' + dialects.size + '/60 distinct)');

/* ---- THE REGRESSION THIS CAUGHT (live probe, 5 runs, 2026-08-16) ----
   The bubble used to live a fixed CHATTER_MS from its own stamp, which is only correct for a body
   that starts speaking exactly on its slot boundary. A body that ARRIVES LATE joins its turn
   already in progress, so its bubble was still fading well into the NEXT speaker's turn: run 5 of
   the probe caught TWO bubbles up at once. The window is now anchored to the SLOT, so every body
   holding turn k — whenever it joined — is gone at the same instant. */
const SLOT_T = 1700, SPEAK_T = 1150, FADE_T = 260;
const w0 = chatterWindow(0, 0, SLOT_T, SPEAK_T, FADE_T);
A.eq(w0.turn, 0, 'the opening instant is turn 0');
A.eq(w0.until, SPEAK_T + FADE_T, 'and its bubble is gone when the mouth stops, plus the fade');
// EVERY join time inside one turn yields the SAME deadline — that is the whole fix
for (let join = 0; join < SPEAK_T; join += 7) {
  const w = chatterWindow(0, join, SLOT_T, SPEAK_T, FADE_T);
  A.eq(w.turn, 0, 'a body joining ' + join + 'ms into turn 0 is still on turn 0');
  A.eq(w.until, w0.until, 'a LATE joiner ends with the TURN, not CHATTER_MS after it started');
}
// consecutive turns can never have overlapping windows
for (let k = 0; k < 12; k++) {
  const cur = chatterWindow(0, k * SLOT_T, SLOT_T, SPEAK_T, FADE_T);
  const next = chatterWindow(0, (k + 1) * SLOT_T, SLOT_T, SPEAK_T, FADE_T);
  A.eq(next.turn, k + 1, 'the slot boundary advances the turn');
  A.ok(cur.until <= (k + 1) * SLOT_T, 'turn ' + k + '\'s bubble is gone before turn ' + (k + 1) + ' opens its mouth');
  A.ok(next.until > cur.until, 'and the next window is strictly later — no window ever runs backwards');
}
// the LATEST any body can legally join a turn still cannot spill into the next one
const late = chatterWindow(0, SPEAK_T - 1, SLOT_T, SPEAK_T, FADE_T);
A.ok(late.until <= SLOT_T, 'even a body joining on the last millisecond of its turn is gone before the next speaker starts');
A.eq(chatterWindow(0, -500, SLOT_T, SPEAK_T, FADE_T).turn, 0, 'a negative elapsed (clock skew) clamps to turn 0 rather than a negative window');

/* ---- ⛔ THE SAME AGENT MUST NOT REPLAY ONE SCRIPT IN EVERY CONVERSATION (2026-08-16) ----
   Andrew: "it wont repeat the same made up language everytime?" It did. `turn` counts from the
   start of the ENCOUNTER, so it resets to 0 every time two agents meet — seeding on (id, turn)
   meant an agent said the identical opening line, then the identical second line, in every
   conversation for the life of the station. Two separate live probe runs logged byte-identical
   phrases for the same bodies, which is how it was caught. The seed is now the turn's ABSOLUTE
   deadline, which names this turn of THIS encounter and nothing else. */
const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const seedOf = (id, win) => fnv(id + '@' + Math.round(win.until));
const encA = chatterWindow(10000, 0, SLOT_T, SPEAK_T, FADE_T);
const encB = chatterWindow(58314, 0, SLOT_T, SPEAK_T, FADE_T);
A.eq(encA.turn, encB.turn, 'both are turn 0 — of two different encounters');
A.ok(encA.until !== encB.until, 'but their absolute deadlines differ, which is what makes the seed differ');
A.ok(JSON.stringify(glyphPhrase(seedOf('NOVA', encA), dA)) !== JSON.stringify(glyphPhrase(seedOf('NOVA', encB), dA)),
  'so the SAME agent opens two different conversations with two different lines');
// ...and it stays deterministic WITHIN a turn — that is what keeps the bubble from shimmering
A.eq(JSON.stringify(glyphPhrase(seedOf('NOVA', encA), dA)), JSON.stringify(glyphPhrase(seedOf('NOVA', encA), dA)),
  'the same turn of the same encounter always yields the same line');
// a long sweep of encounters: openings must not collapse onto a handful of phrases
const openings = new Set();
for (let e = 0; e < 300; e++) {
  const w = chatterWindow(7000 + e * 41111, 0, SLOT_T, SPEAK_T, FADE_T);
  openings.add(JSON.stringify(glyphPhrase(seedOf('NOVA', w), dA)));
}
A.ok(openings.size > 280, 'across 300 conversations an agent opens with ' + openings.size + ' distinct lines — it does not have a catchphrase');
// two agents in the SAME encounter+turn still differ (the id is in the seed, not just the clock)
A.ok(JSON.stringify(glyphPhrase(seedOf('NOVA', encA), dA)) !== JSON.stringify(glyphPhrase(seedOf('BIT', encA), dA)),
  'two speakers never share a line just because they share a clock');

// ---- the seeded stream itself is well-formed ----
const r = glyphRnd(12345);
for (let i = 0; i < 5000; i++) { const v = r(); A.ok(v >= 0 && v < 1, 'the seeded stream stays in [0,1)'); }
A.ok(glyphRnd(0)() !== undefined, 'a zero seed still produces a stream (never NaN/undefined)');

// ---- THE WIRING (source-level: these are the properties a pure block cannot hold) ----
// rolled ONCE on the rising edge of the turn — never in the draw path (that would be a shimmer)
const setTalkingFn = src.slice(src.indexOf('function setTalking('), src.indexOf('/* Enter the face-each-other hold'));
A.ok(/const rising = !!on && !b\.talking/.test(setTalkingFn) && /if \(rising\) startChatter\(b\)/.test(setTalkingFn),
  'the line is rolled on the RISING EDGE of a turn, once — not per frame');
const startFn = src.slice(src.indexOf('function startChatter('), src.indexOf('// `talking` is the world'));
A.ok(/isTalkKind\(b\.social\.kind\)/.test(startFn),
  'a bubble refuses the SILENT beat kinds — a watch/follow carries no conversation to draw');
A.ok(/b\.chatter = null/.test(startFn), 'and clears any stale line rather than leaving one behind');
A.ok(/glyphPhrase\(U\.hash\(String\(b\.id\) \+ '@' \+ Math\.round\(w\.until\)\), dialectFor\(b\)\)/.test(startFn),
  'the seed is the speaker plus the turn\'s ABSOLUTE instant — never the turn INDEX, which resets every encounter');
A.ok(!/U\.hash\([^)]*\+ w\.turn\)/.test(startFn),
  'the bare turn index is NOT the seed (it would replay one identical script in every conversation)');
A.ok(/chatterWindow\(socialBeat\.startedAt, fnow - socialBeat\.startedAt, TALK_SLOT_MS, TALK_SPEAK_MS, CHATTER_FADE_MS\)/.test(startFn),
  'the deadline is computed off the ENCOUNTER clock through chatterWindow — never off the body\'s own arrival');
A.ok(/until: w\.until/.test(startFn), 'and it is stamped on the line, so the draw path never re-derives it');

// the bubble dies WITH the encounter (the same law as the mouth-moving pose above it)
const endFn = src.slice(src.indexOf('function endEncounter('), src.indexOf('function encounterBroken('));
A.ok(/if \(body\) body\.chatter = null;/.test(endFn),
  'teardown clears every participant\'s bubble — a line left over a body no longer talking is a lie');

// a REAL spoken line always wins the anchor; the two can never stack over one head
const drawFn = src.slice(src.indexOf('function drawBubble('), src.indexOf('function bubbleChrome('));
A.ok(/if \(!s\.text \|\| \(s\.until < now && !speakingNow\)\) \{ drawChatterBubble\(now, who\); return; \}/.test(drawFn),
  'chatter draws ONLY when there is no real line to say — one function, one bubble, never two over a head');

// bounded lifetime: the bubble cannot outlive its own stamp even if a teardown is missed
const chatterFn = src.slice(src.indexOf('function drawChatterBubble('), src.indexOf('/* One rune, as pixel rects.'));
A.ok(/if \(age < 0 \|\| age > CHATTER_MS \|\| now > ch\.until\) \{ who\.chatter = null; return; \}/.test(chatterFn),
  'the turn\'s deadline ends the bubble, with CHATTER_MS as a hard backstop against a clock jump');
A.ok(/\(ch\.until - now\) \/ CHATTER_FADE_MS/.test(chatterFn),
  'the FADE keys off that same deadline too — otherwise a late joiner would vanish mid-fade');
A.ok(!/fillText|ctx\.font/.test(chatterFn) && !/fillText|ctx\.font/.test(src.slice(src.indexOf('function drawRune('), src.indexOf('function setOnClick('))),
  'the chatter bubble draws NO TEXT — no font, no fillText, nothing a screen-reader or a screenshot could transcribe');
const SPEAK = Number((src.match(/TALK_SPEAK_MS\s*=\s*(\d+)/) || [])[1]);
const FADE = Number((src.match(/CHATTER_FADE_MS\s*=\s*(\d+)/) || [])[1]);
const SLOT = Number((src.match(/TALK_SLOT_MS\s*=\s*(\d+)/) || [])[1]);
A.ok(SPEAK > 0 && FADE > 0 && SLOT > SPEAK, 'the shipped timings are readable from world.js');
A.ok(/CHATTER_MS = TALK_SPEAK_MS \+ CHATTER_FADE_MS/.test(src),
  'the bubble lives exactly as long as the mouth moves, plus its fade — it is tied to the pose, not a free timer');
A.ok(SPEAK + FADE < SLOT + SPEAK, 'the fade tail closes before this speaker\'s next turn could open');
A.ok(FADE < SLOT - SPEAK, 'the fade finishes inside the silence between turns — two bubbles can never be on screen at once');

A.report('glyph-speech.test');
