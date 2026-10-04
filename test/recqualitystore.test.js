/* node test/recqualitystore.test.js — THE OUTCOME LOOP (frontend/app/recqualitystore.js).
   The arithmetic lives in the pure recquality.js (tested separately); this is the live glue, and the thing it
   has to get right is ATTRIBUTION: an accepted offer → the run it spawned → that run's real outcome. Locks:
     - weights start NEUTRAL and are read neutral for an unknown channel (a cold store changes no ranking)
     - an accept that spawns work credits NOTHING until the work produces an outcome (a click is not a result)
     - the stamp is claimed by the FIRST hero run after the accept, never by a worker's run, never twice
     - a clean finish folds a weak positive; a stop/error/limit folds NOTHING (an interrupted run is not the
       suggestion's fault, and the harness cannot honestly say otherwise)
     - the Commander's 👍/👌/👎 on the attributed run is the strong signal; an UNattributed run says nothing
     - weights persist, hydrate clamped, and reset() clears them for a new hero
     - a dud channel gets quieter but is never silenced (the floor holds through the whole live path) */
'use strict';
const A = require('./_assert.js');
global.RecQuality = require('../frontend/app/recquality.js');

const mem = {};
global.localStorage = {
  getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};
const bus = A.makeBus();
global.U = { bus };

const { RecQualityStore: S } = require('../frontend/app/recqualitystore.js');
const RQ = global.RecQuality;
const NEUTRAL = RQ.Q_START;

let CLOCK = 1780000000000;
S.init({ now: () => CLOCK });

/* ── 1. a cold store is NEUTRAL everywhere (it can never change a ranking it has no evidence for) ── */
A.eq(S.weightFor('suggest'), NEUTRAL, 'an unrated channel reads neutral');
A.eq(S.weightFor('suggest', 'goals'), NEUTRAL, 'so does an unrated channel/dimension pair');
A.eq(S.weightFor(''), NEUTRAL, 'so does a nameless channel');
A.eq(S.stampFor('run-nope'), null, 'an unknown run carries no stamp');
A.eq(S.noteVerdict('run-nope', 'great'), null, 'and a verdict on an unattributed run records NOTHING');

/* ── 2. an accept that spawns work credits nothing YET ── */
S.noteAccept({ channel: 'suggest', dim: 'goals', spawnsWork: true, id: 'sugg-1' });
A.eq(S.weightFor('suggest'), NEUTRAL, 'accepting an offer that spawns work is not itself an outcome');
A.ok(S._pending() && S._pending().channel === 'suggest', 'the accept arms a pending attribution stamp');

/* ── 3. the stamp is claimed by the first HERO run, once ── */
A.eq(S.claimForRun('run-w', 'worker-2'), null, 'a summoned worker’s run never claims the Commander’s offer');
A.ok(S._pending(), 'and the pending stamp survives that');
const stamp = S.claimForRun('run-1', 'agent');
A.eq(stamp && stamp.channel, 'suggest', 'the next hero run claims the stamp');
A.eq(stamp && stamp.dim, 'goals', 'the targeted dimension rides with it');
A.eq(S._pending(), null, 'the pending stamp is consumed — a stale accept can never attach to later work');
A.eq(S.claimForRun('run-2', 'agent'), null, 'a subsequent run claims nothing');
A.eq(S.stampFor('run-1').id, 'sugg-1', 'the run remembers WHICH recommendation it came from');

/* ── 4. the run's real outcome folds back ── */
bus.emit('agent.run.end', { runId: 'run-1', reason: 'stopped' });
A.eq(S.weightFor('suggest'), NEUTRAL, 'a STOPPED run folds nothing — the harness cannot blame the offer for it');
bus.emit('agent.run.end', { runId: 'run-1', reason: 'done' });
const afterDone = S.weightFor('suggest');
A.ok(afterDone > NEUTRAL, 'a clean finish is a weak positive');
bus.emit('agent.run.end', { runId: 'run-1', reason: 'done' });
A.eq(S.weightFor('suggest'), afterDone, 'a re-fired run.end cannot double-credit the same completion');
const afterGreat = S.noteVerdict('run-1', 'great');
A.ok(afterGreat > afterDone, 'the Commander’s 👍 on the attributed work is the strong signal');
A.ok(S.weightFor('suggest', 'goals') > NEUTRAL, 'and the dimension it targeted earns with it');
A.eq(S.noteVerdict('run-1', 'shrug'), null, 'an unnamed verdict folds nothing');

