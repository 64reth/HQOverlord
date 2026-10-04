/* node test/beat-coordination.test.js — locks the HEADLINE Slice 3 behavior: the ongoing suggestion and the
   curiosity nudge share ONE post-run beat slot and never both fire on the same task (anti-nag coordination).

   Two layers, because the arbiter itself lives in chat.js (DOM/flow code, not node-loadable):
     1. SOURCE GUARD (idiomatic here, like lint-emits.js): chat.js's post-run slot must consult
        SuggestStore.willSuggest() BEFORE CuriosityStore.consider(), and early-return when an idea fires — so a
        precedence inversion (which would let both fire) is caught.
     2. BEHAVIORAL: with the REAL SuggestStore, a due idea makes willSuggest() true (curiosity stands down) and a
        "nothing new" state makes it false (curiosity proceeds) — the mutual-exclusion contract chat.js relies on. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

/* ---------- 1. source guard: ONE collection pass, ONE arbiter, ONE winner ----------
   The five old agent.run.end offer listeners plus the wireCuriosity if/return ladder are gone: every
   proactive channel now stages a CANDIDATE and the pure spine (recommend.js) decides who speaks. The
   precedence this suite has always protected (suggestion > seed > routine > recruitment > curiosity, one
   beat per task) survives as Recommend.PRIORITY — locked behaviorally in recommend.test.js and asserted
   against the live chat.js wiring here. */
const chatSrc = fs.readFileSync(path.join(__dirname, '../frontend/app/chat.js'), 'utf8');
const Recommend = require('../frontend/app/recommend.js');
const iPass = chatSrc.indexOf('async function recommendPass');
A.ok(iPass > 0, 'chat.js drives ONE post-run collection pass (the recommendation spine)');
const iWireAnchor = chatSrc.indexOf('function wireCuriosity');
A.ok(iWireAnchor > iPass, 'chat.js still defines wireCuriosity (the one place the pass is armed)');
const passBody = chatSrc.slice(iPass, iWireAnchor);
/* TWO ARMS, ONE ARBITER. A single 1.6s arm broke the two channels whose evidence the run must first PRODUCE:
   memory.proposed lands seconds later (so "memory wins" was a fiction — a turn-in took the free slot and the
   consent deck queued behind it, invisible), and the study/thread stashes weren't written yet (so every study
   card offered the PREVIOUS run's batch). The rating keeps the fast arm — it needs nothing but the run's own
   counters, and that is the precedence parity the old 650ms ladder gave it. Everything else collects late. */
const iWire = chatSrc.slice(iWireAnchor, iWireAnchor + 1400);
A.ok(/setTimeout\(\(\) => \{ recommendPass\(p, 'fast'\); \}, BEAT_ARM_MS\)/.test(iWire),
  'a clean run end arms the FAST pass (the rate beat — nothing to wait for)');
A.ok(/setTimeout\(\(\) => \{ recommendPass\(p, 'slow'\); \}, BEAT_SLOW_ARM_MS\)/.test(iWire),
  'and the SLOW pass, once reflection has landed and both turn-in stashes are written');
A.ok(/const BEAT_ARM_MS = 1600;/.test(chatSrc) && /const BEAT_SLOW_ARM_MS = 12000;/.test(chatSrc),
  'the slow arm is the old STUDY_ARM_MS reality (12s), the fast arm stays at 1.6s');
A.ok(/const slow = phase !== 'fast';/.test(passBody) && /const takeoverOnly = phase === 'takeover';/.test(passBody), 'the ONE pass serves fast, slow and post-rating takeover collection');
A.ok(passBody.indexOf('rateCandidate(agentId, runId)') < passBody.indexOf('arcCandidate(runId)'),
  'the FAST arm collects the rating; every fetch-backed / produced-evidence channel collects on the SLOW arm');
