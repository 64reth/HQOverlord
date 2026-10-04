/* node test/eval-skills-runner.test.js — scripts/eval/skills.mjs pure halves: parseArgs, summarize, render.
   The honesty law of the runner: a scripted/replay model can only ever yield MODE: PLUMBING — never a green
   consistency claim; a live model yields per-skill pass RATES; no goldens is said out loud. */
'use strict';
const A = require('./_assert.js');
(async () => {
  const M = await import('../scripts/eval/skills.mjs');
  const o = M.parseArgs(['--base', 'http://x:1/', '--skill', 's1', '--repeat', '3', '--json', 'out.json']);
  A.eq(o.base, 'http://x:1', 'base trailing slash stripped');
  A.eq(o.skill, 's1', 'skill filter'); A.eq(o.repeat, 3, 'repeat'); A.eq(o.json, 'out.json', 'json out');
  A.eq(M.parseArgs(['--repeat', '0']).repeat, 1, 'repeat floors at 1');

  const plumbing = M.summarize([{ skillId: 'a', goldenId: 'g1', model: 'test/model', pass: true }, { skillId: 'a', goldenId: 'g1', model: 'test/model', pass: true }]);
  A.eq(plumbing.mode, 'plumbing', 'a scripted model → plumbing mode');
  A.ok(/PLUMBING ONLY/.test(M.render(plumbing)) && !/LIVE/.test(M.render(plumbing)), 'RATCHET: plumbing never renders a live consistency claim');

  const live = M.summarize([
    { skillId: 'brief', goldenId: 'g1', model: 'anthropic/claude-haiku-4.5', pass: true },
    { skillId: 'brief', goldenId: 'g1', model: 'anthropic/claude-haiku-4.5', pass: false },
    { skillId: 'brief', goldenId: 'g2', model: 'anthropic/claude-haiku-4.5', pass: true },
    { skillId: 'outreach', goldenId: 'g3', model: 'anthropic/claude-haiku-4.5', pass: true }
  ]);
  A.eq(live.mode, 'live', 'a live model → live mode');
  A.eq(live.rows[0].skillId, 'brief', 'worst skill first');
  A.eq(live.rows[0].rate, 0.667, 'pass rate per skill');
  A.eq(live.rows[0].goldens, 2, 'distinct goldens counted');
  A.ok(/FLAKY brief/.test(M.render(live)) && /PASS  outreach/.test(M.render(live)) && /MODE: LIVE — 3\/4/.test(M.render(live)), 'render names flaky vs pass and the live total');
  const mixed = M.summarize([{ skillId: 'a', goldenId: 'g', model: 'test/model', pass: true }, { skillId: 'a', goldenId: 'g', model: 'openai/gpt-5', pass: true }]);
  A.eq(mixed.mode, 'live', 'any live run makes the report live (the plumbing rows are still listed by model)');
  A.eq(M.summarize([]).mode, 'empty', 'no results → empty');
  A.ok(/no goldens on record/.test(M.render(M.summarize([]))), 'empty says how to mint one');
  A.report('eval-skills-runner');
})();
