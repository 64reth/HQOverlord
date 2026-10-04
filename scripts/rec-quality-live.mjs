#!/usr/bin/env node
/* rec-quality-live.mjs — LIVE proof for the recommendation QUALITY LOOP lane (throwaway verification driver).
   Boots a seeded SKYNET_DEV sidecar on its own port + its own scratch workspace, drives headless Chrome to
   the floor, then asserts against the REAL page (real modules, real stores, real DOM):

     1. Both halves are loaded and read the LIVE understanding/dossier state (no injected fakes).
     2. THE SCORER CHANGES A REAL OUTCOME: two REAL agent.run.end passes, the gentle-band field the pass itself
        stages captured each time (projected to kind/dim/why/strength/quality — base, streak and declines are
        dropped), real outcomes folded through the store's own API in between — and the same-band winner moves
        off the one pure priority order would have named. NB slice 2 WRITES: it trains the station's mint,
        prospect and quality stores, which slices 3/5 then read. It is not a read-only measurement.
     3. The QUALITY WEIGHT reaches the live pass: Recommend.pick is wrapped, a real agent.run.end is emitted,
        and the candidates the REAL recommendPass hands the spine are inspected for their earned `quality`.
     4. The ATTRIBUTION STAMP lands on the spawned work's meta: an accepted offer is armed, a real run is
        driven through Chat.send, and Chat.runMeta(runId).rec is read back.
     5. The STALE-BELIEF RE-CONFIRM renders as a real card in COMMS, and DENY writes through the real stores
        (the belief is gone from the dossier, the question is fingerprint-denylisted).
   Usage: SKYNET_RQ_PORT=8815 SKYNET_RQ_CDP=9315 node scripts/rec-quality-live.mjs */
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, collectDiagnostics, sleep } from './lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from './lib/seed.mjs';

