'use strict';
// Execute the production button and picker with a small DOM and controlled HTTP responses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../frontend/app/group-chat.js'), 'utf8');
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.events = {}; this.value = ''; this.style = { setProperty() {} }; this.classList = { add() {}, toggle() {} }; }
  get isConnected() { return this.attached || !!this.parentElement?.isConnected; }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'id') this.id = v; if (k === 'data-agent-name') this.dataset.agentName = v; }
  addEventListener(k, fn) { this.events[k] = fn; }
  append(...nodes) { for (const n of nodes) { const e = typeof n === 'string' ? Object.assign(new Element('#text'), { textContent: n }) : n; e.parentElement = this; this.children.push(e); } }
  replaceChildren(...nodes) { for (const e of this.children) e.parentElement = null; this.children = []; this.textContent = ''; this.append(...nodes); }
  before(node) { this.parentElement.append(node); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(e => e !== this); this.parentElement = null; }
}
const walk = e => [e, ...e.children.flatMap(walk)];
const text = e => (e.textContent || '') + e.children.map(text).join(' ');
const settle = async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const roster = [{ id: 'agent', name: 'Lead' }, { id: 'peer', name: 'Peer' }];
const success = () => ({ status: 200, ok: true, json: async () => ({ ok: true, result: { roster, groups: [] } }) });
async function boot() {
  const body = new Element('body'); body.attached = true;
  const head = new Element('head'); head.attached = true;
  for (const id of ['comms-idbar', 'chat-input', 'chat-log', 'chat-queued', 'chat-inputrow']) { const e = new Element('div'); e.id = id; body.append(e); }
  const find = id => walk(body).find(e => e.id === id);
  let request = async () => success(), push = async () => {}, onClose, opens = 0;
  const document = { body, head, createElement: tag => new Element(tag), createTextNode: t => Object.assign(new Element('#text'), { textContent: t }), getElementById: find };
  const ctx = vm.createContext({ document, console, crypto: { randomUUID: () => 'test' }, clearTimeout() {}, setTimeout() {},
    fetch: (...args) => request(...args), App: { pushRoster: () => push(), agents: () => roster, persist() {}, refreshRail() {} },
    StationUI: { toggleTerm(key, title, build, opts) { opens++; const shell = new Element('div'); shell.id = 'test-window'; body.append(shell); build(shell); onClose = opts.onClose; }, closeTerm() { onClose?.(); find('test-window')?.remove(); } }, Workstreams: {} });
  vm.runInContext(source + '\nGroupChat.bind({id:"direct",agentId:"agent",history:[]});', ctx);
  await settle();
  return { find, click: async label => { const b = walk(body).find(e => e.tagName === 'button' && (e.attrs['aria-label'] === label || text(e) === label)); assert.ok(b, 'button exists: ' + label); b.events.click(); await settle(); },
    request(fn) { request = fn; }, push(fn) { push = fn; }, get opens() { return opens; } };
}
(async () => {
  const app = await boot();
  const pending = deferred(); app.request(() => pending.promise);
  await app.click('+ Add agents');
  assert.ok(app.find('gc-picker')?.isConnected, 'picker is visible before the backend responds');
  assert.match(text(app.find('gc-picker')), /Loading agents/);
  await app.click('+ Add agents'); assert.equal(app.opens, 1, 'rapid clicks open only one picker');
  pending.resolve({ status: 404, ok: false, json: async () => { throw new SyntaxError('not found'); } }); await settle();
  assert.match(text(app.find('gc-picker')), /Group chat is unavailable on this server/);
  assert.ok(walk(app.find('gc-picker')).some(e => e.attrs.role === 'alert'), 'failure is announced inside the visible picker');
  app.request(async () => success()); await app.click('RETRY');
  assert.match(text(app.find('gc-picker')), /Add to this chat/);
  await app.click('Add Peer to this chat');
  assert.match(text(app.find('gc-picker')), /START GROUP CHAT/);
  await app.click('CANCEL'); assert.equal(app.find('gc-picker'), undefined);
  for (const status of [401, 403, 500]) {
    app.request(async () => ({ status, ok: false, json: async () => { throw new SyntaxError('invalid JSON'); } }));
    await app.click('+ Add agents');
    assert.match(text(app.find('gc-picker')), status === 500 ? /server could not load group chat/ : /Reconnect to this station/);
    await app.click('CANCEL');
  }
  app.push(async () => { throw new Error('Roster sync failed'); });
  await app.click('+ Add agents'); assert.match(text(app.find('gc-picker')), /Roster sync failed/); await app.click('CANCEL');
  app.push(async () => {});
  const late = deferred(); app.request(() => late.promise);
  await app.click('+ Add agents'); await app.click('CANCEL'); late.resolve(success()); await settle();
  assert.equal(app.find('gc-picker'), undefined, 'late success cannot reopen a canceled picker');
  app.request(async () => success()); await app.click('+ Add agents');
  assert.match(text(app.find('gc-picker')), /Add to this chat/, 'picker can reopen after cancellation');
  console.log('group-chat-picker: loading, duplicate clicks, 404, auth, malformed response, roster failure, retry, selection and cancellation PASS');
})().catch(e => { console.error(e); process.exitCode = 1; });