/* ── 5. an accept with no trackable work IS the outcome ── */
const before = S.weightFor('study');
S.noteAccept({ channel: 'study', dim: 'pain', spawnsWork: false });
A.ok(S.weightFor('study') > before, 'a kept belief credits its channel immediately (nothing to wait for)');
A.eq(S._pending(), null, 'and arms no stamp');

/* ── 6. declines are real, and a "not now" is milder than a "no" ── */
S.noteDecline({ channel: 'seed' }, true);
const deferred = S.weightFor('seed');
S.reset(); S.init({});
S.noteDecline({ channel: 'seed' }, false);
const declined = S.weightFor('seed');
A.ok(declined < deferred, 'a refusal costs more than a "not now"');
A.ok(deferred < NEUTRAL, 'and both are honest negatives');

/* ── 7. a DUD channel gets quieter — and is never silenced ── */
S.reset(); S.init({});
for (let i = 0; i < 30; i++) {
  S.noteAccept({ channel: 'routine', spawnsWork: true });
  S.claimForRun('r' + i, 'agent');
  S.noteVerdict('r' + i, 'miss');
}
const dud = S.weightFor('routine');
A.ok(dud < NEUTRAL, 'a channel whose work is consistently rated 👎 ranks lower');
A.ok(dud >= RQ.Q_FLOOR, 'but never below the floor — quality alone can NEVER silence a channel');
A.ok(S.weightFor('curiosity') === NEUTRAL, 'and one bad channel never taints another');

/* ── 8. persistence: the earned weights survive, corrupt ones do not ── */
A.ok(mem[S.KEY] && JSON.parse(mem[S.KEY]).ch.routine < NEUTRAL, 'weights self-persist to their own key (no save.js)');
mem[S.KEY] = JSON.stringify({ v: 1, ch: { routine: 0.01, broken: 'x', huge: 99 }, dim: {} });
S.init({});
A.eq(S.weightFor('routine'), RQ.Q_FLOOR, 'a persisted weight below the floor hydrates clamped UP to it');
A.eq(S.weightFor('huge'), RQ.Q_CAP, 'and one above the cap hydrates clamped down');
A.eq(S.weightFor('broken'), NEUTRAL, 'a corrupted entry is dropped, never guessed at');
A.eq(S.stampFor('r1'), null, 'run attribution is in-memory: a reload honestly forgets it rather than inventing it');
S.reset();
A.eq(mem[S.KEY], undefined, 'reset() clears the key — a new hero inherits no channel history');
A.eq(S.weightFor('routine'), NEUTRAL, 'and reads neutral again');

/* ── 8a. THE SHARED DIMENSION BAG IS A TILT, NOT HALF THE READING (2026-08-04) ──
   Several channels target the same dimension, so a dimension's weight carries OTHER channels' outcomes into this
   one. That sharing is deliberate — a dimension nobody wants to be asked about should quieten every ask aimed at
   it — but it is not evidence about THIS channel, and a straight average let one channel's declines drag an
   unrelated one down by half. With banding live, that leak really moves a winner. */
S.reset(); S.init({});
for (let i = 0; i < 20; i++) S.noteDecline({ channel: 'curiosity', dim: 'goals' }, false);   // one channel, one dim
for (let i = 0; i < 6; i++) S.noteAccept({ channel: 'seed', spawnsWork: false });            // a DIFFERENT channel's own record
const own = S.weightFor('seed');
const dimOnly = S.weightFor('nobody', 'goals');
const blended = S.weightFor('seed', 'goals');
A.ok(dimOnly < NEUTRAL, 'the dimension itself carries the declines aimed at it');
A.ok(blended < own, 'a dimension nobody wants asked about still quietens another channel aimed at it (the sharing is deliberate)');
A.eq(Math.round(blended * 1e6), Math.round((own * 0.75 + dimOnly * 0.25) * 1e6),
  'but only as a TILT: the channel’s own record is three quarters of the reading, the shared dimension the last quarter');
A.ok(blended > (own + dimOnly) / 2, 'a straight 50/50 average would have dragged it twice as far ('
  + blended.toFixed(3) + ' vs ' + ((own + dimOnly) / 2).toFixed(3) + ')');
A.eq(S.weightFor('seed'), own, 'and asked WITHOUT a dimension, the channel reads its own record alone');
A.eq(S.weightFor('nobody'), NEUTRAL, 'a channel with no record of its own and no dimension is still neutral');
S.reset();

