'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../frontend/app/stationui.js'), 'utf8');
const section = source.slice(source.indexOf("  const TIER_MODELS_KEY ="), source.indexOf('  // P1-8 NOTIFICATION'));

function rig(saved, catalog) {
  const values = new Map([['starnet.tierModels.v1', JSON.stringify(saved)]]);
  const nodes = new Map();
  for (const tier of ['reasoning', 'balanced', 'fast']) nodes.set('#tm-' + tier, {
    options: [], value: '', handlers: {}, replaceChildren() { this.options = []; },
    appendChild(o) { this.options.push(o); }, addEventListener(name, fn) { this.handlers[name] = fn; }
  });
  nodes.set('#tm-form', {}); nodes.set('#tm-msg', {});
  const urls = [];
  const context = vm.createContext({ document: { createElement: () => ({}) },
    localStorage: { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) },
    Harness: { getProv: () => 'starnet', api: { get: url => { urls.push(url); return catalog; } } }, sfx() {}
  });
  vm.runInContext(section + '\nthis.wire = wireTierModels;', context);
  const open = () => context.wire({ querySelector: k => nodes.get(k) });
  return { open, nodes, urls, values };
}

test('saved tier rows reconcile once with the active provider and survive reopening', async () => {
  let finish;
  const r = rig({ reasoning: 'openai/gpt-5.6-sol' }, new Promise(resolve => { finish = resolve; }));
  r.open();
  assert.match(r.nodes.get('#tm-reasoning').options[1].textContent, /unverified/);
  finish({ models: [{ id: 'openai/gpt-5.6-sol', name: 'Sol' }] });
  await new Promise(resolve => setImmediate(resolve));
  for (let i = 0; i < 2; i++) {
    const select = r.nodes.get('#tm-reasoning');
    assert.equal(select.value, 'openai/gpt-5.6-sol');
    assert.equal(select.options.filter(o => o.value === select.value).length, 1);
    assert.ok(select.options.every(o => !/not in catalog|unverified/.test(o.textContent)));
    r.open(); await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(r.urls.every(url => url === '/api/models/starnet'));
});

test('catalog failure preserves saved pins without claiming absence; successful absence is labeled', async () => {
  for (const [response, label] of [[{ error: 'offline', models: [] }, /unverified/], [{ models: [] }, /not in catalog/]]) {
    const r = rig({ fast: 'saved-model' }, Promise.resolve(response)); r.open();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(r.nodes.get('#tm-fast').value, 'saved-model');
    assert.match(r.nodes.get('#tm-fast').options[1].textContent, label);
    assert.equal(JSON.parse(r.values.get('starnet.tierModels.v1')).fast, 'saved-model');
  }
});