// MEMORY WINS BY RESERVATION, not by an arm delay: memory.proposed reserves the slot the instant it fires, so a
// turn-in that has not rendered yet stands down, and one that HAS rendered is queued behind — never replaced.
const iWireProp = chatSrc.indexOf('function wireProposals');
A.ok(iWireProp > 0 && /slotMemoryProposed\(runId\);/.test(chatSrc.slice(iWireProp, iWireProp + 1400)),
  'memory.proposed RESERVES the beat slot the instant it fires (it needs no arm at all)');
// THE SESSION ASK BUDGET: a spine-level ceiling on proactive consent cards, with memory + rate exempt.
A.eq(Recommend.SESSION_ASK_MAX, 4, 'the spine caps proactive consent cards per browser session');
A.eq(Recommend.asksBudget('memory'), false, 'a reflection deck is earned by the run, never budgeted');
A.eq(Recommend.asksBudget('rate'), false, 'so is the rating of work just done');
for (const k of ['study', 'arc', 'trust', 'thread', 'suggest', 'seed', 'routine', 'recruit', 'curiosity']) {
  A.eq(Recommend.asksBudget(k), true, k + ' spends the session ask budget');
}
A.ok(/if \(askBudgetSpent\(\)\) \{[\s\S]{0,40}return;|\} else if \(askBudgetSpent\(\)\) \{/.test(passBody),
  'a spent budget makes the pass silent for every consent channel');
A.ok(/Recommend\.asksBudget\(winner\.kind\)\) sessionAsks \+= 1;/.test(passBody),
  'the budget is spent by a card that actually FIRED, never by one that merely collected');
// S1: a blocked moment defers the run's turn-ins instead of destroying them
A.ok(/if \(slow && !takeoverOnly && isHeroRun && runId\) \{ queueStudy\(runId, agentId\); queueThread\(runId, agentId\); \}/.test(passBody),
  'a blocked moment QUEUES this run\'s study + thread (the pre-spine listeners deferred them; returning dropped them forever)');

// the pass asks the PURE spine who speaks, and exactly one candidate ever fires
/* one-memory lane (2026-08-05): the pick now runs over `live` — the candidate list AFTER the shared
   cross-surface declined memory has removed anything the Commander already waved off elsewhere. */
A.ok(/const winner = Recommend\.pick\(live, recUnderstanding\(\)\);/.test(passBody),
  'the pass ranks every candidate through Recommend.pick (one voice, best-first, or silence)');
A.ok(/if \(recAlreadyDeclined\(c\)\)/.test(passBody),
  '…and the list it ranks has already dropped explicitly-declined proposals (the one memory)');
A.eq((passBody.match(/winner\.fire\(\)/g) || []).length, 1, 'exactly ONE candidate fires per pass (never two beats)');
A.ok(/if \(!winner\) return;/.test(passBody), 'no citable candidate means SILENCE, not a fallback beat');

// every gentle channel is still consulted, and their old ladder order IS the spine's priority order
A.ok(chatSrc.indexOf('SuggestStore.willSuggest()') > 0, 'chat.js consults SuggestStore.willSuggest()');
A.ok(chatSrc.indexOf('SeedStore.willPropose()') > 0, 'chat.js consults SeedStore.willPropose()');
A.ok(chatSrc.indexOf('RoutineNudgeStore.willPropose()') > 0, 'chat.js consults RoutineNudgeStore.willPropose()');
A.ok(chatSrc.indexOf('RecruiterStore.topPick()') > 0, 'chat.js consults RecruiterStore.topPick()');
A.ok(chatSrc.indexOf('CuriosityStore.consider()') > 0, 'chat.js still consults CuriosityStore.consider()');
const ladder = ['suggest', 'seed', 'routine', 'recruit', 'curiosity'].map(k => Recommend.PRIORITY.indexOf(k));
A.ok(ladder.every(i => i >= 0), 'every gentle channel has a place in the one priority order');
A.eq(ladder, ladder.slice().sort((a, b) => a - b),
  'suggestion > seed > routine > recruitment > curiosity — the ladder precedence survives as PRIORITY');
