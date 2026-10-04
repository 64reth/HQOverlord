/* node test/memcore.test.js — Cortex M-mem.6 Memory Core: the PURE stats reducer + record ops.
   Proves the per-record stats are a REDUCTION over the memory.* event log (never invented): memory.used
   bumps useCount + stamps lastUsedAt from the injected clock; memory.feedback folds a signed delta into a
   clamped [0,1] trust. pin/edit/forget are pure, non-mutating array transforms; edit preserves provenance
   and mirrors content into body for the legacy readers; projectRecord surfaces the full §5.2 shape. */
'use strict';
const A = require('./_assert.js');
const { nextTrust, nextNoteId, reduceStats, applyPin, applyEdit, applyForget, projectRecord, TRUST_STEP, TRUST_HALFLIFE_MS, clamp01, decayTrust, tokenJaccard, findSimilar, originOf } = require('../sidecar/memcore.js');

const base = () => [
  { id: 'note_1', kind: 'note', title: 'API base', body: 'openrouter.ai/api/v1', useCount: 0, trust: 0, lastUsedAt: null, createdAt: 1000, ts: 1000, sourceRunId: 'run_a', pinned: false },
  { id: 'note_2', kind: 'fact', title: 'Fact', body: 'deploys with npm publish', content: 'deploys with npm publish', useCount: 0, trust: 0, lastUsedAt: null, createdAt: 1000, sourceRunId: 'run_b', pinned: false }
];

// ---- clamp + trust math ----
A.eq(clamp01(-1), 0, 'clamp01 floors at 0');
A.eq(clamp01(2), 1, 'clamp01 ceils at 1');
A.eq(clamp01(0.5), 0.5, 'clamp01 passes through mid-range');
A.ok(Math.abs(nextTrust(0, 2) - 0.30) < 1e-9, 'keep (+2) seeds trust 0.30 from 0');
A.ok(Math.abs(nextTrust(0, 1) - 0.15) < 1e-9, 'edit (+1) seeds trust 0.15 from 0');
A.ok(nextTrust(0, -1) === 0, 'a negative delta from 0 stays clamped at 0');
A.ok(Math.abs(nextTrust(0.5, -1) - 0.35) < 1e-9, 'discard (-1) lowers trust by one step');
A.eq(nextTrust(0.95, 2), 1, 'positive feedback clamps at 1');
A.eq(nextTrust('bad', 2), 0.30, 'a corrupt prior is treated as 0');
A.eq(nextTrust(0.5, NaN), 0.5, 'a non-finite delta is a no-op');

// ---- reduceStats: memory.used -> useCount + lastUsedAt (pure) ----
const recs = base();
const r1 = reduceStats(recs, { name: 'memory.used', payload: { id: 'note_1' } }, { now: 2000 });
A.eq(r1[0].useCount, 1, 'memory.used bumps useCount');
A.eq(r1[0].lastUsedAt, 2000, 'lastUsedAt stamped from the injected clock');
A.eq(recs[0].useCount, 0, 'input array/record NOT mutated (pure)');
A.ok(r1[1] === recs[1], 'untouched records pass through by reference');
const r1b = reduceStats(r1, { name: 'memory.used', payload: { id: 'note_1' } }, { now: 3000 });
A.eq(r1b[0].useCount, 2, 'a second use increments again');
A.eq(r1b[0].lastUsedAt, 3000, 'lastUsedAt advances to the newer use');

// ---- reduceStats: memory.feedback -> trust (clamped, signed) ----
const fb1 = reduceStats(base(), { name: 'memory.feedback', payload: { id: 'note_2', delta: 2 } }, { now: 0 });
A.ok(Math.abs(fb1[1].trust - 0.30) < 1e-9, 'positive feedback raises trust');
const fb2 = reduceStats(fb1, { name: 'memory.feedback', payload: { id: 'note_2', delta: -1 } }, { now: 0 });
A.ok(fb2[1].trust < fb1[1].trust, 'negative feedback lowers trust');

