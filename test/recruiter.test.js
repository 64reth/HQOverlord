/* node test/recruiter.test.js — the pure adaptive-recruitment matcher (frontend/app/recruiter.js).
   Locks the product promises: cold start returns an EMPTY list (bay falls back honestly); a dish-heavy signal
   surfaces the research family with a why NAMING the dish (truthful telemetry — the reason is a real counter); a
   class already on the roster is NEVER recommended; ordering is deterministic; confidence tracks evidence volume;
   and a class the Commander's work never touches (zero kit-affinity) never surfaces even on a dossier keyword hit. */
'use strict';
const A = require('./_assert.js');
const R = require('../frontend/app/recruiter.js');
const W = require('../frontend/app/worksignal.js');
const S = require('../shared/specialties.js');
const CATALOG = S.BUILTINS;
const N = W.CALIBRATING_N;

// a helper: fold k tool fires in a lane with an interest tag.
function sigOf(lane, tag, k) { const s = W.fresh(); for (let i = 0; i < k; i++) W.observe(s, { lane, tag }, 0); return s; }

/* ---------- warm floor consistency: the matcher reads the SHARED CALIBRATING_N, never a stale literal ----------
   The recruiter's effective sample floor MUST equal WorkSignal.CALIBRATING_N (the single source of truth). A
   duplicated `|| 5` fallback + ">=5" comment had drifted from the real 3 — this pins them together so a future
   retune of the constant can never silently desync the matcher. */
A.eq(R.CAL_N, N, 'recruiter effective floor === WorkSignal.CALIBRATING_N (read, not a duplicated literal)');
// behavioral boundary: EXACTLY N samples is warm; N-1 is not (the floor is inclusive at N, matching the constant).
A.eq(R.recommend({ worksignal: sigOf('dish', 'research', N), catalog: CATALOG, roster: ['chief'], now: 0 }).warm, true, 'exactly CALIBRATING_N samples clears the warm floor');
A.eq(R.recommend({ worksignal: sigOf('dish', 'research', N - 1), catalog: CATALOG, now: 0 }).warm, false, 'one sample below the floor is not warm');

/* ---------- cold start: below the sample floor → empty (honest fallback) ---------- */
A.eq(R.recommend({ worksignal: W.fresh(), catalog: CATALOG, now: 0 }).warm, false, 'a cold (empty) signal is not warm');
A.eq(R.recommend({ worksignal: W.fresh(), catalog: CATALOG, now: 0 }).items.length, 0, 'a cold signal recommends nobody (empty list)');
const thin = sigOf('dish', 'research', N - 1);
A.eq(R.recommend({ worksignal: thin, catalog: CATALOG, now: 0 }).warm, false, 'below the sample floor stays not-warm');
A.eq(R.recommend({ worksignal: thin, catalog: CATALOG, now: 0 }).items.length, 0, 'thin signal → empty list (never a fabricated pick)');

/* ---------- dish-heavy research work → the research family surfaces, why names the dish ---------- */
const dishSig = sigOf('dish', 'research', 8);
const res = R.recommend({ worksignal: dishSig, roster: ['chief'], catalog: CATALOG, now: 0 });
A.eq(res.warm, true, 'a dish-heavy signal past the floor is warm');
A.ok(res.items.length > 0, 'a warm signal recommends at least one class');
const top = res.items[0];
A.ok(['researcher', 'scout', 'prospector', 'strategist'].indexOf(top.classId) >= 0, 'the top pick is a dish/research-family class');
A.ok(/web research/.test(top.why), 'the why NAMES the dish lane (web research) — a real persisted counter, never fabricated');
A.eq(top.evidence.dominantLane, 'dish', 'evidence records the dominant lane driving the pick');
A.ok(top.evidence.bestLane === 'dish', 'evidence names the heaviest kit lane behind the reason');
A.ok(top.confidence > 0 && top.confidence <= 1, 'confidence is an honest 0..1');

