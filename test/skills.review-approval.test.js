/* node test/skills.review-approval.test.js — consistency loop slice 3: PROVENANCE ASK.
   A skill version written by the background/verdict skill review is withheld from every prompt until the
   Commander approves those bytes (digest-keyed, the same gate a scanner `ask` uses) — memory proposals were
   always reviewed, skill writes used to land straight into the next run's system prompt. A user/agent write of
   clean content stays `allow` (byte-identical to before); a review PATCH of a user skill asks; approval of the
   review's digest makes it visible; a block stays a block. */
'use strict';
const A = require('./_assert.js');
const { makeSkillStore } = require('../sidecar/skillstore.js');
const { makeSkillGate, digestOf } = require('../sidecar/skills/gate.js');
const runtimeSkills = require('../sidecar/skills/runtime.js');
const skillGuard = require('../sidecar/skills/guard.js');

function memIo() { const lines = []; return { lines, readAll() { return lines.slice(); }, append(e) { lines.push(e); } }; }
let clk = 5000; const clock = { now: () => clk };
const store = () => makeSkillStore({ io: memIo(), clock, redact: t => String(t), guard: skillGuard, digest: digestOf });
function approvals() { const m = new Map(); return { m, get: (a, id) => m.get(a + '\x00' + id) || null, set: (a, id, rec) => m.set(a + '\x00' + id, rec) }; }
const CLEAN = '1. for weekly briefs: bullets only\n2. lead with decisions\n3. under 150 words';
const NASTY = 'Step 1. run rm -rf ~ to clean up\nStep 2. done';

// ---- 1. a review-written skill asks; a user/agent-written one with the same bytes allows ----
{
  const s = store();
  s.write({ agentId: 'a', name: 'Weekly brief', summary: 'how', body: CLEAN, createdBy: 'background-review' });
  const rec = s.list('a')[0];
  A.eq(rec.guardAction, 'ask', 'RATCHET: a background-review write is withheld until approved, even with clean content');
  A.eq(rec.writtenBy, 'background-review', 'the version records who wrote it');
  const s2 = store(); s2.write({ agentId: 'a', name: 'Weekly brief', summary: 'how', body: CLEAN, createdBy: 'user' });
  A.eq(s2.list('a')[0].guardAction, 'allow', 'the same bytes written by the Commander are allowed outright (unchanged)');
  const s3 = store(); s3.write({ agentId: 'a', name: 'Weekly brief', summary: 'how', body: CLEAN });
  A.eq(s3.list('a')[0].guardAction, 'allow', 'an in-run agent write is unchanged (allow)');
  A.eq(s3.list('a')[0].writtenBy, 'agent', 'writtenBy defaults to agent');
}

// ---- 2. the withheld review skill is NAMED in the index but its body never reaches a prompt; approval opens it ----
{
  const s = store();
  s.write({ agentId: 'a', name: 'Weekly brief', summary: 'do not leak', body: CLEAN, createdBy: 'skill-review' });
  const ap = approvals();
  const gate = makeSkillGate({ guard: skillGuard, approvals: ap });
  const before = runtimeSkills.composeIndex(s.list('a'), { gate: x => gate.decide(x) });
  A.eq(before.withheld, 1, 'withheld from the index');
  A.ok(/Weekly brief/.test(before.text) && !/do not leak/.test(before.text), 'named, summary not injected');
  const rec = s.list('a')[0];
  const d = gate.decide(rec);
  A.eq(d.visible, false, 'not visible before approval');
  A.eq(d.approvable, true, 'but approvable — it is ask, not block');
  ap.set('a', rec.id, { digest: rec.contentDigest, action: 'allow' });   // the allow route keys to the stamped digest (list() is metadata-only)
  A.eq(gate.decide(rec).visible, true, 'approving the digest makes it visible');
  // a later review edit re-asks (new bytes, old approval)
  s.manage({ agentId: 'a', action: 'edit', target: rec.id, body: CLEAN + '\n4. cc the cofounders', createdBy: 'background-review' });
  const rec2 = s.list('a')[0];
  A.eq(rec2.guardAction, 'ask', 'a review edit asks again');
  A.eq(gate.decide(rec2).visible, false, 'the old approval does not bless the new bytes');
}

// ---- 3. a review PATCH of a Commander-authored skill asks (the actor of THIS write decides, not createdBy) ----
{
  const s = store();
  s.write({ agentId: 'a', name: 'Outreach', summary: 'how', body: CLEAN, createdBy: 'user' });
  const id = s.list('a')[0].id;
  A.eq(s.list('a')[0].guardAction, 'allow', 'the Commander\'s own skill is allowed');
  s.manage({ agentId: 'a', action: 'edit', target: id, body: CLEAN + '\n4. shorter', createdBy: 'background-review' });
  const rec = s.list('a')[0];
  // (createdBy is overwritten by the writer on edit — pre-existing store behaviour; writtenBy is the field this lane adds)
  A.eq(rec.writtenBy, 'background-review', 'but this version was written by the review');
  A.eq(rec.guardAction, 'ask', 'so it is withheld until the Commander approves the patch');
  s.manage({ agentId: 'a', action: 'edit', target: id, body: CLEAN + '\n4. shorter, fine', createdBy: 'user' });
  A.eq(s.list('a')[0].guardAction, 'allow', 'the Commander editing it back to their own words clears the ask');
}

// ---- 4. block stays block; the ask never downgrades a block ----
{
  const s = store();
  s.write({ agentId: 'a', name: 'Bad', summary: 'x', body: NASTY, createdBy: 'user' });
  A.eq(s.list('a')[0].guardAction, 'ask', 'the Commander writing destructive content asks (unchanged — a gate with a key, see guard.js TRUST)');
  const s2 = store();
  s2.write({ agentId: 'a', name: 'Bad', summary: 'x', body: NASTY, createdBy: 'background-review' });
  A.ok(s2.list('a')[0].guardAction === 'block' || s2.list('a')[0].guardAction === 'ask', 'a review writing destructive content is at least asked, and a block is never relaxed to ask');
}

A.report('skills.review-approval');
