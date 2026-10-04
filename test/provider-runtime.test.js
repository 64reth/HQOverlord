'use strict';

const A = require('./_assert.js');
const { runtime } = require('../sidecar/providers/provider.js');

function fakeSignal(aborted) {
  const handlers = new Set();
  return {
    aborted: !!aborted,
    addEventListener(_name, fn) { handlers.add(fn); },
    removeEventListener(_name, fn) { handlers.delete(fn); },
    abort() { this.aborted = true; for (const fn of Array.from(handlers)) fn(); },
    listeners: () => handlers.size
  };
}

(async () => {
  A.ok(runtime.isAbort({ name: 'AbortError' }, null), 'named AbortError is cancellation');
  A.ok(!runtime.isAbort(new Error('request aborted upstream'), null), 'message text cannot masquerade as cancellation');

  const completed = fakeSignal(false);
  await runtime.abortableDelay(1, completed);
  A.eq(completed.listeners(), 0, 'successful retry delay removes its abort listener');

  const pending = fakeSignal(false);
  const wait = runtime.abortableDelay(1000, pending).then(() => null, error => error);
  A.eq(pending.listeners(), 1, 'pending delay has one cancellation listener');
  pending.abort();
  const aborted = await wait;
  A.eq(aborted && aborted.name, 'AbortError', 'mid-delay cancellation rejects with AbortError');
  A.eq(pending.listeners(), 0, 'cancelled delay removes its listener');

  const already = fakeSignal(true);
  const immediate = await runtime.abortableDelay(1000, already).then(() => null, error => error);
  A.eq(immediate && immediate.name, 'AbortError', 'already-aborted delay rejects immediately');
  A.eq(already.listeners(), 0, 'already-aborted delay never registers a listener');

  A.report('provider-runtime.test');
})().catch(error => { console.error(error); process.exitCode = 1; });
