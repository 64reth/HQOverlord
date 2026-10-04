/* node test/taskbrief.clarify.test.js — IN-TURN CLARIFY (2026-07-31, Hermes-parity): on a watched run,
   brief.ask blocks on a live asker and resumes the SAME turn with the Commander's answer; every other
   outcome (no asker, no answer, a throwing asker, a stale store write) falls back byte-identically to
   the durable end-run question. The store's answerInTurn mirrors the next-run answer path without
   minting a new brief, and refuses stale writes. Offline + deterministic (fake disk, fake asker). */
'use strict';
const A = require('./_assert.js');
const path = require('path');
const { makeTaskBriefStore } = require('../sidecar/taskbrief-store.js');
const { registerTaskBriefTools } = require('../sidecar/taskbrief-tools.js');
const { makeRegistry } = require('../sidecar/tools/registry.js');

function fakeDisk() {
  const files = new Map();
  return {
    readFileSync(f) { if (!files.has(f)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files.get(f); },
    writeFileSync(f, d) { files.set(f, d); }, renameSync(a, b) { files.set(b, files.get(a)); files.delete(a); },
    existsSync(f) { return files.has(f); }, mkdirSync() {}, unlinkSync(f) { files.delete(f); },
    openSync() { return 1; }, fsyncSync() {}, closeSync() {}, _files: files
  };
}
const writeDurable = ({ fs }, file, data) => fs.writeFileSync(file, data);
const makeStore = () => makeTaskBriefStore({ fs: fakeDisk(), path, workspaces: '/ws', writeDurable });

const material = () => ({
  dimension: 'audience',
  question: 'who is this dashboard primarily for?',
  options: ['operators', 'executives', 'customers'],
  recommended: 'operators', reason: 'Audience changes information density and navigation.',
  discoverable: false
});

(async () => {
  // ---- A. an answered live question resumes the SAME turn: answer in content, NO final control ----
  {
    const store = makeStore();
    const brief = await store.prepare({ id: 'tb_a', key: 'stream:a', text: 'Build the dashboard' }, 100);
    const state = { brief };
    const registry = makeRegistry();
    const askedWith = [];
    registerTaskBriefTools(registry, store, state, {
      now: () => 110,
      askCommander: async (f) => { askedWith.push(f); return { answered: true, text: 'executives' }; }
    });
    const r = await registry.dispatch({ name: 'brief.ask', args: material(), argsRaw: '{}' }, {});
    A.ok(r.ok, 'an answered clarify dispatches ok: ' + JSON.stringify(r.content));
    A.ok(!r.control, 'NO final control — the run keeps going in the same turn');
    A.ok(/The Commander answered "executives" to: who is this dashboard primarily for\?/.test(r.content), 'the answer reaches the model as tool content, tied to its question');
    A.eq(askedWith[0].question, 'who is this dashboard primarily for?', 'the asker sees the validated question');
    A.eq(askedWith[0].recommended, 'operators', 'and the recommendation for the ★ chip');
    A.eq(state.brief.status, 'ready', 'the brief is back to ready — brief.proceed can settle it this turn');
    A.eq(state.brief.questions[0].answer, 'executives', 'the durable record carries the in-turn answer');
    const onDisk = store.active('stream:a');
    A.eq(onDisk.status, 'ready', 'the persisted brief agrees (no split-brain with the in-memory state)');
  }

  // ---- B. an UNANSWERED live question falls back to today's end-run flow, exactly ----
  {
    const store = makeStore();
    const brief = await store.prepare({ id: 'tb_b', key: 'stream:b', text: 'Build it' }, 100);
    const state = { brief };
    const registry = makeRegistry();
    registerTaskBriefTools(registry, store, state, { now: () => 110, askCommander: async () => ({ answered: false }) });
    const r = await registry.dispatch({ name: 'brief.ask', args: material(), argsRaw: '{}' }, {});
    A.eq(r.control && r.control.final, true, 'no live answer -> the durable end-run question, unchanged');
    A.ok(/^TASK_QUESTION: /.test(r.control.text), 'with the marker line the next-run resume path parses');
    A.eq(state.brief.status, 'clarifying', 'the brief stays clarifying for the next reply');
  }

  // ---- C. a THROWING asker can never break the run — same fallback ----
  {
    const store = makeStore();
    const brief = await store.prepare({ id: 'tb_c', key: 'stream:c', text: 'Build it' }, 100);
    const state = { brief };
    const registry = makeRegistry();
    registerTaskBriefTools(registry, store, state, { now: () => 110, askCommander: async () => { throw new Error('transport died'); } });
    const r = await registry.dispatch({ name: 'brief.ask', args: material(), argsRaw: '{}' }, {});
    A.eq(r.control && r.control.final, true, 'a dead asker degrades to the end-run question, never an error');
  }

  // ---- D. NO asker wired (unattended/channel run) = byte-identical old behavior ----
  {
    const store = makeStore();
    const brief = await store.prepare({ id: 'tb_d', key: 'stream:d', text: 'Build it' }, 100);
    const state = { brief };
    const registry = makeRegistry();
    registerTaskBriefTools(registry, store, state, { now: () => 110 });
    const r = await registry.dispatch({ name: 'brief.ask', args: material(), argsRaw: '{}' }, {});
    A.eq(r.control && r.control.final, true, 'without an asker the question ends the run as before');
    A.eq(r.content, 'Waiting for the Commander\'s decision.', 'same content');
  }

  // ---- E. the tool's own timeout covers the wait (the default 30s ctx budget would kill it) ----
  {
    const registry = makeRegistry();
    const store = makeStore();
    registerTaskBriefTools(registry, store, { brief: { id: 'x', status: 'ready', questions: [] } }, { now: () => 0 });
    const def = registry.get('brief.ask');
    A.ok(def.timeoutMs >= 15 * 60 * 1000, 'brief.ask declares a ceiling above the consent timer + ack extension');
  }

  // ---- F. answerInTurn store semantics: open-question only, no new brief, stale writes refused ----
  {
    const store = makeStore();
    const b = await store.prepare({ id: 'tb_f', key: 'stream:f', text: 'Build it' }, 100);
    A.eq(await store.answerInTurn(b.id, 'early', 105), null, 'no open question -> refused');
    await store.ask(b.id, material(), 110);
    const answered = await store.answerInTurn(b.id, 'customers', 120);
    A.eq(answered.status, 'ready', 'answering flips clarifying -> ready');
    A.eq(answered.questions[0].answer, 'customers', 'the open question carries the answer');
    A.eq(answered.questions[0].answeredAt, 120, 'stamped with the answer time');
    A.eq(store.list({}).length, 1, 'no new brief was minted — the SAME record advanced');
    A.eq(await store.answerInTurn(b.id, 'operators', 130), null, 'a second answer to the same question is refused');
    A.eq(answered.questions[0].answer, 'customers', 'and the first answer stands');
    A.eq(await store.answerInTurn('tb_missing', 'x', 140), null, 'an unknown brief id is a harmless no-op');
  }

  // ---- G. BATCHED ASK (2026-08-14): one call, three questions, three sequential live answers ----
  {
    const store = makeStore();
    const brief = await store.prepare({ id: 'tb_g', key: 'stream:g', text: 'Build the dashboard' }, 100);
    const state = { brief };
    const registry = makeRegistry();
    const askedWith = [];
    const replies = ['executives', 'weekly, trends', 'read-only'];
    registerTaskBriefTools(registry, store, state, {
      now: () => 110,
      askCommander: async (f) => { askedWith.push(f); return { answered: true, text: replies[askedWith.length - 1] }; }
    });
    const args = Object.assign(material(), { also: [
      { dimension: 'deliverable', question: 'what cadence and cuts matter?', options: ['weekly, trends', 'daily, raw counts'], recommended: 'weekly, trends', reason: 'Cadence shapes the whole layout.', multiSelect: true },
      { dimension: 'scope', question: 'read-only or interactive filters?', options: ['read-only', 'interactive filters'], recommended: 'read-only', reason: 'Interactivity doubles the build.' }
    ] });
    const r = await registry.dispatch({ name: 'brief.ask', args, argsRaw: '{}' }, {});
    A.ok(r.ok && !r.control, 'a fully answered batch resumes the SAME turn');
    A.eq(askedWith.length, 3, 'all three questions rode the live channel');
    A.eq(askedWith[0].ordinal, 1, 'the card knows its place in the batch'); A.eq(askedWith[0].total, 3, 'and the batch size');
    A.eq(askedWith[1].multiSelect, true, 'a non-exclusive question reaches the card as multiSelect');
    A.ok(/answered "executives"/.test(r.content) && /answered "weekly, trends"/.test(r.content) && /answered "read-only"/.test(r.content), 'every answer reaches the model, tied to its question');
    A.eq(state.brief.status, 'ready', 'the settled batch flips the brief back to ready');
    A.eq(state.brief.questions.length, 3, 'all three questions persisted'); A.eq(state.brief.askCalls, 1, 'and spent ONE ask call of the budget');
    A.eq(state.brief.questions[1].answer, 'weekly, trends', 'each answer landed on ITS question, not the last one');
  }

  // ---- H. batch walk-away mid-batch: durable fallback asks the FIRST unanswered, state stays clarifying ----
  {
    const store = makeStore();
    const brief = await store.prepare({ id: 'tb_h', key: 'stream:h', text: 'Build it' }, 100);
    const state = { brief };
    const registry = makeRegistry();
    let calls = 0;
    registerTaskBriefTools(registry, store, state, {
      now: () => 110,
      askCommander: async () => (++calls === 1 ? { answered: true, text: 'executives' } : { answered: false })
    });
    const args = Object.assign(material(), { also: [
      { dimension: 'scope', question: 'read-only or interactive filters?', options: ['read-only', 'interactive filters'], recommended: 'read-only', reason: 'Interactivity doubles the build.' }
    ] });
    const r = await registry.dispatch({ name: 'brief.ask', args, argsRaw: '{}' }, {});
    A.eq(r.control && r.control.final, true, 'a half-answered batch falls back to the durable end-run question');
    A.ok(/^TASK_QUESTION: read-only or interactive filters\?/.test(r.control.text), 'the marker carries the FIRST UNANSWERED question, not the first asked');
    A.eq(state.brief.status, 'clarifying', 'the brief stays clarifying for the next reply');
    A.eq(state.brief.questions[0].answer, 'executives', 'the answer that DID land is already durable');
  }

  // ---- I. unattended surface: a batch is rejected with steering, a single question still works ----
  {
    const store = makeStore();
    const brief = await store.prepare({ id: 'tb_i', key: 'stream:i', text: 'Build it' }, 100);
    const state = { brief };
    const registry = makeRegistry();
    registerTaskBriefTools(registry, store, state, { now: () => 110 });
    const args = Object.assign(material(), { also: [
      { dimension: 'scope', question: 'wide or narrow?', options: ['wide', 'narrow'], recommended: 'narrow', reason: 'Scope halves or doubles it.' }
    ] });
    const r = await registry.dispatch({ name: 'brief.ask', args, argsRaw: '{}' }, {});
    A.ok(!r.ok && /ONLY the single most material question/.test(String(r.error || r.content)), 'an unattended batch is refused with corrective steering: ' + JSON.stringify(r.error || r.content));
    A.eq((store.active('stream:i') || {}).status, 'ready', 'nothing was stored — the rejected batch spent no budget');
  }

  // ---- J. policy: bundled questions must cover distinct dimensions; budget counts CALLS not questions ----
  {
    const Policy = require('../sidecar/taskbrief-policy.js');
    const dup = Policy.validateQuestions(Object.assign(material(), { also: [material()] }), { questions: [], askCalls: 0 });
    A.ok(!dup.ok && /DIFFERENT dimension/.test(dup.error), 'same-dimension bundling is rejected');
    const spent = Policy.validateQuestions(material(), { askCalls: 2, questions: [] });
    A.ok(!spent.ok, 'two spent calls exhaust the budget');
    const legacy = Policy.validateQuestions(material(), { questions: [{ text: 'q1', answer: 'a' }, { text: 'q2', answer: 'b' }] });
    A.ok(!legacy.ok, 'a legacy brief with two stored questions (no askCalls field) is still counted as spent');
    const second = Policy.validateQuestions(Object.assign(material(), { newBlocker: true }), { askCalls: 1, questions: [{ text: 'q1', answer: 'a' }] });
    A.ok(second.ok, 'a second CALL is allowed after an answered first call with a new blocker');
    A.eq(Policy.validateQuestions(Object.assign(material(), { multiSelect: true }), { questions: [], askCalls: 0 }).questions[0].multiSelect, true, 'multiSelect survives validation');
  }

  // ---- K. store: answerInTurn targets a question by id and holds clarifying until the batch settles ----
  {
    const store = makeStore();
    const b = await store.prepare({ id: 'tb_k', key: 'stream:k', text: 'Build it' }, 100);
    await store.askMany(b.id, Object.assign(material(), { also: [
      { dimension: 'scope', question: 'wide or narrow?', options: ['wide', 'narrow'], recommended: 'narrow', reason: 'Scope halves or doubles it.' }
    ] }), 110);
    const mid = await store.answerInTurn(b.id, 'narrow', 120, b.id + '_q2');
    A.eq(mid.status, 'clarifying', 'one answer of two keeps the brief clarifying');
    A.eq(mid.questions[1].answer, 'narrow', 'the id-addressed question got the answer');
    const done = await store.answerInTurn(b.id, 'executives', 130);   // no id -> first unanswered
    A.eq(done.status, 'ready', 'the last open answer settles the batch');
    A.eq(done.questions[0].answer, 'executives', 'the un-addressed answer went to the first open question');
  }

  // ---- L. "use your judgment for the rest": ONE tap settles the whole remaining batch ----
  {
    const store = makeStore();
    const brief = await store.prepare({ id: 'tb_l', key: 'stream:l', text: 'Build it' }, 100);
    const state = { brief };
    const registry = makeRegistry();
    const askedWith = [];
    registerTaskBriefTools(registry, store, state, {
      now: () => 110,
      askCommander: async (f) => { askedWith.push(f); return { answered: true, text: 'use your judgment for the rest' }; }
    });
    const args = Object.assign(material(), { also: [
      { dimension: 'scope', question: 'wide or narrow?', options: ['wide', 'narrow'], recommended: 'narrow', reason: 'Scope halves or doubles it.' },
      { dimension: 'sources', question: 'which data?', options: ['ledger', 'exports'], recommended: 'ledger', reason: 'Sources decide the panels.' }
    ] });
    const r = await registry.dispatch({ name: 'brief.ask', args, argsRaw: '{}' }, {});
    A.ok(r.ok && !r.control, 'the run continues in the same turn — nothing is left hanging');
    A.eq(askedWith.length, 1, 'the Commander was asked ONCE, not three times');
    A.eq(state.brief.status, 'ready', 'the whole batch is settled');
    A.eq(state.brief.questions.map(q => q.answer), ['use your judgment', 'use your judgment', 'use your judgment'],
      'every question is recorded as a REAL deferral, so the skip/ask-worthiness bookkeeping still sees them');
    A.ok(/use your judgment/.test(r.content), 'the model is told the decisions came back to it');
  }

  // ---- M. a deferral that carries a real constraint is NOT the batch escape ----
  {
    const store = makeStore();
    const brief = await store.prepare({ id: 'tb_m', key: 'stream:m', text: 'Build it' }, 100);
    const state = { brief };
    const registry = makeRegistry();
    let n = 0;
    registerTaskBriefTools(registry, store, state, {
      now: () => 110,
      askCommander: async () => (++n === 1 ? { answered: true, text: 'use your judgment for the rest, but keep it under 3 pages' } : { answered: true, text: 'narrow' })
    });
    const args = Object.assign(material(), { also: [
      { dimension: 'scope', question: 'wide or narrow?', options: ['wide', 'narrow'], recommended: 'narrow', reason: 'Scope halves or doubles it.' }
    ] });
    const r = await registry.dispatch({ name: 'brief.ask', args, argsRaw: '{}' }, {});
    A.eq(n, 2, 'the qualified answer is an ordinary answer — the second question is still asked');
    A.eq(state.brief.questions[0].answer, 'use your judgment for the rest, but keep it under 3 pages', 'and their actual words are kept verbatim');
    A.ok(r.ok && !r.control, 'the run still resumes in the same turn');
  }

  // ---- N. a 6-option multi-select survives validation, persistence AND the live card payload ----
  {
    const store = makeStore();
    const b = await store.prepare({ id: 'tb_n', key: 'stream:n', text: 'Build it' }, 100);
    const state = { brief: b };
    const registry = makeRegistry();
    const seen = [];
    registerTaskBriefTools(registry, store, state, { now: () => 110, askCommander: async f => { seen.push(f); return { answered: true, text: 'a, c, e' }; } });
    const six = ['a', 'b', 'c', 'd', 'e', 'f'];
    const r = await registry.dispatch({ name: 'brief.ask', args: {
      dimension: 'sources', question: 'which data should it pull from?', options: six.slice(),
      recommended: 'a', reason: 'Sources decide what the panels can show.', discoverable: false, multiSelect: true
    }, argsRaw: '{}' }, {});
    A.ok(r.ok, 'a six-option multi-select is accepted: ' + JSON.stringify(r.content || r.error));
    A.eq(seen[0].options, six, 'all six reach the card');
    A.eq(store.active('stream:n').questions[0].options, six, 'and all six survive the round-trip to disk');
    A.eq(store.active('stream:n').questions[0].answer, 'a, c, e', 'the set answer is stored as the Commander gave it');
  }

  A.report('taskbrief.clarify.test');
})();
