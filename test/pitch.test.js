/* node test/pitch.test.js — the pure First Pitch engine (frontend/app/pitch.js).
   Locks the keystone promises: shouldPitch() fires once, only after a real task, only when the station knows
   enough to be confident; buildDirective() hard-constrains the agent to ONE buildable proposal in a strict
   parseable format; parsePitch() reads the reply back tolerantly; choices() is always the confident single
   pitch + a soft out (never a menu); present() carries the famous line. Pure + deterministic. */
'use strict';
const A = require('./_assert.js');
const P = require('../frontend/app/pitch.js');

/* ---------- fresh(): the fire-once persisted flag ---------- */
A.eq(P.fresh(), { v: 1, pitched: false }, 'fresh() starts un-pitched');

/* ---------- shouldPitch(): the graduation gate ---------- */
const ready = { firstTaskDone: true, alreadyPitched: false, knownDims: ['goals', 'identity'] };
A.eq(P.shouldPitch(ready), { go: true, reason: 'ready' }, 'pitches once task is done and it knows enough');
A.eq(P.shouldPitch(Object.assign({}, ready, { alreadyPitched: true })), { go: false, reason: 'already-pitched' }, 'never pitches twice (fire-once)');
A.eq(P.shouldPitch(Object.assign({}, ready, { firstTaskDone: false })), { go: false, reason: 'awaiting-first-task' }, 'no advice before it has done one real task');
A.eq(P.shouldPitch({ firstTaskDone: true, knownDims: ['identity', 'stack'] }), { go: false, reason: 'missing:goals' }, 'cannot pitch a build without knowing the goal');
A.eq(P.shouldPitch({ firstTaskDone: true, knownDims: ['goals'] }), { go: false, reason: 'too-cold' }, 'stays quiet when it barely knows the Commander');
A.eq(P.shouldPitch({}).go, false, 'defensive: empty state never pitches');
A.eq(P.shouldPitch().go, false, 'defensive: no state never pitches, never throws');

// the gate is configurable (the controller can tighten/loosen it)
A.eq(P.shouldPitch({ firstTaskDone: true, knownDims: ['stack', 'style'], requireDims: ['stack'], minKnown: 2 }), { go: true, reason: 'ready' }, 'requireDims + minKnown are honored');
A.eq(P.shouldPitch({ firstTaskDone: true, knownDims: ['goals', 'stack', 'style'], minKnown: 4 }), { go: false, reason: 'too-cold' }, 'a higher minKnown holds the pitch');
A.eq(P.REQUIRE_DIMS, ['goals'], 'goals is the default required dimension');

/* ---------- buildDirective(): one buildable proposal, strict format ---------- */
const dir = P.buildDirective({
  recipes: [{ id: 'morning-brief', name: 'Morning Brief', tagline: 'daily digest' }, { id: 'inbox-triage', name: 'Inbox Triage' }],
  capabilities: [{ id: 'computer', label: 'run code' }, { id: 'dish', label: 'web access' }],
  recentTask: 'wrote a hello file and verified it'
});
A.ok(typeof dir === 'string' && dir.length > 0, 'buildDirective returns a non-empty directive');
A.ok(/exactly one/i.test(dir), 'directive demands exactly one proposal (never a menu)');
A.ok(/buildable|cannot deliver/i.test(dir), 'directive forbids un-buildable fluff');
A.ok(dir.indexOf('recipe:morning-brief') >= 0, 'directive lists the real recipe shelf by id');
A.ok(dir.indexOf('daily digest') >= 0, 'directive carries a recipe tagline when present');
A.ok(/run code/.test(dir) && /web access/.test(dir), 'directive lists the capabilities it actually has');
A.ok(dir.indexOf('wrote a hello file and verified it') >= 0, 'directive references the first task it just did');
A.ok(/PITCH:/.test(dir) && /WHY:/.test(dir) && /BUILD:/.test(dir) && /GAP:/.test(dir), 'directive demands the strict tagged reply format');
A.ok(/pain|eats their time|recurring chore/i.test(dir), 'directive aims the pitch at the Commander pain points (Slice 6 — shared by First Pitch + the suggestion engine)');
A.ok(/keep meaning|ambition|what they actually want|never reach/i.test(dir), 'directive also aims at the Commander ambitions (Slice 7 — closing the pain->ambition gap)');

