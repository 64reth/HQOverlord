/* node test/loop-templates.test.js — the LOOP SHAPES a beginner picks instead of authoring a loop.

   What matters here is not string plumbing, it is that each template produces a loop that is already shaped
   correctly and honestly: a hard-rigor template must end on a machine result, a soft one must carry the
   digest rule that gives it any convergence at all, and neither may quietly become the other. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const T = require('../frontend/app/loop-templates.js');

// ---- 1. the catalog is coherent ------------------------------------------------------------------------
{
  const all = T.list();
  A.ok(all.length >= 3, 'there are templates to pick from');
  const ids = all.map(t => t.id);
  A.eq(ids.length, new Set(ids).size, 'ids are unique');
  for (const t of all) {
    A.ok(t.name && t.tagline && t.blurb, t.id + ' is presentable (name/tagline/blurb)');
    A.ok(t.shape.length >= 2, t.id + ' declares a visible cycle for the stepper');
    A.ok(t.params.length >= 1, t.id + ' asks the Commander something');
    A.ok(t.params.length <= 3, t.id + ' asks at MOST 3 things — a wall of fields is the confusion we are removing');
    A.ok(['hard', 'soft'].indexOf(t.rigor) >= 0, t.id + ' declares its rigor honestly');
    A.ok(['check-green', 'empty-digests', 'never'].indexOf(t.exitOn) >= 0, t.id + ' has a real exit condition');
    A.eq(t.gate, 'review', t.id + ' defaults to REVIEW — a template must never ship full-access-merge by default');
    A.ok(T.rigorNote(t).length > 20, t.id + ' has an honest sentence about how it ends');
  }
  A.eq(T.get('nope'), null, 'an unknown id is null, never a guess');
}

// ---- 2. THE RIGOR CONTRACT: hard means machine-checked, soft means self-reported ------------------------
{
  for (const t of T.list()) {
    if (t.rigor === 'hard') {
      A.eq(t.exitOn, 'check-green', t.id + ': hard rigor MUST mean a machine-checked exit condition');
      A.ok(!!t.check, t.id + ': hard rigor MUST carry a check command template');
      A.ok(t.needsProject, t.id + ': a check needs somewhere to run');
      A.ok(/exit code/.test(T.rigorNote(t)), t.id + ': and says the ending is a real result');
    } else {
      A.ok(!t.check, t.id + ': a soft template must not imply it runs a check');
      A.ok(/DIGEST:/.test(t.objective), t.id + ': soft rigor REQUIRES the digest rule — it is the only convergence it has');
      A.ok(/convention, not a proof/.test(T.rigorNote(t)), t.id + ': and says so plainly rather than implying equal rigor');
    }
  }
  const notes = T.list().map(t => T.rigorNote(t));
  A.ok(new Set(notes).size >= 2, 'hard and soft do not read identically to a beginner');
}

// ---- 3. the digest rule asks for a REPORT, never a concession -------------------------------------------
{
  A.ok(/DIGEST: <n> findings/.test(T.DIGEST_RULE), 'the rule specifies an exact reportable form');
  A.ok(/File it even when n is 0/.test(T.DIGEST_RULE), 'and demands the empty case explicitly');
  A.ok(/Never invent work/.test(T.DIGEST_RULE), 'and forbids manufacturing work to avoid reporting zero');
}

// ---- 4. token filling ------------------------------------------------------------------------------------
{
  const params = [{ key: 'a', required: true, default: '' }, { key: 'b', required: false, default: 'fallback' }];
  A.eq(T.fillTokens('x {a} y', { a: 'A' }, params), 'x A y', 'a filled token substitutes');
  A.eq(T.fillTokens('x {b} y', {}, params), 'x fallback y', 'a blank optional falls back to its default');
  A.eq(T.fillTokens('x {b} y', { b: '   ' }, params), 'x fallback y', 'whitespace counts as blank');
  A.eq(T.fillTokens('x {zz} y', {}, params), 'x {zz} y', 'an unknown token is left VERBATIM — an authoring mistake must be visible, not swallowed');
  A.eq(T.fillTokens('a: {b}\nc', { b: '' }, [{ key: 'b', required: false, default: '' }]), 'a:\nc',
    'an empty resolution does not leave a dangling space before the newline');
  A.eq(T.fillTokens('paste: {a}', { a: 'line1\n  line2' }, params), 'paste: line1\n  line2', 'user text is inserted verbatim, indentation intact');
}

// ---- 5. required-field validation ------------------------------------------------------------------------
{
  const bt = T.get('build-test-verify');
  A.ok(T.requiredMissing(bt.id, {}).indexOf('goal') >= 0, 'a blank required field is reported');
  A.eq(T.requiredMissing(bt.id, { goal: 'x', check: 'npm test' }), [], 'a complete form has nothing missing');
  A.eq(T.requiredMissing(bt.id, { goal: '   ', check: 'npm test' }), ['goal'], 'whitespace is not an answer');
  const rs = T.get('research');
  A.eq(T.requiredMissing(rs.id, { question: 'q' }), [], 'an optional field may stay blank');
}

// ---- 6. buildSpec produces a loop that is already shaped correctly ---------------------------------------
{
  const spec = T.buildSpec('build-test-verify', { goal: 'make the auth tests pass', check: 'npm test' }, { workdir: 'C:/proj', agentId: 'dev' });
  A.eq(spec.exitOn, 'check-green', 'the exit condition comes from the template, not the user');
  A.eq(spec.checkCmd, 'npm test', 'the check command is resolved at creation');
  A.eq(spec.workdir, 'C:/proj', 'and bound to the project');
  A.eq(spec.gate, 'review', 'review-gated by default');
  A.eq(spec.meta.templateId, 'build-test-verify', 'provenance is stamped so the panel can show which shape it is');
  A.ok(/make the auth tests pass/.test(spec.objective), 'the goal is in the objective');
  A.ok(/you do not run it/.test(spec.objective), 'and the agent is told the check is not its to run');
  A.ok(/cannot see or change the command/.test(spec.objective), 'nor to see or change');
  A.ok(spec.redStopAfter > 0, 'a red ceiling is set so a losing fight cannot grind forever');

  const soft = T.buildSpec('sweep-and-fix', { hunting: 'unhandled rejections' }, { workdir: 'C:/proj' });
  A.eq(soft.exitOn, 'empty-digests', 'a soft template exits on empty digests');
  A.eq(soft.checkCmd, undefined, 'and never invents a check command');
  A.ok(/the whole project/.test(soft.objective), 'an omitted optional uses its default rather than leaving a hole');
  A.ok(/DIGEST:/.test(soft.objective), 'and the digest rule rides into the real objective');
  A.ok(soft.dryStopAfter > 0, 'with a convergence ceiling');

  A.eq(T.buildSpec('nope', {}), null, 'an unknown template builds nothing');
}

// ---- 7. a template can be overridden but never silently downgraded ---------------------------------------
{
  const spec = T.buildSpec('research', { question: 'q' }, { gate: 'auto', name: 'my loop', perDayUsd: 3 });
  A.eq(spec.gate, 'auto', 'the Commander may explicitly choose full access');
  A.eq(spec.name, 'my loop', 'and name it');
  A.eq(spec.perDayUsd, 3, 'and cap its daily spend');
  A.eq(T.buildSpec('research', { question: 'q' }).gate, 'review', 'but the DEFAULT stays review when nothing is passed');
}

/* ---- 8. THE CROSS-MODULE CONTRACT — the form the template ASKS for must be the form the sidecar READS.
   This is the exact bug that shipped: the templates instructed "DIGEST: 0 findings" while the sidecar's
   convergence parser only understood "NOTHING-TO-DO", so two of the three shapes could never stop. Every
   soft template's own instruction is now run through the real parser. */
{
  const LJ = require('../sidecar/loopjob.js');

  // the literal example the rule shows a model, with a real count substituted
  const sample = T.DIGEST_RULE.match(/DIGEST: <n> findings — <[^>]+>/);
  A.ok(!!sample, 'the rule shows a concrete example line');
  const filled = sample[0].replace('<n>', '0').replace(/<[^>]+>/, 'nothing new');
  A.eq(LJ.readDigest(filled).filed, true, 'the sidecar can READ the exact form the template asks for');
  A.eq(LJ.readDigest(filled).count, 0, 'and extract its count');
  A.eq(LJ.nextOutcomeFor(filled), 'noop', 'so a zero-finding pass actually converges');
  A.eq(LJ.nextOutcomeFor(sample[0].replace('<n>', '4').replace(/<[^>]+>/, 'found four')), 'candidate',
    'and a non-zero pass is real work');

  for (const t of T.list().filter(x => x.rigor === 'soft')) {
    const m = t.objective.match(/DIGEST: <n> findings/);
    A.ok(!!m, t.id + ' embeds the digest form in its objective');
    A.eq(LJ.readDigest(t.objective.replace('<n>', '0')).filed, true,
      t.id + ': the instruction it gives the model is one the sidecar can parse');
  }
  // and the hard template must NOT be asking for a digest it does not measure
  const hard = T.list().find(x => x.rigor === 'hard');
  A.ok(!/DIGEST:/.test(hard.objective), hard.id + ' does not ask for a digest — its check is the measure');
}

/* ---- 9. the project detector has a real idle state ------------------------------------------------------
   The create form must not claim it is reading a project before a path exists. Once a path is present the
   same row may show the loading state while /api/loops/detect is genuinely in flight. */
{
  const ui = fs.readFileSync(path.join(__dirname, '../frontend/app/windows/loops.js'), 'utf8');
  A.ok(/id="lp-checkrow" class="lp-checkline dim">choose a project to detect its check command/.test(ui),
    'a blank New Loop form starts with an honest idle instruction, not an indefinite loading claim');
  A.ok(/if \(!val && checkEl && rowEl\) \{[\s\S]{0,220}checkEl\.value = ''[\s\S]{0,220}choose a project to detect its check command[\s\S]{0,120}\} else if \(checkEl && rowEl\) \{[\s\S]{0,160}reading the project/.test(ui),
    'clearing the project path resets the check row; loading appears only in the non-empty-path branch');
}

A.report('loop-templates (the shapes a beginner picks)');
