'use strict';
const assert = require('node:assert/strict');
const { makeSseHub } = require('../sidecar/channels/sse.js');
const read = s => JSON.parse(s.split('\n').find(l => l.startsWith('data: ')).slice(6));
const hub = makeSseHub({ epoch: 'boot-a', maxEvents: 3 });
hub.broadcast('queue.status', { depth: 1 });
const cursor = hub.cursor();
hub.broadcast('station.command', { id: 'must-not-repeat' });
hub.broadcast('queue.status', { depth: 2 });
const frames = []; const client = { write: s => { frames.push(s); return true; } };
hub.add(client); hub.resume(client, cursor);
assert.deepEqual(frames.map(read), [
  { name: 'queue.status', payload: { depth: 2 } },
  { stream: 'ready', cursor: 'boot-a:3', reset: false }
]);
hub.broadcast('queue.status', { depth: 3 });
assert.equal(read(frames.at(-1)).payload.depth, 3, 'live events follow replay');
for (const stale of ['boot-a:0', 'boot-b:3', 'boot-a:999', 'boot-a:NaN', 'boot-a:1.5', '']) {
  frames.length = 0; hub.resume(client, stale);
  assert.equal(frames.length, 1); assert.equal(read(frames[0]).reset, true);
}
frames.length = 0; hub.resume(client, hub.cursor());
assert.equal(frames.length, 1); assert.equal(read(frames[0]).reset, false);
const bounded = makeSseHub({ epoch: 'bytes', maxBytes: 256 });
bounded.broadcast('large', { text: 'x'.repeat(1000) });
frames.length = 0; bounded.add(client); bounded.resume(client, 'bytes:0');
assert.equal(read(frames[0]).reset, true, 'oversized frames evict history rather than exceed the byte bound');
const dead = { write() { throw new Error('closed'); }, destroy() {} };
hub.add(dead); assert.equal(hub.resume(dead, 'boot-a:3'), false);
assert.equal(hub.size(), 1, 'failed replay evicts the client');
console.log('channels.replay: offline replay, expiry, restart, duplicate cursor, byte bounds, command exclusion, dead socket passed');
