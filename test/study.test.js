/* node test/study.test.js — GROWTH Tier 1: the STUDY ENGINE (dossier Phase B: work → understanding).

   Three layers, mirroring reflect.test.js + suggeststore.test.js + beat-coordination.test.js:
     1. the PURE engine (frontend/app/study.js): salience gate, tagged-line parse (ADD/RETIRE + dimensions),
        the value floor, dedup vs existing beliefs, the permanent studyDeclined denylist, retire-must-match,
        redaction, count cap, ratings→taste streak minting, the archetype classifier, determinism, fail-open.
     2. the WIRING (frontend/app/studystore.js): session cap, Keep→DossierStore.upsert(source:'study'),
        Discard→permanent denylist, ignore 2×→stop, noteRating mints ONCE per archetype/direction ever.
     3. the CHAINED one-beat guarantee (source-locked, like beat-coordination.test.js — chat.js is DOM-flow):
        a memory turn-in WINS the post-run slot and a study proposal QUEUES for the next task end; the study
        beat is armed AFTER the memory + curiosity slots so it can never double-beat. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const { makeClock } = require('../shared/clock-rng.js');
const { redact } = require('../sidecar/context.js');
const S = require('../frontend/app/study.js');

(async () => {
  /* ============================ 1. THE PURE ENGINE ============================ */

  const run = { agentId: 'ag', runId: 'run_9', directive: 'help me ship the dossier feature', messages: [
    { role: 'system', content: 'SYS — stripped' },
    { role: 'user', content: 'help me ship the dossier feature; I prefer terse answers' },
    { role: 'assistant', content: 'done', tool_calls: [{ id: 't1' }] },
    { role: 'tool', content: 'ok' }
  ] };

  // ---- salience gate (SAME philosophy as reflect.reflectSalient) ----
  A.eq(S.studySalient(run.messages, false), true, 'a run that did real tool work is salient');
  const tiny = [{ role: 'user', content: 'x'.repeat(40) }, { role: 'assistant', content: 'x'.repeat(40) }];
  A.eq(S.studySalient(tiny, false), false, 'a trivial one-off (no tools, not recurring, under floor) is not salient');
  A.eq(S.studySalient(tiny, true), true, 'the same trivial exchange, RECURRING, is salient');
  const midOneOff = [{ role: 'user', content: 'x'.repeat(150) }, { role: 'assistant', content: 'x'.repeat(150) }];
  A.eq(S.studySalient(midOneOff, false), true, 'a 300-char one-off is salient (a short durable belief is never dropped)');
  A.eq(S.studySalient([{ role: 'assistant', content: 'x'.repeat(400) }], true), false, 'no user turn -> not salient even if recurring');
  A.eq(S.studySalient(null, false), false, 'garbage in -> not salient (never throws)');

  // ---- parse: tagged ADD/RETIRE lines -> {dim,kind,text}; untagged/unknown-dim ignored ----
  const p = S.parse('goals ADD: shipping a harness\nstyle ADD: prefers terse answers\ngoals RETIRE: ship the dossier\nnope no tag\nfoo ADD: not a dim\nambition new: a side project');
  A.eq(p.length, 4, 'four valid tagged lines (untagged + unknown-dim dropped)');
  A.eq(p[0].dim, 'goals', 'dimension parsed'); A.eq(p[0].kind, 'add', 'ADD -> add');
  A.eq(p[2].kind, 'retire', 'RETIRE -> retire');
  A.eq(p[3].dim, 'ambition', 'a "new" tag word maps to add on a real dim'); A.eq(p[3].kind, 'add', '"new" -> add');
  const pe = S.parse('style ADD: prefers terse answers | EVIDENCE: "I prefer terse answers"');
  A.eq(pe[0].text, 'prefers terse answers', 'evidence metadata is separated from the belief text');
  A.eq(pe[0].evidence, 'I prefer terse answers', 'the verbatim evidence quote is parsed explicitly');
  A.eq(S.canonDim('goal'), 'goals', 'singular "goal" canonicalises to goals');
  A.eq(S.canonDim('Standing Orders'), 'standing_orders', 'loose "Standing Orders" canonicalises');
  A.eq(S.canonDim('nonsense'), null, 'an unknown dimension is rejected');

  // ---- the happy path: proposals are stamped, sourced, evidenced; the floor drops trivia ----
  const beliefs = { goals: [{ text: 'ship the dossier' }] };
  const raw = 'goals ADD: shipping a local-first agent harness\nstyle ADD: prefers terse answers\n' +
              'goals RETIRE: ship the dossier\npain ADD: ok\nstack ADD: we discussed node today';
  const out = await S.study(run, { propose: async () => raw, clock: makeClock(100), redact, beliefs, declined: [] });
  A.eq(out.proposals.length, 3, 'three real proposals (floored "ok" + run-narration dropped)');
  A.eq(out.proposals[0].dim, 'goals', 'first proposal dim'); A.eq(out.proposals[0].kind, 'add', 'first is an add');
  A.eq(out.proposals[0].source, 'study', 'source is study'); A.eq(out.proposals[0].sourceRunId, 'run_9', 'provenance runId');
  A.eq(out.proposals[0].createdAt, 100, 'createdAt from the injected clock');
  A.ok(out.proposals[0].evidence.indexOf('ship the dossier feature') >= 0, 'evidence carries the directive');
  A.eq(out.proposals[2].kind, 'retire', 'the RETIRE that matched an existing belief survives');
  const grounded = await S.study(run, { propose: async () => 'style ADD: prefers terse verified answers | EVIDENCE: "I prefer terse answers"', clock: makeClock(101), redact, beliefs: {}, declined: [] });
  A.eq(grounded.proposals[0].evidenceRef.kind, 'verbatim', 'a verified quote is stamped as verbatim run evidence');
  const invented = await S.study(run, { propose: async () => 'style ADD: prefers colorful long answers | EVIDENCE: "make everything purple and verbose"', clock: makeClock(102), redact, beliefs: {}, declined: [] });
  A.eq(invented.proposals.length, 0, 'an invented evidence quote cannot become a learned belief');

  // ---- retire MUST match an existing belief (no hallucinated retractions) ----
  const noMatch = await S.study(run, { propose: async () => 'goals RETIRE: a goal we never held', clock: makeClock(0), redact, beliefs, declined: [] });
  A.eq(noMatch.proposals.length, 0, 'a RETIRE with no matching existing belief is dropped');

  // ---- dedup: an ADD the station already believes (exact or paraphrase) is dropped ----
  const dd = await S.study(run, { propose: async () => 'goals ADD: ship the dossier\ngoals ADD: build a brand new pipeline', clock: makeClock(0), redact, beliefs, declined: [] });
  A.eq(dd.proposals.length, 1, 'an ADD duplicating a known belief is dropped; the genuinely-new one survives');
  A.eq(dd.proposals[0].text, 'build a brand new pipeline', 'the new belief survives dedup');

  // ---- the permanent studyDeclined denylist (Jaccard) suppresses a rejected belief forever ----
  const den = await S.study(run, { propose: async () => 'pain ADD: too much time lost to manual deploys\nstack ADD: mainly rust and node', clock: makeClock(0), redact, beliefs: {}, declined: ['too much time lost to manual deploys'] });
  A.eq(den.proposals.length, 1, 'a previously-declined belief is never re-proposed; a distinct one beside it survives');
  A.eq(den.proposals[0].dim, 'stack', 'the surviving belief is the distinct one');

  // ---- redaction (§5.6): a secret-shaped belief is scrubbed before it can be kept ----
  const leak = await S.study(run, { propose: async () => 'stack ADD: the api key is sk-or-v1-0123456789abcdef0123', clock: makeClock(0), redact, beliefs: {}, declined: [] });
  A.ok(leak.proposals.length && leak.proposals[0].text.indexOf('sk-or-v1') < 0, 'a raw key shape is scrubbed from a study belief');

  // ---- count cap (study is rarer than reflection) ----
  const wall = await S.study(run, { propose: async () => 'goals ADD: alpha milestone one\ngoals ADD: beta milestone two\npain ADD: painful thing three\nstack ADD: tool four\nstyle ADD: habit five', clock: makeClock(0), redact, beliefs: {}, declined: [], max: 2 });
  A.eq(wall.proposals.length, 2, 'proposal count capped at max');

  // ---- NONE / empty / thrown / missing-propose -> nothing, never throws (fail-open) ----
  A.eq((await S.study(run, { propose: async () => 'NONE', clock: makeClock(0), redact })).proposals.length, 0, 'NONE -> nothing');
  A.eq((await S.study(run, { propose: async () => '', clock: makeClock(0), redact })).proposals.length, 0, 'empty -> nothing');
  A.eq((await S.study(run, { propose: async () => { throw new Error('down'); }, clock: makeClock(0), redact })).proposals.length, 0, 'a thrown study yields nothing (run unaffected)');
  A.eq((await S.study(run, { clock: makeClock(0) })).proposals.length, 0, 'no propose fn -> nothing');

  // ---- determinism ----
  const a1 = await S.study(run, { propose: async () => raw, clock: makeClock(100), redact, beliefs, declined: [] });
  const a2 = await S.study(run, { propose: async () => raw, clock: makeClock(100), redact, beliefs, declined: [] });
  A.eq(JSON.stringify(a1.proposals), JSON.stringify(a2.proposals), 'study is deterministic for the same inputs');

  // ---- the archetype classifier (the ratings-taste streak key) ----
  A.eq(S.classifyArchetype('help me write a blog post'), 'writing', 'writing bucket');
  A.eq(S.classifyArchetype('debug this function'), 'coding', 'coding bucket');
  A.eq(S.classifyArchetype('research the market'), 'research', 'research bucket');
  A.eq(S.classifyArchetype('zzz'), 'general', 'unclassifiable -> general (honest fallback)');

  // ---- RATINGS -> TASTE: foldRating (consecutive, not cumulative) + tasteProposal (3-streak, once) ----
  let e = S.foldRating(undefined, 'great'); e = S.foldRating(e, 'great');
  A.eq(S.tasteProposal('coding', e, { now: () => 0 }), null, 'no taste proposal at a 2-streak');
  e = S.foldRating(e, 'great');
  const t3 = S.tasteProposal('coding', e, { now: () => 0 });
  A.ok(t3 && /likes coding work/.test(t3.proposal.text), 'a 3× 👍 streak mints a positive style taste proposal');
  A.eq(t3.proposal.dim, 'style', 'a taste proposal is a style-dim belief');
  A.eq(t3.mintedKey, 'upMinted', 'the up direction is flagged minted');
  // a 👌 (ok) breaks BOTH streaks
  let e2 = S.foldRating(undefined, 'great'); e2 = S.foldRating(e2, 'great'); e2 = S.foldRating(e2, 'ok');
  A.eq((e2.up || 0), 0, 'a 👌 resets the up streak (neither like nor dislike)');
  // a 👎 streak mints a caution proposal
  let e3 = S.foldRating(undefined, 'miss'); e3 = S.foldRating(e3, 'miss'); e3 = S.foldRating(e3, 'miss');
  const t3d = S.tasteProposal('writing', e3, { now: () => 0 });
  A.ok(t3d && /unhappy with writing work/.test(t3d.proposal.text), 'a 3× 👎 streak mints a caution style proposal');
  // already-minted direction never re-mints
  e.upMinted = true;
  A.eq(S.tasteProposal('coding', e, { now: () => 0 }), null, 'a minted direction never re-mints (once per archetype/direction ever)');

  /* ============================ 2. THE WIRING (StudyStore) ============================ */

  const mem = {};
  global.localStorage = { getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  global.Study = S;
  // a fake DossierStore recording upserts + forgets so accept() can be verified.
  const dossierBeliefs = { goals: [{ id: 'cd_1', text: 'ship the dossier' }], style: [] };
  const upserts = []; const forgets = [];
  global.DossierStore = {
    beliefs: dim => (dossierBeliefs[dim] || []).slice(),
    upsert: (dim, b) => { upserts.push({ dim, b }); (dossierBeliefs[dim] = dossierBeliefs[dim] || []).push({ id: 'cd_new', text: b.text, source: b.source, observedAt: b.observedAt }); },
    forget: (dim, id) => { forgets.push({ dim, id }); dossierBeliefs[dim] = (dossierBeliefs[dim] || []).filter(x => x.id !== id); }
  };
  // capture the server-consume calls (POST /api/study/resolve) StudyStore fires on every verdict.
  const resolveCalls = [];
  global.fetch = (url, opts) => { resolveCalls.push({ url, body: JSON.parse((opts && opts.body) || '{}') }); return Promise.resolve({ ok: true }); };
  const { StudyStore } = require('../frontend/app/studystore.js');
  StudyStore.init({ now: () => 1000 });

  // session cap: canShow() true until SESSION_CAP markShown()s spend it
  A.eq(StudyStore.canShow(), true, 'canShow true on a fresh session');
  for (let i = 0; i < StudyStore.SESSION_CAP; i++) StudyStore.markShown();
  A.eq(StudyStore.canShow(), false, 'canShow false once the session cap is spent (anti-nag)');
  StudyStore.reset(); StudyStore.init({ now: () => 1000 });   // clean slate for the rest

  // ACCEPT an ADD -> DossierStore.upsert(source:'study' + observedAt)
  const addProp = { id: 'study_1', dim: 'style', kind: 'add', text: 'prefers terse answers', source: 'study', sourceRunId: 'run_9' };
  A.eq(StudyStore.accept(addProp, null), true, 'accept(add) returns true');
  const adoption = resolveCalls.find(c => c.url === '/api/recommendations' && c.body.outcome);
  A.eq(adoption && adoption.body.outcome.adopted, true, 'explicit study Keep records adoption');
  A.eq(adoption && adoption.body.outcome.quality, undefined, 'study Keep does not fabricate satisfaction');
  A.eq(upserts.length, 1, 'accept(add) upserts one belief');
  A.eq(upserts[0].b.source, 'study', 'the kept belief carries source:study');
  A.eq(upserts[0].b.observedAt, 1000, 'the kept belief carries observedAt (study provenance)');
  // ACCEPT an EDIT -> the edited text is stored
  StudyStore.accept({ id: 'study_2', dim: 'style', kind: 'add', text: 'orig' }, 'the edited belief');
  A.eq(upserts[upserts.length - 1].b.text, 'the edited belief', 'accept(edit) stores the edited text');
  // ACCEPT a RETIRE -> forget the matched existing belief
  const retProp = { id: 'study_3', dim: 'goals', kind: 'retire', text: 'ship the dossier' };
  A.eq(StudyStore.accept(retProp, null), true, 'accept(retire) matched an existing belief and returns true');
  A.eq(forgets.length, 1, 'accept(retire) forgets the matched belief');
  A.eq(forgets[0].id, 'cd_1', 'the correct existing belief was retired');

  // ---- CONSUMPTION (finding 2): a DECIDED proposal can never re-offer, and never duplicates on double-Keep ----
  A.eq(StudyStore.nextLive([addProp]), null, 'a KEPT proposal is resolved — a stale server batch can never re-offer it');
  A.eq(StudyStore.isExhausted(addProp.dim, addProp.text), true, 'a kept belief is exhausted (resolved set)');
  A.eq(StudyStore.nextLive([retProp]), null, 'a decided RETIRE is resolved too — it never re-offers');
  // double-Keep guard: even if a stale card somehow re-commits, accept() sees the dossier ALREADY holds the
  // belief (exact/paraphrase) and skips the duplicate write — still reporting success (the belief IS there).
  const upsertsBefore = upserts.length;
  A.eq(StudyStore.accept({ id: 'study_1b', dim: 'style', kind: 'add', text: 'prefers terse answers' }, null), true, 'a second Keep of the same belief still reports success');
  A.eq(upserts.length, upsertsBefore, 'but it writes NO duplicate belief (dedup vs the live dossier)');
  // the resolved set persists (own key): a reload cannot resurrect a decided proposal
  StudyStore.init({ now: () => 1000 });
  A.eq(StudyStore.nextLive([addProp]), null, 'the resolved set survives a re-init (persisted) — no post-reload re-offer');
  // every verdict CONSUMES the proposal server-side too, carrying the current denylist
  const studyResolveCalls = resolveCalls.filter(c => c.url === '/api/study/resolve');
  const recommendationCalls = resolveCalls.filter(c => c.url === '/api/recommendations');
  A.ok(studyResolveCalls.length >= 2, 'each verdict POSTs /api/study/resolve (server batch consumption)');
  A.ok(recommendationCalls.length >= 2, 'study impressions and verdicts join the shared recommendation lifecycle');
  A.eq(studyResolveCalls[0].body.id, 'study_1', 'the resolve call names the decided proposal id');
  A.eq(studyResolveCalls[0].body.runId, 'run_9', 'the resolve call names the batch runId (sourceRunId)');
  A.ok(Array.isArray(studyResolveCalls[0].body.declined), 'the resolve call mirrors the studyDeclined denylist to the sidecar');

  // ---- RETIRE SAFETY (finding 5): a pinned belief is untouchable; the card shows the REAL target ----
  dossierBeliefs.goals = [{ id: 'cd_7', text: 'keep improving the harness pipeline', pinned: true }];
  const retPinned = { id: 'study_7', dim: 'goals', kind: 'retire', text: 'improving the harness pipeline' };
  A.eq(StudyStore.retireTarget(retPinned), null, 'retireTarget NEVER matches a pinned belief (a pin is "this stays")');
  A.eq(StudyStore.nextLive([retPinned]), null, 'a retire whose only match is pinned is not offerable at all');
  const forgetsBefore = forgets.length;
  A.eq(StudyStore.accept(retPinned, null), false, 'accept(retire) refuses when the only match is pinned');
  A.eq(forgets.length, forgetsBefore, 'the pinned belief was NOT deleted');
  dossierBeliefs.goals.push({ id: 'cd_8', text: 'rebuild the harness pipeline end to end', pinned: false });
  const tgt = StudyStore.retireTarget({ id: 'study_8', dim: 'goals', kind: 'retire', text: 'the harness pipeline rebuild' });
  A.ok(tgt && tgt.id === 'cd_8', 'retireTarget returns the unpinned match — the card can show the ACTUAL belief to be deleted');

  // DISCARD -> the belief joins the permanent denylist (and nextLive drops it thereafter)
  const badProp = { id: 'study_4', dim: 'pain', kind: 'add', text: 'this belief is wrong and unwanted' };
  StudyStore.discard(badProp);
  A.ok(StudyStore.declinedList().indexOf('this belief is wrong and unwanted') >= 0, 'discard adds the belief to the permanent studyDeclined denylist');
  A.eq(StudyStore.nextLive([badProp]), null, 'nextLive drops a declined belief');
  A.eq(StudyStore.isExhausted('pain', 'this belief is wrong and unwanted'), true, 'a declined belief is exhausted');

  // FORGET → DENYLIST (2026-07-16 resurrect audit): declineText is the COMMANDER-panel Forget's denylist hook —
  // text-only (no proposal object exists for a belief already IN the dossier), same durability as discard.
  const resolvesBefore = resolveCalls.length;
  A.eq(StudyStore.declineText('a forgotten dossier belief', 'agent'), true, 'declineText accepts a real text');
  A.ok(StudyStore.declinedList().indexOf('a forgotten dossier belief') >= 0, 'the forgotten belief joins the permanent studyDeclined denylist');
  A.eq(StudyStore.nextLive([{ id: 'study_f1', dim: 'goals', kind: 'add', text: 'a forgotten dossier belief' }]), null,
    'a forgotten belief can never be re-proposed (nextLive drops it)');
  A.eq(resolveCalls.length, resolvesBefore + 1, 'declineText mirrors the denylist to the sidecar');
  A.eq(resolveCalls[resolveCalls.length - 1].body.runId, '', 'the mirror rides /api/study/resolve with no runId (documented no-op consume)');
  A.ok(resolveCalls[resolveCalls.length - 1].body.declined.indexOf('a forgotten dossier belief') >= 0, 'the mirrored list carries the forgotten text');
  A.eq(StudyStore.declineText('   '), false, 'blank text is refused (nothing to denylist)');
  // the denylist persists: a re-init (reload) still refuses the forgotten belief.
  StudyStore.init({ now: () => 1000 });
  A.ok(StudyStore.declinedList().indexOf('a forgotten dossier belief') >= 0, 'the forget-denylist survives a re-init (persisted)');
  // source-guard: DossierStore.forget captures the belief text BEFORE the splice and feeds declineText.
  const dsSrc = fs.readFileSync(path.join(__dirname, '../frontend/app/dossierstore.js'), 'utf8');
  A.ok(/StudyStore\.declineText/.test(dsSrc), 'dossierstore.forget routes the forgotten belief into StudyStore.declineText');
  A.ok(dsSrc.indexOf('Dossier.beliefs(dossier, dim)') < dsSrc.indexOf('Dossier.forget(dossier, dim, id'),
    'the belief text is captured BEFORE the splice (after it, the text is gone)');

  // IGNORE 2× -> stop proposing that belief (stop-forever)
  const ignProp = { id: 'study_5', dim: 'stack', kind: 'add', text: 'uses some obscure toolchain daily' };
  A.eq(StudyStore.isExhausted('stack', ignProp.text), false, 'a fresh belief is not exhausted');
  StudyStore.ignore(ignProp); A.eq(StudyStore.isExhausted('stack', ignProp.text), false, 'one ignore is not yet stop-forever');
  StudyStore.ignore(ignProp); A.eq(StudyStore.isExhausted('stack', ignProp.text), true, 'two ignores stops the belief for good (IGNORE_LIMIT)');
  A.eq(StudyStore.nextLive([ignProp]), null, 'nextLive drops an ignore-exhausted belief');

  // nextLive returns the FIRST still-live proposal, skipping exhausted ones
  const live = { id: 'study_6', dim: 'goals', kind: 'add', text: 'a fresh live goal worth keeping' };
  A.eq(StudyStore.nextLive([badProp, ignProp, live]), live, 'nextLive skips exhausted proposals and returns the first live one');

  // noteRating: mints ONCE per archetype/direction ever (persisted flag)
  StudyStore.reset(); StudyStore.init({ now: () => 1000 });
  A.eq(StudyStore.noteRating('coding', 'great'), null, '1× 👍 -> no mint');
  A.eq(StudyStore.noteRating('coding', 'great'), null, '2× 👍 -> no mint');
  const minted = StudyStore.noteRating('coding', 'great');
  A.ok(minted && /likes coding work/.test(minted.text), '3× 👍 on one archetype mints a taste proposal');
  A.eq(StudyStore.noteRating('coding', 'great'), null, 'a 4th 👍 never re-mints (once per archetype/direction ever)');
  // the mint persists across a reload of the SAME hero (own key) — no re-mint after re-init
  StudyStore.init({ now: () => 1000 });
  A.eq(StudyStore.noteRating('coding', 'great'), null, 'the minted flag survives a re-init (persisted) — never re-mints');

  /* ============== 3. THE ONE-BEAT GUARANTEE — BEHAVIORAL (the pure beat-slot arbiter chat.js drives) ==============
     The memory turn-in and the study card arrive on different clocks: memory.proposed lands only after
     reflection's LLM round-trip, seconds after agent.run.end. Both sides of chat.js route every render/queue
     decision through Study.makeBeatSlot(); here we drive the arbiter through the EXACT race scenarios and assert
     visibleBeat() never shows two beats and memory always wins the contested moment. */

  // --- scenario A (the review's finding-1 race): study shows FIRST, memory.proposed lands LATE ---
  let slot = S.makeBeatSlot();
  A.eq(slot.canStudy(), 'free', 'run ended, nothing pending: the study offer may take the moment');
  slot.studyShown();
  A.eq(slot.visibleBeat(), 'study', 'the study card is the one visible beat');
  slot.memoryProposed('run_1');                        // reflection's LLM round-trip finally lands
  A.eq(slot.memoryDeck(), 'queue', 'a memory deck arriving over a visible study card QUEUES — it never stacks');
  A.eq(slot.visibleBeat(), 'study', 'still exactly ONE visible beat (the study card) after the late memory.proposed');
  slot.studyDone(true);                                // the Commander decides the study card; a deck is queued behind it
  A.eq(slot.visibleBeat(), 'memory', 'the queued memory deck takes the moment as the study card resolves');
  slot.memoryShown();                                  // renderTurninBatch's idempotent hard-claim
  A.eq(slot.visibleBeat(), 'memory', 'one visible beat: the memory deck');
  slot.memoryDone('run_1', false);
  A.eq(slot.visibleBeat(), null, 'the moment is free again after the deck resolves');
  A.eq(slot.canStudy(), 'free', 'and the next study offer may take it');

  // --- scenario B (the common case): memory.proposed arrives BEFORE the study arm — memory wins outright ---
  slot = S.makeBeatSlot();
  slot.memoryProposed('run_2');
  A.eq(slot.canStudy(), 'memory', 'reflection in flight (proposed, fetch pending): study cedes BEFORE any deck renders');
  A.eq(slot.memoryDeck(), 'render', 'the fetched deck renders (the slot was free of visible beats)');
  A.eq(slot.canStudy(), 'busy', 'study still cedes while the deck is visible');
  slot.memoryDone('run_2', false);
  A.eq(slot.canStudy(), 'free', 'the deck resolved with nothing queued: study may take the NEXT moment');

  // --- scenario C (the fetch-gap hole): proposed but the 350ms fetch comes back EMPTY / notify-only ---
  slot = S.makeBeatSlot();
  slot.memoryProposed('run_3');
  A.eq(slot.canStudy(), 'memory', 'the claim holds across the whole proposed→fetch window (the 350ms gap is covered)');
  slot.memoryEmpty('run_3');                           // empty batch / off-stream notify — no deck will render
  A.eq(slot.canStudy(), 'free', 'an empty fetch releases the claim — study is not starved by a deck that never comes');

  // --- scenario D: two decks chain, study stays out for the whole train ---
  slot = S.makeBeatSlot();
  slot.memoryProposed('run_4'); slot.memoryProposed('run_5');
  A.eq(slot.memoryDeck(), 'render', 'first deck renders');
  A.eq(slot.memoryDeck(), 'queue', 'second deck queues behind it (never two visible)');
  A.eq(slot.canStudy(), 'busy', 'study cedes to the visible deck');
  slot.memoryDone('run_4', true);
  A.eq(slot.visibleBeat(), 'memory', 'the queued deck holds the moment');
  A.eq(slot.canStudy(), 'busy', 'study still cedes to the queued deck');
  slot.memoryDone('run_5', false);
  A.eq(slot.canStudy(), 'free', 'study may take the moment only after the WHOLE deck train resolves');

  /* ---- source-locks: chat.js actually drives the arbiter at the right seams (idiom of beat-coordination.test) ---- */
  const chatSrc = fs.readFileSync(path.join(__dirname, '../frontend/app/chat.js'), 'utf8');
  const beatSrc = fs.readFileSync(path.join(__dirname, '../frontend/app/beatcard.js'), 'utf8');
  A.ok(chatSrc.indexOf('function wireStudy') > 0, 'chat.js defines wireStudy (the study turn-in beat)');
  A.ok(/wireProposals\(\);[\s\S]{0,220}wireStudy\(\);/.test(chatSrc), 'wireStudy is wired in init next to wireProposals');
  // memory reserves its claim the moment memory.proposed arrives (BEFORE the 350ms fetch), and releases on empty/notify-only
  const iWireProps = chatSrc.indexOf('function wireProposals');
  A.ok(/slotMemoryProposed\(runId\);/.test(chatSrc.slice(iWireProps)), 'memory.proposed reserves the beat-slot claim immediately (covers the fetch gap)');
  // the claim is released on both no-deck outcomes — inside routeProposalBatch (the shared proposed/write route):
  // the off-stream notify-only path AND the empty/no-deck path each slotMemoryEmpty so study/arc/trust aren't wedged.
  const iRoute = chatSrc.indexOf('async function routeProposalBatch');
  A.ok(iRoute > 0, 'chat.js defines routeProposalBatch');
  const rbBody = chatSrc.slice(iRoute, iRoute + 3400);   // window covers the whole route fn (mixed-race guard + off-active notify grew it)
  A.ok((rbBody.match(/slotMemoryEmpty\(runId\)/g) || []).length >= 2, 'the notify-only path AND the empty/no-deck path both release the claim');
  // the deck render path consults the arbiter and queues over a live study card
  const iCard = chatSrc.indexOf('function proposalCard');
  A.ok(/slotMemoryDeck\(\) === 'queue'\)\s*\{[\s\S]{0,120}turninQueue\.push\(batch\)/.test(chatSrc.slice(iCard, iCard + 1200)),
    'proposalCard queues the deck when the arbiter says the moment is taken (a study card can never be stacked on)');
  A.ok(/beatSlot\.memoryShown\(\)/.test(chatSrc), 'renderTurninBatch hard-claims the slot on every deck-render path');
  A.ok(/beatHandle\.finish\(\{ onGone:/.test(chatSrc), 'finishBatch retires through the shared lifecycle controller');
  // the study side: guards + queue-not-drop + session cap + the generous arm delay (memory wins the moment)
  const iOffer = chatSrc.indexOf('async function offerStudy');
  A.ok(iOffer > 0, 'chat.js defines offerStudy');
  A.ok(/slotCanStudy\(\) !== 'free' \|\| studyBlocked\(\)\)\s*\{\s*queueStudy\(runId, agentId\); return; \}/.test(chatSrc.slice(iOffer, iOffer + 700)),
    'a taken/blocked moment QUEUES the study offer (deferred, never dropped, never stacked)');
  A.ok(/StudyStore\.canShow\(\)\)\s*return;/.test(chatSrc.slice(iOffer, iOffer + 700)), 'offerStudy respects the session cap');
  const iBlocked = chatSrc.indexOf('function studyBlocked');
  A.ok(iBlocked > 0 && /isBusy\(\) \|\| interview/.test(chatSrc.slice(iBlocked, iBlocked + 700))
    && /Onboarding\.isRunning/.test(chatSrc.slice(iBlocked, iBlocked + 700))
    && /Intake\.isRunning/.test(chatSrc.slice(iBlocked, iBlocked + 700))
    && /Dialogue\.isOpen/.test(chatSrc.slice(iBlocked, iBlocked + 700)),
    'the study beat honors the SAME stand-down guards as curiosity (busy/interview/onboarding/intake/Dialogue)');
  const iWireStudy = chatSrc.indexOf('function wireStudy');
  /* RECOMMENDATION SPINE: the study offer no longer wins the moment with a 12s head start — it is staged as a
     'study' CANDIDATE by the ONE collection pass and wins on PRIORITY. MEMORY still WINS: the candidate stands
     down the instant the shared arbiter reports anything but a free slot (a reflection in flight has reserved
     'memory'), and a losing offer is re-queued rather than consumed. */
  const iPass = chatSrc.indexOf('async function recommendPass');
  A.ok(iPass > 0, 'chat.js drives ONE collection pass for every proactive channel (the recommendation spine)');
  const passBody = chatSrc.slice(iPass, chatSrc.indexOf('function wireCuriosity', iPass));
  // one-memory lane (2026-08-05): the pick runs over `live` — the list after the shared declined filter.
  A.ok(/const winner = Recommend\.pick\(live, recUnderstanding\(\)\);/.test(passBody),
    'the winner is chosen by the pure spine, not by an arm-delay race');
  const iStudyCand = chatSrc.indexOf('async function studyCandidate');
  A.ok(iStudyCand > 0 && /slotCanStudy\(runId\) !== 'free'\) return null;/.test(chatSrc.slice(iStudyCand, iStudyCand + 700)),
    'the study candidate cedes the moment to a reserved memory claim (MEMORY WINS, now by reservation not by delay)');
  A.ok(/if \(study && winner !== study\) queueStudy\(runId, agentId\);/.test(passBody),
    'a study offer that LOSES the moment is re-queued (deferred, never starved)');
  A.ok(/if \(momentBlocked\(\)\) \{ queueStudy\(runId, agentId\); queueThread\(runId, agentId\); return; \}/.test(passBody),
    'a moment that went blocked during the fetch queues the offer instead of dropping it');
  /* TWO ARMS (B3/B4): the study candidate collects at the SLOW arm, because at 1.6s the run's own study batch
     is not stashed yet and /api/study/proposals falls back to the PREVIOUS run's — every card was one run stale. */
  A.ok(/const BEAT_SLOW_ARM_MS = 12000;/.test(chatSrc), 'the fetch-backed turn-ins collect once their stash exists');
  A.ok(/recommendPass\(p, 'slow'\); \}, BEAT_SLOW_ARM_MS/.test(chatSrc), 'the slow arm is what stages the study candidate');
  A.ok(/slotCanStudy\(runId\) !== 'free'\) return null;/.test(chatSrc.slice(iStudyCand, iStudyCand + 700)),
    'the candidate identifies itself by runId so the pass’s OWN reservation cannot veto it (the self-veto that killed the thread channel)');
  A.ok(/scheduleExpire\('study', 900\);[\s\S]{0,100}setTimeout\(flushStudyPending, 900\)/.test(chatSrc.slice(iWireStudy, iWireStudy + 1600)),
    'each run end expires an undecided study card (the ignore verdict) THEN drains one deferred beat (anti-starve)');
  // finding-4 lifecycle: the expiry tallies StudyStore.ignore for the shown proposal and frees the slot
  A.ok(/onExpire:\s*\(\) => \{ if \(typeof StudyStore\.ignore/.test(chatSrc.slice(chatSrc.indexOf('function studyCard'), chatSrc.indexOf('function studyCard') + 4200)),
    'an undecided card expiring at the next run end tallies an IGNORE (2x = stop proposing that belief)');
  A.ok(/slot\.done\(record\.kind, handoffOf\(record\)\)/.test(beatSrc), 'the shared expiry path releases or hands off the beat slot');
  // FIFO drains, single queue path
  const iFlush = chatSrc.indexOf('function flushStudyPending');
  A.ok(iFlush > 0 && /beatCards\.shift\('study'\)/.test(chatSrc.slice(iFlush, iFlush + 700)) && /beatCards\.shift\('taste'\)/.test(chatSrc.slice(iFlush, iFlush + 700)),
    'deferred beats drain FIFO (shift, not pop — the oldest never starves)');
  A.ok(/const item = q\.shift\(\)/.test(beatSrc), 'the shared controller drains deferred beats FIFO');
  const iQueue = chatSrc.indexOf('function queueStudy');
  A.ok(iQueue > 0 && /beatCards\.enqueue\('study', runId/.test(chatSrc.slice(iQueue, iQueue + 400)), 'queueStudy delegates run-id dedupe to the shared controller');
  // per-session hygiene: a new session/hero clears the study queues + card + arbiter (no cross-hero flush)
  A.ok(/if \(beatCards\) beatCards\.reset\(\);/.test(chatSrc), 'Chat.init invalidates the prior card generation');
  A.ok(/BeatCard\.create\(\{ vanish: vanish \}\)/.test(chatSrc), 'Chat.init rebuilds a fresh shared lifecycle controller per session');
  // the retire card shows the REAL matched belief (never just the model paraphrase) and Keep reflects accept()'s truth
  const iStudyCard = chatSrc.indexOf('function studyCard');
  A.ok(iStudyCard > 0 && /StudyStore\.retireTarget\(prop\)/.test(chatSrc.slice(iStudyCard, iStudyCard + 900)), 'the retire card resolves its ACTUAL target at render time');
  A.ok(/prop\.kind === 'retire' \? target\.text : prop\.text/.test(chatSrc.slice(iStudyCard, iStudyCard + 2600)), 'the retire card displays the stored belief that will be deleted');
  A.ok(/if \(!ok\) \{ settle\(/.test(chatSrc.slice(iStudyCard, iStudyCard + 5200)), 'a failed accept never flashes a success verdict (honest telemetry)');
  // rateWork mints taste through the SAME one beat.
  const iRate = chatSrc.indexOf('function rateWork');
  A.ok(iRate > 0 && /maybeTasteBeat\(/.test(chatSrc.slice(iRate, chatSrc.indexOf('const WORKRATE_COACH_KEY', iRate))), 'rateWork routes a ratings streak into the shared study beat (maybeTasteBeat)');

  A.report('study.test');
})();
