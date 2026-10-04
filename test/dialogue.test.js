/* node test/dialogue.test.js — the GENESIS naming guard (frontend/app/dialogue.js).

   dialogue.js is browser-flow code, but its naming primitives (codename / isUnnamed) are PURE and touch no DOM
   at module load, so they load under node like xp.js. The invariant: a blank / whitespace / placeholder overseer
   name never leaves the awakening labelled with the bland generic 'AGENT' — it mints a real station codename
   instead, WITHOUT hard-blocking the flow (sandbox-no-gating: never trap the Commander on the name field). A real
   typed name is always honoured verbatim (trimmed + clamped to the 18-char nameplate cap). */
'use strict';
const A = require('./_assert.js');
const { Dialogue } = require('../frontend/app/dialogue.js');

// ---- codename(): a real, eerie-not-cute designation — never blank, never over the nameplate cap, never 'AGENT' ----
A.ok(typeof Dialogue.codename === 'function', 'codename() is exported');
const picks = [];
for (let i = 0; i < 200; i++) picks.push(Dialogue.codename());
A.ok(picks.every(n => typeof n === 'string' && n.length > 0), 'every codename is a non-empty string');
A.ok(picks.every(n => n.length <= 18), 'every codename honours the 18-char nameplate cap');
A.ok(picks.every(n => n === n.toUpperCase()), 'codenames are uppercase (station designation style)');
A.ok(picks.every(n => n.trim().toUpperCase() !== 'AGENT'), 'a minted codename is NEVER the bland generic AGENT');
A.ok(new Set(picks).size >= 5, 'the codename pool has real variety (>=5 distinct over 200 draws)');

// ---- isUnnamed(): blank / whitespace / the AGENT placeholder all read as "no real identity"; a real name does not ----
A.ok(typeof Dialogue.isUnnamed === 'function', 'isUnnamed() is exported');
A.eq(Dialogue.isUnnamed(''), true, 'empty string is unnamed');
A.eq(Dialogue.isUnnamed('   '), true, 'whitespace-only is unnamed');
A.eq(Dialogue.isUnnamed(null), true, 'null is unnamed');
A.eq(Dialogue.isUnnamed(undefined), true, 'undefined is unnamed');
A.eq(Dialogue.isUnnamed('AGENT'), true, 'the bland literal AGENT is treated as unnamed (the sentinel the WAKE funnel passes for a blank input)');
A.eq(Dialogue.isUnnamed('agent'), true, 'AGENT is matched case-insensitively');
A.eq(Dialogue.isUnnamed('  agent  '), true, 'AGENT with surrounding whitespace still reads as the placeholder');
A.eq(Dialogue.isUnnamed('ORION'), false, 'a real name is NOT unnamed');
A.eq(Dialogue.isUnnamed('Agent Smith'), false, 'a real name that merely CONTAINS agent is not the placeholder');

// ---- setName never hard-blocks and never regresses to the bland placeholder (pure-logic reachable in node: no DOM
//      is touched because the panel is not mounted, so speakerEl is null and the textContent write is skipped) ----
A.notThrows(() => Dialogue.setName(''), 'setName("") never throws or traps — the flow always advances');
A.notThrows(() => Dialogue.setName(null), 'setName(null) is safe');
A.notThrows(() => Dialogue.setName('NOVA'), 'setName with a real name is safe');

/* ---- answer(): the composer path into the pending question (awakening answer-swallow fix, 2026-07-20) ----
   Pure-logic reachable in node: with no node pending, answer() must be a safe no-op that reports false —
   the caller (onboarding's beginInterview handler) relies on that to swallow stray mid-monologue typing. */
A.ok(typeof Dialogue.answer === 'function', 'answer() is exported (the COMMS composer can resolve a pending question)');
A.eq(Dialogue.answer('stray typing between questions'), false, 'answer() with no pending node is a safe no-op (false)');
A.notThrows(() => Dialogue.answer(null), 'answer(null) never throws');

// the window key handler must never let typing in a real text field drive the option picker (digits used to
// click options and Enter hijacked the flow mid-sentence). Source-level: the guard sits at the top of keyHandler.
const dlgSrc = require('fs').readFileSync(require('path').join(__dirname, '../frontend/app/dialogue.js'), 'utf8');
A.ok(/keyHandler = e => \{[\s\S]{0,600}(INPUT|TEXTAREA)[\s\S]{0,200}isContentEditable[\s\S]{0,60}return;/.test(dlgSrc),
  'keyHandler ignores keys originating from INPUT/TEXTAREA/contentEditable targets');

/* ---- the READ GATE (2026-08-05): onboarding text used to type out and roll on before anyone could finish
   reading — and a beat REPLACES the previous one, so the unread words were simply destroyed. The law now:
   a narration beat WAITS for the Commander (space / enter / click) by default; only an explicit
   { auto: true } (transient latency-cover lines like "give me a second…") keeps the timed auto-advance.
   The gate is DOM-bound, so these are source-level locks like the keyHandler guard above. */
A.ok(/function say\(lines, opts\)/.test(dlgSrc), 'say() accepts opts — the auto escape hatch exists');
A.ok(/const auto = !!\(opts && opts\.auto\);/.test(dlgSrc), 'the gate is the DEFAULT: only an explicit auto:true opts out');
A.ok(/if \(auto\) \{ setTimeout\(finish, \d+\); return; \}\s*\n\s*armGate\(finish\);/.test(dlgSrc),
  'a finished narration beat arms the read gate; only auto beats resolve on a timer');
A.ok(/function closePanel\(\) \{[\s\S]{0,300}clearGate\(true\)/.test(dlgSrc),
  'closePanel flushes a waiting gate (fire=true) — a flow awaiting say() can never hang on teardown');
A.ok(/function closePanel\(\) \{[\s\S]{0,400}flushSay\(\)/.test(dlgSrc),
  'closePanel also flushes a say() still MID-TYPE (cancelType drops onDone, so the gate never arms) — proven live: without this the awaiting flow hangs');
A.ok(/const onKey = e => \{\s*if \(fromTextField\(e\)\) return;/.test(dlgSrc),
  'gate keys ignore keystrokes that belong to a real text field (composer guard)');
A.ok(/onSkipKey = e => \{ if \(fromTextField\(e\)\) return;/.test(dlgSrc),
  'mid-type skip keys honour the same text-field guard');
A.ok(/skipNow = \(\) => \{[\s\S]{0,220}done\(\);/.test(dlgSrc),
  'an impatient tap mid-type reveals the FULL beat and still fires done (never a dropped continuation)');

/* ---- THE INK STAMP (2026-08-05): a dossier write shows its receipt in the panel. DOM-bound → source locks. */
A.ok(typeof Dialogue.ink === 'function', 'ink() is exported (onboarding stamps real dossier writes)');
A.notThrows(() => Dialogue.ink('pain: test line'), 'ink() with no panel mounted is a safe no-op');
A.ok(/inkEl\.textContent = '» filed · ' \+ t;/.test(dlgSrc), 'the stamp is a ledger receipt (» filed · …)');
A.ok(/function closePanel\(\) \{[\s\S]{0,600}clearTimeout\(inkTimer\)/.test(dlgSrc),
  'closePanel clears the ink fade timer (no dangling timeout after teardown)');

A.report('dialogue.test');
