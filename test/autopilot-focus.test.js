/* node test/autopilot-focus.test.js — NS-5b: the focus/snapshot/compounding directive blocks.
   The propose directive must LEAD with the declared focus and instruct candidates to ADVANCE it; the V2 (build)
   directive must, when a project snapshot is present, steer the artifact to a git-apply-able patch. */
'use strict';
const A = require('./_assert.js');
const AP = require('../frontend/app/autopilot.js');

const eligible = AP.ARCHETYPES.slice(0, 3);
const focusHeader = "TONIGHT'S FOCUS: alpha — because you worked in alpha — last touched today (a git repo I can read + patch)";

(function focusLeadsCandidate() {
  const d = AP.buildCandidateDirective({ beliefs: { goals: ['ship it'] }, activity: ['ran alpha build (today)'], eligible, focusHeader });
  A.ok(d.indexOf(focusHeader) >= 0, 'the candidate directive carries the focus header');
  A.ok(/STAY ON FOCUS/.test(d), 'and adds the stay-on-focus rule');
  // the focus header appears BEFORE the belief dump (it leads).
  A.ok(d.indexOf(focusHeader) < d.indexOf('What you know about them'), 'the focus leads the directive');
})();

(function noFocusNoRule() {
  const d = AP.buildCandidateDirective({ beliefs: { goals: ['x'] }, activity: ['y'], eligible });
  A.ok(!/STAY ON FOCUS/.test(d), 'no focus ⇒ no stay-on-focus rule (never a fabricated header)');
})();

(function priorTonightCompounds() {
  const d = AP.buildCandidateDirective({ beliefs: {}, activity: ['z'], eligible, focusHeader, priorTonight: ['drafted the invoice CSV exporter'] });
  A.ok(/ALREADY PRODUCED TONIGHT/.test(d), 'later beats see what earlier beats produced');
  A.ok(/invoice CSV exporter/.test(d), 'the prior output is named so beat 2+ extends it');
})();

(function v2PatchSteer() {
  const snap = 'PROJECT SNAPSHOT — C:/repo/alpha (read by the station, not guessed):\nTODO / FIXME markers:\n  src/app.js:12:// TODO: handle empty invoice list';
  const cand = AP.buildCandidateDirectiveV2({ beliefs: {}, activity: ['w'], eligible, focusHeader, projectSnapshot: snap });
  A.ok(cand.indexOf(snap) >= 0, 'V2 candidate carries the project snapshot');
  A.ok(/kind.{0,4}:.{0,4}patch/i.test(cand) || /"kind":"patch"/.test(cand), 'V2 candidate instructs a patch-kind artifact');
  const doDir = AP.buildDoDirectiveV2({ title: 'fix empty invoice list', spec: 'guard empty list' }, { runId: 'r1', dir: 'workshop/r1', backlogId: 'b1', focusHeader, projectSnapshot: snap, targetRoot: 'C:/repo/alpha' });
  A.ok(/git apply/i.test(doDir), 'the DO directive instructs a git-apply-able patch');
  A.ok(doDir.indexOf('C:/repo/alpha') >= 0, 'and names the exact target root');
  A.ok(/new branch/i.test(doDir), 'and tells the agent the Commander applies it to a new branch (it never touches the repo)');
})();

A.report();
