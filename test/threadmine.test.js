/* node test/threadmine.test.js — the PURE post-run thread-mining producer (NS-6).

   Proves: tagged THREAD/QUOTE/DO/CONFIDENCE blocks parse into candidates; the GROUNDING VETO drops any idea whose
   quote is NOT verbatim in the conversation (invented ideas die); the SUBSTANCE VETO drops grounded-but-worthless
   candidates (no DO deliverable, or confidence below high — the 2026-07-08 banter escape); fingerprint dedup vs
   the live ledger AND the permanent declined denylist (a declined idea is never re-mined); the count cap; the
   NONE/empty/throw paths (a failed mine never hurts the run); and that mining STASHES candidates only — it never
   writes (stash, not auto-commit). */
'use strict';
const A = require('./_assert.js');
const { mine, parse, buildPrompt, mineSalient, fingerprint } = require('../sidecar/threadmine.js');
const { makeClock } = require('../shared/clock-rng.js');

// a full valid block: THREAD + verbatim QUOTE + concrete DO + high CONFIDENCE
function block(title, quote, starter, conf) {
  return 'THREAD: ' + title + '\nQUOTE: ' + quote + '\nDO: ' + (starter || 'build a working first version of it') +
    '\nCONFIDENCE: ' + (conf || 'high') + '\n';
}