// deterministic — same ctx in, byte-identical directive out (cache-warmth + testability)
A.eq(P.buildDirective({ recipes: [{ id: 'x', name: 'X' }] }), P.buildDirective({ recipes: [{ id: 'x', name: 'X' }] }), 'buildDirective is deterministic');
// the recent-task line is omitted cleanly when there was none
A.ok(P.buildDirective({}).indexOf('You just did this') < 0, 'no recent-task line when there is no recent task');
// the recipe shelf is capped so the directive stays lean
const many = Array.from({ length: 12 }, (_, n) => ({ id: 'r' + (n + 1), name: 'R' + (n + 1) }));
const capped = P.buildDirective({ recipes: many, maxRecipes: 8 });
A.ok(capped.indexOf('recipe:r8') >= 0 && capped.indexOf('recipe:r9') < 0, 'buildDirective caps the listed recipes');

// G1c QUEST CHAINING: an unlockedCapability reframes the directive around the fresh capability ("what's next"),
// while keeping the SAME strict reply format so parsePitch reads it unchanged.
const chained = P.buildDirective({ recipes: [{ id: 'x', name: 'X' }], unlockedCapability: 'WEB' });
A.ok(/new capability: WEB/.test(chained), 'unlockedCapability grounds the pitch in the just-unlocked capability (the chaining follow-up)');
A.ok(/PITCH:/.test(chained) && /BUILD:/.test(chained) && /GAP:/.test(chained), 'the chained directive keeps the strict reply format (parsePitch reads it unchanged)');
A.ok(P.buildDirective({}).indexOf('new capability') < 0, 'no unlock line when nothing was chained (older callers untouched)');

/* ---------- parsePitch(): tolerant read-back ---------- */
const good = 'PITCH: a daily crypto-price watcher\nWHY: you said you check prices every morning\nBUILD: recipe:morning-brief\nGAP: which coins you actually care about';
A.eq(P.parsePitch(good), {
  title: 'a daily crypto-price watcher',
  why: 'you said you check prices every morning',
  // W2: the optional EVIDENCE line. A reply without one reads '' — an absent receipt, never a fabricated quote.
  evidence: '',
  gap: 'which coins you actually care about',
  build: { kind: 'recipe', recipeId: 'morning-brief' }
}, 'parses a well-formed recipe pitch');

A.eq(P.parsePitch('PITCH: a custom thing\nBUILD: workflow').build, { kind: 'workflow', recipeId: null }, 'a non-recipe pitch is a workflow build');
A.eq(P.parsePitch('here you go!\n  pitch:  lowercase tags work  \n  why: sure').title, 'lowercase tags work', 'parse is case-insensitive and trims surrounding chatter');
A.eq(P.parsePitch('PITCH: just a title').why, '', 'missing optional fields default to empty, not undefined');
A.eq(P.parsePitch('no tagged pitch here'), null, 'unparseable reply → null (caller falls back)');
A.eq(P.parsePitch(''), null, 'empty reply → null');
A.eq(P.parsePitch(null), null, 'null reply → null, never throws');

/* ---------- choices(): the confident single pitch, never a menu ---------- */
const ch = P.choices();
A.eq(ch.length, 2, 'always exactly two choices — commit or a soft out');
A.eq(ch.map(c => c.value), ['build', 'other'], 'the two choices are build + escape hatch');

