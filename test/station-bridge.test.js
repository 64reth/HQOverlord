'use strict';

const assert = require('node:assert/strict');
const { makeStationBridge } = require('../sidecar/station-bridge.js');

(async () => {
  // ---- a page is attached and answers ----
  {
    const sent = [];
    const bridge = makeStationBridge({ emit: (name, payload) => sent.push({ name, payload }), newId: () => 'id-1' });
    const p = bridge.request('station.status', { verbose: true });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].name, 'station.command');
    assert.equal(sent[0].payload.id, 'id-1');
    assert.equal(sent[0].payload.verb, 'station.status');
    assert.deepEqual(sent[0].payload.args, { verbose: true });
    assert.equal(bridge.inFlight(), 1);
    assert.equal(bridge.ack('id-1', { ok: true, result: { sessions: 3 } }), true);
    assert.deepEqual(await p, { ok: true, result: { sessions: 3 }, verb: 'station.status' });
    assert.equal(bridge.inFlight(), 0, 'a settled command is no longer in flight');
  }

  // ---- the page refuses ----
  {
    const bridge = makeStationBridge({ newId: () => 'id-2' });
    const p = bridge.request('station.new_session');
    bridge.ack('id-2', { ok: false, error: 'no such agent' });
    assert.deepEqual(await p, { ok: false, error: 'no such agent', verb: 'station.new_session' });
  }

  /* ⛔ THE ONE THAT MATTERS: nobody is looking at the station. A headless run must be TOLD the command did
     not happen. Resolving as success here would put "opened a new session" into a transcript with no session
     behind it — the exact lie this bridge exists to prevent. */
  {
    let fire = null;
    const bridge = makeStationBridge({
      newId: () => 'id-3',
      setTimeout: fn => { fire = fn; return 't'; },
      clearTimeout: () => {}
    });
    const p = bridge.request('station.delegate', { to: 'NOVA' });
    fire();
    const out = await p;
    assert.equal(out.ok, false);
    assert.equal(out.unattended, true);
    assert.match(out.error, /no station page answered/);
    assert.equal(bridge.inFlight(), 0);
  }

  // ---- a late ack for a command that already timed out is dropped, not double-resolved ----
  {
    let fire = null;
    const bridge = makeStationBridge({ newId: () => 'id-4', setTimeout: fn => { fire = fn; return 't'; }, clearTimeout: () => {} });
    const p = bridge.request('station.status');
    fire();
    assert.equal((await p).ok, false);
    assert.equal(bridge.ack('id-4', { ok: true, result: 'too late' }), false, 'a stale ack must not resolve anything');
  }

  // ---- an ack for an id we never sent is refused, so the route can answer honestly ----
  {
    const bridge = makeStationBridge({ newId: () => 'id-5' });
    assert.equal(bridge.ack('nonsense', { ok: true }), false);
  }

  // ---- a broken emit fails the command instead of hanging forever ----
  {
    const bridge = makeStationBridge({ emit: () => { throw new Error('bus is down'); }, newId: () => 'id-6' });
    const out = await bridge.request('station.crew');
    assert.equal(out.ok, false);
    assert.match(out.error, /bus is down/);
    assert.equal(bridge.inFlight(), 0);
  }

  console.log('station-bridge.test.js: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
