/* node test/ctxgauge.test.js — the CONTEXT-WINDOW gauge model. Pure transform from two REAL numbers
   (latest prompt_tokens, model context_length) to a render-agnostic gauge state. The honesty rule under
   test: an unknown limit NEVER produces a fabricated percentage — it reports known:false so the renderer
   shows "calibrating" instead of a made-up fill. */
'use strict';
const A = require('./_assert.js');
const { compute, fmtTokens, estimateTokens, estimateMessages, calibrate, calibrateFromEstimate, projectFrom, projectFromBaseline, WARN, CRIT, MSG_OVERHEAD } = require('../frontend/app/ctxgauge.js');
const { makeContext } = require('../sidecar/context.js');

// ---- fmtTokens: compact, deterministic human counts ----
A.eq(fmtTokens(0), '0', '0 tokens');
A.eq(fmtTokens(850), '850', 'under 1k stays raw');
A.eq(fmtTokens(999), '999', '999 stays raw');
A.eq(fmtTokens(1000), '1k', '1000 -> 1k');
A.eq(fmtTokens(1500), '1.5k', '1500 -> 1.5k');
A.eq(fmtTokens(64000), '64k', '64000 -> 64k');
A.eq(fmtTokens(128000), '128k', '128000 -> 128k');
A.eq(fmtTokens(200000), '200k', '200000 -> 200k');
A.eq(fmtTokens(1500000), '1.5M', '1.5M');
A.eq(fmtTokens(2000000), '2M', '2M');

// ---- known limit: real fill, thresholds, labels ----
const half = compute(64000, 128000);
A.ok(half.known === true, 'known when limit > 0');
A.ok(half.frac === 0.5 && half.pct === 50, 'half full -> 0.5 / 50%');
A.eq(half.level, 'ok', 'half full is ok');
A.eq(half.label, '64k / 128k', 'label = used / limit');
A.eq(half.pctLabel, '50%', 'pctLabel');

A.eq(compute(0, 128000).level, 'idle', 'empty (known) -> idle');
A.eq(compute(0, 128000).pct, 0, 'empty -> 0%');

// WARN boundary (0.75) is inclusive; just below is still ok
A.eq(compute(Math.round(WARN * 128000), 128000).level, 'warn', 'at WARN -> warn');
A.eq(compute(Math.round(WARN * 128000) - 200, 128000).level, 'ok', 'just below WARN -> ok');

// CRIT boundary (0.90) is inclusive
A.eq(compute(Math.round(CRIT * 128000), 128000).level, 'crit', 'at CRIT -> crit');
A.eq(compute(Math.round(CRIT * 128000) - 200, 128000).level, 'warn', 'just below CRIT -> warn');

// overflow is clamped, never > 100% / > 1.0, and reads crit
const over = compute(200000, 128000);
A.ok(over.frac === 1 && over.pct === 100, 'overflow clamps to full');
A.eq(over.level, 'crit', 'overflow -> crit');

// ---- unknown limit: NO fabricated percentage (the honesty guarantee) ----
const cold = compute(64000, 0);
A.ok(cold.known === false, 'limit 0 -> not known');
A.ok(cold.frac === 0 && cold.pct === 0, 'unknown -> no fill asserted');
A.eq(cold.level, 'unknown', 'unknown level');
A.eq(cold.pctLabel, '—', 'unknown -> dash, never a number');
A.eq(cold.label, '64k', 'unknown still shows the real used count');
A.eq(compute(0, 0).label, '--', 'nothing known at all -> dash');

// ---- unmeasured current model: context length can be known while prompt tokens are not ----
const unmeasured = compute(64000, 128000, { measured: false });
A.ok(unmeasured.known === false && unmeasured.measured === false, 'unmeasured -> not known');
A.eq(unmeasured.level, 'unknown', 'unmeasured level');
A.eq(unmeasured.label, '-- / 128k', 'unmeasured shows limit without pretending used tokens');
A.eq(unmeasured.pctLabel, '—', 'unmeasured -> no percentage asserted');

// ---- defensive coercion: garbage in -> safe, never a crash or NaN ----
A.eq(compute(-5, 128000).level, 'idle', 'negative used coerces to 0');
A.eq(compute(NaN, NaN).level, 'unknown', 'NaN -> unknown, not a throw');
A.ok(compute(64000.7, 128000).used === 64000, 'fractional used floored');

/* ---- the token estimator: it MUST agree with the sidecar's, because the calibrated overhead is the
   difference between a real prompt_tokens and this estimate of the same array. A drift between the two
   copies is not a rounding nit — it becomes a systematic bias in every projection the gauge shows. ---- */