/* ---------- present(): the famous line, one tested home ---------- */
const line = P.present({ title: 'a watcher', why: 'you check prices daily.', gap: 'which coins' });
A.ok(/i think i know what we should build/i.test(line), 'present() opens with the keystone line');
A.ok(line.indexOf('a watcher') >= 0 && line.indexOf('which coins') >= 0, 'present() carries the title and the gap');
A.ok(P.present({ title: 'x' }).indexOf('the one thing i need') < 0, 'present() omits the gap clause when there is no gap');
A.eq(P.present(null), '', 'present(null) → empty string');
A.eq(P.present({ title: '' }), '', 'present() of a titleless pitch → empty string');

/* ---------- titleSentence(): the shared title→sentence join (no double-period) ---------- */
A.eq(P.titleSentence('build a dashboard'), 'build a dashboard.', 'a bare title gets exactly one full stop');
A.eq(P.titleSentence('build a dashboard.'), 'build a dashboard.', 'a model-supplied trailing period does NOT double up');
A.eq(P.titleSentence('build a dashboard...'), 'build a dashboard.', 'trailing dots collapse to a single full stop');
A.eq(P.titleSentence('  spaced out  '), 'spaced out.', 'the title is trimmed before the stop');
A.eq(P.titleSentence('a watcher, really?'), 'a watcher, really?', 'a deliberate question mark is preserved (no period appended)');
A.eq(P.titleSentence('do it now!'), 'do it now!', 'a deliberate exclamation is preserved');
A.eq(P.titleSentence('wait…'), 'wait…', 'a real ellipsis is preserved');
// present() routes through titleSentence — a period-terminated pitch never renders ".."
const dot = P.present({ title: 'a daily standup note.' });
A.ok(dot.indexOf('..') < 0, 'present() never double-punctuates when the model ends the title with a period');
A.ok(dot.indexOf('a daily standup note.') >= 0, 'present() keeps the single clean full stop');

/* ---------- end-to-end: a reply to the real directive parses into an offered recipe ---------- */
const reply = 'PITCH: a morning brief on your project\nWHY: matches your goal\nBUILD: recipe:morning-brief\nGAP: the topic to watch';
const parsed = P.parsePitch(reply);
A.eq(parsed.build.recipeId, 'morning-brief', 'a reply maps cleanly to a recipe the directive offered');

/* ---------- shouldSuggest(): the ongoing-idea cadence (Slice 3) ---------- */
const sok = { firstPitchDone: true, knownDims: ['goals', 'identity'], familiarity: 0.6, lastFamiliarity: 0.4, tasksSinceLast: 3, sessionShown: 0 };
A.eq(P.shouldSuggest(sok), { go: true, reason: 'ready' }, 'suggests when it has learned something new, after the cooldown, with budget');
A.eq(P.shouldSuggest(Object.assign({}, sok, { firstPitchDone: false })), { go: false, reason: 'no-first-pitch' }, 'ongoing ideas never precede the First Pitch (graduation first)');
A.eq(P.shouldSuggest(Object.assign({}, sok, { knownDims: ['identity'] })), { go: false, reason: 'missing:goals' }, 'cannot propose a build without knowing the goal');
A.eq(P.shouldSuggest(Object.assign({}, sok, { sessionShown: 1 })), { go: false, reason: 'session-spent' }, 'at most one gentle idea per session (anti-nag)');
A.eq(P.shouldSuggest(Object.assign({}, sok, { tasksSinceLast: 2 })), { go: false, reason: 'cooldown' }, 'holds for a task cooldown between ideas');
A.eq(P.shouldSuggest(Object.assign({}, sok, { familiarity: 0.4 })), { go: false, reason: 'nothing-new' }, 'stays quiet until the dossier has actually grown');
A.eq(P.shouldSuggest(Object.assign({}, sok, { lastFamiliarity: 0.6 })), { go: false, reason: 'nothing-new' }, 'equal familiarity is not "new" — no idea');
// the cadence knobs are configurable + exported
A.eq(P.shouldSuggest(Object.assign({}, sok, { tasksSinceLast: 1, minGap: 1 })), { go: true, reason: 'ready' }, 'minGap is honored');
A.eq(P.shouldSuggest(Object.assign({}, sok, { sessionShown: 1, sessionCap: 2 })), { go: true, reason: 'ready' }, 'sessionCap is honored');
A.eq(P.shouldSuggest({}).go, false, 'defensive: empty state never suggests, never throws');
A.eq(P.SUGGEST_MIN_GAP, 3, 'default cooldown is 3 tasks');
A.eq(P.SUGGEST_SESSION_CAP, 1, 'default session cap is one idea');

