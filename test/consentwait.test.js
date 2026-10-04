/* node test/consentwait.test.js — EL-11 FIX 1c: the extendable fail-closed consent waiter.

   THE ESCAPE: a live permission.prompt on a NON-displayed session was invisible (no global surface) and the
   sidecar auto-DENIED it at CONSENT_TIMEOUT_MS — a timeout deny on a prompt nobody ever saw is a consent
   violation. The timeout exists to protect UNATTENDED runs (no browser, telegram silence, dead tab) from
   hanging open forever — that intent must survive.

   The fix: sidecar/consentwait.js — the waiter behind askHuman. Same fail-closed contract as before
   (timeout → deny, abort → deny, settle exactly once), PLUS a one-shot bounded `extend()` that only the
   browser can trigger (POST /api/consent/ack) AFTER it has actually rendered the prompt to a human
   (active consent card OR the new background toast + rail marker). No ack ⇒ the old 120s deny is
   byte-identical, so unattended surfaces are untouched. */
'use strict';
const A = require('./_assert.js');
const { makeConsentWait } = require('../sidecar/consentwait.js');

// deterministic fake timer bed — we control the clock, no real waiting.
function makeClock() {
  let now = 0, seq = 0;
  const timers = new Map();
  return {
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now) { timers.delete(id); t.fn(); }
      }
    },
    pendingCount() { return timers.size; }
  };
}
function makeSignal() {
  const ls = [];
  return {
    aborted: false,
    addEventListener(_n, fn) { ls.push(fn); },
    removeEventListener() {},
    abort() { this.aborted = true; ls.forEach(fn => fn()); }
  };
}

async function settled(p) { let v, done = false; p.then(x => { v = x; done = true; }); await Promise.resolve(); return { v, done }; }

(async () => {
  // 1) UNATTENDED PATH UNCHANGED: no ack → auto-deny at exactly timeoutMs (fail-closed floor intact).
  {
    const clock = makeClock(), pending = new Map(), emitted = [];
    const wait = makeConsentWait({
      pending, signal: makeSignal(), timeoutMs: 120000, extendMs: 600000,
      uuid: () => 'p1', setTimeoutFn: clock.setTimeout.bind(clock), clearTimeoutFn: clock.clearTimeout.bind(clock),
      emitPrompt: (id) => emitted.push(id)
    });
    const p = wait.ask();
    A.eq(emitted, ['p1'], 'unattended: permission.prompt emitted');
    A.ok(pending.has('p1'), 'unattended: finisher registered under promptId');
    clock.advance(119999);
    A.ok(!(await settled(p)).done, 'unattended: still pending just before the timeout');
    clock.advance(1);
    const r = await settled(p);
    A.ok(r.done, 'unattended: settled at timeoutMs');
    A.eq(r.v, 'deny', 'unattended: auto-DENY (fail-closed) with no ack — old behavior byte-identical');
    A.ok(!pending.has('p1'), 'unattended: finisher cleaned up');
  }

  // 2) INTERACTIVE PATH: an ack (prompt provably rendered to a human) extends the deny deadline ONCE,
  //    bounded by extendMs — never indefinite, so an AFK human still fail-closes eventually.
  {
    const clock = makeClock(), pending = new Map();
    const wait = makeConsentWait({
      pending, signal: makeSignal(), timeoutMs: 120000, extendMs: 600000,
      uuid: () => 'p2', setTimeoutFn: clock.setTimeout.bind(clock), clearTimeoutFn: clock.clearTimeout.bind(clock),
      emitPrompt: () => {}
    });
    const p = wait.ask();
    const fin = pending.get('p2');
    A.ok(typeof fin === 'function' && typeof fin.extend === 'function', 'interactive: finisher carries extend()');
    A.eq(fin.extend(), true, 'interactive: first ack extends');
    clock.advance(120000);
    A.ok(!(await settled(p)).done, 'interactive: survives the original 120s deadline after ack');
    A.eq(fin.extend(), false, 'interactive: second ack is a no-op (one-shot, bounded)');
    clock.advance(600000);
    const r = await settled(p);
    A.ok(r.done && r.v === 'deny', 'interactive: STILL fail-closes at the extended bound — never indefinite');
  }

  // 3) a real human answer resolves and clears the timer (with or without a prior ack).
  {
    const clock = makeClock(), pending = new Map();
    const wait = makeConsentWait({
      pending, signal: makeSignal(), timeoutMs: 120000, extendMs: 600000,
      uuid: () => 'p3', setTimeoutFn: clock.setTimeout.bind(clock), clearTimeoutFn: clock.clearTimeout.bind(clock),
      emitPrompt: () => {}
    });
    const p = wait.ask();
    pending.get('p3').extend();
    pending.get('p3')('always');
    const r = await settled(p);
    A.ok(r.done && r.v === 'always', 'answer resolves the decision');
    A.eq(clock.pendingCount(), 0, 'answer clears the timer (no leak)');
    A.ok(!pending.has('p3'), 'answer cleans up the finisher');
  }

  // 4) DISCONNECT still denies INSTANTLY, even after an ack — abort trumps any extension.
  {
    const clock = makeClock(), pending = new Map(), sig = makeSignal();
    const wait = makeConsentWait({
      pending, signal: sig, timeoutMs: 120000, extendMs: 600000,
      uuid: () => 'p4', setTimeoutFn: clock.setTimeout.bind(clock), clearTimeoutFn: clock.clearTimeout.bind(clock),
      emitPrompt: () => {}
    });
    const p = wait.ask();
    pending.get('p4').extend();
    sig.abort();
    const r = await settled(p);
    A.ok(r.done && r.v === 'deny', 'abort after ack: instant deny (disconnect always fail-closes)');
  }

  // 5) already-aborted signal denies immediately (mirror of the old askHuman guard).
  {
    const clock = makeClock(), pending = new Map(), sig = makeSignal(); sig.aborted = true;
    const wait = makeConsentWait({
      pending, signal: sig, timeoutMs: 120000, extendMs: 600000,
      uuid: () => 'p5', setTimeoutFn: clock.setTimeout.bind(clock), clearTimeoutFn: clock.clearTimeout.bind(clock),
      emitPrompt: () => {}
    });
    const r = await settled(wait.ask());
    A.ok(r.done && r.v === 'deny', 'pre-aborted signal: immediate deny');
  }

  // 6) settle-exactly-once: a late timeout fire after an answer must not double-resolve or throw.
  {
    const clock = makeClock(), pending = new Map();
    const wait = makeConsentWait({
      pending, signal: makeSignal(), timeoutMs: 1000, extendMs: 5000,
      uuid: () => 'p6', setTimeoutFn: (fn) => { fn._late = fn; return 9; }, clearTimeoutFn: () => {},
      emitPrompt: () => {}
    });
    const p = wait.ask();
    const fin = pending.get('p6');
    fin('once');
    A.notThrows(() => fin('deny'), 'second settle is a swallowed no-op');
    const r = await settled(p);
    A.eq(r.v, 'once', 'first settle wins');
  }

  A.report('consentwait');
})();