// ---- reduceStats: safe no-ops + determinism ----
A.ok(reduceStats(base(), { name: 'memory.used', payload: { id: 'nope' } }, { now: 1 }) instanceof Array, 'unknown id returns an array');
A.ok(reduceStats(base(), { name: 'memory.used', payload: { id: 'nope' } }, { now: 1 })[0].useCount === 0, 'unknown id no-ops (no bump)');
A.ok(reduceStats(base(), { name: 'agent.run.end', payload: { id: 'note_1' } }, { now: 1 })[0].useCount === 0, 'a non-memory event is ignored');
A.eq(reduceStats([], { name: 'memory.used', payload: { id: 'x' } }, { now: 0 }).length, 0, 'empty store -> empty out');
A.ok(reduceStats(recs, { name: 'memory.used', payload: { id: 'nope' } }, { now: 9 }) === recs, 'no-op returns the SAME array ref (host can skip the write)');
A.eq(JSON.stringify(reduceStats(base(), { name: 'memory.used', payload: { id: 'note_1' } }, { now: 5 })),
     JSON.stringify(reduceStats(base(), { name: 'memory.used', payload: { id: 'note_1' } }, { now: 5 })), 'deterministic for the same inputs');

// ---- applyPin (pure, found/not-found) ----
const pinned = applyPin(base(), 'note_1', true);
A.eq(pinned.found, true, 'pin finds the record');
A.eq(pinned.records[0].pinned, true, 'pin sets pinned');
A.eq(base()[0].pinned, false, 'pin does not mutate the input');
A.eq(applyPin(base(), 'ghost', true).found, false, 'pin reports not-found for a missing id');
A.eq(applyPin(base(), 'note_1', false).records[0].pinned, false, 'unpin clears the flag');

// ---- applyEdit (mirrors into content+body, preserves provenance) ----
const edited = applyEdit(base(), 'note_2', '  refreshed belief  ');   // host trims+redacts; here verify the write
A.eq(edited.found, true, 'edit finds the record');
A.eq(edited.records[1].content, '  refreshed belief  ', 'content replaced (host pre-trims)');
A.eq(edited.records[1].body, '  refreshed belief  ', 'body mirrors content for legacy/recall readers');
A.eq(edited.records[1].sourceRunId, 'run_b', 'provenance (sourceRunId) preserved across an edit');
A.eq(edited.records[1].createdAt, 1000, 'createdAt preserved across an edit');
A.eq(base()[1].content, 'deploys with npm publish', 'edit does not mutate the input');
A.eq(applyEdit(base(), 'ghost', 'x').found, false, 'edit reports not-found for a missing id');

// ---- applyForget (removes, found/not-found, pure) ----
const forgot = applyForget(base(), 'note_1');
A.eq(forgot.found, true, 'forget finds the record');
A.eq(forgot.records.length, 1, 'forget removes exactly one record');
A.eq(forgot.records[0].id, 'note_2', 'the other record survives');
A.eq(base().length, 2, 'forget does not mutate the input');
A.eq(applyForget(base(), 'ghost').found, false, 'forgetting a missing id is a safe no-op (found=false)');

// ---- projectRecord: the full §5.2 view (typed record uses content; note uses body) ----
const pv = projectRecord(base()[1]);
A.eq(pv.kind, 'fact', 'projection carries kind');
A.eq(pv.body, 'deploys with npm publish', 'typed record projects content into body');
A.eq(pv.sourceRunId, 'run_b', 'projection exposes provenance');
A.eq(pv.useCount, 0, 'projection exposes useCount');
A.eq(pv.trust, 0, 'projection exposes trust (clamped)');
A.eq(pv.pinned, false, 'projection exposes pinned');
A.eq(projectRecord(base()[0]).body, 'openrouter.ai/api/v1', 'a note projects its body');
A.eq(projectRecord({ id: 'x', trust: 5 }).trust, 1, 'projection clamps a corrupt trust into [0,1]');
A.eq(projectRecord({ id: 'x' }).createdAt, 0, 'projection tolerates a sparse record');

