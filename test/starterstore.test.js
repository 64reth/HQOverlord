'use strict';
const A = require('./_assert.js'), S = require('../frontend/app/starters.js'), { StarterStore: Store } = require('../frontend/app/starterstore.js');
(async () => {
  let time = 1800000000000, enabled = true, calls = 0, posts = [], release;
  const memory = {}, storage = { getItem: k => memory[k] || null, setItem: (k, v) => { memory[k] = v; }, removeItem: k => { delete memory[k]; } };
  const ctx = S.context({ now: time, agentId: 'agent', goal: { id: 'g', text: 'Build a usable revenue dashboard for my subscription product', status: 'active' } });
  const row = { title: 'Build the subscription revenue dashboard', why: 'Your active goal is a usable revenue dashboard for your subscription product.', deliverable: 'A working revenue dashboard with tested calculations.', prompt: 'Build a revenue dashboard for the subscription product. Inspect the existing project, implement the main workflow, and test the calculations before reporting the result.', sourceIds: ['goal:g'], kind: 'build', sessionId: null, requiredCapabilities: [] };
  const result = { text: JSON.stringify({ suggestions: [row] }) };
  const deps = { engine: S, storage, now: () => time, enabled: () => enabled, generate: async o => { calls++; A.ok(o.internal && o.evidence && !o.isTask && !o.placed.length, 'Uses reasoning-only evidence route'); return result; }, fetch: async (url, options) => { posts.push(JSON.parse(options.body)); return { ok: true }; } };
  Store.init(deps); Store.reset();
  A.eq((await Store.request(S.context({}))).status, 'cold', 'No generation for empty evidence'); A.eq(calls, 0, 'Cold state spends no request');
  const first = await Store.request(ctx); A.eq(first.ideas.length, 1, 'Valid idea retained');
  A.eq((await Store.request(ctx)).ideas[0].id, first.ideas[0].id, 'Same context uses cache'); A.eq(calls, 1, 'Render does not regenerate');
  Store.init(deps); A.eq(Store.peek(ctx).ideas[0].id, first.ideas[0].id, 'Cache survives reload');
  const idea = first.ideas[0]; Store.shown(idea); Store.prepare(idea, 'revenue', 'the exact prepared prompt');
  A.eq(Store.claimDraft('other', 'the exact prepared prompt'), null, 'Other session cannot claim draft');
  A.eq(Store.claimDraft('revenue', 'the exact prepared prompt'), idea.id, 'Send claims exact proposal');
  Store.started(idea.id, 'run-revenue'); Store.finished({ runId: 'unrelated', reason: 'done' }); Store.finished({ runId: 'run-revenue', reason: 'error' }); await Store._flush();
  A.ok(!posts.some(p => p.state === 'completed'), 'Unrelated/failed run not credited');
  Store.finished({ runId: 'run-revenue', reason: 'done' }); Store.finished({ runId: 'run-revenue', reason: 'done' }); await Store._flush();
  A.eq(posts.filter(p => p.state === 'completed').length, 1, 'Completion idempotent'); A.ok(!posts.some(p => p.outcome), 'Completion does not invent usefulness');
  Store.rated('unrelated', 'great'); Store.rated('run-revenue', 'miss'); await Store._flush(); A.eq(posts.filter(p => p.outcome).map(p => p.outcome.quality), [-1], 'Actual attributed rating determines usefulness');
  A.eq(posts.slice(0, 4).map(p => p.state || 'shown'), ['shown', 'opened', 'accepted', 'started'], 'Lifecycle writes ordered');
  Store.reset(); Store.init(deps); time += Store.GAP;
  const second = (await Store.request(ctx)).ideas[0]; Store.dismiss(second); await Store._flush(); Store.init(deps);
  A.eq(Store.peek(ctx).ideas.length, 0, 'Dismissal survives reload'); A.ok(Store.exclusions().includes(second.label), 'Dismissal informs generation');
  Store.prepare(second, 's', 'original draft'); A.eq(Store.claimDraft('s', 'changed unrelated message'), null, 'Edited unrelated draft not credited');
  Store.reset(); Store.init({ ...deps, generate: () => { calls++; return new Promise(r => { release = r; }); } });
  const before = calls, a = Store.request(ctx), b = Store.request(ctx); release(result); await Promise.all([a, b]); A.eq(calls, before + 1, 'Concurrent requests share generation');
  time += Store.GAP; const pending = Store.request({ ...ctx, projectRoot: '/different' }); enabled = false; Store.cancel(); release(result);
  A.eq((await pending).status, 'cancelled', 'Pause invalidates in-flight result'); A.eq(Store.peek(ctx).status, 'paused', 'Pause hides cache');
  enabled = true; time += Store.GAP; const forgetting = Store.request({ ...ctx, projectRoot: '/third' }); Store.reset(); release(result);
  A.eq((await forgetting).status, 'cancelled', 'Forget blocks late resurrection'); A.eq(Store.peek(ctx).status, 'empty', 'Forget removes cache');
  Store.init({ ...deps, generate: async () => ({ error: 'offline' }) }); A.eq((await Store.request(ctx)).status, 'error', 'Provider failure explicit'); A.eq(Store.peek({ ...ctx, projectRoot: '/changed' }).status, 'cooldown', 'New context rate limited without stale ideas');
  Store.reset(); memory[Store.KEY] = JSON.stringify({ version: 1, cache: [null, { key: 'x', ideas: null }], declined: [null], accepted: [null] }); Store.init(deps); A.notThrows(() => Store.peek(ctx), 'Corrupt saved cache harmless');
  await Store._flush();
  // Production UI waits for durable feedback before asking the model (boot initially reads zero weights).
  const fs = require('node:fs'), vm = require('node:vm'); let hydrate, generated = null;
  const fresh = { ...ctx, preferences: { continue: -0.5 } }, options = { system: 'NOVA', modelKey: 'test' };
  const scope = vm.createContext({ d: { isConnected: true }, hint: {}, activeWs: { id: 'blank', history: [] },
    renderStarterIdeas() {}, RecLedger: { refresh: () => new Promise(r => { hydrate = r; }) },
    starterContext: () => fresh, starterOptions: () => options, isBusy: () => false,
    StarterStore: { request: async c => { generated = c; return { status: 'ready', ideas: [] }; } } });
  const code = fs.readFileSync(require('node:path').join(__dirname, '../frontend/app/chat.js'), 'utf8');
  vm.runInContext('async ' + A.fnBody(code, 'function requestStarterIdeas('), scope);
  const waiting = vm.runInContext('requestStarterIdeas(d, hint, {}, {}, false)', scope);
  A.eq(generated, null, 'No inference before feedback hydration'); hydrate(); await waiting;
  A.eq(generated.preferences.continue, -0.5, 'Generation reads hydrated preferences rather than stale zero weights');
  A.report('starterstore');
})().catch(e => { console.error(e); process.exit(1); });
