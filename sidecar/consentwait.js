/* STARNET — consentwait.js : the fail-closed, human-extendable consent waiter behind askHuman.

   EL-11 FIX 1c. The live consent channel await-pauses a run until a human answers a permission.prompt.
   The original inline timer auto-DENIED after CONSENT_TIMEOUT_MS unconditionally — correct for UNATTENDED
   surfaces (no browser, dead tab, silent Telegram: a forgotten prompt must never hold a run open), but a
   consent violation for a prompt that existed only on a NON-displayed session: it was denied before any
   human could possibly have seen it.

   The contract here keeps the unattended intent byte-identical and adds exactly one thing:
     · no ack        → auto-deny at timeoutMs (unchanged fail-closed floor);
     · finish.extend() — called via POST /api/consent/ack ONLY after the browser has actually RENDERED the
       prompt to a human (active consent card, or the global background toast + rail marker) — re-arms the
       deny deadline ONCE to extendMs. One-shot and bounded: an AFK human still fail-closes; never indefinite;
     · abort (disconnect) → instant deny, extension or not;
     · settles exactly once, always cleans up its map entry + timer.

   Pure + injected deps (map, signal, clock, uuid, emit) so the timing semantics are unit-testable with fake
   timers (test/consentwait.test.js) — the REAL sidecar path rides this exact module, not a copy. */
'use strict';

function makeConsentWait(deps) {
  const pending = deps.pending;                 // Map: promptId -> finish(decision) (handleConsent's lookup)
  const signal = deps.signal;                   // the run's AbortController signal (disconnect → deny)
  const timeoutMs = deps.timeoutMs;             // the fail-closed floor (CONSENT_TIMEOUT_MS)
  const extendMs = deps.extendMs;               // the one-shot human-visible bound (CONSENT_ACK_EXTEND_MS)
  const uuid = deps.uuid;
  const setT = deps.setTimeoutFn || setTimeout;
  const clearT = deps.clearTimeoutFn || clearTimeout;
  const emitPrompt = deps.emitPrompt;           // (promptId) => emit the permission.prompt event

  // ask() returns a Promise<decision string>; the registered finisher carries .extend() for the ack route.
  function ask() {
    return new Promise((resolve) => {
      const promptId = uuid();
      let settled = false, timer = null, extended = false;
      function onAbort() { finish('deny'); }
      function finish(decision) {
        if (settled) return; settled = true;
        pending.delete(promptId);
        if (timer) clearT(timer);
        try { signal.removeEventListener('abort', onAbort); } catch (_) {}
        resolve(decision);
      }
      // the ack: a human surface provably rendered this prompt → one bounded extension of the deny deadline.
      finish.extend = function () {
        if (settled || extended) return false;
        extended = true;
        if (timer) clearT(timer);
        timer = setT(() => finish('deny'), extendMs);
        return true;
      };
      pending.set(promptId, finish);
      if (signal.aborted) return finish('deny');
      signal.addEventListener('abort', onAbort, { once: true });
      timer = setT(() => finish('deny'), timeoutMs);
      emitPrompt(promptId);
    });
  }
  return { ask };
}

module.exports = { makeConsentWait };
