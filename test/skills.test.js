/* node test/skills.test.js — the agent's owned SKILL library (H4).
   Part 1 (the store): a skill round-trips through a fresh instance (durable), a same-name write edits IN PLACE
   (no duplicate), list() returns METADATA only (progressive disclosure — name+summary, never the body), view()
   returns the full body by name or id, the per-agent cap refuses a new skill when full, skills are agent-scoped,
   and secrets are redacted on write. Pure + deterministic (in-memory io + injected clock). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeSkillStore } = require('../sidecar/skillstore.js');
const runtimeSkills = require('../sidecar/skills/runtime.js');
const skillReview = require('../sidecar/skillreview.js');
const skillGuard = require('../sidecar/skills/guard.js');
const skillCurator = require('../sidecar/skillcurator.js');
const { makePackageStore } = require('../sidecar/skills/package.js');

function memIo() { const lines = []; return { lines, readAll() { return lines.slice(); }, append(e) { lines.push(e); } }; }
let clk = 1000; const clock = { now: () => clk };
const redact = (t) => String(t).replace(/sk-[A-Za-z0-9]{8,}/g, '[redacted]');

// ---- A. write returns the skill; list is metadata-only; view returns the body ----
{
  const s = makeSkillStore({ io: memIo(), clock, redact });
  clk = 1111;
  const r = s.write({ agentId: 'a', name: 'Deploy the site', summary: 'build, test, push', body: '1. npm ci\n2. npm test\n3. npm run deploy' });
  A.ok(r.ok && r.skill, 'write succeeds');
  A.eq(r.skill.updatedAt, 1111, 'stamps updatedAt from the clock');
  A.eq(r.edited, false, 'first write is a create, not an edit');
  const list = s.list('a');
  A.eq(list.length, 1, 'one skill listed');
  A.eq(list[0].name, 'Deploy the site', 'list carries the name');
  A.ok(list[0].summary === 'build, test, push', 'list carries the summary');
  A.ok(!('body' in list[0]), 'list is METADATA only — no body (progressive disclosure)');
  const v = s.view('a', 'Deploy the site');
  A.ok(v && /npm run deploy/.test(v.body), 'view returns the full body');
  A.eq(s.view('a', list[0].id).name, 'Deploy the site', 'view also resolves by id');
}

// ---- B. same-name write edits IN PLACE (no duplicate) ----
{
  const s = makeSkillStore({ io: memIo(), clock, redact });
  s.write({ agentId: 'a', name: 'Release', summary: 'v1', body: 'old steps' });
  const r2 = s.write({ agentId: 'a', name: 'Release', summary: 'v2', body: 'new steps' });
  A.eq(r2.edited, true, 'second same-name write is an edit');
  A.eq(s.list('a').length, 1, 'still ONE skill (edit in place, no duplicate)');
  A.ok(/new steps/.test(s.view('a', 'Release').body), 'the body was updated');
}

// ---- C. durable: a fresh store rebuilds the library from the on-disk log, edits-latest-wins ----
{
  const io = memIo();
  let s = makeSkillStore({ io, clock, redact });
  s.write({ agentId: 'a', name: 'Backup', summary: 's', body: 'first' });
  s.write({ agentId: 'a', name: 'Backup', summary: 's2', body: 'second' });   // edit
  s = makeSkillStore({ io, clock, redact });   // simulate a RESTART, rebuilt from the same io
  A.eq(s.list('a').length, 1, 'replayed: one skill (not two — fold to latest)');
  A.ok(/second/.test(s.view('a', 'Backup').body), 'replayed: the latest body wins');
}

// ---- D. per-agent cap refuses a NEW skill when full (edits still allowed) ----
{
  const s = makeSkillStore({ io: memIo(), clock, redact, maxPerAgent: 2 });
  A.ok(s.write({ agentId: 'a', name: 'one', body: 'x' }).ok, 'first ok');
  A.ok(s.write({ agentId: 'a', name: 'two', body: 'x' }).ok, 'second ok');
  const over = s.write({ agentId: 'a', name: 'three', body: 'x' });
  A.ok(!over.ok && /full/.test(over.error), 'a NEW skill past the cap is refused');
  A.ok(s.write({ agentId: 'a', name: 'one', body: 'edited' }).ok, 'editing an existing skill still works at the cap');
}

// ---- E. agent isolation + redaction ----
{
  const s = makeSkillStore({ io: memIo(), clock, redact });
  s.write({ agentId: 'a', name: 'mine', body: 'secret token sk-ABCD1234EFGH' });
  s.write({ agentId: 'b', name: 'theirs', body: 'other' });
  A.eq(s.list('a').length, 1, 'agent a sees only its own skill');
  A.eq(s.view('a', 'theirs'), null, 'agent a cannot view agent b\'s skill');
  A.ok(s.view('a', 'mine').body.indexOf('sk-ABCD1234') === -1, 'secrets are redacted in the stored body');
}

// ---- F. a nameless write is rejected (no crash) ----
{
  const s = makeSkillStore({ io: memIo(), clock, redact });
  A.ok(!s.write({ agentId: 'a', body: 'x' }).ok, 'a skill with no name is refused');
}

// ---- G. (H4.2) the skill tools delegate to the store: write saves, list=metadata, view=body ----
{
  const { makeSkillTools } = require('../sidecar/tools/builtin/skills.js');
  const store = makeSkillStore({ io: memIo(), clock, redact });
  const tools = makeSkillTools({ store });
  const ctx = { agentId: 'a' };
  A.eq(tools.writeTool.capability, 'memory', 'skill.write joins the NOTEBOOK (memory) capability');
  const w = tools.writeTool.run({ name: 'Deploy', summary: 'ship it', body: 'step 1\nstep 2 deploy' }, ctx);
  A.ok(/Saved skill/.test(w.content), 'skill.write saves');
  const l = tools.listTool.run({}, ctx);
  A.ok(/Deploy/.test(l.content) && /ship it/.test(l.content), 'skill.list shows name + summary');
  A.ok(l.content.indexOf('step 2 deploy') === -1, 'skill.list does NOT leak the body (progressive disclosure)');
  const v = tools.viewTool.run({ name: 'Deploy' }, ctx);
  A.ok(/step 2 deploy/.test(v.content), 'skill.view loads the full body');
  A.ok(/No skill named/.test(tools.viewTool.run({ name: 'ghost' }, ctx).content), 'skill.view on a missing name -> helpful message');
  A.ok(/Updated/.test(tools.writeTool.run({ name: 'Deploy', body: 'v2' }, ctx).content), 'same-name write reports edited');
  A.eq(tools.manageTool.name, 'skill.manage', 'skill.manage is exposed');
  A.ok(/create complete/.test(tools.manageTool.run({ action: 'create', name: 'Review PRs', summary: 'review code', body: 'inspect diff' }, ctx).content), 'skill.manage creates');
  A.ok(/patch complete/.test(tools.manageTool.run({ action: 'patch', target: 'Review PRs', find: 'diff', replace: 'tests and diff' }, ctx).content), 'skill.manage patches');
  A.ok(/tests and diff/.test(tools.viewTool.run({ name: 'Review PRs' }, ctx).content), 'patched body is viewable');
}

// ---- H. skill.manage lifecycle: archive/restore, support files, usage, curator ----
{
  const s = makeSkillStore({ io: memIo(), clock, redact });
  clk = 2000;
  const c = s.manage({ agentId: 'a', action: 'create', name: 'Ship App', summary: 'ship safely', body: 'run tests\nship' });
  A.ok(c.ok, 'manage create succeeds');
  A.ok(!('body' in s.list('a')[0]), 'manage-created skills still list as metadata only');
  A.ok(s.manage({ agentId: 'a', action: 'write_file', target: 'Ship App', path: 'references/checklist.md', content: 'verify rollback' }).ok, 'support file writes under allowed dirs');
  A.ok(!s.manage({ agentId: 'a', action: 'write_file', target: 'Ship App', path: '../oops.md', content: 'x' }).ok, 'unsafe support paths are rejected');
  clk = 2001;
  const v1 = s.view('a', 'Ship App');
  A.eq(v1.viewCount, 1, 'skill.view increments viewCount');
  A.eq(v1.useCount, 1, 'skill.view also counts as use');
  s.markUsed('a', 'Ship App');
  A.eq(s.view('a', 'Ship App', { bump: false }).useCount, 2, 'markUsed increments useCount without loading body');
  A.ok(s.manage({ agentId: 'a', action: 'archive', target: 'Ship App' }).ok, 'archive succeeds');
  A.eq(s.list('a').length, 0, 'archived skills are hidden from default list/prompt index');
  A.eq(s.view('a', 'Ship App'), null, 'archived skills are hidden from default view');
  A.ok(s.manage({ agentId: 'a', action: 'restore', target: 'Ship App' }).ok, 'restore succeeds');
  A.eq(s.list('a').length, 1, 'restored skills return to the list');
  clk = 10000;
  A.ok(s.manage({ agentId: 'a', action: 'pin', target: 'Ship App' }).ok, 'pin succeeds');
  const cur = s.curate('a', { now: 10000 + 100000, staleMs: 1, archiveMs: 2 });
  A.eq(cur.archived, 0, 'pinned skills are not auto-archived');
}

// ---- I. runtime prompt index: metadata only, mandatory skill.view instruction, budgeted ----
{
  const s = makeSkillStore({ io: memIo(), clock, redact });
  s.write({ agentId: 'a', name: 'Deploy', summary: 'ship safely', body: 'SECRET BODY SHOULD NOT LEAK' });
  const out = runtimeSkills.composeIndex(s.list('a'), { budget: 200, canManage: true });
  A.ok(/SAVED AGENT SKILLS/.test(out.text), 'runtime skill index has a mandatory header');
  A.ok(/Deploy/.test(out.text) && /ship safely/.test(out.text), 'index includes skill metadata');
  A.ok(out.text.indexOf('SECRET BODY') === -1, 'index does not inject skill body');
  A.ok(/skill.view/.test(out.text) && /skill.manage/.test(out.text), 'index instructs view-before-use and manage-on-learning');
  A.eq(out.ids.length, 1, 'compose returns ids for use-count bumping');
  const hidden = runtimeSkills.composeIndex([{ id: 'w', name: 'Windows only', summary: 'x', platforms: ['windows'], state: 'active' }], { platform: 'linux' });
  A.eq(hidden.text, '', 'platform filters hide incompatible skills from the prompt index');

  // ---- relevance-ranked index: opts.query reorders by BM25 over {name, summary}; no query -> caller order ----
  {
    // caller (skillStore mine()) order: pinned first, then updatedAt desc — feed that shape in directly.
    const idx = [
      { id: 'p1', name: 'Pinned Ops', summary: 'unrelated ops runbook', state: 'active', pinned: true, updatedAt: 1000 },
      { id: 'n1', name: 'Deploy Pipeline', summary: 'ship the app safely', state: 'active', updatedAt: 3000 },
      { id: 'n2', name: 'Video Editing', summary: 'cut and caption clips', state: 'active', updatedAt: 2000 }
    ];
    const noQ = runtimeSkills.composeIndex(idx, {});
    A.ok(noQ.text.indexOf('Pinned Ops') < noQ.text.indexOf('Deploy Pipeline') && noQ.text.indexOf('Deploy Pipeline') < noQ.text.indexOf('Video Editing'),
      'no query -> exactly the caller order (byte-identical contract)');
    const q = runtimeSkills.composeIndex(idx, { query: 'cut a video clip for the channel' });
    A.ok(q.text.indexOf('Pinned Ops') < q.text.indexOf('Video Editing'), 'pinned skills stay first even when a non-pinned one is more relevant');
    A.ok(q.text.indexOf('Video Editing') < q.text.indexOf('Deploy Pipeline'), 'the query-relevant skill outranks the more recently updated one');
    A.ok(q.text.indexOf('Deploy Pipeline') >= 0, 'relevance ORDERS the index, never drops a skill (budget is the only omission path)');
    A.eq(q.ids.length, 3, 'all ids still returned under a query');
    const noOverlap = runtimeSkills.composeIndex(idx, { query: 'zzz nothing matches this' });
    A.ok(noOverlap.text.indexOf('Pinned Ops') < noOverlap.text.indexOf('Deploy Pipeline') && noOverlap.text.indexOf('Deploy Pipeline') < noOverlap.text.indexOf('Video Editing'),
      'a no-overlap query degrades to updatedAt-desc caller order (tiebreak law)');
    const stopQ = runtimeSkills.composeIndex(idx, { query: 'the of and' });
    A.ok(stopQ.text.indexOf('Deploy Pipeline') < stopQ.text.indexOf('Video Editing'), 'a stopword-only query is treated as no query');
  }
  A.eq(runtimeSkills.extractInvocations([{ role: 'user', content: '/skill Deploy\ncontinue' }])[0], 'Deploy', 'slash /skill invocation is parsed');
  A.ok(/PRELOADED SKILLS/.test(runtimeSkills.composeLoaded([s.view('a', 'Deploy', { bump: false })])), 'explicit preload composes full skill bodies');
}

// ---- J. background skill review helpers: complex-run trigger + class-level prompt ----
{
  const simple = { reason: 'done', turns: 1, messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'ok' }] };
  A.eq(skillReview.shouldReviewRun(simple), false, 'trivial completed run does not trigger skill review');
  const complex = { reason: 'done', turns: 2, messages: [
    { role: 'user', content: 'do a task' },
    { role: 'assistant', content: '', tool_calls: [{ function: { name: 'fs.read' } }, { function: { name: 'shell.exec' } }, { function: { name: 'verify.run' } }, { function: { name: 'fs.edit' } }] }
  ] };
  A.eq(skillReview.shouldReviewRun(complex), true, 'tool-heavy completed run triggers skill review');
  const prompt = skillReview.buildPrompt({ messages: complex.messages, skills: [{ name: 'Existing', summary: 'umbrella', state: 'active' }] });
  A.ok(/update an existing skill/.test(prompt) && /create a new skill only/.test(prompt), 'review prompt prefers patching existing umbrella skills');
  const prompt2 = skillReview.buildPrompt({ messages: complex.messages, loadedSkills: [{ name: 'Loaded Skill', summary: 'was used' }], memories: [{ kind: 'profile', content: 'prefers short answers' }] });
  A.ok(/Loaded Skill/.test(prompt2) && /Recent durable memory context/.test(prompt2), 'review prompt includes loaded skill and memory context');
}

// ---- K. package-backed skills: SKILL.md, support files, setup/platform metadata, guard scan ----
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-skills-'));
  const packages = makePackageStore({ fs, pathMod: path, root });
  const s = makeSkillStore({ io: memIo(), clock, redact, packageStore: packages, guard: skillGuard });
  const r = s.manage({
    agentId: 'a', action: 'create', name: 'Package Demo', summary: 'package test',
    description: 'writes a package', setup: 'Install deps first.', platforms: ['windows'],
    body: 'Use the package safely.'
  });
  A.ok(r.ok && r.skill.packagePath, 'package-backed create returns a package path');
  A.ok(fs.existsSync(path.join(r.skill.packagePath, 'SKILL.md')), 'SKILL.md is written to disk');
  s.manage({ agentId: 'a', action: 'write_file', target: 'Package Demo', path: 'references/notes.md', content: 'linked detail' });
  const viewed = s.view('a', 'Package Demo', { bump: false });
  A.ok(viewed.files.some(f => f.path === 'references/notes.md' && /linked detail/.test(f.content)), 'view hydrates linked support files');
  A.ok(/Install deps/.test(fs.readFileSync(path.join(viewed.packagePath, 'SKILL.md'), 'utf8')), 'setup notes are rendered into SKILL.md');
  A.eq(viewed.scan.verdict, 'safe', 'safe package records a guard verdict');
  s.manage({ agentId: 'a', action: 'patch', target: 'Package Demo', find: 'safely', replace: 'with curl ${API_TOKEN}' });
  A.eq(s.view('a', 'Package Demo', { bump: false }).scan.verdict, 'dangerous', 'guard scan flags exfiltration-shaped content');
}

// ---- L. curator helpers: agent-created clusters only, pinned/protected filtered out ----
{
  const skills = [
    { name: 'deploy-api', summary: 'x', state: 'active', createdBy: 'agent' },
    { name: 'deploy-ui', summary: 'x', state: 'active', createdBy: 'background-review' },
    { name: 'research-news', summary: 'x', state: 'active', createdBy: 'agent', pinned: true },
    { name: 'bundled-plan', summary: 'x', state: 'active', createdBy: 'builtin' }
  ];
  const cls = skillCurator.clusters(skills);
  A.eq(cls.length, 1, 'curator clusters unpinned agent-created siblings');
  A.eq(cls[0].key, 'deploy', 'cluster key comes from skill prefix');
  A.ok(/deploy-api/.test(skillCurator.buildPrompt({ skills })), 'curator prompt includes candidate skills');
}

// ---- M. (A2) background review observer un-silences a pass: deliverable + one audit line per change ----
{
  // a WRITE action fires the EXISTING deliverable (kind:'skill') through the injected emit + one audit line.
  const emits = []; const logs = [];
  const obs = skillReview.makeReviewObserver({ emit: (n, p) => emits.push({ n, p }), log: (s) => logs.push(s), now: () => 42, source: 'skill-review' });
  const skill = { id: 'sk1', agentId: 'a', name: 'Deploy the site' };
  A.eq(obs.onManage(skill, 'create'), true, 'a create is a surfaced write');
  A.eq(emits.length, 1, 'exactly one deliverable emitted');
  A.eq(emits[0].n, 'deliverable', 'the EXISTING deliverable event is used (no new schema)');
  A.eq(emits[0].p.kind, 'skill', 'deliverable carries kind:skill');
  A.eq(emits[0].p.title, 'Deploy the site', 'deliverable carries the skill name as title');
  A.eq(emits[0].p.id, 'sk1', 'deliverable carries the skill id for the panel refresh');
  A.eq(logs.length, 1, 'exactly one auditable log line (C1)');
  A.ok(/skill-review/.test(logs[0]) && /Deploy the site/.test(logs[0]) && /create/.test(logs[0]), 'the audit line names source, action, and skill');

  // dedup: a re-fired SAME action on the same skill does not double-emit.
  A.eq(obs.onManage(skill, 'create'), false, 'a duplicate create is dropped (deduped)');
  A.eq(emits.length, 1, 'no second deliverable for the duplicate');

  // a distinct action on the same skill IS a fresh change (create then edit within one pass).
  A.eq(obs.onManage(skill, 'edit'), true, 'a distinct action on the same skill surfaces once');
  A.eq(emits.length, 2, 'the edit emits its own deliverable');

  // a READ-shaped action (view/list) stays silent — no aside for merely consulting a skill.
  A.eq(obs.onManage(skill, 'view'), false, 'a read action never surfaces');
  A.eq(obs.onManage(null, 'create'), false, 'a missing skill never surfaces');
  A.eq(emits.length, 2, 'reads and null skills add no deliverable');
}

// ---- N. (A2) isWriteAction classifies mutations vs reads ----
{
  A.ok(skillReview.isWriteAction('create') && skillReview.isWriteAction('patch') && skillReview.isWriteAction('archive'), 'create/patch/archive are writes');
  A.ok(skillReview.isWriteAction('saved') && skillReview.isWriteAction('edited'), 'store verbs saved/edited count as writes');
  A.ok(!skillReview.isWriteAction('view') && !skillReview.isWriteAction('list') && !skillReview.isWriteAction(''), 'view/list/empty are not writes');
}

// ---- O. GROWTH: view() does NOT append a JSONL line (RAM-only bump); counters ride the next real mutation ----
{
  const io = memIo();
  const s = makeSkillStore({ io, clock, redact });
  s.write({ agentId: 'a', name: 'Deploy', summary: 's', body: 'steps' });
  const linesAfterWrite = io.lines.length;
  for (let i = 0; i < 25; i++) s.view('a', 'Deploy');   // many views — the old code appended one line EACH
  A.eq(io.lines.length, linesAfterWrite, 'view() appended NO new JSONL lines (was unbounded growth)');
  A.eq(s.view('a', 'Deploy', { bump: false }).viewCount >= 25, true, 'the view bumps still accumulated in RAM');
  // a real mutation flushes the accumulated counters to disk (makeEntry carries viewCount/useCount forward)
  s.write({ agentId: 'a', name: 'Deploy', summary: 's2', body: 'steps2' });
  const reloaded = makeSkillStore({ io, clock, redact });
  A.ok(reloaded.view('a', 'Deploy', { bump: false }).viewCount >= 25, 'accumulated view counters survived to disk via the next mutation');
}

// ---- P. COMPACTION: rewrite keeps only the newest entry per (agentId,name); every distinct skill survives ----
{
  // an io that can atomically replace the whole file (io.rewrite) — mirrors the index.js JSONL adapter.
  function rwIo() { let lines = []; return { get lines() { return lines; }, readAll() { return lines.slice(); }, append(e) { lines.push(e); }, rewrite(entries) { lines = entries.slice(); } }; }
  const io = rwIo();
  const s = makeSkillStore({ io, clock, redact });
  // three distinct skills, each edited several times -> many JSONL lines, few distinct skills
  for (let i = 0; i < 6; i++) { s.write({ agentId: 'a', name: 'Alpha', summary: 's' + i, body: 'a' + i }); }
  for (let i = 0; i < 4; i++) { s.write({ agentId: 'a', name: 'Beta', summary: 's' + i, body: 'b' + i }); }
  s.write({ agentId: 'b', name: 'Alpha', summary: 's', body: 'other-agent' });   // same NAME, different agent — distinct key
  for (let i = 0; i < 10; i++) s.view('a', 'Alpha');
  const beforeLines = io.lines.length;
  A.ok(beforeLines >= 11, 'many appends accumulated before compaction');
  const r = s.compact();
  A.ok(r.ok, 'compaction ran');
  A.eq(io.lines.length, 3, 'compacted to exactly one line per distinct (agentId,name)');
  A.ok(io.lines.length < beforeLines, 'compaction shrank the file');
  // every distinct skill's NEWEST state survives, and a boot load after compaction sees them all
  const reloaded = makeSkillStore({ io, clock, redact });
  A.ok(/a5/.test(reloaded.view('a', 'Alpha', { bump: false }).body), 'Alpha kept its NEWEST body after compaction');
  A.ok(/b3/.test(reloaded.view('a', 'Beta', { bump: false }).body), 'Beta kept its newest body');
  A.ok(/other-agent/.test(reloaded.view('b', 'Alpha', { bump: false }).body), 'the other agent\'s same-named skill was NOT dropped');
  A.eq(reloaded.view('a', 'Alpha', { bump: false }).viewCount >= 10, true, 'compaction flushed accumulated view counters to disk');
  A.eq(reloaded.list('a').length + reloaded.list('b').length, 3, 'boot load after compaction sees every distinct skill');
}

/* ---- "take the WORSE of two risk levels" must not fail OPEN on a level it doesn't recognize ----
   ORDER[unknown] is undefined and `undefined >= n` is FALSE, so an unrecognized level always LOST:
   worse('Dangerous','safe') answered 'safe'. A typo, a casing difference, or a level a newer scanner emits
   silently downgraded the verdict — in the one function whose entire job is to pick the worse of two. ---- */
{
  A.eq(skillGuard.worse('dangerous', 'safe'), 'dangerous', 'a known-worse level wins');
  A.eq(skillGuard.worse('safe', 'dangerous'), 'dangerous', 'in either argument order');
  A.eq(skillGuard.worse('caution', 'safe'), 'caution', 'caution beats safe');
  A.eq(skillGuard.worse('Dangerous', 'safe'), 'Dangerous', 'a CASING difference is not a downgrade');
  A.eq(skillGuard.worse('extreme', 'caution'), 'extreme', 'an UNKNOWN level ranks worst, never safest');
  A.eq(skillGuard.worse(null, 'caution'), 'caution', 'a missing level defaults to safe and loses');
  A.eq(skillGuard.worse('safe', 'safe'), 'safe', 'two safes stay safe');
}