A.ok(Recommend.PRIORITY.indexOf('suggest') < Recommend.PRIORITY.indexOf('curiosity'),
  'a due suggestion outranks a get-to-know-you question (and only ONE of them can fire)');
// the gentle channels share ONE beat-slot family, so the arbiter itself makes them mutually exclusive
for (const k of ['suggest', 'seed', 'routine', 'recruit', 'curiosity']) {
  A.eq(Recommend.slotKindOf(k), 'nudge', k + ' renders through the one gentle-aside slot');
}

/* EVERY SOURCE LOCK BELOW BINDS ITS OWN FUNCTION (fixed 2026-08-04). These windows were fixed char counts
   (`slice(i, i + 2600)`), which overran the function's real end as bodies grew: 9 of the 10 `why:` assertions
   below were matching a NEIGHBOUR builder's why, and deleting suggestCandidate's why left this suite green.
   A.fnBody brace-counts to the function's OWN closing brace, so a lock can only ever pass on its own subject. */
const BUILDERS = ['arcCandidate', 'trustCandidate', 'rateCandidate', 'suggestCandidate', 'seedCandidate',
                  'routineCandidate', 'recruitCandidate', 'curiosityCandidate', 'studyCandidate', 'threadCandidate'];
const body = {};
for (const fn of BUILDERS.concat(['offerStudy', 'offerThread'])) {
  const async = chatSrc.indexOf('async function ' + fn) >= 0;
  body[fn] = A.fnBody(chatSrc, (async ? 'async function ' : 'function ') + fn + '(');
  A.ok(body[fn].length > 0 && body[fn].length < chatSrc.length / 4,
    'chat.js defines ' + fn + ', and its body is bounded by its own closing brace (' + body[fn].length + ' chars)');
}
// the slicer really does stop at the boundary: no builder's body may contain the NEXT builder's declaration
for (let i = 0; i < BUILDERS.length - 1; i++) {
  A.ok(body[BUILDERS[i]].indexOf('function ' + BUILDERS[i + 1]) < 0,
    BUILDERS[i] + '’s window stops before ' + BUILDERS[i + 1] + ' begins (no lock can borrow a neighbour’s evidence)');
}

/* THE ONCE LAW: a per-run token is spent at FIRE time, never at collection. Spending it while merely staging a
   candidate meant a channel that LOST the moment (or a pass that stood down afterwards) burned the run's only
   chance to speak, and a re-fired agent.run.end found every token spent with nothing ever shown. */
for (const [fn, probe] of [['arcCandidate', /if \(arcSeen\(runId\)\) return null;/],
                           ['trustCandidate', /beatCards\.hasSeen\('trust', runId\)\) return null;/],
                           ['studyCandidate', /beatCards\.hasSeen\('study', runId\)\) return null;/],
                           ['threadCandidate', /beatCards\.hasSeen\('thread', runId\)\) return null;/]]) {
  A.ok(probe.test(body[fn]), fn + ' only READS its per-run token (collection is side-effect-free)');
}
A.ok(/fire: \(\) => \{ if \(arcOnce\(runId\)\) offerArc\(runId\); \}/.test(body.arcCandidate),
  'the arc spends its token when it FIRES');
for (const [k, fn] of [['trust', 'trustCandidate'], ['study', 'studyCandidate'], ['thread', 'threadCandidate']]) {
  A.ok(new RegExp("fire: \\(\\) => \\{ if \\(beatCards\\.once\\('" + k + "', runId\\)\\)").test(body[fn]),
    k + ' spends its token when it FIRES');
}
// …and the deferred queue drain consumes the SAME token, so the queue and the pass can never both render a run's card
for (const [fn, k] of [['offerStudy', 'study'], ['offerThread', 'thread']]) {
  A.ok(new RegExp("if \\(beatCards && !beatCards\\.once\\('" + k + "', runId\\)\\) return;").test(body[fn]),
    fn + ' consumes the same per-run token before rendering (never a double offer)');
}