const SAMPLE = [
  { role: 'system', content: 'you are a helpful station agent' },
  { role: 'user', content: 'x'.repeat(4000) },
  { role: 'assistant', content: 'ok', tool_calls: [{ function: { name: 'fs.write', arguments: JSON.stringify({ path: 'a.txt', body: 'y'.repeat(9000) }) } }] },
  { role: 'user', content: '' }
];
const sidecarCtx = makeContext({ contextLimit: 200000 });
A.eq(estimateMessages(SAMPLE), sidecarCtx.estimateMessages(SAMPLE),
  'the browser estimator matches sidecar/context.js message-for-message');
A.eq(estimateTokens('abcd'), 1, 'char/4');
A.eq(estimateTokens(null), 0, 'null estimates as nothing, never NaN');
A.eq(estimateMessages([{ role: 'user', content: '' }]), MSG_OVERHEAD, 'an empty message still costs its framing');
A.eq(estimateMessages(null), 0, 'a missing array estimates as 0, never a throw');
A.ok(estimateMessages(SAMPLE) > 2000, 'tool-call ARGUMENTS are counted (a written file body is the biggest thing on the wire)');

/* ---- calibration: a straight line fitted through ONE real prompt_tokens reading ---- */
const sentEst = estimateMessages(SAMPLE);

// OFFSET case (the usual one): char/4 undershoots because it cannot see the harness's own payload.
const off = calibrate(sentEst + 12000, SAMPLE);
A.eq(off.overhead, 12000, 'overhead is the measured excess over the dialogue we sent');
A.eq(projectFrom(off, SAMPLE), sentEst + 12000, 'the fit reproduces the measurement it was taken from');
A.eq(projectFrom(off, []), 12000, 'an EMPTY chat still costs the harness overhead — that is the honest floor');

/* ⛔ COMPACTION case — found walking this live on 2026-08-03. A measurement can come in BELOW the
   transcript we sent, because the sidecar folds older turns away before sending (context.js compacts at
   0.65 of the window). That says nothing about the MODEL's overhead, so it must not be learned as one:
   a per-model figure fitted from a compacted run would understate every other chat on that model. */
A.eq(calibrate(Math.round(sentEst / 4), SAMPLE), null, 'a measurement below the transcript teaches nothing about the model');
A.eq(calibrateFromEstimate(100, 5000), null, 'the pre-estimated form refuses the same case');
A.eq(calibrate(0, SAMPLE), null, 'no measurement, no calibration — never a fabricated fit');
A.eq(projectFrom(null, SAMPLE), 0, 'projecting without a calibration yields nothing, not a guess');
A.eq(calibrateFromEstimate(sentEst + 12000, sentEst).overhead, 12000, 'the pre-estimated form fits identically');

/* …that compacted conversation is covered by its OWN baseline instead: start from the real reading of
   this exact transcript and add only what has been said since. It carries this chat's real overhead
   and whatever was compacted away, so neither gets re-guessed. */
A.eq(projectFromBaseline(30000, sentEst, SAMPLE), 30000, 'an unchanged transcript projects back to its own measurement');
A.eq(projectFromBaseline(30000, sentEst, SAMPLE.concat([{ role: 'user', content: 'z'.repeat(4000) }])),
  30000 + 1000 + MSG_OVERHEAD, 'growth since the measurement is added, and only the growth');
A.eq(projectFromBaseline(30000, sentEst, []), Math.max(0, 30000 - sentEst), 'a shrunken transcript projects downward');
A.eq(projectFromBaseline(500, 100000, SAMPLE), 0, 'and can never go negative');

/* ---- projected readings: a fill may be asserted, but it must never pass as a measurement ---- */
const proj = compute(20000, 200000, { measured: false, projected: true });
A.ok(proj.known === true, 'a projection anchored to a real overhead can assert a fill');
A.eq(proj.measured, false, 'a projection is never reported as measured');
A.eq(proj.projected, true, 'and says so explicitly');
A.eq(proj.label, '~20k / 200k', 'the tilde is in the label, so the UI cannot render it as exact');
A.eq(proj.pctLabel, '~10%', 'the tilde is in the percentage too');
A.eq(proj.level, 'ok', 'a projection still drives the level/colour');

const measuredSame = compute(20000, 200000);
A.eq(measuredSame.label, '20k / 200k', 'a MEASURED reading carries no tilde');
A.eq(measuredSame.projected, false, 'a measured reading is not projected');

// projected + unknown limit is still unknown: with nothing to divide by there is no fill to assert
const projCold = compute(20000, 0, { measured: false, projected: true });
A.eq(projCold.known, false, 'a projection against an unknown window asserts nothing');
A.eq(projCold.pctLabel, '—', 'and shows no percentage');
// measured:false without projected stays exactly as before (the pre-existing honesty path)
A.eq(compute(64000, 128000, { measured: false }).known, false, 'unmeasured and unprojected is still unknown');

A.report('ctxgauge.test');
