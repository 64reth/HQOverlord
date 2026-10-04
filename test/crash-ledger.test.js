/* node test/crash-ledger.test.js — the crash-loop circuit breaker's durable memory (sidecar/crash-ledger.js) and its
   wiring into the fail-loud policy (sidecar/process-fault.js `breaker` dep).

   The law (2026-09-03 audit): a deterministic fault at boot must NOT become an infinite exit/respawn loop behind
   the desktop watchdog. The 3rd fault exit inside 10 minutes trips the breaker: the process holds itself alive
   DEGRADED (health 503 naming the loop) instead of exiting again. Real fs in a temp dir (the ledger is durable by
   design — "survives restart" is the whole point), injected clock. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { makeCrashLedger, DEFAULT_WINDOW_MS, DEFAULT_THRESHOLD } = require('../sidecar/crash-ledger.js');
const { writeFileDurable } = require('../sidecar/durable-write.js');
const { makeProcessFaultHandler, healthLine } = require('../sidecar/process-fault.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-crash-ledger-')); }
function ledger(dir, t, extra) {
  return makeCrashLedger(Object.assign({ fs, path, dir, now: () => t.v, writeDurable: writeFileDurable, note: (tag, e) => t.notes.push([tag, String(e && e.message || e)]) }, extra || {}));
}

(async () => {
  // ---- A. defaults + empty state ----
  {
    const dir = tmp(); const t = { v: 1_000_000, notes: [] };
    const L = ledger(dir, t);
    A.eq(L.windowMs, DEFAULT_WINDOW_MS, 'default window = 10 minutes');
    A.eq(L.threshold, DEFAULT_THRESHOLD, 'default threshold = 3');
    A.eq(L.read().length, 0, 'absent ledger reads as empty');
    A.eq(L.tripped(), false, 'absent ledger never trips');
    A.eq(L.state().count, 0, 'state.count 0');
    A.eq(t.notes.length, 0, 'ENOENT is not a fail-open note');
    A.eq(L.describe(), 'crash-loop: 0 faults in 10m', 'describe() with nothing recorded');
  }

  // ---- B. trips on the 3rd fault inside the window; NOT before ----
  {
    const dir = tmp(); const t = { v: 10 * 60_000, notes: [] };
    const L = ledger(dir, t);
    const r1 = L.record({ code: 1, summary: 'boom one' });
    A.eq(r1.count, 1, '1st fault counted'); A.eq(r1.tripped, false, '1st fault does not trip');
    t.v += 60_000;
    const r2 = L.record({ code: 1, summary: 'boom two' });
    A.eq(r2.count, 2, '2nd fault counted'); A.eq(r2.tripped, false, '2nd fault does not trip');
    t.v += 60_000;
    const r3 = L.record({ code: 1, summary: 'boom three' });
    A.eq(r3.count, 3, '3rd fault counted'); A.eq(r3.tripped, true, '3rd fault inside the window TRIPS');
    A.eq(L.tripped(), true, 'tripped() agrees');
    const s = L.state();
    A.eq(s.count, 3, 'state.count 3'); A.eq(s.tripped, true, 'state.tripped'); A.eq(s.last.summary, 'boom three', 'state.last = newest');
    A.eq(L.describe(), 'crash-loop: 3 faults in 10m — last: boom three', 'describe() names count, window and last summary');
    A.ok(fs.existsSync(path.join(dir, '.crash-ledger.json')), 'ledger file written under the dir');
    const doc = JSON.parse(fs.readFileSync(path.join(dir, '.crash-ledger.json'), 'utf8'));
    A.eq(doc.version, 1, 'ledger doc version 1'); A.eq(doc.entries.length, 3, 'three entries on disk');
    A.ok(doc.entries.every(e => e.ts > 0 && e.code === 1 && typeof e.summary === 'string'), 'entries carry {ts, code, summary}');
  }

  // ---- C. does NOT trip when faults are spread out (window slides) ----
  {
    const dir = tmp(); const t = { v: 100 * 60_000, notes: [] };
    const L = ledger(dir, t);
    L.record({ code: 1, summary: 'a' });
    t.v += 6 * 60_000; L.record({ code: 1, summary: 'b' });
    t.v += 6 * 60_000;                                    // 'a' is now 12m old — outside the window
    const r = L.record({ code: 1, summary: 'c' });
    A.eq(r.count, 2, 'only b + c are inside the 10m window'); A.eq(r.tripped, false, 'spread-out faults do not trip');
    t.v += 11 * 60_000;
    A.eq(L.tripped(), false, 'after the window passes nothing is recent'); A.eq(L.state().count, 0, 'state.count back to 0');
    A.eq(L.read().length, 3, 'but the history is still on disk (bounded)');
  }

  // ---- D. survives restart: a NEW ledger instance over the same dir sees the prior exits ----
  {
    const dir = tmp(); const t = { v: 50 * 60_000, notes: [] };
    ledger(dir, t).record({ code: 73, summary: 'owner unavailable' });
    t.v += 1000;
    ledger(dir, t).record({ code: 1, summary: 'second life' });
    t.v += 1000;
    const third = ledger(dir, t);                          // "the third boot"
    A.eq(third.state().count, 2, 'a fresh instance reads the two prior exits');
    const r = third.record({ code: 1, summary: 'third life' });
    A.eq(r.tripped, true, 'the third life trips on prior lives’ exits');
    A.eq(third.state().last.code, 1, 'last code is this life’s');
  }

  // ---- E. bounded + garbage-safe + knobs ----
  {
    const dir = tmp(); const t = { v: 1_000_000, notes: [] };
    const L = ledger(dir, t, { keep: 5, threshold: 2, windowMs: 1000 });
    for (let i = 0; i < 9; i++) { L.record({ code: 1, summary: 'f' + i }); t.v += 10; }
    A.eq(L.read().length, 5, 'keep bounds the on-disk history');
    A.eq(L.state().count, 5, 'all 5 kept are inside a 1s window');
    A.eq(L.threshold, 2, 'threshold knob honoured');
    A.eq(L.windowMs, 1000, 'window knob honoured');
    fs.writeFileSync(L.file, '{ torn');
    A.eq(L.read().length, 0, 'a torn ledger reads as EMPTY');
    A.eq(L.tripped(), false, '…and never trips on garbage');
    A.ok(t.notes.some(n => n[0] === 'crash-ledger.parse'), 'the torn read is noted (fail-open stays visible)');
    const r = L.record({ code: 1, summary: 'after torn' });
    A.eq(r.count, 1, 'recording over a torn ledger starts a fresh list');
    A.eq(L.clear(), true, 'clear() removes the file'); A.eq(L.read().length, 0, 'cleared');
    A.ok(/x/.test('x'), 'sanity');
    // summaries are clipped and whitespace-collapsed
    const long = L.record({ code: 1, summary: 'a\n\n' + 'b'.repeat(400) });
    A.ok(long.entry.summary.length <= 201 && long.entry.summary.indexOf('\n') < 0, 'summary clipped + single-line');
  }

  // ---- F. process-fault wiring: the breaker holds the process alive on the tripping fault ----
  {
    const dir = tmp(); const t = { v: 5_000_000, notes: [] };
    const mk = () => {
      const calls = { exits: [], scheduled: [], logs: [] };
      const h = makeProcessFaultHandler({
        surface: () => {}, exit: c => calls.exits.push(c), schedule: (fn, ms) => { calls.scheduled.push(ms); return 1; },
        release: () => {}, log: m => calls.logs.push(m), now: () => t.v, delayMs: 500, breaker: ledger(dir, t)
      });
      return { h, calls };
    };
    // life 1 + life 2: ordinary fail-loud (exit scheduled), ledger grows
    for (let life = 1; life <= 2; life++) {
      const { h, calls } = mk();
      const r = h.onUncaught(new Error('deterministic boot throw #' + life));
      A.eq(r.action, 'exit-scheduled', 'life ' + life + ': exit scheduled as before');
      A.eq(calls.scheduled.length, 1, 'life ' + life + ': one exit timer');
      A.eq(h.fault().exiting, true, 'life ' + life + ': fault.exiting true');
      A.eq(healthLine(h.fault()), 'degraded: uncaughtException: deterministic boot throw #' + life, 'life ' + life + ': health names the exception');
      t.v += 2000;
    }
    // life 3: the breaker trips — NO exit, fault marked held, health names the loop
    const { h, calls } = mk();
    const r = h.onUncaught(new Error('deterministic boot throw #3'));
    A.eq(r.action, 'crash-loop-held', 'life 3: held instead of exiting');
    A.eq(r.count, 3, 'life 3: count 3');
    A.eq(calls.scheduled.length, 0, 'life 3: NO exit timer scheduled');
    A.eq(calls.exits.length, 0, 'life 3: exit() never called');
    A.eq(h.fault().exiting, false, 'life 3: fault.exiting false');
    A.ok(h.fault().loop && h.fault().loop.count === 3 && h.fault().loop.tripped === true, 'life 3: fault.loop carries the ledger state');
    A.eq(healthLine(h.fault()), 'degraded: crash-loop: 3 faults in 10m — last: deterministic boot throw #3', 'life 3: /api/health body names the loop + last summary');
    A.eq(h.healthLine(), healthLine(h.fault()), 'handler.healthLine() = healthLine(fault())');
    A.ok(calls.logs.some(m => /CRASH LOOP/.test(m)), 'life 3: logged once, loudly');
    const r2 = h.onUncaught(new Error('another'));
    A.eq(r2.action, 'already-faulted', 'a later throw in the held life only surfaces');
    // a breaker that throws must never mask the exit policy
    const dead = makeProcessFaultHandler({ surface: () => {}, exit: () => {}, schedule: () => 1, log: () => {}, now: () => 1, breaker: { record: () => { throw new Error('disk gone'); } } });
    A.eq(dead.onUncaught(new Error('x')).action, 'exit-scheduled', 'a throwing breaker → exit policy proceeds');
    // keepAlive (test opt-out) wins before the breaker: no ledger write
    const dir2 = tmp(); const L2 = ledger(dir2, t);
    const ka = makeProcessFaultHandler({ surface: () => {}, exit: () => {}, schedule: () => 1, log: () => {}, now: () => 1, keepAlive: true, breaker: L2 });
    A.eq(ka.onUncaught(new Error('x')).action, 'degraded-kept-alive', 'keepAlive still degrades-and-keeps');
    A.eq(L2.read().length, 0, 'keepAlive does not ledger (a test opt-out is not a crash)');
  }

  // ---- G. healthLine shapes ----
  {
    A.eq(healthLine(null), 'ok', 'no fault → ok');
    A.eq(healthLine({ kind: 'uncaughtException', message: 'm' }), 'degraded: uncaughtException: m', 'single fault line');
    A.eq(healthLine({ kind: 'uncaughtException', message: 'm', loop: { count: 1, windowMs: 60000 } }), 'degraded: crash-loop: 1 fault in 1m — last: m', 'loop line, singular');
  }

  A.report('crash-ledger');
})().catch(e => { console.error(e); process.exit(1); });
