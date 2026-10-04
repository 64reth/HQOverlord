/* node test/workspace-lease.test.js — the per-agent workspace lease that replaced the same-agent
   run mutex (concurrent-sessions lane). Locks the semantics dispatch depends on: free/re-entrant
   acquire, FIFO handoff on release, bounded wait that names the holder, and withdrawal of a queued
   wait when its run ends (the release-in-finally guarantee). */
'use strict';
const A = require('./_assert.js');
const { makeWorkspaceLease } = require('../sidecar/workspace-lease.js');

(async () => {
  // ---- 1. free acquire + re-entrancy ----
  {
    const L = makeWorkspaceLease({});
    A.eq((await L.acquire('a', 'r1')).ok, true, 'free lease acquires immediately');
    A.eq((await L.acquire('a', 'r1')).ok, true, 're-entrant: the holder\'s later tools never re-wait');
    A.eq(L.holderOf('a').runId, 'r1', 'holderOf names the holding run');
    A.eq((await L.acquire('b', 'r9')).ok, true, 'a DIFFERENT agent\'s lease is independent');
    L.release('a', 'r1');
    A.eq(L.holderOf('a'), null, 'release frees the lease');
    A.eq((await L.acquire('a', 'r2')).ok, true, 'freed lease is acquirable by the next run');
  }

  // ---- 2. FIFO handoff: release grants the lease to the longest-waiting run ----
  {
    const L = makeWorkspaceLease({ waitMs: 5000 });
    await L.acquire('a', 'r1');
    let r2got = null, r3got = null;
    const p2 = L.acquire('a', 'r2').then(v => { r2got = v; });
    const p3 = L.acquire('a', 'r3').then(v => { r3got = v; });
    A.eq(L.waitersOf('a'), 2, 'both siblings queue');
    A.eq(r2got, null, 'a queued acquire does not resolve while the holder works');
    L.release('a', 'r1');
    await p2;
    A.eq(r2got && r2got.ok, true, 'release hands the lease to the FIRST waiter');
    A.eq(L.holderOf('a').runId, 'r2', 'the waiter is now the holder');
    A.eq(r3got, null, 'the second waiter keeps waiting');
    L.release('a', 'r2');
    await p3;
    A.eq(r3got && r3got.ok, true, 'the chain drains FIFO');
    L.release('a', 'r3');
    A.eq(L.holderOf('a'), null, 'fully drained');
  }

  // ---- 3. bounded wait: a timeout fails truthfully, naming the holder ----
  {
    const L = makeWorkspaceLease({ waitMs: 30 });
    await L.acquire('a', 'r1');
    const v = await L.acquire('a', 'r2');
    A.eq(v.ok, false, 'a sibling\'s acquire fails after the bounded wait');
    A.eq(v.timedOut, true, 'flagged as a timeout, not a cancellation');
    A.eq(v.holder && v.holder.runId, 'r1', 'the refusal names the holder run');
    A.eq(L.waitersOf('a'), 0, 'the timed-out waiter left the queue');
    // the holder is unaffected and a later retry can still queue
    A.eq(L.holderOf('a').runId, 'r1', 'the holder still holds after a sibling timeout');
  }

  // ---- 4. waitMs 0 = never wait (immediate truthful refusal) ----
  {
    const L = makeWorkspaceLease({ waitMs: 0 });
    await L.acquire('a', 'r1');
    const v = await L.acquire('a', 'r2');
    A.eq(v.ok === false && v.timedOut === true && v.holder.runId === 'r1', true, 'waitMs 0 refuses immediately with the holder named');
  }

  // ---- 5. a run ending while QUEUED withdraws its wait (release-in-finally can never leak a waiter) ----
  {
    const L = makeWorkspaceLease({ waitMs: 5000 });
    await L.acquire('a', 'r1');
    let got = null;
    const p = L.acquire('a', 'r2').then(v => { got = v; });
    L.release('a', 'r2');   // r2's run ends (aborted) while still waiting
    await p;
    A.eq(got && got.ok, false, 'the dead run\'s queued acquire resolves (never dangles)');
    A.eq(got && got.cancelled, true, 'flagged cancelled, not timed out');
    A.eq(L.waitersOf('a'), 0, 'its queue entry is gone');
    L.release('a', 'r1');
    A.eq(L.holderOf('a'), null, 'the holder\'s own release still frees cleanly');
  }

  // ---- 6. release by a non-holder is a harmless no-op ----
  {
    const L = makeWorkspaceLease({});
    await L.acquire('a', 'r1');
    L.release('a', 'r-ghost');
    A.eq(L.holderOf('a').runId, 'r1', 'a stranger\'s release never steals the lease');
    L.release('ghost-agent', 'r1');   // unknown agent: no throw
    A.eq(L.holderOf('a').runId, 'r1', 'unknown-agent release is a no-op');
  }

  // ---- 7. parallel tool calls of ONE queued run share a single wait ----
  {
    const L = makeWorkspaceLease({ waitMs: 5000 });
    await L.acquire('a', 'r1');
    const p1 = L.acquire('a', 'r2');
    const p2 = L.acquire('a', 'r2');
    A.eq(L.waitersOf('a'), 1, 'the same run queues ONCE (parallel tool calls share the wait)');
    L.release('a', 'r1');
    const [v1, v2] = await Promise.all([p1, p2]);
    A.eq(v1.ok && v2.ok, true, 'both parallel acquires resolve held when the lease is granted');
    L.release('a', 'r2');
  }

  A.report('workspace-lease.test');
})().catch(e => { console.error(e); process.exit(1); });
