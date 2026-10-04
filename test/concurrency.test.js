/* node test/concurrency.test.js — the multi-agent admission gate (concurrency.js). Bounds how many
   DISTINCT agents may have paid runs in flight; a 2nd run of an already-admitted agent never consumes a
   new slot. Pure/stateful-local — no clock, no IO, no emit. */
'use strict';
const A = require('./_assert.js');
const { makeConcurrencyGate } = require('../sidecar/concurrency.js');

// ---- distinct-agent cap: hero + 2 fit at max 3; a 4th DISTINCT agent is refused ----
{
  const g = makeConcurrencyGate({ max: 3 });
  A.ok(g.tryEnter('hero'), 'hero admitted (1/3)');
  A.ok(g.tryEnter('b'), 'agent b admitted (2/3)');
  A.ok(g.tryEnter('c'), 'agent c admitted (3/3)');
  A.eq(g.active(), 3, 'three distinct agents in flight');
  A.eq(g.tryEnter('d'), false, 'a 4th DISTINCT agent is refused at the cap');
  A.eq(g.active(), 3, 'a refused agent takes no slot');
}

// ---- a 2nd run of an ALREADY-admitted agent is allowed (no new slot consumed) ----
{
  const g = makeConcurrencyGate({ max: 1 });
  A.ok(g.tryEnter('hero'), 'hero admitted (the only slot)');
  A.ok(g.tryEnter('hero'), "hero's 2nd concurrent run is allowed — same agent, no new slot");
  A.eq(g.active(), 1, 'still one distinct agent in flight');
  A.eq(g.inFlight('hero'), 2, 'hero has two runs in flight');
  A.eq(g.tryEnter('b'), false, 'a DIFFERENT agent is still refused at max 1');
}

// ---- leave() is refcounted: a slot frees only when the agent's LAST run ends ----
{
  const g = makeConcurrencyGate({ max: 2 });
  g.tryEnter('a'); g.tryEnter('a'); g.tryEnter('b');   // a×2, b×1 -> 2 distinct, at cap
  A.eq(g.tryEnter('c'), false, 'c refused while a + b hold both slots');
  g.leave('a');                                        // a still has 1 run -> slot NOT freed
  A.eq(g.active(), 2, "a's slot persists while it still has a run in flight");
  A.eq(g.tryEnter('c'), false, 'c still refused — a has not fully left');
  g.leave('a');                                        // a's last run ends -> slot frees
  A.eq(g.active(), 1, "a's slot freed after its last run leaves");
  A.ok(g.tryEnter('c'), 'c now admitted into the freed slot');
}

// ---- unbalanced / unknown leave is a harmless no-op; max 0 = unlimited ----
{
  const g = makeConcurrencyGate({ max: 2 });
  g.leave('ghost');                                    // never entered -> no throw, no underflow
  A.eq(g.active(), 0, 'leaving an unknown agent is a no-op');

  const u = makeConcurrencyGate({ max: 0 });           // 0 = unlimited
  for (let i = 1; i <= 20; i++) A.ok(u.tryEnter('worker-' + i), 'unlimited gate admits worker-' + i);
  A.eq(u.max(), 0, 'max 0 reports unlimited');

  const d = makeConcurrencyGate({});                   // omitted = unlimited product default
  for (let i = 1; i <= 20; i++) A.ok(d.tryEnter('default-worker-' + i), 'default gate admits worker-' + i);
  A.eq(d.active(), 20, 'the default gate admits twenty distinct agents concurrently');
}

// ---- inFlight() as TELEMETRY (concurrent-sessions lane, 2026-07-18): the old admission-time same-agent
//      mutex (`inFlight(agentId) > 0` refused a 2nd run) is RETIRED — concurrent same-agent runs are admitted,
//      and the workspace/shadow-git collision is guarded by workspace-lease.js at the mutating-tool seam.
//      inFlight survives as the honest run counter behind `concurrencyFree` (nightshift defers its autonomous
//      beats while the agent has ANY live run) — lock that reading here. ----
{
  const g = makeConcurrencyGate({ max: 0 });   // unlimited fan-out; the counter is orthogonal to the distinct-agent cap
  const concurrencyFree = (id) => g.inFlight(id) === 0;   // the exact predicate index.js hands nightshift

  A.eq(concurrencyFree('hero'), true, 'a fresh agent reads free (nightshift may beat)');
  g.tryEnter('hero'); g.tryEnter('hero');            // two CONCURRENT runs of one agent — both admitted now
  A.eq(g.inFlight('hero'), 2, 'inFlight counts every concurrent run of the agent honestly');
  A.eq(concurrencyFree('hero'), false, 'nightshift defers while the agent has live runs');
  A.eq(concurrencyFree('other'), true, 'a DIFFERENT agent is unaffected — team workers stay parallel');
  g.leave('hero');
  A.eq(concurrencyFree('hero'), false, 'still not free while ONE of the concurrent runs lives');
  g.leave('hero');
  A.eq(concurrencyFree('hero'), true, 'free again only after the LAST run leaves');
}

A.report('concurrency.test');
