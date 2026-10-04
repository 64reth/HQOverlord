/* test/chain.test.js — the agentic-graph executor (sidecar/routing/chain.js).
   Pure orchestration: a fake nextAgent (the drawn floor) + a fake runAgent (the harness), injected clock.
   No provider, no DOM, no wall-clock. The last block wires the REAL compiler + REAL router so "the line the
   Commander drew" and "the runs the sidecar buys" are proven to be one decision. */
'use strict';
const A = require('./_assert.js');
const { makeChainRunner } = require('../sidecar/routing/chain.js');
const { makeRouter } = require('../sidecar/routing/router.js');
const P = require('../frontend/app/pipeline.js');

// a scripted harness: agentId -> { text, usd } | fn(text) — plus a log of what each stage was handed
function harness(script, log) {
  return async ({ agentId, text, hop, from }) => {
    if (log) log.push({ agentId, hop, from, text });
    const r = script[agentId];
    return typeof r === 'function' ? r(text) : (r || { text: agentId + ' output' });
  };
}
const line = map => a => map[a] || null;      // the drawn floor, as a plain edge map
let T = 0; const clock = () => (T += 10);

(async () => {

  /* ---- a two-stage line runs BOTH agents; the reply is the LAST stage's ---- */
  {
    const log = [], events = [];
    const c = makeChainRunner({
      nextAgent: line({ researcher: 'writer' }),
      runAgent: harness({ writer: { text: 'the polished draft', usd: 0.02 } }, log),
      emit: (n, p) => events.push(n + ':' + p.agentId), now: clock
    });
    const res = await c.advance({ agentId: 'researcher', text: 'raw findings', originalText: 'write me a brief' });
    A.eq(res.text, 'the polished draft', 'the LAST stage of the line produces the answer');
    A.eq(res.agentId, 'writer', 'and the reply is attributed to it');
    A.eq(res.hops.length, 1, 'one downstream hop ran');
    A.eq(res.stopped, null, 'the line ran to its end');
    A.eq(res.usd, 0.02, "the chain accounts for the downstream stage's spend");
    A.eq(log[0].from, 'researcher', 'the handoff names the upstream stage');
    A.ok(/raw findings/.test(log[0].text), "the downstream stage is handed the upstream stage's output");
    A.ok(/write me a brief/.test(log[0].text), 'AND the original request — a writer handed only research invents the ask');
    A.eq(events.join('|'), 'workitem.placed:writer|workitem.delivered:writer', 'every hop rides as a real crate');
  }

  /* ---- a terminal dock hands off to nobody: today's single-agent behaviour, byte for byte ---- */
  {
    let ran = 0;
    const c = makeChainRunner({ nextAgent: line({}), runAgent: async () => { ran++; return { text: 'x' }; }, now: clock });
    const res = await c.advance({ agentId: 'solo', text: 'the answer' });
    A.eq(res.text, 'the answer', 'a lone dock delivers its own reply unchanged');
    A.eq(ran, 0, 'and buys no extra runs');
    A.eq(res.hops.length, 0, 'no hops');
  }

  /* ---- A FAILED STAGE KEEPS THE LAST GOOD ANSWER (the belt is never a gate) ---- */
  {
    const c = makeChainRunner({
      nextAgent: line({ a: 'b', b: 'c' }),
      runAgent: harness({ b: { text: 'stage b work', usd: 0.01 }, c: { error: 'provider exploded' } }), now: clock
    });
    const res = await c.advance({ agentId: 'a', text: 'stage a work' });
    A.eq(res.text, 'stage b work', 'the reply is the last stage that actually worked');
    A.eq(res.agentId, 'b', 'attributed to the agent that produced it');
    A.ok(/^c failed: provider exploded/.test(res.stopped), 'and the stop reason names the stage and the failure');
    A.ok(/work line stopped early/.test(c.stopNote(res)), 'the note is honest about the line not finishing');
    A.eq(c.stopNote({ stopped: null }), '', 'a complete line adds no note');
  }

  /* ---- an EMPTY stage output is never handed on (it would buy a run that can only hallucinate its input) ---- */
  {
    let ran = 0;
    const c = makeChainRunner({
      nextAgent: line({ a: 'b' }), runAgent: async () => { ran++; return { text: '' }; }, now: clock
    });
    const res = await c.advance({ agentId: 'a', text: '   ' });
    A.eq(ran, 0, 'a blank upstream output stops the line before it spends anything');
    A.ok(/produced no output/.test(res.stopped), 'and says so');
  }

  /* ---- NEVER RUN AN AGENT TWICE IN ONE CHAIN (a plan re-posted mid-chain can reintroduce a loop) ---- */
  {
    const seen = [];
    const c = makeChainRunner({
      nextAgent: line({ a: 'b', b: 'a' }),                    // a loop the compiler would have refused
      runAgent: harness({ b: { text: 'b work' } }, seen), now: clock
    });
    const res = await c.advance({ agentId: 'a', text: 'a work' });
    A.eq(seen.length, 1, 'the loop closes after ONE hop — not forever');
    A.ok(/loops back to a/.test(res.stopped), 'and the reason names the loop');
  }

  /* ---- the hop cap and the spend cap both stop the line, honestly ---- */
  {
    const c = makeChainRunner({
      nextAgent: a => ({ s0: 's1', s1: 's2', s2: 's3' })[a] || null,
      runAgent: harness({ s1: { text: 'one' }, s2: { text: 'two' }, s3: { text: 'three' } }),
      maxHops: 2, now: clock
    });
    const res = await c.advance({ agentId: 's0', text: 'seed' });
    A.eq(res.hops.length, 2, 'exactly maxHops downstream stages ran');
    A.eq(res.text, 'two', 'the answer is the last stage that ran');
    A.ok(/longer than 2 stages/.test(res.stopped), 'the cap is reported, never silent');
  }
  {
    const c = makeChainRunner({
      nextAgent: a => ({ s0: 's1', s1: 's2' })[a] || null,
      runAgent: harness({ s1: { text: 'one', usd: 5 }, s2: { text: 'two', usd: 5 } }),
      maxUsd: 1, now: clock
    });
    const res = await c.advance({ agentId: 's0', text: 'seed' });
    A.eq(res.hops.length, 1, 'the line stops once the chain has blown its ceiling');
    A.ok(/\$1\.00 limit/.test(res.stopped), 'and names the limit');
  }

  /* ---- THE $ CEILING COVERS THE WHOLE CHAIN — the entry run is not a free stage (2026-08-10 audit) ----
     MAX_CHAIN_USD bounded only the hops: an expensive stage one rode outside its own line's cap on every
     path, so "the whole chain's spend ceiling" was quietly a hops-only ceiling. The caller seeds the entry
     run's reconciled spend; the cap is measured against entry + hops, while `usd` stays HOP-ONLY (both
     production callers add it to their own entry accounting — totalling it here would double-count). */
  {
    let ran = 0;
    const c = makeChainRunner({
      nextAgent: a => ({ s0: 's1', s1: 's2' })[a] || null,
      runAgent: async ({ agentId }) => { ran++; return { text: agentId + ' out', usd: 0.10 }; },
      maxUsd: 1, now: clock
    });
    // an entry run that already blew the ceiling buys not one downstream dollar
    const blown = await c.advance({ agentId: 's0', text: 'seed', entryUsd: 1.50 });
    A.eq(ran, 0, 'an entry run that already blew the ceiling buys ZERO downstream runs');
    A.ok(/\$1\.00 limit/.test(blown.stopped), 'and the stop names the limit');
    A.eq(blown.text, 'seed', "stage one's answer is still delivered (the belt is never a gate)");
    A.eq(blown.usd, 0, 'usd stays hop-only: nothing downstream ran, nothing is double-counted');
    // entry + first hop cross the ceiling -> the second hop is never bought
    const crossed = await c.advance({ agentId: 's0', text: 'seed', entryUsd: 0.95 });
    A.eq(crossed.hops.length, 1, 'entry + hop crossing the ceiling stops the line before the next hop');
    A.ok(/\$1\.00 limit/.test(crossed.stopped), 'honestly');
    A.eq(crossed.usd, 0.10, "and `usd` reports the hops' spend alone (the caller already holds the entry's)");
    // an absent or garbage seed is a 0 seed — yesterday's behaviour, byte for byte
    const legacy = await c.advance({ agentId: 's0', text: 'seed', entryUsd: 'not-a-number' });
    A.eq(legacy.hops.length, 2, 'a non-numeric seed is ignored (hops-only cap, exactly as before)');
  }

  /* ---- E-STOP: an aborted signal stops the line where it stands ---- */
  {
    const c = makeChainRunner({ nextAgent: line({ a: 'b' }), runAgent: harness({}), now: clock });
    const res = await c.advance({ agentId: 'a', text: 'work', signal: { aborted: true } });
    A.eq(res.hops.length, 0, 'nothing runs after an E-STOP');
    A.eq(res.stopped, 'stopped', 'and it says stopped');
  }

  /* ================= THE DRAWN FLOOR IS THE PIPELINE (compiler + router + executor) ================= */
  {
    const belt = (x, y, dir) => ({ x, y, dir });
    const plan = P.compileRoutingPlan({
      props: [{ id: 'i', t: 'intake', x: 0, y: 0, w: 1, h: 1 },
              { id: 'bA', t: 'bay', x: 4, y: 0, w: 1, h: 1, agentId: 'researcher' },
              { id: 'bB', t: 'bay', x: 7, y: 0, w: 1, h: 1, agentId: 'writer' },
              { id: 'o', t: 'outbox', x: 10, y: 0, w: 1, h: 1 }],
      belts: [belt(1, 0, 'E'), belt(2, 0, 'E'), belt(3, 0, 'E'), belt(5, 0, 'E'), belt(6, 0, 'E'), belt(8, 0, 'E'), belt(9, 0, 'E')]
    });
    const router = makeRouter();
    A.ok(router.setPlan(plan).ok, 'the drawn floor deploys');
    A.eq(router.resolveTarget({ tag: 'x' }), 'researcher', 'inbound work enters at the first dock');

    const log = [];
    const c = makeChainRunner({
      nextAgent: (a, ctx) => router.chainNext(a, ctx),
      runAgent: harness({ writer: { text: 'FINAL COPY', usd: 0.01 } }, log), now: clock
    });
    // work belongs to a line (2026-08-07): the seed carries the line the work ENTERED on — here, the line
    // whose INBOX the router just walked. router.lineOriginFor answers that in production; asked of the same
    // compiled plan here so the test and the sidecar agree on one derivation.
    const lineId = router.lineOfAgent('researcher');
    A.ok(!!lineId, 'the compiled plan names the line this dock belongs to');
    const res = await c.advance({ agentId: 'researcher', text: 'findings', originalText: 'brief me', lineId: lineId });
    A.eq(res.agentId, 'writer', 'the BELTS decided that the writer runs second — nothing else was configured');
    A.eq(res.text, 'FINAL COPY', "and the writer's output is what leaves the station");
    A.eq(res.stopped, null, 'the line ran to the OUTBOX');
    A.eq(log.length, 1, 'exactly one downstream run was bought');

    /* ---- THE SAME DOCK, AN AD-HOC ORDER: terminal, and it SPENDS NOTHING downstream ----
       Andrew's ruling (2026-08-07): "each conveyor system built has a purpose and a different workflow —
       the conveyor system should visually run ONLY when the specific workflow is running." A direct order
       handed to the researcher did not come in through this line's trigger, so the writer must never run. */
    log.length = 0;
    const adhoc = await c.advance({ agentId: 'researcher', text: 'findings', originalText: 'brief me' });
    A.eq(adhoc.agentId, 'researcher', 'a direct order is TERMINAL at the dock that answered it');
    A.eq(adhoc.text, 'findings', "and its own reply is the answer — the line's stages never touched it");
    A.eq(adhoc.hops.length, 0, 'no downstream hop ran');
    A.eq(adhoc.stopped, null, 'and it is not reported as a line that "stopped early" — it was never a line run');
    A.eq(log.length, 0, 'PROVIDER CALLS DOWNSTREAM: zero — nothing was spent past the dock');
    A.eq(adhoc.usd, 0, 'and the chain accounts for $0');

    /* ---- a WRONG line id is not a key: the plan decides, so it cannot unlock another line's spend ---- */
    log.length = 0;
    const forged = await c.advance({ agentId: 'researcher', text: 'findings', originalText: 'brief me', lineId: 'not-a-line' });
    A.eq(forged.hops.length, 0, 'a lineId the compiled plan does not recognise advances nothing');
    A.eq(log.length, 0, 'and buys no runs — the gate reads the plan, never the caller');
  }

  /* ---- TWO INDEPENDENT LINES ON ONE FLOOR NEVER ADVANCE EACH OTHER ----
     Two separate belt networks in one station: A(entry)->A2 and B(entry)->B2. Work that came in through
     line A's INBOX must run A's stages and NOTHING on line B, and vice versa — the exact "spending money on
     later docks the user never intended" failure this lane exists to close. */
  {
    const belt = (x, y, dir) => ({ x, y, dir });
    const plan = P.compileRoutingPlan({
      props: [{ id: 'a_i', t: 'intake', x: 0, y: 0, w: 1, h: 1 },
              { id: 'a_1', t: 'bay', x: 4, y: 0, w: 1, h: 1, agentId: 'a1' },
              { id: 'a_2', t: 'bay', x: 7, y: 0, w: 1, h: 1, agentId: 'a2' },
              { id: 'b_i', t: 'intake', x: 0, y: 6, w: 1, h: 1 },
              { id: 'b_1', t: 'bay', x: 4, y: 6, w: 1, h: 1, agentId: 'b1' },
              { id: 'b_2', t: 'bay', x: 7, y: 6, w: 1, h: 1, agentId: 'b2' }],
      belts: [belt(1, 0, 'E'), belt(2, 0, 'E'), belt(3, 0, 'E'), belt(5, 0, 'E'), belt(6, 0, 'E'),
              belt(1, 6, 'E'), belt(2, 6, 'E'), belt(3, 6, 'E'), belt(5, 6, 'E'), belt(6, 6, 'E')]
    });
    const router = makeRouter();
    A.ok(router.setPlan(plan).ok, 'a two-line floor deploys');
    const lineA = router.lineOfAgent('a1'), lineB = router.lineOfAgent('b1');
    A.ok(lineA && lineB && lineA !== lineB, 'the two networks compile to two DIFFERENT line ids');
    A.eq(router.lineOfAgent('a2'), lineA, 'both of line A\'s docks belong to line A');
    A.eq(router.lineOfAgent('b2'), lineB, "and both of line B's belong to line B");

    const log = [];
    const c = makeChainRunner({
      nextAgent: (a, ctx) => router.chainNext(a, ctx),
      runAgent: harness({ a2: { text: 'A stage two' }, b2: { text: 'B stage two' } }, log), now: clock
    });
    const ra = await c.advance({ agentId: 'a1', text: 'A stage one', lineId: lineA });
    A.eq(ra.agentId, 'a2', "work fed to line A's INBOX runs line A's second stage");
    A.eq(log.map(h => h.agentId).join(','), 'a2', 'and ONLY that one — line B bought nothing');

    log.length = 0;
    const cross = await c.advance({ agentId: 'a1', text: 'A stage one', lineId: lineB });
    A.eq(cross.hops.length, 0, "line B's trigger cannot advance a dock on line A");
    A.eq(log.length, 0, 'PROVIDER CALLS: zero — one line can never spend on another');
  }

  /* ---- AN OLD PLAN (compiled before line identity) SELF-HEALS AT LOAD, IT DOES NOT STAY DEAF ----
     The sidecar restores the last accepted plan from disk at boot, so a plan without lineOfAgent is real —
     and on a HEADLESS/service sidecar taking Telegram + routine traffic, no browser ever comes along to
     re-post a fresh one. Leaving those docks terminal meant every multi-stage line silently ran stage one
     only, forever. router.setPlan now derives the missing line map from the plan's OWN geometry
     (sidecar/routing/planlines.js), so a restored plan runs its lines with no browser. The safer-default
     (terminal) is kept for what is genuinely underivable: a dock the derivation puts on no line at all. */
  {
    const belt = (x, y, dir) => ({ x, y, dir });
    const plan = P.compileRoutingPlan({
      props: [{ id: 'i', t: 'intake', x: 0, y: 0, w: 1, h: 1 },
              { id: 'bA', t: 'bay', x: 4, y: 0, w: 1, h: 1, agentId: 'researcher' },
              { id: 'bB', t: 'bay', x: 7, y: 0, w: 1, h: 1, agentId: 'writer' }],
      belts: [belt(1, 0, 'E'), belt(2, 0, 'E'), belt(3, 0, 'E'), belt(5, 0, 'E'), belt(6, 0, 'E')]
    });
    const lineId = P.lineOf(plan, 'researcher');
    // strip line identity exactly as an older compiler would have left it, then re-post
    const old = JSON.parse(JSON.stringify(plan));
    delete old.lines; delete old.lineOfProp; delete old.lineOfAgent;
    for (const d of (old.dockBays || [])) delete d.lineId;
    const router = makeRouter();
    A.ok(router.setPlan(old).ok, 'an older-shaped plan is still accepted (no contract break)');
    A.eq(router.lineOfAgent('researcher'), lineId, 'and the missing line map is DERIVED from its own geometry');
    A.eq(router.lineOfAgent('writer'), lineId, 'both docks of the one physical line heal onto that line');
    const log = [];
    const c = makeChainRunner({ nextAgent: (a, ctx) => router.chainNext(a, ctx), runAgent: harness({ writer: { text: 'x' } }, log), now: clock });
    const res = await c.advance({ agentId: 'researcher', text: 'findings', lineId: lineId });
    A.eq(res.agentId, 'writer', 'a restored pre-arc plan advances its multi-stage line with no browser open');
    A.eq(log.length, 1, 'exactly ONE downstream provider call — the drawn stage, nothing more');
    // healing widens NOTHING: the gate still refuses work that did not enter through this line
    log.length = 0;
    const adhoc = await c.advance({ agentId: 'researcher', text: 'findings' });
    A.eq(adhoc.hops.length, 0, 'a direct order at the same dock is still terminal on a healed plan');
    const foreign = await c.advance({ agentId: 'researcher', text: 'findings', lineId: 'some-other-line' });
    A.eq(foreign.hops.length, 0, 'and a foreign line id still buys nothing');
    A.eq(log.length, 0, 'PROVIDER CALLS: zero — the heal fills a hole, it does not open a door');
    // the freshly compiled plan still wins outright (the compiler is the authority whenever it has spoken)
    A.ok(router.setPlan(plan).ok, 'the freshly compiled plan re-arms routing');
    const healed = await c.advance({ agentId: 'researcher', text: 'findings', lineId: lineId });
    A.eq(healed.agentId, 'writer', 'and the compiled plan agrees with the derived one on this floor');
  }

  /* ---- A DERIVED LINE MAP NEVER OVERWRITES A COMPILED ONE ----
     A plan that already answers lineOfAgent is returned untouched by the heal, including the deliberate
     empty answer of a floor whose only dock is beltless (on no line, therefore terminal). */
  {
    const { healPlan } = require('../sidecar/routing/planlines.js');
    const compiled = P.compileRoutingPlan({
      props: [{ id: 'i', t: 'intake', x: 0, y: 0, w: 1, h: 1 },
              { id: 'bA', t: 'bay', x: 4, y: 0, w: 1, h: 1, agentId: 'researcher' }],
      belts: [{ x: 1, y: 0, dir: 'E' }, { x: 2, y: 0, dir: 'E' }, { x: 3, y: 0, dir: 'E' }]
    });
    A.eq(healPlan(compiled), compiled, 'a compiled plan is returned by identity — nothing is re-derived');
    const lone = P.compileRoutingPlan({ props: [{ id: 'bZ', t: 'bay', x: 4, y: 0, w: 1, h: 1, agentId: 'solo' }], belts: [] });
    const stripped = JSON.parse(JSON.stringify(lone));
    delete stripped.lines; delete stripped.lineOfProp; delete stripped.lineOfAgent;
    A.eq(healPlan(stripped).lineOfAgent, {}, 'a beltless dock is on NO line even after healing — genuinely underivable stays terminal');
  }

  /* ---- THE LINE ID SURVIVES A PLAN RE-POST (the same floor recompiles to the same id) ---- */
  {
    const belt = (x, y, dir) => ({ x, y, dir });
    const props = [{ id: 'i', t: 'intake', x: 0, y: 0, w: 1, h: 1 },
                   { id: 'bA', t: 'bay', x: 4, y: 0, w: 1, h: 1, agentId: 'researcher' },
                   { id: 'bB', t: 'bay', x: 7, y: 0, w: 1, h: 1, agentId: 'writer' }];
    const belts = [belt(1, 0, 'E'), belt(2, 0, 'E'), belt(3, 0, 'E'), belt(5, 0, 'E'), belt(6, 0, 'E')];
    const p1 = P.compileRoutingPlan({ props, belts });
    const p2 = P.compileRoutingPlan({ props: props.slice().reverse(), belts: belts.slice().reverse() });
    A.eq(P.lineOf(p2, 'researcher'), P.lineOf(p1, 'researcher'), 'the same floor compiles to the same line id, whatever order it is read in');
    // line identity rides OUTSIDE the dispatch-topology hash, so no station needlessly re-arms on upgrade
    A.eq(p1.hash, P._internals.hashStr(JSON.stringify({ sources: p1.sources, bays: p1.bays, junctions: p1.junctions, belts: p1.belts })),
      'the plan hash still covers exactly the dispatch topology — line identity did not enter it');
    A.ok(p1.bays.every(b => b.lineId === undefined), 'and the hashed bay records are untouched (the id rides dockBays + the lookup maps)');
    A.ok(p1.dockBays.every(d => !!d.lineId), 'every working dock is stamped with its line');
    const router = makeRouter();
    router.setPlan(p1);
    const before = router.lineOfAgent('writer');
    router.setPlan(JSON.parse(JSON.stringify(p2)));   // a real re-post: serialized over the wire
    A.eq(router.lineOfAgent('writer'), before, 'a re-post keeps the line the run in flight is riding');
    const log = [];
    const c = makeChainRunner({ nextAgent: (a, ctx) => router.chainNext(a, ctx), runAgent: harness({ writer: { text: 'ok' } }, log), now: clock });
    const res = await c.advance({ agentId: 'researcher', text: 'findings', lineId: before });
    A.eq(res.agentId, 'writer', 'so a line mid-run is not orphaned by a re-post');
  }

  /* ---- a floor whose docks feed each other in a loop is REFUSED before it can spend anything ---- */
  {
    const belt = (x, y, dir) => ({ x, y, dir });
    const plan = P.compileRoutingPlan({
      props: [{ id: 'bA', t: 'bay', x: 2, y: 0, w: 1, h: 1, agentId: 'ping' },
              { id: 'bB', t: 'bay', x: 6, y: 0, w: 1, h: 1, agentId: 'pong' }],
      belts: [belt(3, 0, 'E'), belt(4, 0, 'E'), belt(5, 0, 'E'), belt(6, 1, 'S'), belt(6, 2, 'W'),
              belt(5, 2, 'W'), belt(4, 2, 'W'), belt(3, 2, 'W'), belt(2, 2, 'N'), belt(2, 1, 'N')]
    });
    const router = makeRouter();
    const r = router.setPlan(plan);
    A.ok(!r.ok, 'the sidecar refuses a looping work line');
    A.ok(r.codes.indexOf('CHAIN_CYCLE') >= 0, 'naming CHAIN_CYCLE as the reason');
    A.eq(router.chainNext('ping', {}), null, 'and no chain edge is served from a refused plan');
  }

  /* ---- A BLOCKED HANDOFF IS NOT A FINISHED LINE (2026-08-07 conveyor audit) ----
     `if (!target) return out` left stopped:null for BOTH "this dock is the end of the line" and "the line
     gate refused this work" — so a line truncated by a stale lineId reported itself as having run to its
     end, breaking this file's first law (every stop carries an honest note). The refusal is only
     detectable with the line fact, so `lineOfAgent` is injected exactly like nextAgent; without it the
     runner must stay silent rather than guess. */
  {
    // the floor: researcher -> writer, both on line 'p3'. nextAgent mirrors Pipeline.chainNext's gate.
    const own = { researcher: 'p3', writer: 'p3' };
    const gated = (a, ctx) => (own[a] && ctx && ctx.lineId === own[a] && a === 'researcher') ? 'writer' : null;
    const mk = extra => makeChainRunner(Object.assign({
      nextAgent: gated, runAgent: harness({ writer: { text: 'the polished draft' } }), now: clock
    }, extra || {}));

    // (a) the gate refuses — the run carries a lineId that is no longer this dock's line
    const withLine = mk({ lineOfAgent: a => own[a] || null });
    const refused = await withLine.advance({ agentId: 'researcher', text: 'raw findings', lineId: 'p10' });
    A.eq(refused.hops.length, 0, 'a refused line runs no downstream stage');
    A.eq(refused.text, 'raw findings', "…and still delivers the last good output (a chain never gates the reply)");
    A.ok(refused.stopped, 'THE STOP IS REPORTED — a truncated line no longer claims it finished');
    A.ok(/did not come in through this line/.test(refused.stopped), '…in plain language about the door it came in');
    A.ok(!/lineId|p10|belt/.test(refused.stopped), '…with no ids and no belt vocabulary in it');

    // (b) a genuinely terminal dock stays silent — the common case must not grow a spurious note
    const terminal = await withLine.advance({ agentId: 'writer', text: 'the polished draft', lineId: 'p3' });
    A.eq(terminal.stopped, null, 'the LAST dock of a line is terminal by design — no note');
    const passes = await withLine.advance({ agentId: 'researcher', text: 'raw findings', lineId: 'p3' });
    A.eq(passes.hops.length, 1, 'and work that DID come in through this line still runs the line');
    A.eq(passes.stopped, null, '…reporting no stop');

    // (c) a direct order (no lineId) is the designed contract, not a failed line
    const direct = await withLine.advance({ agentId: 'researcher', text: 'raw findings' });
    A.eq(direct.stopped, null, 'a direct order answers at its dock and says nothing about lines');

    // (d) the seam is OPTIONAL: unwired, the runner claims nothing it cannot prove
    const blind = mk();
    const quiet = await blind.advance({ agentId: 'researcher', text: 'raw findings', lineId: 'p10' });
    A.eq(quiet.stopped, null, 'without the line fact injected the runner never invents a refusal');
    // …and a lineOfAgent that throws is treated exactly like one that is absent
    const angry = mk({ lineOfAgent: () => { throw new Error('plan gone'); } });
    const safe = await angry.advance({ agentId: 'researcher', text: 'raw findings', lineId: 'p10' });
    A.eq(safe.stopped, null, 'a throwing seam degrades to silence, never to a crash or a guess');
    A.eq(safe.text, 'raw findings', '…and the reply survives it');
  }

  A.report('chain');
})();