/* ---------- the STARTER — the guaranteed floor under the tutorial's close ---------- */
const sd0 = P.buildStarterDirective({ capabilities: [] });
A.ok(/INTERNAL/.test(sd0) && /Do not run any tools/.test(sd0), 'starter directive is internal + reason-only');
A.ok(/NO placed tools yet — compute only/.test(sd0), 'a toolless station is stated honestly (no promised reach)');
A.ok(/^MOVE:/m.test(sd0) && /^WHY:/m.test(sd0), 'starter directive demands MOVE/WHY');
A.ok(/LEARNS the most/.test(sd0), 'a cold dossier steers the move toward learning-while-delivering');
const sd1 = P.buildStarterDirective({ capabilities: [{ id: 'cabinet', label: 'FILES' }, { id: 'web', label: 'WEB' }] });
A.ok(sd1.indexOf('FILES, WEB') >= 0, 'placed capabilities are named (the honest envelope)');
A.eq(sd0, P.buildStarterDirective({ capabilities: [] }), 'buildStarterDirective is deterministic');
const sp = P.parseStarter('chatter\nMOVE: draft a one-page plan for your channel\nWHY: it maps the work you keep shelving.\nmore chatter');
A.ok(sp && sp.move === 'draft a one-page plan for your channel' && /shelving/.test(sp.why), 'parseStarter grabs MOVE/WHY through chatter');
A.eq(P.parseStarter('WHY: reasons but no move'), null, 'no MOVE → null (the caller falls back to the quest pointer)');
A.eq(P.parseStarter(''), null, 'empty starter reply → null');
const spres = P.presentStarter(sp);
A.ok(spres.indexOf('✦ first move — ') === 0 && /want me to start\?$/.test(spres), 'presentStarter composes the gentle offer');
A.ok(spres.indexOf('..') < 0, 'no double punctuation in the starter line');
A.eq(P.presentStarter(null), '', 'presentStarter is defensive');
const sch = P.starterChoices();
A.eq(sch.length, 2, 'starter is exactly two choices — commit or a soft out, never a menu');
A.eq(sch[0].value, 'run', 'first choice runs it');
A.ok(sch[1].skip === true, 'the out is a skip');

/* ---------- R3: the belief-probe aim is additive + optional ---------- */
const dvNorm = P.buildDirective({ recipes: [], capabilities: [] });
A.ok(dvNorm.indexOf('AIM THIS ONE CAREFULLY') < 0, 'no probe → the normal un-aimed directive (most sessions)');
const dvProbe = P.buildDirective({ recipes: [], capabilities: [], probe: { dim: 'ambition', text: 'launch the newsletter' } });
A.ok(dvProbe.indexOf('AIM THIS ONE CAREFULLY') >= 0, 'a probe aims the directive');
A.ok(dvProbe.indexOf('launch the newsletter') >= 0, 'the probe carries the sagging belief text');
A.ok(dvProbe.indexOf('Do not mention this aiming') >= 0, 'the probe is silent — the agent never asks "is this still true"');
A.ok(dvProbe.indexOf('PITCH: <one line') >= 0, 'the strict reply format is unchanged (parsePitch reads an aimed reply identically)');
A.ok(P.buildDirective({ probe: { dim: 'ambition' } }).indexOf('AIM THIS') < 0, 'a malformed probe (no text) is ignored, never a broken line');

A.report('pitch.test');
