/* sidecar/commander-context.js — bounded server-side context composer for ordinary task runs.

   This is the common seam interactive COMMS and messaging channels can share. It composes only durable,
   provenance-labelled facts the harness can prove: active task brief, explicit dossier/goal text, and repeated
   task-decision patterns. It does not infer certainty and does not duplicate a dossier already present in the
   caller's system prompt. */
'use strict';

function clip(s, n) { return String(s == null ? '' : s).trim().slice(0, n); }
function compose(input) {
  input = input || {}; const lines = [];
  const b = input.brief;
  if (b && b.originalDirective) {
    lines.push('<task_brief id="' + clip(b.id, 100).replace(/["<>]/g, '') + '" status="' + clip(b.status, 20) + '">');
    lines.push('ORIGINAL REQUEST: ' + clip(b.originalDirective, 4000));
    for (const q of (b.questions || []).slice(-6)) {
      lines.push('DECISION: ' + clip(q.text, 240) + (q.answer ? (' => ' + clip(q.answer, q.mode==='conversation' ? 4000 : 500)) : ' => unanswered') + (q.mode==='conversation' ? ' [sourceId: '+q.id+']' : ''));
    }
    if(b.context) lines.push('WORKING UNDERSTANDING (model interpretation with user quotations; assumptions are not confirmed facts): '+JSON.stringify(b.context));
    for (const a of (b.assumptions || []).slice(-6)) lines.push('ASSUMPTION: ' + clip(a, 300));
    lines.push('Continue this same task. Do not re-ask answered decisions. Verify the result against the original request and decisions.');
    lines.push('</task_brief>');
  }
  // TASK BRIEF v2 — recipe intake: the launching recipe's DECLARED material decisions (normalized by
  // recipes.js — dimension ∈ the taskbrief-policy set). Aims any mid-run question at the right dimension
  // even when the Commander skipped the launch chips; launch-tapped answers already ride the directive.
  const intake = Array.isArray(input.recipeIntake) ? input.recipeIntake.slice(0, 3) : [];
  if (intake.length) {
    lines.push('<recipe_intake provenance="recipe-declared">');
    lines.push('MATERIAL DECISIONS for this task type — resolve each from the request, launch decisions, or dossier before consequential work; if one is genuinely unresolved and material, it is THE thing to ask about. Default everything else:');
    for (const e of intake) {
      lines.push('- ' + clip(e.dimension, 24) + ': ' + clip(e.question, 160) + ' [' + (Array.isArray(e.options) ? e.options.map(o => clip(o, 72)).join(' | ') : '') + ']'
        + (e.recommended ? ' (suggested: ' + clip(e.recommended, 72) + (e.reason ? ' — ' + clip(e.reason, 160) : '') + ')' : ''));
    }
    lines.push('</recipe_intake>');
  }
  const dossier = clip(input.dossier, 5000), existing = String(input.existingSystem || '');
  if (dossier && existing.indexOf(dossier) < 0) lines.push('<commander_context provenance="commander-dossier">\n' + dossier + '\n</commander_context>');
  const goal = input.goal && (input.goal.title || input.goal.text || input.goal.goal);
  if (goal) lines.push('<active_goal provenance="commander-confirmed">' + clip(goal, 500) + '</active_goal>');
  // ONE evidence projection for every execution lane. These are weak/observed signals: they may help prioritize
  // and personalize, but never override the current request or masquerade as a stated belief.
  const evidence = [];
  const topics = Array.isArray(input.topics) ? input.topics.slice(0, 6) : [];
  for (const t of topics) {
    if (!t || !(t.label || t.topic)) continue;
    evidence.push('TOPIC: ' + clip(t.label || t.topic, 80) + ' (seen ' + Math.max(0, Number(t.count) || 0) + '×)'
      + ((t.evidence && t.evidence[0]) ? ' — evidence: "' + clip(t.evidence[0], 140) + '"' : ''));
  }
  const threads = Array.isArray(input.threads) ? input.threads.slice(0, 5) : [];
  for (const t of threads) if (t && t.title) evidence.push('OPEN THREAD: ' + clip(t.title, 160) + (t.spec ? ' — ' + clip(t.spec, 180) : ''));
  if (input.worksignal) evidence.push('WORKFLOW: ' + clip(input.worksignal, 400));
  const verdicts = input.verdicts && input.verdicts.kinds && typeof input.verdicts.kinds === 'object' ? input.verdicts.kinds : {};
  const prefs = [];
  for (const k of Object.keys(verdicts).slice(0, 8)) {
    const v = verdicts[k] || {}; const w = Number(v.weight) || 0;
    if (w) prefs.push(k + '=' + (w > 0 ? '+' : '') + Math.round(w * 100) / 100 + ' (' + (Number(v.positive) || 0) + ' kept/' + (Number(v.negative) || 0) + ' declined)');
  }
  if (prefs.length) evidence.push('VERDICT PATTERNS: ' + prefs.join(', '));
  const activity = Array.isArray(input.activity) ? input.activity.slice(0, 6) : [];
  for (const a of activity) if (a) evidence.push('RECENT ACTIVITY: ' + clip(a, 180));
  // TRACK RECORD (outcome learning, 2026-08-30): what this station's runs actually produce — pre-composed by
  // outcomes.js, every number a literal count of recent runs. Rides the same weak-evidence fence: it may steer
  // what to propose and how to shape work, never override the current request. Pushed LAST deliberately
  // (consistency sweep, 2026-08-30): the block's 20-line cap truncates from the tail, and on a warm station
  // (6 topics + 5 threads + workflow + verdicts + 6 activity = 19) the original pre-activity position pushed
  // up to 3 RECENT ACTIVITY lines out — trading the freshest grounding for a statistic, the exact inversion
  // of the contextpack doctrine. Now the statistic is what truncates first.
  const track = Array.isArray(input.trackRecord) ? input.trackRecord.slice(0, 4) : [];
  for (const t of track) if (t) evidence.push('TRACK RECORD: ' + clip(t, 200));
  if (evidence.length) {
    lines.push('<commander_evidence provenance="observed; weak; never override the current request">');
    for (const e of evidence.slice(0, 20)) lines.push('- ' + e);
    lines.push('</commander_evidence>');
  }
  // ASK-WORTHINESS: dimensions the Commander has repeatedly waved off with "use your judgment". The tool gate
  // (taskbrief-tools) refuses these outright; saying so here spends no turn discovering that, and names the
  // honest alternative — decide it, then surface the choice as a correctable assumption.
  const deferred = Array.isArray(input.deferredDimensions) ? input.deferredDimensions.slice(0, 8) : [];
  if (deferred.length) {
    lines.push('<deferred_decisions provenance="commander-observed">');
    lines.push('The Commander has repeatedly answered "use your judgment" on these decision dimensions: '
      + deferred.map(d => clip(d, 24)).join(', ') + '. Do NOT ask about them. Choose the most sensible reversible default and state it as a correctable assumption in brief_proceed.');
    lines.push('</deferred_decisions>');
  }
  const patterns = Array.isArray(input.patterns) ? input.patterns : [];
  if (patterns.length) {
    lines.push('<observed_task_patterns strength="weak; never override current instructions">');
    for (const p of patterns.slice(0, 5)) lines.push('- ' + clip(p.question, 180) + ' => ' + clip(p.answer, 240) + ' (' + Number(p.count || 0) + ' times)');
    lines.push('</observed_task_patterns>');
  }
  return lines.join('\n\n');
}

module.exports = { compose };