/* every recommended class carries a why derivable from a counter (no empty/fabricated reasons) */
A.ok(res.items.every(x => typeof x.why === 'string' && x.why.length > 0), 'every pick has a non-empty honest why');
A.ok(res.items.every(x => x.evidence && x.evidence.kitAffinity > 0), 'every pick has real kit-affinity evidence (touches the Commander’s work)');

/* ---------- a class already on the roster is NEVER recommended ---------- */
const res2 = R.recommend({ worksignal: dishSig, roster: ['researcher', 'scout'], catalog: CATALOG, now: 0 });
A.ok(!res2.items.some(x => x.classId === 'researcher'), 'a rostered class (researcher) is never recommended');
A.ok(!res2.items.some(x => x.classId === 'scout'), 'a rostered class (scout) is never recommended');

/* ---------- coverage gap: research work + no research specialist → gap boost fires ---------- */
A.eq(top.evidence.coversGap, true, 'the top pick covers a real coverage gap (research work, no research specialist rostered)');
// once a research specialist IS rostered, the SAME dish work no longer flags a coverage gap for the next candidate
const res3 = R.recommend({ worksignal: dishSig, roster: ['researcher'], catalog: CATALOG, now: 0 });
const scoutPick = res3.items.find(x => x.classId === 'scout');
if (scoutPick) A.eq(scoutPick.evidence.coversGap, false, 'with a research specialist rostered, the gap boost stops firing for the next research class');

/* ---------- determinism: identical inputs → identical ordering ---------- */
const a = R.recommend({ worksignal: dishSig, roster: ['chief'], catalog: CATALOG, now: 0 });
const b = R.recommend({ worksignal: dishSig, roster: ['chief'], catalog: CATALOG, now: 0 });
A.eq(a.items.map(x => x.classId), b.items.map(x => x.classId), 'the ranked order is deterministic across identical calls');

/* ---------- confidence tracks evidence volume: more samples → not-lower confidence ---------- */
const lots = sigOf('dish', 'research', 40);
const few = sigOf('dish', 'research', 6);
const cLots = R.recommend({ worksignal: lots, roster: ['chief'], catalog: CATALOG, now: 0 }).items[0].confidence;
const cFew = R.recommend({ worksignal: few, roster: ['chief'], catalog: CATALOG, now: 0 }).items[0].confidence;
A.ok(cLots >= cFew, 'more evidence never lowers confidence (volume-aware)');

/* ---------- code-heavy workbench work surfaces the engineer family ---------- */
const codeSig = W.fresh();
for (let i = 0; i < 8; i++) W.observe(codeSig, { lane: 'workbench', tag: 'code' }, 0);
for (let i = 0; i < 4; i++) W.observe(codeSig, { lane: 'cabinet', tag: 'code' }, 0);
const codeRes = R.recommend({ worksignal: codeSig, roster: ['chief'], catalog: CATALOG, now: 0 });
A.ok(['engineer', 'analyst', 'treasurer'].indexOf(codeRes.items[0].classId) >= 0, 'code-heavy workbench work surfaces a code-family class');
A.ok(/terminal|files/.test(codeRes.items[0].why), 'the code pick’s why names the terminal/files lane it actually used');

/* ---------- a zero-kit-affinity class never surfaces even on a dossier keyword hit ---------- */
// a purely dish signal; a class whose kit touches none of the used lanes (e.g. a studio-only designer) must not
// appear just because the dossier text keyword-matches its blurb.
const onlyDish = sigOf('dish', 'general', 10);
const kwRes = R.recommend({ worksignal: onlyDish, roster: ['chief'], catalog: CATALOG, dossier: { goals: ['I need visuals and design assets and layout'], pain: [], ambition: [] }, now: 0 });
A.ok(!kwRes.items.some(x => x.classId === 'designer'), 'a class whose kit the Commander never used is not curated on a dossier keyword hit alone');

A.report('recruiter');
