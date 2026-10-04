/* node test/autopilot-threads.test.js — NS-6 propose integration in the PURE autopilot engine.

   Proves: the candidate directive grows a THREADS block listing the open threads with citable tags (so the block
   "appears in the context pack" the propose step feeds the model); a candidate that cites a thread tag [tN] in
   GROUNDS survives the grounding veto AND carries the resolved threadId back (for the picked/delivered/declined
   writeback); a candidate citing a thread title (no tag) also grounds + resolves; and — the anti-slop invariant is
   preserved — a candidate that cites NEITHER a thread NOR any belief/activity is still vetoed. */
'use strict';
const A = require('./_assert.js');
const AP = require('../frontend/app/autopilot.js');

const threads = [
  { id: 'th_aaa', title: 'GPU price watcher', spec: 'build a price watcher for GPUs someday' },
  { id: 'th_bbb', title: 'Discord moderation bot', spec: 'I want a Discord bot for my server' }
];
const beliefs = { goals: ['ship StarNet v1'] };

// ---- 1. the THREADS block appears in the candidate directive, with citable tags ----
{
  const dir = AP.buildCandidateDirective({ beliefs, threads, eligible: AP.ARCHETYPES });
  A.ok(dir.indexOf('OPEN THREADS') >= 0, 'directive carries an OPEN THREADS block');
  A.ok(dir.indexOf('GPU price watcher') >= 0 && dir.indexOf('Discord moderation bot') >= 0, 'both open threads are listed');
  A.ok(dir.indexOf('[t1]') >= 0 && dir.indexOf('[t2]') >= 0, 'each thread carries a citable tag');
  A.ok(/PREFER AN OPEN THREAD/i.test(dir), 'a hard rule tells the model to prefer + cite a thread');
  // the V2 (build) directive gets the same block
  const dir2 = AP.buildCandidateDirectiveV2({ beliefs, threads, eligible: AP.ARCHETYPES });
  A.ok(dir2.indexOf('OPEN THREADS') >= 0 && dir2.indexOf('[t1]') >= 0, 'V2 build directive also carries the THREADS block');
}

// ---- 2. a candidate citing a thread TAG survives the veto AND resolves the threadId ----
{
  const reply =
    'JOB: Build the GPU price watcher\nKIND: advance-goal\nGROUNDS: [t1] the Commander wanted a GPU price watcher\nCONFIDENCE: high\nSPEC: a runnable price-watch script';
  const cands = AP.parseCandidates(reply, { eligible: AP.ARCHETYPES, beliefs, threads });
  A.eq(cands.length, 1, 'a thread-tag-cited candidate survives the grounding veto');
  A.eq(cands[0].threadId, 'th_aaa', 'the cited tag [t1] resolves to the real thread id');
}

// ---- 3. a candidate citing a thread TITLE (no tag) also grounds + resolves ----
{
  const reply =
    'JOB: Prototype a moderation bot\nKIND: advance-goal\nGROUNDS: their Discord moderation bot idea\nCONFIDENCE: medium\nSPEC: a bot skeleton';
  const cands = AP.parseCandidates(reply, { eligible: AP.ARCHETYPES, beliefs, threads });
  A.eq(cands.length, 1, 'a thread-title-cited candidate survives the veto');
  A.eq(cands[0].threadId, 'th_bbb', 'a title citation resolves the thread id too');
}

// ---- 4. anti-slop preserved: a candidate grounded in NEITHER a thread NOR a belief is still vetoed ----
{
  const reply =
    'JOB: Reorganize their sock drawer\nKIND: advance-goal\nGROUNDS: sock drawer entropy management\nCONFIDENCE: high\nSPEC: a folded-sock diagram';
  const cands = AP.parseCandidates(reply, { eligible: AP.ARCHETYPES, beliefs, threads });
  A.eq(cands.length, 0, 'an ungrounded candidate (no thread, no belief) is still dropped by the veto');
}

// ---- 5. threads are OPTIONAL: absent threads = unchanged NS-1/NS-2 behavior (no THREADS block, no threadId) ----
{
  const dir = AP.buildCandidateDirective({ beliefs, eligible: AP.ARCHETYPES });
  A.ok(dir.indexOf('OPEN THREADS') < 0, 'no THREADS block when no threads are passed (back-compat)');
  const cands = AP.parseCandidates(
    'JOB: Ship v1\nKIND: advance-goal\nGROUNDS: ship StarNet v1\nCONFIDENCE: high\nSPEC: a checklist',
    { eligible: AP.ARCHETYPES, beliefs });
  A.eq(cands.length, 1, 'belief-grounded candidate still works with no threads');
  A.ok(!cands[0].threadId, 'no threadId when nothing was cited');
}

A.report('autopilot-threads');