/* ── 8b. THE RE-CONFIRM DENIAL SET (Q3): a question answered "no" is never asked again ── */
S.reset(); S.init({});
const RQfp = RQ.beliefFingerprint('goals', { id: 'b1', text: 'ship the billing rewrite' });
A.eq(S.isBeliefDenied(RQfp), false, 'nothing is denied on a cold store');
A.eq(S.denyBelief(RQfp), true, 'a denied re-confirm is remembered');
A.eq(S.isBeliefDenied(RQfp), true, 'and the question is not asked again');
A.eq(S.denyBelief(RQfp), false, 'denying twice is a no-op');
A.eq(S.isBeliefDenied(RQ.beliefFingerprint('goals', { id: 'b1', text: 'ship the invoicing rewrite' })), false,
  'an EDITED belief is a NEW question — the denial does not silence it forever');
A.eq(S.isBeliefDenied(''), false, 'an unfingerprintable belief is never treated as denied');
S.init({});
A.eq(S.isBeliefDenied(RQfp), true, 'the denial survives a reload (it is a durable answer, not a session mood)');
for (let i = 0; i < 140; i++) S.denyBelief('fp-' + i);
A.ok(JSON.parse(mem[S.KEY]).deniedOrder.length <= 100, 'the denial memory is FIFO-bounded (never unbounded storage growth)');
A.eq(S.isBeliefDenied(RQfp), false, 'and the oldest denials age out rather than accumulating forever');
S.reset();

/* ── 8c. THE PENDING STAMP CANNOT FALSELY ATTRIBUTE (fixed 2026-08-04) ──
   Reproduced live: a "build it" accepted while the agent was mid-run launched NOTHING (Chat.send no-ops when
   busy), the stamp stayed armed forever, and the Commander's next unrelated manual run claimed it — the channel's
   weight moved on work that offer never caused. Three independent holes, three locks. */
S.reset(); CLOCK = 1780000000000; S.init({ now: () => CLOCK });
// (a) an armed stamp EXPIRES: past the window the next run is not this offer's work
S.noteAccept({ channel: 'suggest', spawnsWork: true, id: 'o1' });
A.ok(S._pending() && Number.isFinite(S._pending().at), 'an armed stamp records WHEN it was armed');
CLOCK += 2 * 60 * 1000;
A.ok(S.claimForRun('run-soon', 'agent'), 'a run two minutes later is still plausibly this offer’s work');
S.reset(); CLOCK = 1780000000000; S.init({ now: () => CLOCK });
S.noteAccept({ channel: 'suggest', spawnsWork: true, id: 'o2' });
CLOCK += 45 * 60 * 1000;
A.eq(S.claimForRun('run-late', 'agent'), null, 'a run 45 minutes later claims NOTHING — the stamp expired');
A.eq(S._pending(), null, 'and the expired stamp is cleared, never left to catch a later run either');
A.ok(S.weightFor('suggest') < NEUTRAL, 'an accept that produced no work in its window settles as a "not now", the only honest read');
A.eq(S.stampFor('run-late'), null, 'the late run carries no attribution at all');
// (b) a SECOND accept never silently swallows the first
S.reset(); CLOCK = 1780000000000; S.init({ now: () => CLOCK });
S.noteAccept({ channel: 'seed', spawnsWork: true, id: 'first' });
S.noteAccept({ channel: 'routine', spawnsWork: true, id: 'second' });
A.eq(S._pending().id, 'second', 'the newest accept holds the pending slot');
A.ok(S.weightFor('seed') < NEUTRAL, 'and the accept it displaced is SETTLED (deferred), never dropped on the floor');
A.eq(S.weightFor('routine'), NEUTRAL, 'the new accept itself still credits nothing yet');
/* (c) the caller-side gate, proved at the STORE level: when the launch is refused the caller never calls
   noteAccept at all (source-lock in §10), and this is the state that leaves behind — nothing armed, so the
   Commander's next manual run claims nothing and no weight moves off a click that started no work. */
S.reset(); CLOCK = 1780000000000; S.init({ now: () => CLOCK });
A.eq(S._pending(), null, 'a refused launch arms NOTHING (the accept never reaches the store)');
A.eq(S.claimForRun('run-unrelated', 'agent'), null, 'so the Commander’s next manual run claims no attribution');
A.eq(S.stampFor('run-unrelated'), null, 'and carries no stamp of its own');
bus.emit('agent.run.end', { runId: 'run-unrelated', reason: 'done' });
A.eq(S.weightFor('suggest'), NEUTRAL, 'its clean finish credits no channel — the click that started nothing moved nothing');
S.reset(); S.init({});