const port = process.env.SKYNET_RQ_PORT || '8815';
const cdpPort = Number(process.env.SKYNET_RQ_CDP || 9315);
const url = `http://127.0.0.1:${port}/`;
const scratch = mkdtempSync(join(process.cwd(), '.dev-workspaces-recquality-'));
const profile = mkdtempSync(join(tmpdir(), 'recquality-profile-'));
let fail = 0, pass = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('FAIL: ' + m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + ' — expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));

// a REAL provider key, when one is available, so slice 4 can drive an actual run (dev/.env.dev).
let key = process.env.SKYNET_OPENROUTER_KEY || '';
try {
  const envPath = join(process.cwd(), 'dev', '.env.dev');
  if (!key && existsSync(envPath)) {
    const m = /SKYNET_OPENROUTER_KEY\s*=\s*(\S+)/.exec(readFileSync(envPath, 'utf8'));
    if (m) key = m[1].trim();
  }
} catch {}
const liveKey = !!key && key.indexOf('placeholder') < 0;

materializeSeedWorkspace(scratch);
const sidecar = bootSeededSidecar(Object.assign({ port, scratchDir: scratch }, liveKey ? { key } : {}));
const chrome = launchChrome({ cdpPort, profileDir: profile });
let cdp = null;
try {
  await waitUp(url);
  await sleep(1200);
  cdp = await connectCDP(cdpPort);
  const diag = collectDiagnostics(cdp);
  await cdp.send('Page.navigate', { url });
  await waitDevReady(cdp, evalJS, { url });

  /* ---- 1. both halves live, reading the REAL understanding engine ---- */
  const loaded = await evalJS(cdp, `(() => {
    const u = (typeof UnderstandingStore !== 'undefined' && UnderstandingStore.read) ? UnderstandingStore.read() : null;
    return {
      quality: typeof RecQuality !== 'undefined',
      store: typeof RecQualityStore !== 'undefined',
      spine: typeof Recommend !== 'undefined',
      dims: u && u.dims ? Object.keys(u.dims).length : 0,
      neutralWeight: (typeof RecQualityStore !== 'undefined') ? RecQualityStore.weightFor('suggest') : null,
      floor: (typeof RecQuality !== 'undefined') ? RecQuality.Q_FLOOR : null
    };
  })()`);
  ok(loaded.quality && loaded.store && loaded.spine, 'recquality.js + recqualitystore.js + recommend.js are all live in the page');
  ok(loaded.dims > 0, 'the live understanding read exposes real dimensions (' + loaded.dims + ')');
  eq(loaded.neutralWeight, 1, 'a cold station reads every channel NEUTRAL (it can change no ranking it has no evidence for)');
  ok(loaded.floor >= 0.5, 'the quality floor is live at ' + loaded.floor);

  /* ---- 2. THE SCORER CHANGES A REAL OUTCOME — proved on candidates the REAL pass produced ----
     This slice used to hand Recommend.pick two hand-built candidates of the SAME kind. The pass can never emit
     that shape (one candidate per kind), so it proved nothing about the live product — and while it passed, the
     scorer was in fact INERT: every modifier was clamped under the per-kind tier gap, and no field the pass
     could actually produce ever ranked differently from pure priority order.
     The honest proof: drive TWO real agent.run.end passes, capture the REAL gentle-band field each one stages,
     apply REAL outcomes through the store's own API in between, and watch the same-band winner change. The first
     pass's pick is SUPPRESSED (returns null) so no card fires and no session/channel cap is spent.

     WHAT THIS SLICE REALLY DOES TO THE STATION, stated plainly (it is NOT read-only, and an earlier version of
     this comment claimed it was). Suppressing pick() only stops a CARD rendering. To earn the candidates it
     measures, the block below writes real state that later slices then run against: four MintStore.observe
     directives, four ProspectStore.noteLaunch records, CuriosityStore.noteWork ticks, and — between the two
     passes — SIXTY real RecQualityStore.noteOutcome folds (30 'miss' on the cold winner, 30 'great' on the
     runner-up). Slices 3/5 deliberately re-read that same store afterwards, so the ordering here is load-bearing:
     the two channels this slice trains are gentle-band ones it picks at runtime, and slice 3 trains 'curiosity'
     separately for exactly that reason. Move this slice and the later ones measure a different station.

     WHAT THE CAPTURE KEEPS is also less than the whole candidate: the field is projected to
     {kind, dim, why, strength, quality} — `base`, `streak` and `declines` are DROPPED. That is sound for the
     pair measured here (dim-less gentle channels carry none of the three) but it means the re-scoring printed
     below is the score of the PROJECTION, not necessarily of the original candidate. The winner assertions
     themselves are computed by the real Recommend.pick on the same projection, so they compare like with like. */
  // PASS 1 — the field as the station stages it COLD (every channel neutral). pick() is SUPPRESSED for both
  // passes: no card fires, no session/channel cap is spent, no nudge lands in the feed. The field the pass staged
  // and the arbiter that ranks it are the real ones; only rendering is skipped (see the caveats above).
  const staged = await evalJS(cdp, `(() => {
    const GENTLE = Recommend.BANDS[Recommend.BANDS.length - 1];
    const orig = Recommend.pick;
    window.__rq2 = { orig, field: null };
    Recommend.pick = function (cands) {
      const s = window.__rq2;
      const gentle = (cands || []).filter(c => c && GENTLE.indexOf(c.kind) >= 0)
        .map(c => ({ kind: c.kind, dim: c.dim || '', why: String(c.why || '').slice(0, 70), strength: c.strength, quality: c.quality }));
      if (gentle.length) s.field = gentle;
      return null;
    };
    /* EARN TWO MORE GENTLE CHANNELS THE WAY THE PRODUCT REALLY EARNS THEM — no injected candidates:
         SEED    — the station learns a recurring SHAPE by observing real task directives (chat.js calls
                   MintStore.observe on every one). Four repeats crosses mint.js's THRESHOLD, and seedCandidate
                   then cites that REAL repeat count as its strength.
         ROUTINE — a recipe hand-launched past RoutineNudgeStore.LAUNCH_FLOOR, recorded through the same
                   ProspectStore.noteLaunch the bay calls, plus the store's own cron read (its duplicate gate).
       Both are dim-less, so neither carries a value-of-information term: the ONLY thing that can separate them
       is what the station has learned about the two channels' real outcomes. That is exactly the measurement. */
    let seedReady = false, routine = null;
    try {
      for (const t of ['summarise the weekly billing report', 'summarise the weekly invoice report',
                       'summarise the weekly revenue report', 'summarise the weekly churn report']) MintStore.observe(t);
      seedReady = !!(SeedStore.willPropose && SeedStore.willPropose());
    } catch (e) {}
    try {
      const r = (Recipes.list() || []).find(x => x && x.cadence);
      if (r) { for (let i = 0; i < 4; i++) ProspectStore.noteLaunch(r); routine = r.id; }
      RoutineNudgeStore.onRunEnd();      // warm the store's own cron cache (its no-duplicate-routine gate)
    } catch (e) {}
    try { for (let i = 0; i < 8; i++) CuriosityStore.noteWork(); } catch (e) {}
    U.bus.emit('agent.run.end', { agentId: 'agent', runId: 'rq-reorder-1', reason: 'done' });
    return { seedReady, routine };
  })()`);
  ok(staged.seedReady, 'four real observations of one directive shape earned the station a live SEED candidate');
  ok(!!staged.routine, 'and four real hand-launches of a recurring recipe earned it a live ROUTINE candidate (' + staged.routine + ')');
  await sleep(13500);
  // teach the station the OPPOSITE of its rank order through REAL outcomes: the channel that leads on rank alone
  // gets a run of real declines; the one below it gets real accepts. Then run the pass again.
  const cold = await evalJS(cdp, `(() => {
    const s = window.__rq2, all = s.field ? s.field.slice() : [];
    const byPriority = ks => ks.slice().sort((a, b) => Recommend.PRIORITY.indexOf(a) - Recommend.PRIORITY.indexOf(b))[0];
    // the VOI-FREE pair: two dim-less gentle channels, so nothing but their outcome records can separate them.
    const pair = all.filter(c => !c.dim);
    const out = { all, allWinner: all.length ? s.orig(all, UnderstandingStore.read()).kind : null,
                  allPriority: byPriority(all.map(c => c.kind)), pair: pair.map(c => c.kind) };
    if (pair.length < 2) return out;
    const coldWinner = s.orig(pair, UnderstandingStore.read());
    const runnerUp = pair.find(c => c.kind !== coldWinner.kind);
    /* REAL, NAMED OUTCOMES through the store's own API: 👎 on the work the leader's offers spawned, 👍 on the
       runner-up's. Nothing is poked — every fold goes through noteOutcome exactly as rateWork's hand-off does. */
    for (let i = 0; i < 30; i++) RecQualityStore.noteOutcome({ channel: coldWinner.kind }, 'miss');
    for (let i = 0; i < 30; i++) RecQualityStore.noteOutcome({ channel: runnerUp.kind }, 'great');
    s.coldWinner = coldWinner.kind; s.runnerUp = runnerUp.kind;
    s.field = null;
    U.bus.emit('agent.run.end', { agentId: 'agent', runId: 'rq-reorder-2', reason: 'done' });
    return Object.assign(out, { coldWinner: coldWinner.kind, runnerUp: runnerUp.kind,
             priorityWinner: byPriority(pair.map(c => c.kind)),
             sameBand: Recommend.sameBand(coldWinner.kind, runnerUp.kind) });
  })()`);
  if (cold.pair && cold.pair.length >= 2) await sleep(13500);
  const reorder = await evalJS(cdp, `(() => {
    const s = window.__rq2;
    const warmAll = s.field ? s.field.slice() : [];
    const warm = warmAll.filter(c => !c.dim);
    const warmWinner = warm.length ? s.orig(warm, UnderstandingStore.read()) : null;
    Recommend.pick = s.orig;
    return Object.assign(${JSON.stringify(cold)}, {
      warm, warmWinner: warmWinner && warmWinner.kind,
      scores: warm.map(c => ({ kind: c.kind, score: Math.round(Recommend.score(c, UnderstandingStore.read()) * 100) / 100 })),
      weights: s.coldWinner ? { down: RecQualityStore.weightFor(s.coldWinner), up: RecQualityStore.weightFor(s.runnerUp) } : null
    });
  })()`);
  console.log('gentle field the live pass staged (cold): ' + JSON.stringify(reorder.all));
  ok(reorder.all && reorder.all.length >= 2,
    'the REAL pass stages several gentle-band candidates (' + (reorder.all || []).map(c => c.kind).join(', ') + ')');
  // (a) the whole field: the VOI-promoted question the old ±50 clamp had silently killed, back and live
  ok(reorder.allWinner !== reorder.allPriority,
    'the REAL pass’s winner is NOT the pure-priority pick — a maximum-VOI question (' + reorder.allWinner
      + ') outranks the channel above it (' + reorder.allPriority + '), the spine-era promotion the clamp had removed');
  // (b) the VOI-free pair: nothing but recorded outcomes can separate them, and they swap
  ok(reorder.pair && reorder.pair.length >= 2,
    'two of them are dim-less, so no value-of-information term can confound the measurement (' + (reorder.pair || []).join(', ') + ')');
  if (reorder.pair && reorder.pair.length >= 2) {
    eq(reorder.sameBand, true, 'the two channels really are in one band (a cross-band flip would be a BUG, not a feature)');
    eq(reorder.coldWinner, reorder.priorityWinner, 'cold, the station knows nothing about either and rank order decides');
    ok(reorder.weights.down <= 0.55 && reorder.weights.up >= 1.2,
      'thirty real 👎 outcomes and thirty real 👍 outcomes moved the two channels apart: ' + JSON.stringify(reorder.weights));
    eq(reorder.warm.map(c => c.kind).sort(), reorder.pair.slice().sort(),
      'the SECOND pass staged the SAME two channels — only what the station has learned about them changed');
    eq(reorder.warmWinner, reorder.runnerUp,
      'and the arbiter hands the moment to the one whose offers actually produced good work (was ' + reorder.coldWinner + ')');
    ok(reorder.warmWinner !== reorder.priorityWinner,
      'THE SCORER CHANGED A REAL OUTCOME: same field, same priority order, different winner — before the bands, no field the pass could produce ever did this');
    console.log('VOI-free pair (warm): ' + JSON.stringify(reorder.warm));
    console.log('warm scores: ' + JSON.stringify(reorder.scores) + ' · cold winner ' + reorder.coldWinner + ' → warm winner ' + reorder.warmWinner);
  }

  /* ---- 2b. the pure reads behind it, against the LIVE understanding state ---- */
  const strength = await evalJS(cdp, `(() => {
    const now = Date.now(), DAY = 86400000;
    const u = UnderstandingStore.read();
    const freshB = { id: 'f', text: 'ship the billing rewrite', updatedAt: now };
    const oldB = { id: 'o', text: 'ship the billing rewrite', updatedAt: now - 120 * DAY };
    const sFresh = RecQuality.beliefStrength(freshB, now, u, 'goals');
    const sOld = RecQuality.beliefStrength(oldB, now, u, 'goals');
    // the band law: a maxed-out lower band still loses
    const cross = Recommend.pick([
      { kind: 'curiosity', why: 'x', dim: 'goals', strength: 1, quality: 1.25, streak: 99 },
      { kind: 'arc', why: 'y', strength: 0, quality: 0.5, declines: 99 }
    ], u);
    return { sFresh, sOld, cross: cross && cross.kind,
             stale: RecQuality.staleness(oldB, now, u, 'goals'), staleFresh: RecQuality.staleness(freshB, now, u, 'goals').stale,
             nullConf: RecQuality.staleness(oldB, now, { dims: { goals: { weight: 3, conf: null } } }, 'goals').stale };
  })()`);
  ok(strength.sOld < strength.sFresh, 'a 120-day-old belief reads WEAKER than a fresh one against the live dossier ('
    + strength.sOld.toFixed(3) + ' < ' + strength.sFresh.toFixed(3) + ')');
  eq(strength.cross, 'arc', 'a maxed-out gentle candidate still cannot cross a band');
  eq(strength.staleFresh, false, 'a fresh belief is never stale');
  eq(strength.nullConf, false, 'an UNREADABLE confidence is not confidence zero — it claims no staleness at all');
  console.log('live staleness read: ' + JSON.stringify(strength.stale));

  /* ---- 3+5. ONE real pass proves both halves: the earned quality weight reaches the spine, and the stale
        goals belief produces a RE-CONFIRM card instead of an arc that asserts it. The belief is aged FIRST so
        the very first pass of the session takes the stale branch (an arc that fires normally opens a Dialogue
        panel and spends a paid decomposition call — neither belongs in a verification run). ---- */
  const seeded = await evalJS(cdp, `(() => {
    // age the station's REAL goals belief(s) past the staleness threshold, through the live records
    const arr = DossierStore.beliefs('goals');
    const at = Date.now() - 45 * 86400000;
    for (const b of arr) { b.updatedAt = at; b.createdAt = at; b.observedAt = null; b.pinned = false; }
    UnderstandingStore.refresh(false);
    const u = UnderstandingStore.read();
    const b = arr[0] || null;
    return { count: arr.length, id: b && b.id, text: b && b.text, conf: u.dims.goals.conf,
             weight: b && b.weight, source: b && b.source,
             stale: b ? RecQuality.staleness(b, Date.now(), u, 'goals') : null,
             willOffer: !!(GoalStore.willOfferDecomposition && GoalStore.willOfferDecomposition()) };
  })()`);
  console.log('aged the live goals belief: ' + JSON.stringify(seeded));
  ok(seeded.count > 0, 'the seeded station holds a real goals belief to age');
  ok(seeded.stale && seeded.stale.stale === true, 'it reads STALE against the live understanding engine');
  ok(seeded.willOffer, 'and the arc would otherwise have ASSERTED it (willOfferDecomposition is true)');

  const passRead = await evalJS(cdp, `(() => {
    // make one channel a proven dud through the store's own API (real outcomes, not a poked number)
    for (let i = 0; i < 8; i++) RecQualityStore.noteDecline({ channel: 'curiosity' }, false);
    window.__rqPick = [];
    const orig = Recommend.pick;
    Recommend.pick = function (cands, uRead) {
      try { window.__rqPick.push((cands || []).map(c => ({ kind: c.kind, dim: c.dim || '', quality: c.quality, strength: c.strength, why: String(c.why || '').slice(0, 60) }))); } catch (e) {}
      const w = orig.apply(this, arguments);
      try { window.__rqWinner = w ? { kind: w.kind, quality: w.quality, reconfirm: !!w.reconfirm } : null; } catch (e) {}
      return w;
    };
    // let the gentle half be EARNED (the work-floor the pass honours), then drive a real clean run end.
    try { for (let i = 0; i < 6; i++) CuriosityStore.noteWork(); } catch (e) {}
    U.bus.emit('agent.run.end', { agentId: 'agent', runId: 'rq-live-1', reason: 'done' });
    return { dud: RecQualityStore.weightFor('curiosity') };
  })()`);
  ok(passRead.dud < 1 && passRead.dud >= loaded.floor,
    'eight real declines made the curiosity channel a dud, floored not silenced (' + passRead.dud + ')');
  await sleep(14000);   // the pass runs at 1.6s (rate) and 12s (everything the run must first produce)
  const captured = await evalJS(cdp, `({ calls: window.__rqPick || [], winner: window.__rqWinner || null })`);
  const withQuality = (captured.calls || []).flat().filter(c => c && c.quality != null);
  ok(captured.calls.length > 0, 'the REAL recommendation pass ran and consulted the spine (' + captured.calls.length + ' call(s))');
  ok(withQuality.length > 0, 'and every candidate it staged carried its channel’s earned quality weight');
  const dudCand = withQuality.find(c => c.kind === 'curiosity');
  if (dudCand) ok(dudCand.quality < 1, 'the dud channel’s candidate went in DISCOUNTED live: ' + JSON.stringify(dudCand));
  console.log('candidates the live pass staged: ' + JSON.stringify(captured.calls));
  console.log('winner: ' + JSON.stringify(captured.winner));

  /* ---- 5. the RE-CONFIRM card the same pass produced, end to end, in the real DOM ---- */
  const card = await evalJS(cdp, `(() => {
    const el = document.querySelector('#chat-log .cmsg.turnin.rec.arc');
    if (!el) return { rendered: false, winner: window.__rqWinner || null };
    const btns = Array.from(el.querySelectorAll('.consent-btn')).map(b => b.textContent);
    const cs = getComputedStyle(el.querySelector('.consent-btn'));
    return {
      rendered: true,
      eyebrow: (el.querySelector('.rec-eyebrow') || {}).textContent,
      evidence: (el.querySelector('.rec-evidence') || {}).textContent,
      label: (el.querySelector('.turnin-kind') || {}).textContent,
      proposal: (el.querySelector('.turnin-text') || {}).textContent,
      note: (el.querySelector('.turnin-evidence') || {}).textContent,
      btns, btnBg: cs.backgroundColor, btnColor: cs.color, btnBorder: cs.borderTopColor,
      winner: window.__rqWinner || null
    };
  })()`);
  ok(card.rendered, 'the stale belief produced a RE-CONFIRM card in the live COMMS feed');
  console.log('re-confirm card: ' + JSON.stringify(card));
  if (card.rendered) {
    ok(card.winner && card.winner.reconfirm === true, 'the spine’s winner was the RE-CONFIRM, not an assertion');
    eq(String(card.label), 'STILL TRUE', 'labelled as a question, and unpunctuated like every sibling label');
    ok(/still where you’re heading/.test(String(card.proposal)), 'the proposal IS phrased as a question');
    // THE CITATION MATCHES THE BELIEF'S OWN PROVENANCE: only Commander-authored evidence may be quoted as speech.
    // NB: whyLine leaves a citation that carries its own preposition alone — "because from …" is not English.
    const spoken = seeded.weight === 'stated' || seeded.source === 'commander';
    ok(String(card.evidence).indexOf(spoken ? 'because you said' : 'from “') === 0,
      'it cites by the belief’s recorded provenance (weight=' + seeded.weight + ', source=' + seeded.source + '): ' + card.evidence);
    ok(/week/.test(String(card.note)), 'and says how long it has been: ' + card.note);
    ok(/re-learn it from your work/.test(String(card.note)), 'and discloses what DENY really costs: ' + card.note);
    ok(String(card.note).length < 100, 'in a short aside, not a paragraph (' + String(card.note).length + ' chars)');
    eq(card.btns, ['Still true', 'Not now', 'Not anymore'], 'three taps — ignoring it is no longer the only way to defer');
    const osPaint = ['rgb(255, 255, 255)', 'rgb(239, 239, 239)'];
    ok(osPaint.indexOf(card.btnBg) < 0 && card.btnBorder !== 'rgb(118, 118, 118)',
      'no OS paint on the consent buttons (' + card.btnBg + ' / ' + card.btnBorder + ')');
    // DENY → the real store writes
    const denied = await evalJS(cdp, `(() => {
      const fp = RecQuality.beliefFingerprint('goals', { id: ${JSON.stringify(seeded.id)}, text: ${JSON.stringify(seeded.text)} });
      const before = { beliefs: DossierStore.beliefs('goals').length, denied: RecQualityStore.isBeliefDenied(fp), conf: UnderstandingStore.read().dims.goals.conf };
      const el = document.querySelector('#chat-log .cmsg.turnin.rec.arc');
      const deny = Array.from(el.querySelectorAll('.consent-btn')).find(b => /Not anymore/.test(b.textContent));
      deny.click();
      return { before, after: {
        beliefs: DossierStore.beliefs('goals').length,
        stillThere: DossierStore.beliefs('goals').some(b => b.id === ${JSON.stringify(seeded.id)}),
        denied: RecQualityStore.isBeliefDenied(fp),
        result: (el.querySelector('.consent-result') || {}).textContent,
        conf: UnderstandingStore.read().dims.goals.conf
      } };
    })()`);
    ok(denied.after.stillThere === false, 'DENY retired the belief through the dossier’s own forget path');
    eq(denied.after.beliefs, denied.before.beliefs - 1, 'exactly one belief was removed');
    ok(denied.after.denied === true, 'and the question is fingerprint-denylisted — it is never asked again');
    ok(/dropped/.test(String(denied.after.result)), 'the card settles honestly: ' + denied.after.result);
    ok(denied.after.conf <= denied.before.conf, 'the dimension’s confidence did not rise on a retirement');
    console.log('deny round-trip: ' + JSON.stringify(denied));
  }

  /* ---- 5b. THE OTHER TWO CHIPS, driven live (the deny path above was the only one ever exercised) ----
        A helper that mints a fresh stale goals belief, drives ONE real pass, and hands back the rendered card.
        Every belief here is written through DossierStore's own upsert path — no poked records. */
  const stageReconfirm = async (text, runId) => {
    const setup = await evalJS(cdp, `(() => {
      DossierStore.upsert('goals', { text: ${JSON.stringify(text)}, source: 'onboarding', weight: 'seed' });
      const b = DossierStore.beliefs('goals').find(x => x && x.text === ${JSON.stringify(text)});
      const at = Date.now() - 45 * 86400000;
      if (b) { b.updatedAt = at; b.createdAt = at; b.observedAt = null; b.pinned = false; }
      UnderstandingStore.refresh(false);
      const u = UnderstandingStore.read();
      return { id: b && b.id, stale: b ? RecQuality.staleness(b, Date.now(), u, 'goals').stale : null,
               pending: !!(GoalStore.pendingDecomposition && GoalStore.pendingDecomposition()) };
    })()`);
    if (!setup.stale) return setup;
    await evalJS(cdp, `U.bus.emit('agent.run.end', { agentId: 'agent', runId: ${JSON.stringify(runId)}, reason: 'done' })`);
    await sleep(14000);
    return Object.assign(setup, await evalJS(cdp, `(() => {
      const el = document.querySelector('#chat-log .cmsg.turnin.rec.arc');
      return { rendered: !!el, evidence: el ? (el.querySelector('.rec-evidence') || {}).textContent : '' };
    })()`));
  };

  // (i) NOT NOW must silence the QUESTION without withdrawing the belief's milestone-decomposition offer.
  const deferStage = await stageReconfirm('launch the mobile companion app', 'rq-defer-1');
  ok(deferStage.rendered === true, 'a second stale belief produced its own re-confirm card (' + JSON.stringify(deferStage.id) + ')');
  if (deferStage.rendered) {
    const deferred = await evalJS(cdp, `(() => {
      const el = document.querySelector('#chat-log .cmsg.turnin.rec.arc');
      Array.from(el.querySelectorAll('.consent-btn')).find(b => /Not now/.test(b.textContent)).click();
      const pend = GoalStore.pendingDecomposition ? GoalStore.pendingDecomposition() : null;
      return { result: (el.querySelector('.consent-result') || {}).textContent,
               stillPending: !!(pend && pend.id === ${JSON.stringify(deferStage.id)}),
               beliefs: DossierStore.beliefs('goals').length };
    })()`);
    ok(/ask again later/.test(String(deferred.result)), 'the chip settles with what actually happens: ' + deferred.result);
    /* THE S4 FIX, live: "not now" used to run through GoalStore.markOffered, whose offered-fingerprint also gates
       pendingDecomposition — so deferring the STALENESS question permanently withdrew the belief's unrelated
       MILESTONE-DECOMPOSITION offer. The belief must still be pending decomposition after a deferral. */
    ok(deferred.stillPending === true,
      'deferring the QUESTION leaves the belief’s milestone-decomposition offer live (it used to withdraw it permanently)');
    await sleep(2000);
    const reAsk = await evalJS(cdp, `(() => {
      document.querySelectorAll('#chat-log .cmsg.turnin.rec.arc').forEach(n => n.remove());
      U.bus.emit('agent.run.end', { agentId: 'agent', runId: 'rq-defer-2', reason: 'done' });
      return true;
    })()`);
    await sleep(14000);
    const reAsked = await evalJS(cdp, `document.querySelectorAll('#chat-log .cmsg.turnin.rec.arc').length`);
    ok(reAsk === true && reAsked === 0, 'and the question is NOT re-asked this session (the in-memory deferral holds)');
    console.log('defer round-trip: ' + JSON.stringify(deferred) + ' · re-asked cards: ' + reAsked);
    // retire it so the next slice's belief is the one the arc reaches (pendingDecomposition returns the FIRST)
    await evalJS(cdp, `DossierStore.forget('goals', ${JSON.stringify(deferStage.id)})`);
  }

  /* (ii) STILL TRUE — the two writes the re-sweep found wrong: the LIVE text (not the render-time capture), and
     an evidence marker that keeps the affirmation from being replayed as authorship. */
  const confirmStage = await stageReconfirm('ship the billing rewrite', 'rq-confirm-1');
  ok(confirmStage.rendered === true, 'a third stale belief produced a re-confirm card to CONFIRM');
  if (confirmStage.rendered) {
    const confirmed = await evalJS(cdp, `(() => {
      const el = document.querySelector('#chat-log .cmsg.turnin.rec.arc');
      const shown = (el.querySelector('.rec-evidence') || {}).textContent;
      // THE COMMANDER EDITS THE BELIEF WHILE THE CARD IS STILL IN THE FEED (the COMMANDER panel's own write path)
      DossierStore.upsert('goals', { id: ${JSON.stringify(confirmStage.id)}, text: 'ship the billing rewrite by Q3' });
      Array.from(el.querySelectorAll('.consent-btn')).find(b => /Still true/.test(b.textContent)).click();
      const b = DossierStore.beliefs('goals').find(x => x && x.id === ${JSON.stringify(confirmStage.id)});
      return { shown, result: (el.querySelector('.consent-result') || {}).textContent,
               text: b && b.text, weight: b && b.weight, source: b && b.source,
               ref: b && b.evidenceRef && b.evidenceRef.kind };
    })()`);
    ok(/still true/.test(String(confirmed.result)), 'the card settles as confirmed: ' + confirmed.result);
    ok(confirmed.text === 'ship the billing rewrite by Q3',
      'THE MID-CARD EDIT SURVIVED: the confirm wrote back the LIVE belief, not the render-time capture (' + confirmed.text + ')');
    ok(/ship the billing rewrite”/.test(String(confirmed.shown)) && confirmed.shown.indexOf('Q3') < 0,
      '…and the card really had rendered the pre-edit wording, so the capture WOULD have reverted it');
    eq(confirmed.weight, 'stated', 'the confirmation is recorded as Commander-STATED evidence (what ends the re-ask loop)');
    eq(confirmed.source, 'commander', 'with commander provenance');
    eq(confirmed.ref, 'confirmed',
      'AND an evidence marker saying it was AFFIRMED, not authored — so no later card replays a paraphrase as speech');
    console.log('confirm round-trip: ' + JSON.stringify(confirmed));
  }

  /* ---- 4. the attribution stamp lands on the spawned run's meta ---- */
  if (liveKey) {
    const armed = await evalJS(cdp, `(() => {
      RecQualityStore.noteAccept({ channel: 'suggest', dim: 'goals', spawnsWork: true, id: 'live-offer-1' });
      window.__rqRun = null;
      U.bus.on('agent.run.start', p => { if (!window.__rqRun) window.__rqRun = p && (p.runId || p.id); });
      Chat.send('Say the single word: ready.');
      return { pending: !!RecQualityStore._pending() };
    })()`);
    ok(armed.pending === true, 'an accepted offer that spawns work arms a pending stamp (and credits nothing yet)');
    let meta = null;
    for (let i = 0; i < 40 && !(meta && meta.rec); i++) {
      await sleep(1500);
      meta = await evalJS(cdp, `(() => { const id = window.__rqRun; return id ? Object.assign({ id }, Chat.runMeta(id) || {}) : null; })()`);
    }
    ok(meta && meta.rec && meta.rec.channel === 'suggest',
      'the spawned run’s META carries the attribution stamp: ' + JSON.stringify(meta && meta.rec));
    eq(meta && meta.rec && meta.rec.dim, 'goals', 'including the dimension the offer targeted');
    // the run's REAL end folds the completion outcome through the store's own bus subscription (no poking).
    let outcome = null;
    for (let i = 0; i < 30; i++) {
      outcome = await evalJS(cdp, `({ stamped: !!RecQualityStore.stampFor(window.__rqRun), weight: RecQualityStore.weightFor('suggest'), busy: Chat.isBusy() })`);
      if (!outcome.busy && outcome.weight !== 1) break;
      await sleep(1500);
    }
    ok(outcome && outcome.stamped, 'the store bound that run to the offer');
    ok(outcome && outcome.weight > 1, 'the run’s clean finish folded a real positive outcome onto the channel (' + (outcome && outcome.weight) + ')');
    // and the strong signal: the verdict path the rate beat hands over (rateWork is module-private, so the
    // store-level hand-off is exercised here; its call site inside rateWork is locked by recqualitystore.test).
    const verdict = await evalJS(cdp, `(() => { const before = RecQualityStore.weightFor('suggest');
      RecQualityStore.noteVerdict(window.__rqRun, 'great'); return { before, after: RecQualityStore.weightFor('suggest') }; })()`);
    ok(verdict.after > verdict.before, 'a 👍 on the attributed run moves it further up: ' + JSON.stringify(verdict));
  } else {
    console.log('SKIP slice 4 (attribution on a real run): no live provider key available');
  }

  /* ---- 6. clean boot ---- */
  const errs = (diag.consoleMsgs || []).map(m => m.type + ': ' + m.text).concat(diag.exceptions || []);
  const mine = errs.filter(e => /recquality|RecQuality|reconfirm|recommendPass/i.test(String(e)));
  eq(mine, [], 'no console errors from the quality loop');
  console.log('console/exception log: ' + JSON.stringify(errs.slice(0, 8)));
} catch (e) {
  fail++; console.log('FAIL: driver threw — ' + (e && e.stack || e));
} finally {
  try { chrome.kill(); } catch {}
  try { sidecar.kill(); } catch {}
  await sleep(400);
  try { rmSync(scratch, { recursive: true, force: true }); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(fail ? ('rec-quality-live: ' + fail + ' problem(s), ' + pass + ' ok') : ('rec-quality-live: OK (' + pass + ' assertions)'));
process.exit(fail ? 1 : 0);
