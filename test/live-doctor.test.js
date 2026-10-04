'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Doctor = require('../sidecar/live-doctor.js');

test('live doctor refuses to probe without explicit consent', async () => {
  await assert.rejects(() => Doctor.runLiveDoctor({ targets: [] }), /explicit live-probe consent/);
});

test('live doctor preserves truthful states, latency, ordering, and a paste-ready receipt', async () => {
  let now = Date.parse('2026-08-07T12:00:00.000Z');
  const clock = { now: () => now };
  const target = (kind, id, state, detail) => ({ kind, id, label: id, probe: async () => { now += 7; return { state, detail }; } });
  const out = await Doctor.runLiveDoctor({
    confirmed: true, agentId: 'captain', clock,
    targets: [
      target('provider', 'model-a', Doctor.STATES.ROUND_TRIP, 'minimal response received'),
      target('execution', 'safe-cell', Doctor.STATES.AUTHENTICATED, 'ready only'),
      target('mcp', 'docs', Doctor.STATES.UNREACHABLE, 'timeout'),
      target('channel', 'slack', Doctor.STATES.NOT_CONFIGURED, '')
    ]
  });
  assert.deepEqual(out.report.summary, { roundTrip: 1, authenticated: 1, failed: 1, notConfigured: 1 });
  assert.ok(out.report.rows[0].latencyMs >= 7);
  assert.match(out.text, /1 round-trip proven; 1 authenticated; 1 failed; 1 not configured/);
  assert.match(out.text, /No keys, tokens, prompts, transcripts/);
});

test('receipt redacts credential-shaped detail and never promotes an unknown state', async () => {
  let now = 0;
  const out = await Doctor.runLiveDoctor({ confirmed: true, clock: { now: () => ++now }, targets: [{
    kind: 'provider', id: 'x', label: 'x', probe: async () => ({ state: 'connected', detail: 'token=sk-abcdefghijklmnop https://u:p@host/x?api_key=xoxb-1234567890' })
  }] });
  assert.equal(out.report.rows[0].state, Doctor.STATES.UNREACHABLE);
  assert.doesNotMatch(out.text, /sk-abcdefghijklmnop/);
  assert.doesNotMatch(out.text, /xoxb-|u:p/);
  assert.match(out.text, /\[redacted\]/);
});

test('failure classifier distinguishes configuration, refusal, and reachability', () => {
  assert.equal(Doctor.failureState(new Error('provider not configured')), Doctor.STATES.NOT_CONFIGURED);
  assert.equal(Doctor.failureState(new Error('HTTP 401 rejected')), Doctor.STATES.REFUSED);
  assert.equal(Doctor.failureState(new Error('socket timeout')), Doctor.STATES.UNREACHABLE);
});

test('independent probes run concurrently and keep receipt order', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let secondStarted = false;
  const running = Doctor.runLiveDoctor({ confirmed: true, clock: { now: () => 0 }, targets: [
    { kind: 'mcp', id: 'first', probe: async () => { await gate; return { state: Doctor.STATES.ROUND_TRIP }; } },
    { kind: 'channel', id: 'second', probe: async () => { secondStarted = true; return { state: Doctor.STATES.AUTHENTICATED }; } }
  ] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(secondStarted, true, 'the later probe starts without waiting for the first');
  release();
  const out = await running;
  assert.deepEqual(out.report.rows.map(r => r.id), ['first', 'second']);
});