/* ── 9. the store is a READ-ONLY citizen of the event spine ── */
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'frontend', 'app', 'recqualitystore.js'), 'utf8');
A.eq(/U\.bus\.emit|bus\.emit/.test(src), false, 'recqualitystore.js NEVER emits on the frozen event contract');
A.ok(/U\.bus\.on\('agent\.run\.end'/.test(src), 'it subscribes to the run lifecycle it needs and nothing more');
A.eq(/document\./.test(src), false, 'it renders nothing — presentation belongs to the card');

/* ── 10. THE WIRING IS REAL (source-lock: chat.js is DOM-flow, not node-loadable) ──
   An injected-store test proves the arithmetic and hides the wiring. These lock the seams the loop dies at. */
const fs = require('fs'), path = require('path');
const chatSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'chat.js'), 'utf8');
A.ok(/rec: recClaimRun\(id, ws\.agentId \|\| 'agent'\)/.test(chatSrc),
  'the attribution stamp is written onto RUN_META at run start, beside every other piece of run provenance');
const iRate = chatSrc.indexOf('function rateWork');
A.ok(iRate > 0 && /RecQualityStore\.noteVerdict\(runId, verdict\)/.test(chatSrc.slice(iRate, chatSrc.indexOf('const WORKRATE_COACH_KEY', iRate))),
  'rateWork hands its verdict to the loop DIRECTLY (it never rides the bus)');
const iPass = chatSrc.indexOf('async function recommendPass');
const passBody = chatSrc.slice(iPass, chatSrc.indexOf('function wireCuriosity'));
A.ok(/c\.quality = recQualityOf\(c\.kind, c\.dim\)/.test(passBody), 'the pass hands each candidate its channel’s earned weight');
// one-memory lane (2026-08-05): the pick runs over `live` (the post-declined-filter list), same order law.
A.ok(passBody.indexOf('c.quality = recQualityOf') < passBody.indexOf('Recommend.pick(live'),
  '…before the spine ranks them');
