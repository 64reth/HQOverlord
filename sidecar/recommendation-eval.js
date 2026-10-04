'use strict';

const Ledger = require('./recommendation-ledger.js');

function finite(v, fallback) { return Number.isFinite(Number(v)) ? Number(v) : fallback; }
function clamp01(v) { return Math.max(0, Math.min(1, finite(v, 0))); }
function positive(e) { return e.outcome.adopted === true; }
function terminal(e) { return e.state === 'completed' || e.state === 'declined'; }
function round(v) { return Math.round(finite(v, 0) * 10000) / 10000; }

function rate(rows, predicate) { return rows.length ? rows.filter(predicate).length / rows.length : 0; }
function surfaceMetrics(rows) {
  const out = {};
  for (const e of rows) (out[e.surface || 'unknown'] || (out[e.surface || 'unknown'] = [])).push(e);
  for (const key of Object.keys(out)) {
    const r = out[key];
    out[key] = { shown: r.length, adoptionRate: round(rate(r, positive)), completionRate: round(rate(r, e => e.state === 'completed')), satisfactionRate: round(rate(r, e => e.outcome.quality > 0)), declineRate: round(rate(r, e => e.state === 'declined')) };
  }
  return out;
}

/* Offline, deterministic scorecard. It intentionally reads only the durable recommendation history: no UI
   counters, inferred clicks, or mutable current state can make an evaluation look better than the ledger proves. */
function evaluate(raw, opts) {
  opts = opts || {};
  const rows = Ledger.normalize(raw && raw.recommendations ? raw.recommendations : raw).entries
    .filter(e => !opts.surface || e.surface === opts.surface)
    .sort((a, b) => (a.createdAt - b.createdAt) || a.id.localeCompare(b.id));
  const decided = rows.filter(terminal);
  const predicted = decided.filter(e => Number.isFinite(e.scoreComponents.success));
  const brier = predicted.length ? predicted.reduce((sum, e) => {
    const p = clamp01(e.scoreComponents.success); const y = positive(e) ? 1 : 0; return sum + Math.pow(p - y, 2);
  }, 0) / predicted.length : null;

  const slates = {};
  for (const e of decided) if (e.contextId) (slates[e.contextId] || (slates[e.contextId] = [])).push(e);
  let slateCount = 0, precision = 0, regret = 0;
  for (const key of Object.keys(slates)) {
    const slate = slates[key].slice().sort((a, b) => (finite(a.rank, 999) - finite(b.rank, 999)));
    if (!slate.length) continue;
    slateCount++;
    const top = slate.filter(e => finite(e.rank, 999) <= 3);
    precision += rate(top, positive);
    const bestPositiveRank = slate.filter(positive).reduce((m, e) => Math.min(m, finite(e.rank, 999)), 999);
    if (bestPositiveRank < 999) regret += Math.max(0, bestPositiveRank - 1) / Math.max(1, slate.length - 1);
  }

  const fingerprints = {};
  for (const e of decided) if (e.fingerprint) (fingerprints[e.fingerprint] || (fingerprints[e.fingerprint] = new Set())).add(positive(e) ? 'positive' : 'negative');
  const contradictions = Object.values(fingerprints).filter(s => s.size > 1).length;
  const midpoint = Math.ceil(rows.length / 2); const early = rows.slice(0, midpoint); const late = rows.slice(midpoint);
  const hasTemporalComparison = early.length > 0 && late.length > 0;
  const earlyCompletion = hasTemporalComparison ? rate(early, e => e.state === 'completed') : null;
  const lateCompletion = hasTemporalComparison ? rate(late, e => e.state === 'completed') : null;
  const replay = Ledger.replay({ entries: rows }, opts.now != null ? { now: opts.now } : undefined);
  return {
    sampleSize: rows.length, decided: decided.length,
    adoptionRate: round(rate(rows, positive)), satisfactionRate: round(rate(rows, e => e.outcome.quality > 0)), completionRate: round(rate(rows, e => e.state === 'completed')),
    precisionAt3: slateCount ? round(precision / slateCount) : null,
    counterfactualRegret: slateCount ? round(regret / slateCount) : null,
    calibrationBrier: brier == null ? null : round(brier),
    repeatRate: round(replay.repeatRate), contradictionRate: round(decided.length ? contradictions / decided.length : 0),
    meanInterventions: round(rows.length ? rows.reduce((s, e) => s + e.outcome.interventions, 0) / rows.length : 0),
    meanCostUsd: round(rows.length ? rows.reduce((s, e) => s + e.outcome.costUsd, 0) / rows.length : 0),
    temporal: { earlyCompletionRate: earlyCompletion == null ? null : round(earlyCompletion), lateCompletionRate: lateCompletion == null ? null : round(lateCompletion), improvement: hasTemporalComparison ? round(lateCompletion - earlyCompletion) : null },
    surfaces: surfaceMetrics(rows), preferenceModel: { kinds: replay.kinds, traits: replay.traits, projects: replay.projects }
  };
}

/* A fixed eight-week evolution arc used by CI and by maintainers changing rank policy. The Commander begins by
   keeping research briefs, then shifts toward automation. Recency decay plus explicit outcomes must let automation
   overtake research; a model that keeps serving the old identity fails this simulation. */
function simulateArc() {
  const entries = []; const start = Date.UTC(2026, 0, 1); let seq = 0;
  for (let week = 0; week < 8; week++) {
    const contextId = 'week-' + week; const later = week >= 4;
    const candidates = [
      { kind: 'research', traits: ['analysis'], title: 'Research brief ' + week },
      { kind: 'automation', traits: ['automation'], title: 'Automate workflow ' + week },
      { kind: 'writing', traits: ['writing'], title: 'Draft update ' + week }
    ];
    const model = Ledger.replay({ entries }, { now: start + week * 7 * 86400000 });
    const ranked = Ledger.rankCandidates(candidates.map(c => Object.assign({}, c, { features: { relevance: 0.7, impact: 0.7, success: 0.65, novelty: 0.5 } })), model);
    for (const c of ranked) {
      const wanted = later ? c.kind === 'automation' : c.kind === 'research';
      const at = start + week * 7 * 86400000 + c.rank;
      entries.push({ id: 'sim-' + (++seq), surface: 'simulation', kind: c.kind, title: c.title, traits: c.traits,
        contextId, rank: c.rank, score: c.utility, scoreComponents: c.scoreComponents,
        state: wanted ? 'completed' : 'declined', reason: wanted ? 'completed' : 'wrong_thing',
        outcome: { adopted: wanted, quality: wanted ? 1 : -0.5, costUsd: 0.02, interventions: 0, completedAt: wanted ? at : 0 }, createdAt: at, updatedAt: at });
    }
  }
  const now = start + 8 * 7 * 86400000;
  return { history: { entries }, metrics: evaluate({ entries }, { now }), model: Ledger.replay({ entries }, { now }) };
}

module.exports = { evaluate, simulateArc };