// EVIDENCE OR SILENCE: every candidate builder must cite real state or return null
for (const fn of BUILDERS) {
  A.ok(/why:/.test(body[fn]), fn + ' carries a why — a channel that cannot cite stays silent');
}

// the whole pass stands down behind a focused panel / onboarding / intake / an unanswered task question
const iMoment = chatSrc.indexOf('function momentBlocked');
A.ok(iMoment > 0 && /studyBlocked\(\) \|\| taskQuestionLive\(\)/.test(chatSrc.slice(iMoment, iMoment + 260)),
  'momentBlocked is the ONE stand-down set (the old study/arc guards + the live-question rule)');
A.ok(/if \(momentBlocked\(\)\) \{/.test(passBody), 'the pass stands down on a blocked moment');
const iBlocked0 = chatSrc.indexOf('function studyBlocked');
A.ok(iBlocked0 > 0 && /Dialogue\.isOpen/.test(chatSrc.slice(iBlocked0, iBlocked0 + 700)),
  'the shared stand-down set includes a focused Dialogue panel (First Pitch / awakening / tutorial)');

// the gentle half stays HERO-ONLY; the rating does not (S1 specialist rate-starve fix, re-locked by order)
A.ok(/if \(!turninOwnsMoment\(runId\) && isHeroRun\) \{/.test(passBody), 'the gentle-nudge half of the pass is hero-only');
const iArmInPass = passBody.indexOf('armRateFallback(agentId, runId)');
A.ok(iArmInPass > 0 && iArmInPass < passBody.indexOf('if (momentBlocked()) {'),
  'armRateFallback is armed BEFORE every stand-down guard (a blocked moment cannot skip arming)');
A.ok(passBody.indexOf('rateCandidate(agentId, runId)') > 0
  && passBody.indexOf('rateCandidate(agentId, runId)') < passBody.indexOf('if (!turninOwnsMoment(runId) && isHeroRun)'),
  'the rate candidate is staged before the hero gate (a specialist run can still be rated)');
// a new gentle beat retires any prior unanswered one (no cross-run nudge stacking), and clearNudge is exported
// so the First Pitch can retire a live nudge before its focused panel opens over it.
const iCurNudge = chatSrc.indexOf('function curiosityNudge');
const iGentle = chatSrc.indexOf('function nudge(');
A.ok(iCurNudge > 0 && /clearNudge\(\);/.test(chatSrc.slice(iCurNudge, iCurNudge + 220)), 'curiosityNudge retires a prior nudge before creating a new one');
A.ok(iGentle > 0 && /clearNudge\(\);/.test(chatSrc.slice(iGentle, chatSrc.indexOf("const r = row('agent')", iGentle))), 'the gentle nudge() retires an unprotected prior nudge before creating a new one');
A.ok(/return\s*\{[^}]*\bclearNudge\b/.test(chatSrc), 'clearNudge is exported (so pitchstore can retire a live nudge before the First Pitch panel opens)');

/* ---------- 2. behavioral: the real SuggestStore decision drives the mutual exclusion ---------- */
global.Pitch = require('../frontend/app/pitch.js');
const mem = {};
global.localStorage = { getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
const bus = A.makeBus(); global.U = { bus };
let dsFam = 0.4; const dsKnown = ['goals', 'identity'];
global.DossierStore = { summary: () => ({ known: dsKnown, blank: ['stack'], familiarity: dsFam }) };
// V3 §6: the shared readiness gate (fail-closed) — this suite is about BEAT COORDINATION, so the gate is open.
global.UnderstandingStore = { readiness: () => ({ ready: true, reasons: [] }) };
let pitchDoneFlag = true; global.PitchStore = { done: () => pitchDoneFlag };
global.Recipes = { list: () => [], get: () => null, requiredMissing: () => [] };
global.Chat = { nudge() {}, isBusy: () => false };
global.Harness = { chat() { return Promise.resolve({ text: 'PITCH: x\nBUILD: workflow' }); } };
const { SuggestStore } = require('../frontend/app/suggeststore.js');
SuggestStore.init({ getSystem: () => 'SYS', getCaps: () => [], getRecentTask: () => '', launchRecipe: () => {}, launchDirective: () => {} });

// a faithful copy of chat.js's arbiter precedence (locked above by the source guard): a due idea takes the beat;
// otherwise curiosity is consulted. We don't call the async fire() here — the precedence is a synchronous decision.
let curiosityConsulted = false;
let stubSeedWill = false, seedProposed = false;   // a stub seed gate (real SeedStore behavior is locked in seedstore.test.js)
function postRunBeat() {
  curiosityConsulted = false; seedProposed = false;
  if (SuggestStore.willSuggest()) return 'suggestion';   // (chat.js calls SuggestStore.fire(); return; here)
  if (stubSeedWill) { seedProposed = true; return 'seed'; }   // (chat.js calls SeedStore.propose(); return; here)
  curiosityConsulted = true;                              // (chat.js falls through to CuriosityStore.consider())
  return 'curiosity';
}

// drive the store "due": establish the post-graduation baseline (0.4), then grow (0.6) past the task cooldown
SuggestStore.reset();
bus.emit('agent.run.end', { reason: 'done', agentId: 'agent' });   // counter 1, baseline := 0.4
dsFam = 0.6;
bus.emit('agent.run.end', { reason: 'done', agentId: 'agent' });   // counter 2
bus.emit('agent.run.end', { reason: 'done', agentId: 'agent' });   // counter 3 → cooldown met
A.eq(SuggestStore.willSuggest(), true, 'an idea is due after the dossier grew + the cooldown passed');
A.eq(postRunBeat(), 'suggestion', 'a due idea takes the one post-run beat');
A.eq(curiosityConsulted, false, 'curiosity stands down when an idea fires (never both on one task)');

// nothing new learned → the idea stands down and curiosity gets the beat
SuggestStore.reset();
dsFam = 0.4;
bus.emit('agent.run.end', { reason: 'done', agentId: 'agent' });   // baseline := 0.4
bus.emit('agent.run.end', { reason: 'done', agentId: 'agent' });
bus.emit('agent.run.end', { reason: 'done', agentId: 'agent' });   // cooldown met, but no growth
A.eq(SuggestStore.willSuggest(), false, 'no idea when nothing new was learned');
A.eq(postRunBeat(), 'curiosity', 'curiosity proceeds when no idea is due');
A.ok(curiosityConsulted, 'curiosity is consulted when the suggestion stands down');

/* ---------- 3. the 4-way precedence: suggestion > seed > curiosity, one beat per task ---------- */
// (SuggestStore.willSuggest() is false here — the "nothing new" state above.)
stubSeedWill = true;
A.eq(postRunBeat(), 'seed', 'when no idea is due but a seed is ripe, the seed takes the beat');
A.eq(curiosityConsulted, false, 'curiosity stands down when a seed fires (never both on one task)');
// suggestion still outranks a ripe seed
dsFam = 0.6; bus.emit('agent.run.end', { reason: 'done', agentId: 'agent' });   // make an idea due again
A.eq(SuggestStore.willSuggest(), true, 'an idea is due again');
A.eq(postRunBeat(), 'suggestion', 'a due suggestion outranks a ripe seed (suggestion keeps priority)');
A.eq(seedProposed, false, 'the seed stands down when a suggestion fires');
stubSeedWill = false;

/* ---------- 4. G2.4: the rate-the-work control can never STARVE (source guards, same idiom as §1) ----------
   Rating is the PRIMARY leveling input (XP law), so every path where the turn-in "owns the moment" (or a
   focused panel holds the slot) must still funnel an unrated run into the standalone beat: an empty
   proposal fetch, an off-stream batch (notify-only), a deck the Commander finished without rating, and
   a tutorial/intake panel blocking the 650ms moment. */
const iMaybe = chatSrc.indexOf('function maybeStandaloneRate');
A.ok(iMaybe > 0, 'chat.js defines maybeStandaloneRate (the one funnel for a starved rating)');
// bound the window at the function's real end (the fallback's ledger declaration) rather than a magic char count,
// so growing the body's commentary can never silently slide an assertion out of range.
const iMaybeEnd = chatSrc.indexOf('const armedRateRuns', iMaybe);
A.ok(iMaybeEnd > iMaybe, 'maybeStandaloneRate is still followed by the armRateFallback ledger (window anchor)');
const mBody = chatSrc.slice(iMaybe, iMaybeEnd);
A.ok(/workRatedRuns\.has\(runId\)/.test(mBody), 'maybeStandaloneRate never double-asks a rated run');
A.ok(/\.cmsg\.work-rate/.test(mBody), 'maybeStandaloneRate never stacks a second live rate ask (one at a time)');
A.ok(/Dialogue\.isOpen/.test(mBody) && /'blocked'/.test(mBody),
  'a focused panel is a TRANSIENT block (retryable), not a permanent stand-down');
/* S1 SPECIALIST RATE-STARVE. The gate was `agentId !== 'agent' -> 'never'`, so a summoned specialist could only
   ever be rated via a memory turn-in card and stayed Lv 1 forever. A non-hero run is now gated on ITS OWN stream
   being the one on screen (the beat renders into the single shared #chat-log — it must never land a specialist's
   rating in somebody else's transcript), and that gate is TRANSIENT so the fallback still lands it on switch. */
A.ok(!/\(agentId \|\| 'agent'\) !== 'agent'\) return 'never'/.test(mBody),
  'the old hero-only PERMANENT stand-down is gone (it starved every specialist of the primary leveling beat)');
A.ok(/\(agentId \|\| 'agent'\) !== 'agent' && !\(activeWs && \(activeWs\.agentId \|\| 'agent'\) === \(agentId \|\| 'agent'\)\)\) return 'blocked'/.test(mBody),
  'a non-hero run is rateable only while ITS OWN stream is displayed, and the wait is TRANSIENT (retried, never starved)');
// the self-retrying fallback: armed at run end BEFORE any stand-down guard, retries while blocked
const iArm = chatSrc.indexOf('function armRateFallback');
A.ok(iArm > 0, 'chat.js defines the armRateFallback retry loop');
A.ok(/'blocked'\s*&&\s*left > 0\)\s*attempt\(left - 1\)/.test(chatSrc.slice(iArm, iArm + 800)),
  'the fallback re-attempts while transiently blocked (a tutorial panel delays, never starves, the rating)');