for (const [file, probe, what] of [
  ['frontend/app/suggeststore.js', /noteAccept\(\{ channel: 'suggest', dim: probe \? probe\.dim : '', spawnsWork: true/, 'the suggestion arms a stamp (its accept launches a run)'],
  ['frontend/app/suggeststore.js', /const launched = doBuild\(parsed\);\s*\n\s*if \(launched\) \{\s*\n\s*if \(rq && rq\.noteAccept\)/,
    'and it arms that stamp ONLY when the launch really started — the refused branch keys on `launched` ALONE, so a successful launch with the store absent can never take it'],
  ['frontend/app/suggeststore.js', /if \(deps\.launchDirective\) return deps\.launchDirective\(directive\) === true;/,
    'doBuild reports the launch result (fail-closed: an unprovable launch is not a launch)'],
  /* S6: …and a REFUSED launch is no longer silent. Detecting it was only half the fix — the loop learned
     nothing from it and the Commander was told nothing (they tapped "let's build it" and the beat vanished). */
  ['frontend/app/suggeststore.js', /acceptedRecommendation = null; acceptedRunId = null;\s*\n\s*ledgerPost\(\{ id: recommendationId, state: 'declined', reason: 'wrong_time' \}\);\s*\n\s*if \(rq && rq\.noteDecline\) \{ try \{ rq\.noteDecline\(\{ channel: 'suggest', dim: probe \? probe\.dim : '' \}, true\); \}/,
    'a refused launch folds "deferred" — right idea, wrong moment, which is all the harness can honestly say'],
  ['frontend/app/suggeststore.js', /ledgerPost\(\{ id: recommendationId, state: 'declined', reason: 'wrong_time' \}\);\s*\n\s*if \(rq && rq\.noteDecline\)/,
    'and the LEDGER hears the same truth — declined/wrong_time is its own neutral shape; a row left terminal at accepted would count a launch that never happened as positive preference forever'],
  ['frontend/app/suggeststore.js', /Chat\.localLine\('stream’s busy — ask me again after this run'\)/,
    'and it TELLS the Commander why, in one short house line, instead of the beat just disappearing'],
  ['frontend/app/app.js', /let sent = false; if \(typeof Chat !== 'undefined' && Chat\.send && !Chat\.isBusy\(\)\) \{ Chat\.send\(text\); sent = true; \} persist\(\); return sent;/,
    'the real launchDirective dep answers truthfully instead of returning undefined'],
  ['frontend/app/seedstore.js', /noteAccept\(\{ channel: 'seed', spawnsWork: false/, 'a saved seed settles immediately (it authors a recipe, it does not run one)'],
  ['frontend/app/routinenudgestore.js', /noteAccept\(\{ channel: 'routine', spawnsWork: false/, 'a scheduled routine settles immediately'],
  ['frontend/app/chat.js', /recAccept\('study', prop\.dim, false\)/, 'a kept belief settles immediately'],
  ['frontend/app/chat.js', /recAccept\('trust', '', false\)/, 'a granted trust offer settles on the VERIFIED apply'],
  ['frontend/app/chat.js', /recAccept\('curiosity', dim, false\)/, 'an answered curiosity question settles immediately']
]) {
  A.ok(probe.test(fs.readFileSync(path.join(__dirname, '..', file), 'utf8')), what);
}
A.ok(/RecQualityStore\.init\(/.test(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'app.js'), 'utf8'))
  && /RecQualityStore\.reset\(\)/.test(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'app.js'), 'utf8')),
  'the store is initialised on boot and reset for a new hero');
A.ok(/app\/recqualitystore\.js/.test(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8'))
  && /app\/recquality\.js/.test(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8')),
  'both halves are actually loaded by the page (a module wired only under node is dead in the browser)');

/* ── 11. THE STALENESS GUARD IS WIRED (Q3, source-lock) ──
   A stale belief must ASK, never ASSERT — and the ask must ride the SAME slot and the SAME card grammar, or
   this becomes a new surface, which the spine's contract forbids. */
const arcBody = A.fnBody(chatSrc, 'function arcCandidate(');
A.ok(/const stale = recStale\(belief, 'goals'\)/.test(arcBody), 'the arc consults staleness BEFORE citing its belief');
A.ok(arcBody.indexOf('recStale(belief') < arcBody.indexOf('beliefCiteKind(belief)), strength:'),
  'the stale branch is taken INSTEAD of the assertion, not after it');
A.ok(/if \(recReconfirmDenied\(fp\)\) return null;/.test(arcBody), 'a re-confirm answered "no" is never re-asked (silence, not a nag)');
A.ok(/reconfirm: true/.test(arcBody) && !/strength:[^\n]*\n[^\n]*reconfirm/.test(arcBody),
  'the ask carries NO strength reading — strength discounts a weak assertion, and an ask asserts nothing');
const cardBody = A.fnBody(chatSrc, 'function reconfirmCard(');
A.ok(cardBody.length > 0, 'chat.js renders the re-confirm through its own card function');
A.ok(/recCard\(\{/.test(cardBody), 'the re-confirm rides the SHARED offer-card grammar — no new surface');
A.ok(/kind: 'arc'/.test(cardBody) && /beatCards && beatCards\.claim\(\{/.test(cardBody),
  'and the SAME beat slot family, so it is bounded by the same one-voice arbiter');
A.ok(/proposal: 'is that still where you’re heading\?'/.test(cardBody), 'the proposal is phrased as a QUESTION');
A.ok(/UnderstandingStore\.noteEvidence\(dim, \+1\)/.test(cardBody) && /UnderstandingStore\.noteEvidence\(dim, -1\)/.test(cardBody),
  'both answers write real signed evidence onto the dimension');
A.ok(/DossierStore\.forget\(dim, belief\.id\)/.test(cardBody), 'DENY retires the belief through the store’s own forget path');
A.ok(/RecQualityStore\.denyBelief\(fp\)/.test(cardBody), 'and fingerprints the question so it is never asked again');

/* ── 11b. THE RE-CONFIRM LOOP MUST END (Q3 follow-up, 2026-08-04) ──
   A seed-weighted belief contributes ZERO confidence by design (understanding.js EVIDENCE_WEIGHT.seed = 0), so
   the same signal eae2011a proved false for the strength read still fired the staleness read: confirming only
   re-stamped updatedAt, the dimension stayed exactly as under-confirmed, and the SAME question came back at the
   next 21-day mark — two or three times over a couple of months. Confirming now re-stamps the PROVENANCE too,
   which is simply true: the Commander just stated it, in answer to a direct question. */
A.ok(/DossierStore\.upsert\(dim, \{ id: belief\.id, text: live\.text, source: 'commander', weight: 'stated', evidenceRef: \{ kind: 'confirmed' \} \}\)/.test(cardBody),
  'CONFIRM records the belief as Commander-STATED evidence — the only thing that actually ends the re-ask loop');
/* …and it writes back the LIVE text, not the render-time capture (B1, 2026-08-04). The card sits in the feed
   while the COMMANDER panel stays editable; writing the captured string reverted an edit made in between AND
   stamped the reverted wording as something the Commander had just stated. */
A.eq(/text: text,/.test(cardBody), false,
  'the confirm never writes the RENDER-TIME text back (that silently reverted a mid-card edit)');
A.ok(cardBody.indexOf('const live = liveBelief();') < cardBody.indexOf('text: live.text'),
  'the belief is re-read BEFORE the write, and the write uses that re-read');
const DossierPure = require('../frontend/app/dossier.js');
{
  const now0 = 1780000000000;
  let d = DossierPure.fresh();
  d = DossierPure.upsert(d, 'goals', { text: 'ship the billing rewrite', source: 'onboarding', weight: 'seed' }, now0);
  const id = DossierPure.beliefs(d, 'goals')[0].id;
  d = DossierPure.upsert(d, 'goals', { id: id, text: 'ship the billing rewrite' }, now0 + 1000);
  A.eq(DossierPure.beliefs(d, 'goals')[0].weight, 'seed', 'an upsert that declares no provenance changes none');
  d = DossierPure.upsert(d, 'goals', { id: id, text: 'ship the billing rewrite', source: 'commander', weight: 'stated' }, now0 + 2000);
  const b = DossierPure.beliefs(d, 'goals')[0];
  A.eq(b.weight, 'stated', 'a declared weight RE-STAMPS an existing belief (a seed the Commander confirmed is no longer a seed)');
  A.eq(b.source, 'commander', 'and so does the declared source');
  A.eq(b.updatedAt, now0 + 2000, 'the confirmation is also what freshness measures');
  A.eq(DossierPure.beliefs(d, 'goals').length, 1, 'and it updates in place — a confirm never mints a second belief');
  // …and the resurrect race: an id that no longer exists PUSHES A NEW belief, which is exactly why the card
  // checks the belief is still there before writing anything.
  const d2 = DossierPure.upsert(d, 'goals', { id: 'cd_999', text: 'ghost' }, now0 + 3000);
  A.eq(DossierPure.beliefs(d2, 'goals').length, 2, 'an upsert on a GONE id invents a brand-new belief (the hazard the card guards)');
}
/* ── 11b-i. THE MID-CARD EDIT SURVIVES THE CONFIRM (B1, 2026-08-04) ──
   The Commander edits the belief in the COMMANDER panel while the re-confirm card is still sitting in the feed,
   then taps "Still true". Writing the render-time capture reverted their edit — and recorded the reverted wording
   as commander/stated, i.e. a sentence they had just replaced, stamped as one they had just said. */
{
  const now0 = 1780000000000;
  let d = DossierPure.fresh();
  d = DossierPure.upsert(d, 'goals', { text: 'ship the billing rewrite', source: 'onboarding', weight: 'seed' }, now0);
  const id = DossierPure.beliefs(d, 'goals')[0].id;
  const captured = DossierPure.beliefs(d, 'goals')[0].text;          // what the card RENDERED
  d = DossierPure.upsert(d, 'goals', { id: id, text: 'ship the billing rewrite by Q3' }, now0 + 1000);   // …the panel edit
  const live = DossierPure.beliefs(d, 'goals').find(b => b.id === id);
  d = DossierPure.upsert(d, 'goals', { id: id, text: live.text, source: 'commander', weight: 'stated', evidenceRef: { kind: 'confirmed' } }, now0 + 2000);
  const after = DossierPure.beliefs(d, 'goals')[0];
  A.eq(after.text, 'ship the billing rewrite by Q3', 'confirming re-affirms the LIVE text — the mid-card edit survives');
  A.ok(after.text !== captured, 'and is not silently reverted to what the card happened to show');
  A.eq(after.weight, 'stated', 'the weight upgrade still lands (that is what ends the re-ask loop)');
  /* ── 11b-ii. AN AFFIRMATION IS NOT AN AUTHORSHIP CLAIM (S2) ── */
  A.eq(after.evidenceRef && after.evidenceRef.kind, 'confirmed',
    'and the confirmation stamps evidenceRef.kind=confirmed, so later cards cite the affirmation, not authorship');
  const untouched = DossierPure.upsert(d, 'goals', { id: id, text: after.text, weight: 'stated' }, now0 + 3000);
  A.eq(DossierPure.beliefs(untouched, 'goals')[0].evidenceRef.kind, 'confirmed',
    'the evidenceRef acceptance is DEFAULTED OFF: an upsert that declares none leaves the stored ref alone');
}
A.ok(/const live = liveBelief\(\);\s*\n\s*if \(!live\) \{ settle\(/.test(cardBody),
  'the card re-reads the belief at CLICK time and settles quietly when it is gone — never fabricating a new one');
A.ok(/if \(!confirmed && live\.pinned\) \{ settle\(/.test(cardBody),
  'a PINNED belief is never forgotten by this card (DossierStore.forget has no pin guard of its own)');
// F3: the third chip. Both answers were terminal, so ignoring the card re-asked at every task end forever.
A.ok(/mk\('Still true'/.test(cardBody) && /mk\('Not now'/.test(cardBody) && /mk\('Not anymore', 'deny'/.test(cardBody),
  'the card offers three answers — including a NOT NOW, so ignoring it is not the only way to defer');
/* ── 11c. A DEFERRAL SILENCES THE QUESTION, NOT THE UNRELATED OFFER (S4, 2026-08-04) ──
   "Not now" called GoalStore.markOffered — but that offered-fingerprint ALSO gates pendingDecomposition, so
   deferring the STALENESS question permanently withdrew the belief's MILESTONE-DECOMPOSITION offer until its
   text changed. Two different asks, one kill switch. The deferral is now session-local to chat.js. */
A.eq(/GoalStore\.markOffered\(/.test(cardBody), false,
  '"not now" never touches GoalStore.offered — that set gates the arc’s decomposition offer, not this question');
A.ok(/if \(fp\) reconfirmDeferred\.add\(fp\);/.test(cardBody),
  'it records the deferral in chat.js’s own session-lifetime fingerprint set instead');
A.ok(/const reconfirmDeferred = new Set\(\);/.test(chatSrc),
  '…which is in-memory and module-level: a reload honestly forgets a "later" rather than persisting it as a "no"');
A.ok(/if \(fp && reconfirmDeferred\.has\(fp\)\) return null;/.test(arcBody),
  'and the candidate builder consults it, so the question is not re-asked this session');
A.ok(/settle\('✓ i’ll ask again later'/.test(cardBody),
  'the settle copy says what actually happens now — “later”, not “if it changes”');
/* the decomposition offer is UNAFFECTED: goalstore’s offered set is written only by the arc’s own paths. */
{
  const goalSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'goalstore.js'), 'utf8');
  const callers = (goalSrc.match(/markOffered\(belief\)/g) || []).length;
  A.ok(callers >= 3, 'goalstore still marks offered on its own confirm / null-path / decline (' + callers + ' call sites)');
}
const deferIdx = cardBody.indexOf("answer === 'defer'");
A.ok(deferIdx > 0 && cardBody.indexOf('recAccept', deferIdx) > cardBody.indexOf("settle('✓ i’ll ask again", deferIdx),
  'a deferral folds NOTHING onto the channel (a "later" is not a verdict on the offer)');
// F7: the arc channel is no longer a one-way ratchet
A.ok(/if \(confirmed\) recAccept\('arc', dim, false\); else recDecline\('arc', dim, false\);/.test(cardBody),
  'the re-confirm folds POSITIVE on confirm and a real DECLINE on deny (it used to fold "engaged" on both)');
const offerArcBody = A.fnBody(chatSrc, 'async function offerArc(');
// fnBody does not parse regex literals, so a quote inside a regex character class can run the slice long (see
// test/_assert.js). Guard every extraction that matters: non-empty, and nowhere near the whole file.
A.ok(offerArcBody.length > 400 && offerArcBody.length < 12000, 'the offerArc extraction is a real function body, not a mis-scan (' + offerArcBody.length + ' chars)');
A.ok(cardBody.length > 400 && cardBody.length < 12000, 'and so is the reconfirmCard one (' + cardBody.length + ' chars)');
A.ok(arcBody.length > 200 && arcBody.length < 8000, 'and the arcCandidate one (' + arcBody.length + ' chars)');
A.ok(/recAccept\('arc', 'goals', false\);/.test(offerArcBody) && /recDecline\('arc', 'goals', true\);/.test(offerArcBody),
  'and the arc’s REAL confirm flow trains the channel too — it recorded nothing at all before');
/* …but only when a goal tree really got built. GoalStore.confirm returns null on a path edited down to
   something Goals.makeGoal will not build — crediting the channel for that is the loop rewarding an offer that
   produced nothing. It is not a decline either (the Commander did not refuse), so it folds NOTHING. */
{
  const iG = offerArcBody.indexOf('const g = GoalStore.confirm(');
  const iAccept = offerArcBody.indexOf("recAccept('arc', 'goals', false)");
  const iElse = offerArcBody.indexOf('} else {', iG);
  A.ok(iG > 0 && iAccept > iG && iAccept < iElse, 'the accept fold sits INSIDE the if (g) branch…');
  A.ok(/if \(g\) \{[\s\S]*recAccept\('arc', 'goals', false\);\s*\n\s*\}/.test(offerArcBody),
    '…gated on the real confirm result, so an unusable edited path credits nothing');
}
// F5: deny's real consequence is disclosed, in the house's short-aside voice
A.ok(/i won’t re-learn it from your work/.test(cardBody),
  'the note discloses what DENY really does: forget() also denylists the text against being re-learned from work');
A.ok(/label: 'STILL TRUE'/.test(cardBody), 'the label is unpunctuated like every sibling (RETIRE · GRANT · AUTONOMY · THREAD)');
{
  const m = /note: ([^\n]+)\n/.exec(cardBody);
  const noteLen = m ? m[1].replace(/' \+ weeks \+ '/, '3').replace(/' \+ \(weeks === 1 \? '' : 's'\) \+ '/, 's').replace(/[',]/g, '').length : 999;
  A.ok(noteLen < 90, 'and the note stays a short aside like its siblings (' + noteLen + ' chars, was ~180)');
}
// F9: the recruit channel has a real accept path and now records both directions
A.ok(/recAccept\('recruit', '', false\);/.test(A.fnBody(chatSrc, 'function maybeRecruit(')),
  'recruitment records its accept (it had a real accept path and folded nothing, drifting down against channels that do)');

/* ── 12. THE OUTCOME FORWARD (dead-wires lane, 2026-08-28): each attributed outcome ALSO reaches the durable
   ledger, so the server's replay() quality term stops being structurally zero for the spine and the earned
   record survives the browser profile. The forward is injectable; the fake below records what crosses it. ── */
{
  const settles = [];
  const fakeLedger = { settle: (ch, outcome, runId) => { settles.push(ch + '/' + outcome + '/' + (runId || '')); } };
  S.init({ now: () => CLOCK, recLedger: fakeLedger });
  S.noteAccept({ channel: 'seed', dim: '', spawnsWork: true, id: 'seed-1' });
  S.claimForRun('run-f1', 'agent');
  bus.emit('agent.run.end', { runId: 'run-f1', reason: 'error' });
  A.eq(settles.length, 0, 'an interrupted run forwards nothing — the ledger hears exactly what the EWMA folds');
  bus.emit('agent.run.end', { runId: 'run-f1', reason: 'done' });
  A.eq(settles.join('|'), 'seed/completed/run-f1', 'a clean finish crosses to the durable ledger with its run');
  S.noteVerdict('run-f1', 'great');
  A.eq(settles.join('|'), 'seed/completed/run-f1|seed/great/run-f1', 'so does the Commander’s own verdict');
  S.noteDecline({ channel: 'seed' }, false);
  A.eq(settles.length, 2, 'a card decline does NOT cross here — that is the verdict path’s wire, not an outcome');
  // an accept whose run never came forwards the drop signal so the ledger can release the awaiting row
  S.noteAccept({ channel: 'routine', dim: '', spawnsWork: true, id: 'r-1' });
  CLOCK += 10 * 60 * 1000;
  S.claimForRun('run-f2', 'agent');
  A.eq(settles.slice(-1)[0], 'routine/deferred/', 'an expired accept forwards `deferred` (the row must not wait forever)');
  // and a null injection silences the forward entirely (the node default), fail-open
  const n = settles.length;
  S.init({ now: () => CLOCK, recLedger: null });
  S.noteAccept({ channel: 'seed', dim: '', spawnsWork: true, id: 'seed-2' });
  S.claimForRun('run-f3', 'agent');
  bus.emit('agent.run.end', { runId: 'run-f3', reason: 'done' });
  A.eq(settles.length, n, 'recLedger:null disables the forward — the store never throws for a missing wire');
}

A.report('recqualitystore.test');
