/* node test/fork.test.js — the pure mid-task preference-fork engine (frontend/app/fork.js, R1).
   Locks: shouldOffer() gates on LOW style confidence and fails CLOSED (no read → no fork — an unearned
   interruption is the failure mode this feature must never have); the directive rides only via the caller;
   parse() reads the one-line FORK marker tolerantly but never yields a broken chip row (min 2 options,
   caps); strip() removes the marker from the rendered reply; beliefText() composes a legible banked
   belief. Pure + deterministic. */
'use strict';
const A = require('./_assert.js');
const F = require('../frontend/app/fork.js');

/* ---------- shouldOffer: the self-retiring confidence gate ---------- */
A.eq(F.shouldOffer({ dims: { style: { conf: 0.2 } } }), true, 'low style confidence earns the fork instruction');
A.eq(F.shouldOffer({ dims: { style: { conf: 0.6 } } }), false, 'a well-grounded style model retires the fork (self-retiring)');
A.eq(F.shouldOffer({ dims: { style: { conf: F.CONF_FLOOR } } }), false, 'the floor itself is NOT below the floor');
A.eq(F.shouldOffer(null), false, 'no understanding read → fail CLOSED (never an unearned interruption)');
A.eq(F.shouldOffer({}), false, 'malformed read → fail closed');
A.eq(F.shouldOffer({ dims: {} }), false, 'missing style dim → fail closed');

/* ---------- directive: present, bounded, format-locked ---------- */
const d = F.directive();
A.ok(d.indexOf('AT MOST ONCE per task') >= 0, 'the directive caps the fork at one per task');
A.ok(d.indexOf('FORK: <the question') >= 0, 'the directive teaches the exact marker format');
A.ok(d.indexOf('never ask a fork twice') >= 0, 'the directive forbids re-asking (the station remembers)');
A.ok(d.indexOf('one-off task details') >= 0, 'the directive excludes one-off task details (durable preferences only)');

/* ---------- parse: tolerant but never a broken chip row ---------- */
const p1 = F.parse('Here is the draft.\nFORK: terse summary or full detail? || terse | full detail');
A.eq(p1.question, 'terse summary or full detail?', 'parse reads the question');
A.eq(p1.options, ['terse', 'full detail'], 'parse reads the options');
const p3 = F.parse('FORK: how should reports read? || bullets | prose | mixed');
A.eq(p3.options.length, 3, 'parse accepts three options');
A.eq(F.parse('FORK: too many? || a | b | c | d').options.length, 3, 'options cap at three (never a menu)');
A.eq(F.parse('no marker here'), null, 'no marker → null');
A.eq(F.parse('FORK: only one option? || solo'), null, 'fewer than two options → null (renders as plain text, never a broken row)');
A.eq(F.parse('FORK: || a | b'), null, 'an empty question → null');
A.eq(F.parse(null), null, 'null input → null, never throws');
// caps: a rambling question/option is clipped, not rejected
const long = F.parse('FORK: ' + 'q'.repeat(300) + '? || ' + 'x'.repeat(90) + ' | b');
A.ok(long.question.length <= 160 && long.options[0].length <= 48, 'question and options are clipped to their caps');

/* ---------- strip: the marker never renders raw ---------- */
A.eq(F.strip('The draft is ready.\nFORK: terse or full? || terse | full'), 'The draft is ready.', 'strip removes the marker line');
A.eq(F.strip('no marker'), 'no marker', 'strip is a no-op without a marker');

/* ---------- beliefText: the banked belief stays legible ---------- */
A.eq(F.beliefText('terse summary or full detail?', 'terse'), 'terse (asked: terse summary or full detail?)', 'the belief carries answer + question context');
A.eq(F.beliefText('', 'bullets'), 'bullets', 'no question → the bare answer');
A.eq(F.beliefText('q?', ''), '', 'no answer → empty (the caller banks nothing)');

A.report('fork.test');