// (the arm-before-guards ORDER inside the pass is locked in section 1; here we only re-assert it exists)
const iRunEnd = chatSrc.indexOf('armRateFallback(agentId, runId)');
const iBusyGuard = chatSrc.indexOf('if (momentBlocked()) {');
A.ok(iRunEnd > 0 && iBusyGuard > 0 && iRunEnd < iBusyGuard,
  'the fallback is armed BEFORE the post-run slot\'s stand-down guards (a blocked moment cannot skip arming)');
// hole 1: proposed-but-empty batch (no deck AND no receipts) — the no-deck branch of routeProposalBatch must
// release any reserved slot and STILL rate (the silent-save UX split receipts from the deck; the RATE guarantee
// is unchanged — a run that reflected but rendered nothing must not silently drop its rating).
const iRoute = chatSrc.indexOf('async function routeProposalBatch');
A.ok(iRoute > 0, 'chat.js defines routeProposalBatch (the shared proposed/write fetch+route)');
A.ok(/if \(reservedSlot\) slotMemoryEmpty\(runId\);\s*maybeStandaloneRate\(agentId, runId\);/.test(chatSrc.slice(iRoute, iRoute + 3400)),
  'an EMPTY/no-deck proposal batch releases the reserved slot and still fires the standalone rate beat');