// ---- nextNoteId: collision-proof (one past the MAX existing N, never positional length) ----
A.eq(nextNoteId([]), 'note_1', 'first id on an empty store');
A.eq(nextNoteId([{ id: 'note_1' }, { id: 'note_2' }, { id: 'note_3' }]), 'note_4', 'grows past the max');
A.eq(nextNoteId([{ id: 'note_1' }, { id: 'note_3' }]), 'note_4', 'after a forget (gap) the next id is max+1, NOT the colliding length+1 (note_3)');
A.eq(nextNoteId([{ id: 'note_5' }]), 'note_6', 'one record at note_5 -> note_6, not note_2');
A.eq(nextNoteId([{ id: 'note_2' }, { id: 'weird' }, null]), 'note_3', 'ignores non-note ids and garbage');

// ---- hardening: a pre-existing duplicate id can never multi-mutate (first match only) ----
const dup = () => [{ id: 'note_3', useCount: 0, trust: 0, pinned: false }, { id: 'note_3', useCount: 0, trust: 0, pinned: false }];
const usedDup = reduceStats(dup(), { name: 'memory.used', payload: { id: 'note_3' } }, { now: 7 });
A.eq(usedDup[0].useCount, 1, 'memory.used bumps only the FIRST of a duplicate pair');
A.eq(usedDup[1].useCount, 0, 'the second duplicate is left untouched');
A.eq(applyForget(dup(), 'note_3').records.length, 1, 'forget removes only ONE of a duplicate pair (never both)');
A.eq(applyPin(dup(), 'note_3', true).records.filter(r => r.pinned).length, 1, 'pin sets only the first of a duplicate pair');
A.eq(applyEdit(dup(), 'note_3', 'x').records.filter(r => r.content === 'x').length, 1, 'edit changes only the first of a duplicate pair');

// ---- decayTrust: an unreinforced endorsement fades toward 0 (trust decay, parity with the reference harness) ----
A.ok(decayTrust(0.8, 1000, 1000) === 0.8, 'no time elapsed -> trust unchanged');
A.ok(Math.abs(decayTrust(0.8, 1000, 1000 + TRUST_HALFLIFE_MS) - 0.4) < 1e-9, 'one half-life halves the trust');
A.ok(Math.abs(decayTrust(0.8, 1000, 1000 + 2 * TRUST_HALFLIFE_MS) - 0.2) < 1e-9, 'two half-lives quarter the trust');
A.eq(decayTrust(0, 1000, 9e15), 0, 'zero trust stays zero (nothing to fade)');
A.eq(decayTrust(0.5, 0, 9e15), 0.5, 'unknown reinforcement time -> no decay (returns raw)');
A.eq(decayTrust(0.5, 2000, 1000), 0.5, 'a future reinforcement time -> no decay');
A.ok(decayTrust(0.8, 1000, 1000 + TRUST_HALFLIFE_MS, 2 * TRUST_HALFLIFE_MS) > 0.4, 'a longer custom half-life fades slower');

// ---- reduceStats: memory.feedback stamps the reinforcement clock (lastFeedbackAt) ----
const fbStamp = reduceStats(base(), { name: 'memory.feedback', payload: { id: 'note_2', delta: 2 } }, { now: 7777 });
A.eq(fbStamp[1].lastFeedbackAt, 7777, 'memory.feedback stamps lastFeedbackAt from the injected clock');
A.eq(reduceStats(base(), { name: 'memory.used', payload: { id: 'note_1' } }, { now: 7777 })[0].lastFeedbackAt, undefined, 'memory.used does NOT stamp the feedback clock (usage != endorsement)');