(async () => {
  const run = { agentId: 'ag', runId: 'run_3', streamId: 's1', messages: [
    { role: 'system', content: 'SYS — stripped' },
    { role: 'user', content: 'Can you fix this bug in my parser? Also, unrelated, I keep thinking I should build a price watcher for GPUs someday so I can snag one at MSRP, and honestly I want a Discord bot for my server too for moderation — but not now, just fix the parser bug for me today please. Oh, I\'m gonna be throwing some real crazy chaos at you, my G. It\'s gonna be crazy.' },
    { role: 'assistant', content: 'Fixed the parser bug — it was an off-by-one in the tokenizer. The other two ideas (price watcher, Discord bot) were not acted on in this run.' }
  ] };

  // ---- happy path: two grounded+substantive threads survive; the invented one dies on the grounding veto ----
  const stub = () =>
    block('GPU price watcher', 'build a price watcher for GPUs someday', 'a script that polls GPU prices and alerts at MSRP') +
    block('Discord bot', 'I want a Discord bot for my server', 'a moderation bot skeleton for their server') +
    block('A totally invented CRM', 'build me a CRM for my sales team', 'a CRM prototype');   // quote NOT in convo
  const r = await mine(run, { propose: stub, clock: makeClock(500) });
  A.eq(r.proposals.length, 2, 'two grounded threads survive; the invented one (no verbatim quote) is vetoed');
  A.eq(r.proposals[0].title, 'GPU price watcher', 'title parsed off the THREAD tag');
  A.ok(r.proposals[0].spec.indexOf('price watcher for GPUs') >= 0, 'the verbatim QUOTE becomes the spec/evidence');
  A.ok(r.proposals[0].starter.indexOf('polls GPU prices') >= 0, 'the DO deliverable is carried on the proposal');
  A.eq(r.proposals[0].sourceRef.runId, 'run_3', 'provenance: sourceRef.runId stamped');
  A.eq(r.proposals[0].createdAt, 500, 'createdAt from the injected clock');
  A.ok(r.proposals[0].fingerprint === fingerprint('GPU price watcher'), 'fingerprint stamped for dedup');
  /* WHO SPOKE (truthful telemetry, 2026-08-04). The grounding veto locates a quote in the WHOLE exchange, which
     includes the AGENT's turns — so "verbatim quote" never meant "the Commander said this". The turn-in card may
     only render `you said "…"` for a quote found in the Commander's OWN turns; anything else is cited as coming
     from the conversation rather than put in their mouth. */
  A.eq(r.proposals[0].speaker, 'user', 'a quote located in the Commander\'s own turn is stamped speaker:user');
  const echoed = await mine(run, { propose: () => block('Tokenizer follow-up', 'it was an off-by-one in the tokenizer', 'a regression test for the tokenizer'), clock: makeClock(0) });
  A.eq(echoed.proposals.length, 1, 'a quote taken from the AGENT\'s turn still passes the grounding veto (it was really said)');
  A.eq(echoed.proposals[0].speaker, 'other', 'but it is NOT stamped as the Commander\'s speech — the card softens its citation');

  // ---- THE SUBSTANCE VETO (regression for the 2026-07-08 escape): banter is grounded — the Commander really
  //      said it — but it is NOT actionable work. Even if the model tries to mint it, it dies without BOTH a
  //      concrete DO and CONFIDENCE high. ----
  const banterQuote = 'I\'m gonna be throwing some real crazy chaos at you, my G';
  const banterMedium = await mine(run, { propose: () => block('Future chaos', banterQuote, 'prepare for upcoming chaotic requests', 'medium'), clock: makeClock(0) });
  A.eq(banterMedium.proposals.length, 0, 'ESCAPE REGRESSION: a grounded banter line below high confidence is dropped');
  const noDo = await mine(run, { propose: () => 'THREAD: Future chaos\nQUOTE: ' + banterQuote + '\nCONFIDENCE: high', clock: makeClock(0) });
  A.eq(noDo.proposals.length, 0, 'a candidate with no DO deliverable is dropped even at high confidence');
  const shortDo = await mine(run, { propose: () => block('Future chaos', banterQuote, 'idk', 'high'), clock: makeClock(0) });
  A.eq(shortDo.proposals.length, 0, 'a trivial DO line (below the deliverable floor) is dropped');
  const legacy = await mine(run, { propose: () => 'THREAD: GPU price watcher\nQUOTE: build a price watcher for GPUs someday', clock: makeClock(0) });
  A.eq(legacy.proposals.length, 0, 'legacy two-line blocks (no DO/CONFIDENCE) no longer qualify — the bar moved');

  // ---- GROUNDING VETO is load-bearing: an all-invented reply mines NOTHING ----
  const invented = await mine(run, { propose: () => block('Build a spaceship', 'please build me a spaceship', 'a spaceship design doc'), clock: makeClock(0) });
  A.eq(invented.proposals.length, 0, 'a thread whose quote never appears in the conversation is dropped');

  // ---- dedup vs the live ledger + the permanent declined denylist (known fingerprints from the store) ----
  const known = {};
  known[fingerprint('GPU price watcher')] = 'thread';       // already an open thread
  known[fingerprint('Discord bot')] = 'declined';           // permanently declined
  const dd = await mine(run, { propose: stub, clock: makeClock(0), known });
  A.eq(dd.proposals.length, 0, 'a candidate matching a live thread OR a declined fingerprint is not re-mined');

  // ---- count cap: DEFAULT_MAX is now 2 (few, high-bar asks); explicit max still respected ----
  const words = ['alpha bravo', 'charlie delta', 'echo foxtrot', 'golf hotel', 'india juliet', 'kilo lima'];
  const many = () => words.map(w => block('build ' + w + ' tool', 'build a price watcher for GPUs someday', 'a working ' + w + ' tool')).join('');
  // (all share the SAME verbatim quote so they pass the veto; distinct titles so they don't dedup)
  const capped = await mine(run, { propose: many, clock: makeClock(0), max: 3 });
  A.ok(capped.proposals.length === 3, 'proposals are capped at explicit max');
  const defCap = await mine(run, { propose: many, clock: makeClock(0) });
  A.eq(defCap.proposals.length, 2, 'default cap is 2 — a turn-in ask is expensive, never a wall of proposals');

  // ---- NONE / empty / throw: a failed or empty mine never throws and yields no proposals ----
  A.eq((await mine(run, { propose: () => 'NONE', clock: makeClock(0) })).proposals.length, 0, 'NONE → no proposals');
  A.eq((await mine(run, { propose: () => '', clock: makeClock(0) })).proposals.length, 0, 'empty → no proposals');
  A.notThrows(() => {}, 'baseline');
  const threw = await mine(run, { propose: () => { throw new Error('boom'); }, clock: makeClock(0) });
  A.eq(threw.proposals.length, 0, 'a throwing propose is caught — no proposals, no crash');

  // ---- STASH-NOT-AUTOCOMMIT: mine returns candidates and TOUCHES NO STORE. The result is a plain object; there
  //      is no store dependency in mine's signature at all — proving it cannot auto-commit. ----
  A.ok(typeof r === 'object' && Array.isArray(r.proposals) && !r.committed && !r.written, 'mine only produces candidates — never writes / commits');

  // ---- prompt strips system, carries the exchange + the verbatim demand + the SUBSTANCE bar ----
  const built = buildPrompt(run.messages, 6000);
  A.ok(built.prompt.indexOf('price watcher for GPUs') >= 0 && built.prompt.indexOf('verbatim') >= 0, 'prompt carries the exchange + demands a verbatim quote');
  A.ok(built.prompt.indexOf('SYS — stripped') < 0, 'system turns stripped from the mining prompt');
  A.ok(built.prompt.indexOf('NEVER list: jokes, banter') >= 0, 'prompt names banter/jokes/hype as non-threads');
  A.ok(built.prompt.indexOf('reply NONE') >= 0 && built.prompt.indexOf('CONFIDENCE') >= 0, 'prompt defaults to NONE and demands a confidence stake');

  // ---- parse carries the new fields ----
  const parsed = parse(block('X y z tool', 'some quote here', 'a concrete deliverable', 'HIGH'));
  A.eq(parsed.length, 1, 'block parses');
  A.ok(parsed[0].starter === 'a concrete deliverable' && parsed[0].confidence === 'high', 'DO + CONFIDENCE parsed (case-normalized)');

  // ---- salience gate ----
  A.ok(mineSalient(run.messages) === true, 'a substantive exchange is mine-salient');
  A.ok(mineSalient([{ role: 'user', content: 'hi' }]) === false, 'a trivial run is not mine-salient');

  A.report('threadmine');
})();