// hole 3: a batch on a non-displayed stream is notify-only — the rating must not vanish with it
const notifyRoute = A.fnBody(chatSrc, 'async function routeProposalBatch(');
const iNotify = notifyRoute.indexOf('to review');
A.ok(iNotify > 0 && /maybeStandaloneRate\(agentId, runId\)/.test(notifyRoute.slice(iNotify, iNotify + 400)),
  'an off-stream (notify-only) batch still fires the standalone rate beat');
// hole 2: a deck decided without rating — finishBatch must hand the rating to the standalone beat
const iFinish = chatSrc.indexOf('function finishBatch');
A.ok(iFinish > 0 && /maybeStandaloneRate\(batch\.agentId \|\| 'agent', batch\.runId\)/.test(chatSrc.slice(iFinish, iFinish + 600)),
  'a turn-in deck that vanishes unrated hands the rating to the standalone beat');

/* ---------- 5. P3.1 RE-SUMMON + P3.2 CREW RATEABILITY (source guards, same idiom as §1/§4) ----------
   Both are 👍-triggered post-run consumers riding the SAME rateWork direct hand-off + the SAME one beat slot. */
// P3.1: re-summon rides rateWork like BottleStore, and is MUTUALLY EXCLUSIVE with bottle on a given run — it fires
// ONLY when a bottle offer will NOT (so a single 👍 shows at most one of the two; never a clobber/double-ask).
const iRate = chatSrc.indexOf('function rateWork');
A.ok(iRate > 0, 'chat.js defines rateWork (the 👍/👌/👎 direct mint hand-off)');
const rateBody = chatSrc.slice(iRate, chatSrc.indexOf('const WORKRATE_COACH_KEY', iRate));
const iBottleCall = rateBody.indexOf('BottleStore.onVerdict');
const iResummonCall = rateBody.indexOf('ResummonStore.onVerdict');
A.ok(iBottleCall > 0 && iResummonCall > 0, 'rateWork hands the verdict to BOTH BottleStore and ResummonStore');
A.ok(iBottleCall < iResummonCall, 'BottleStore is consulted BEFORE ResummonStore (bottle keeps priority for the shared slot)');
A.ok(/bottleWillOffer/.test(rateBody) && /if \(!takeoverReady && !bottleWillOffer\) ResummonStore\.onVerdict/.test(rateBody),
  're-summon fires ONLY when a bottle offer will NOT (mutually exclusive per 👍 run — never both, never a slot clobber)');
// P3.2: the crew capture is wired at init, and the split rides the SAME memory.feedback mint path per worker.
A.ok(chatSrc.indexOf('wireCrewCapture()') > 0, 'chat.js wires wireCrewCapture at init (records forwarded worker spend)');
A.ok(/function claimCrew/.test(chatSrc), 'chat.js defines claimCrew (attributes forwarded worker ends to a lead run window)');
A.ok(/\/\^sub-\//.test(chatSrc), 'ephemeral team.spawn clones (sub-* ids) are filtered from crew attribution (no persistent identity → never credited)');
const iSplit = rateBody.indexOf('Xp.crewSplit');
A.ok(iSplit > 0, 'rateWork splits a crew run\'s mint via Xp.crewSplit');
A.ok(/entries\.push\(\{ agentId: wk\.agentId/.test(rateBody) && /XpStore\.recordWorkRating/.test(rateBody),
  'each proven worker share enters the SAME durable canonical rating under ITS OWN agentId');

A.report('beat-coordination.test');