// ---- tokenJaccard + findSimilar: near-duplicate (paraphrase) detection ----
A.eq(tokenJaccard('', 'anything'), 0, 'empty side -> 0 similarity');
A.eq(tokenJaccard('the and of', 'to in on'), 0, 'pure stopwords -> 0 (no real tokens)');
A.ok(tokenJaccard('Andrew prefers npm start', 'Andrew prefers running npm start') > 0.6, 'a paraphrase scores high');
A.ok(tokenJaccard('deploys with npm publish', 'the sky is blue today') < 0.2, 'unrelated text scores low');
const simSet = [{ id: 'n1', content: 'Andrew prefers npm start over serve' }];
A.ok(findSimilar(simSet, 'prefers running npm start over serve') !== null, 'findSimilar flags a paraphrase of an existing belief');
A.eq(findSimilar(simSet, 'the reactor gauge reads cost'), null, 'findSimilar passes an unrelated belief');
A.eq(findSimilar([], 'anything'), null, 'findSimilar on an empty store -> null');
A.eq(findSimilar(simSet, 'npm', { threshold: 0.01 }), simSet[0], 'a low threshold catches a single shared token');

// ---- projectRecord(now): surfaces effectiveTrust (time-decayed) + lastFeedbackAt ----
const decayRec = { id: 'd1', kind: 'note', body: 'x', trust: 0.8, lastFeedbackAt: 1000, createdAt: 1000 };
const projNow = projectRecord(decayRec, 1000 + TRUST_HALFLIFE_MS);
A.eq(projNow.trust, 0.8, 'projection keeps the raw EARNED trust');
A.ok(Math.abs(projNow.effectiveTrust - 0.4) < 1e-9, 'projection surfaces the time-decayed effectiveTrust');
A.eq(projNow.lastFeedbackAt, 1000, 'projection surfaces lastFeedbackAt');
A.eq(projectRecord(decayRec).effectiveTrust, undefined, 'no now -> no effectiveTrust (back-compat: callers/tests without a clock)');

// ---- originOf: WHICH surface formed a belief ----
// Memory used to form only on the watched browser run, so every record was self-evidently the Commander's own
// conversation. Unattended runs reflect now, so "the agent believes this about me" and "this came off a group
// chat at 3am" must be distinguishable in the Memory Core panel.
A.eq(originOf({ taskSource: 'interactive', trigger: 'directive' }), 'commander', 'the browser COMMS run is the Commander in person');
A.eq(originOf({ taskSource: 'telegram', trigger: 'event' }), 'channel:telegram', 'a channel names itself');
A.eq(originOf({ taskSource: 'discord', trigger: 'event' }), 'channel:discord', '…including discord');
A.eq(originOf({ taskSource: 'api', trigger: 'event' }), 'api', 'the local OpenAI-compatible endpoint is its own origin');
A.eq(originOf({ trigger: 'schedule' }), 'schedule', 'a cron fire / Run Now / workshop shift is scheduled work');
A.eq(originOf({ trigger: 'nightshift' }), 'nightshift', 'a night shift is its own origin');
A.eq(originOf({}), 'commander', 'an unknown run context defaults to commander (the historical meaning)');
A.eq(originOf(), 'commander', 'and so does no context at all — the helper is total');
A.eq(originOf({ taskSource: 'weird/../name' }), 'channel:weirdname', 'a channel id is sanitized before it becomes a stored label');
A.ok(originOf({ taskSource: 'x'.repeat(200) }).length <= 32, 'and bounded, so a hostile source cannot bloat every record');
// an untagged LEGACY record predates unattended memory — it can only have come from the Commander
A.eq(projectRecord({ id: 'n1', body: 'x' }).origin, 'commander', 'a legacy record projects as commander, not unknown');
A.eq(projectRecord({ id: 'n2', body: 'x', origin: 'channel:telegram' }).origin, 'channel:telegram', 'a stamped origin survives projection');

A.report('memcore.test');
