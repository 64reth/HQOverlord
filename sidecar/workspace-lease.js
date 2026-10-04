/* sidecar/workspace-lease.js — the per-agent WORKSPACE lease that replaced the same-agent run mutex.

   Concurrent runs of one agent are now ADMITTED (multiple COMMS sessions may drive the same agent at
   once — the world's overlap refcount already renders that truthfully). What two runs of one agentId
   still cannot share is the agent's single workspace directory + its shadow-git checkpoint repo: a
   file clobber and a `git index.lock` fight. So the collision guard moved DOWN from run admission to
   the first workspace-MUTATING tool call: the run that touches the workspace first takes this lease
   and holds it until the run ends (keeping its checkpoint chain contiguous); a sibling run's mutating
   tool WAITS here (bounded), then fails truthfully naming the holder. Chat/reasoning-only runs never
   acquire, so "quick question while a long task runs" is never blocked.

   makeWorkspaceLease({ waitMs, now, setTimeout, clearTimeout }) -> {
     acquire(agentId, runId) -> Promise<
       { ok:true }                                        // held (fresh, re-entrant, or granted after a wait)
       | { ok:false, timedOut:true, holder:{runId,since} } // waited waitMs; the holder is still working
       | { ok:false, cancelled:true }>                     // this run ended/was released while still queued
     release(agentId, runId),        // idempotent; hands the lease to the next FIFO waiter. Call in the
                                     // run's finally (like concurrencyGate.leave) so it ALWAYS runs.
     holderOf(agentId) -> { runId, since } | null,
     waitersOf(agentId) -> int
   }
   PURE/stateful-local: no IO, no emit; clock + timers injectable for tests. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).workspaceLease = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_WAIT_MS = 45000;

  function makeWorkspaceLease(opts) {
    opts = opts || {};
    const waitMs = (typeof opts.waitMs === 'number' && isFinite(opts.waitMs) && opts.waitMs >= 0) ? opts.waitMs : DEFAULT_WAIT_MS;
    const now = typeof opts.now === 'function' ? opts.now : (() => 0);   // clock is INJECTED (lint-determinism); un-clocked hosts get a flat 0 `since`
    const setT = typeof opts.setTimeout === 'function' ? opts.setTimeout : setTimeout;
    const clearT = typeof opts.clearTimeout === 'function' ? opts.clearTimeout : clearTimeout;
    // agentId -> { holder: { runId, since }, queue: [{ runId, resolve, timer, promise }] }
    const leases = new Map();

    const key = v => String(v == null ? '' : v);

    function stateOf(agentId) {
      let s = leases.get(agentId);
      if (!s) { s = { holder: null, queue: [] }; leases.set(agentId, s); }
      return s;
    }
    function gc(agentId, s) { if (!s.holder && !s.queue.length) leases.delete(agentId); }

    function acquire(agentId, runId) {
      agentId = key(agentId); runId = key(runId);
      const s = stateOf(agentId);
      if (!s.holder) { s.holder = { runId, since: now() }; return Promise.resolve({ ok: true }); }
      if (s.holder.runId === runId) return Promise.resolve({ ok: true });   // re-entrant: later tools of the holder never re-wait
      // a second acquire from the SAME queued run (parallel tool calls in one turn) shares the pending promise
      const queued = s.queue.find(w => w.runId === runId);
      if (queued) return queued.promise;
      const w = { runId, resolve: null, timer: null, promise: null };
      w.promise = new Promise((resolve) => {
        w.resolve = resolve;
        if (waitMs > 0) {
          w.timer = setT(() => {
            const i = s.queue.indexOf(w);
            if (i >= 0) s.queue.splice(i, 1);
            gc(agentId, s);
            resolve({ ok: false, timedOut: true, holder: s.holder ? { runId: s.holder.runId, since: s.holder.since } : null });
          }, waitMs);
        }
      });
      s.queue.push(w);
      // waitMs === 0 = never wait: fail immediately with the holder named (still queued-then-removed for one tick? no — resolve now)
      if (waitMs === 0) {
        const i = s.queue.indexOf(w); if (i >= 0) s.queue.splice(i, 1);
        w.resolve({ ok: false, timedOut: true, holder: { runId: s.holder.runId, since: s.holder.since } });
      }
      return w.promise;
    }

    function release(agentId, runId) {
      agentId = key(agentId); runId = key(runId);
      const s = leases.get(agentId);
      if (!s) return;
      // a run ending while still QUEUED withdraws its wait (its acquire resolves cancelled — never leaks)
      for (let i = s.queue.length - 1; i >= 0; i--) {
        if (s.queue[i].runId === runId) {
          const w = s.queue.splice(i, 1)[0];
          if (w.timer) { try { clearT(w.timer); } catch (_) {} }
          w.resolve({ ok: false, cancelled: true });
        }
      }
      if (s.holder && s.holder.runId === runId) {
        const next = s.queue.shift();
        if (next) {
          if (next.timer) { try { clearT(next.timer); } catch (_) {} }
          s.holder = { runId: next.runId, since: now() };
          next.resolve({ ok: true });
        } else {
          s.holder = null;
        }
      }
      gc(agentId, s);
    }

    function holderOf(agentId) {
      const s = leases.get(key(agentId));
      return (s && s.holder) ? { runId: s.holder.runId, since: s.holder.since } : null;
    }
    function waitersOf(agentId) {
      const s = leases.get(key(agentId));
      return s ? s.queue.length : 0;
    }

    return { acquire, release, holderOf, waitersOf };
  }

  return { makeWorkspaceLease, DEFAULT_WAIT_MS };
});