// ---- R. the view->markUsed cycle is a FIXED POINT on a skill with setup + support files ----
// Regression for the hydrate-then-bump re-append: view() hydrates the RENDERED SKILL.md (setup block +
// support-file pointer list) and used to bump that whole document into `latest` as the skill's `body`.
// markUsed() runs on every run and persists from `latest`, so each cycle re-rendered '## Setup' in front
// of a body that already had one — unbounded growth in RAM, in skills.jsonl and on disk, and a moving
// contentDigest that invalidated the Commander's approval forever.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-skills-fp-'));
  const packages = makePackageStore({ fs, pathMod: path, root });
  const skillGate = require('../sidecar/skills/gate.js');
  const s = makeSkillStore({ io: memIo(), clock, redact, guard: skillGuard, digest: skillGate.digestOf, packageStore: packages });
  s.write({ agentId: 'a', name: 'Deploy', body: '1. npm ci\n2. npm test', setup: 'Node 20 and a clean tree.' });
  s.manage({ agentId: 'a', action: 'write_file', target: 'Deploy', path: 'references/notes.md', content: 'hello' });
  const id = s.list('a')[0].id;
  const sizes = [], digests = [];
  for (let i = 0; i < 4; i++) {
    clk += 10;
    s.view('a', id);                 // the skill.view TOOL passes no opts — bump AND hydrate default ON
    s.markUsed('a', [id]);           // every run does this for every indexed skill id
    const stored = s.view('a', id, { bump: false, hydrate: false });
    sizes.push(String(stored.body).length);
    digests.push(stored.contentDigest);
  }
  A.eq(sizes.join(','), [sizes[0], sizes[0], sizes[0], sizes[0]].join(','), 'the stored body does NOT grow across view+markUsed cycles');
  A.eq(digests.join(','), [digests[0], digests[0], digests[0], digests[0]].join(','), 'contentDigest is stable, so an approval is not invalidated every run');
  const stored = s.view('a', id, { bump: false, hydrate: false });
  A.ok(/npm test/.test(stored.body), 'the real steps survive');
  A.ok(!/## Setup/.test(stored.body), 'the RENDERED setup block never enters the stored body');
  A.ok(!/## Support Files/.test(stored.body), 'the RENDERED pointer list never enters the stored body');
  A.eq(stored.setup, 'Node 20 and a clean tree.', 'setup stays its own field');
  const md = fs.readFileSync(path.join(packages.packageDir({ agentId: 'a', id }), 'SKILL.md'), 'utf8');
  A.eq((md.match(/## Setup/g) || []).length, 1, 'SKILL.md on disk holds exactly ONE Setup block');
  A.eq((md.match(/## Support Files/g) || []).length, 1, 'SKILL.md on disk holds exactly ONE Support Files list');
  // The hydrated copy the model receives still carries the counters the bump just made.
  const seen = s.view('a', id, { bump: false });
  A.eq(seen.viewCount, 4, 'the hydrated view still reports the bumped viewCount');
}

// ---- S. splitRendered inverts renderSkillMd, and heals a package already corrupted by the re-append ----
{
  const P = require('../sidecar/skills/package.js');
  const one = P.splitRendered('## Setup\nDo this first.\n\n1. step one\n2. step two\n\n## Support Files\n- `references/a.md`', { setup: 'Do this first.' });
  A.eq(one.setup, 'Do this first.', 'the rendered Setup block is claimed off the KNOWN value');
  A.eq(one.body, '1. step one\n2. step two', 'the pointer list and the Setup block are stripped from the body');
  // A setup that itself contains a blank line is exactly why the boundary cannot be guessed from text.
  const multi = P.splitRendered('## Setup\npara one\n\npara two\n\n1. step one', { setup: 'para one\n\npara two' });
  A.eq(multi.setup, 'para one\n\npara two', 'a MULTI-PARAGRAPH setup round-trips — the known value fixes the boundary');
  A.eq(multi.body, '1. step one', 'and the body after it is not swallowed');
  const heal = P.splitRendered('## Setup\nSame.\n\n## Setup\nSame.\n\n## Setup\nSame.\n\nreal steps', { setup: 'Same.' });
  A.eq(heal.setup, 'Same.', 'repeated rendered Setup blocks collapse to one — the re-append signature');
  A.eq(heal.body, 'real steps', 'the healed body is just the real steps');
  const edited = P.splitRendered('## Setup\nHAND EDITED on disk.\n\nreal steps', { setup: 'Node 20.' });
  A.eq(edited.setup, '', 'a Setup block we cannot claim exactly is NOT guessed at');
  A.eq(edited.body, '## Setup\nHAND EDITED on disk.\n\nreal steps', 'the hand-edited text stays in the body — nothing is dropped');
  const absent = P.splitRendered('just steps', { setup: 'Node 20.' });
  A.eq(absent.setup, 'Node 20.', 'a document with no Setup heading at all keeps the setup we hold');
  const authored = P.splitRendered('1. run it\n\n## Support Files\nsee the notes in references/', {});
  A.eq(authored.body, '1. run it\n\n## Support Files\nsee the notes in references/', 'a Support Files section that is PROSE, not a pointer list, is left alone');
  // render -> split -> render must be a fixed point, on both branches
  const fixedPoint = (skill) => {
    const md1 = P.renderSkillMd(skill);
    const split = P.splitRendered(P.parseFrontmatter(md1).body, skill);
    const next = Object.assign({}, skill, { setup: split.setup, body: split.body });
    const md2 = P.renderSkillMd(next);
    const split2 = P.splitRendered(P.parseFrontmatter(md2).body, next);
    return md2 === md1 && split2.body === split.body && split2.setup === split.setup;
  };
  A.ok(fixedPoint({ name: 'X', setup: 'S', body: 'B', files: [{ path: 'references/a.md', content: 'c' }] }), 'render/split is a FIXED POINT with setup + support files');
  A.ok(fixedPoint({ name: 'X', setup: 'a\n\nb', body: 'B' }), 'render/split is a FIXED POINT with a multi-paragraph setup');
  A.ok(fixedPoint({ name: 'X', body: '## Setup\nthe author typed this themselves' }), 'render/split is a FIXED POINT when the BODY itself opens with a Setup heading');
  A.ok(fixedPoint({ name: 'X', setup: 'S', body: '' }), 'render/split is a FIXED POINT for a setup-only skill');
}

A.report('skills.test');
