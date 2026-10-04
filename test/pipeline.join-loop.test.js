/* test/pipeline.join-loop.test.js — JOINER (fan-in barrier) + LOOP gate (bounded cycle) in the belt compiler
   (frontend/app/pipeline.js, 2026-08-21). Pure geo in, plan out — no DOM, no clock. */
'use strict';
const A = require('./_assert.js');
const P = require('../frontend/app/pipeline.js');

const geo = (props, belts) => ({ props, belts });
const belt = (x, y, dir) => ({ x, y, dir });
const onLine = (plan, aid, extra) => Object.assign({ lineId: P.lineOf(plan, aid) }, extra || {});

/* THE JOIN FLOOR: INBOX -> SPLIT -> (A | B) -> JOINER -> D
     (0,0) intake, belts E to the splitter at (3,0); E lane -> bay A (6,0); S lane -> bay B (2,4).
     A ships from (8,0) south to (8,4)E into the joiner at (9,4); B ships from (4,5) east to (9,5)N into it.
     The joiner's single exit (10,4)E,(11,4)E feeds bay D at (12,4). */
function joinFloor(extraProps) {
  return geo(
    [{ id: 'p1', t: 'intake', x: 0, y: 0, w: 1, h: 1 },
     { id: 'p2', t: 'splitter', x: 3, y: 0, w: 1, h: 1 },
     { id: 'p3', t: 'bay', x: 6, y: 0, w: 2, h: 2, agentId: 'A' },
     { id: 'p4', t: 'bay', x: 2, y: 4, w: 2, h: 2, agentId: 'B' },
     { id: 'p5', t: 'joiner', x: 9, y: 4, w: 1, h: 1 },
     { id: 'p6', t: 'bay', x: 12, y: 4, w: 2, h: 2, agentId: 'D' }].concat(extraProps || []),
    [belt(1, 0, 'E'), belt(2, 0, 'E'), belt(3, 0, 'E'), belt(4, 0, 'E'), belt(5, 0, 'E'),
     belt(3, 1, 'S'), belt(3, 2, 'S'), belt(3, 3, 'S'),
     belt(8, 0, 'S'), belt(8, 1, 'S'), belt(8, 2, 'S'), belt(8, 3, 'S'), belt(8, 4, 'E'),
     belt(4, 5, 'E'), belt(5, 5, 'E'), belt(6, 5, 'E'), belt(7, 5, 'E'), belt(8, 5, 'E'), belt(9, 5, 'N'),
     belt(9, 4, 'E'), belt(10, 4, 'E'), belt(11, 4, 'E')]
  );
}

{
  const plan = P.compileRoutingPlan(joinFloor());
  A.ok(P.ok(plan), 'the join floor compiles deployable: ' + JSON.stringify(plan.errors));
  const j = plan.junctions['9,4'];
  A.ok(j && j.kind === 'join', 'the joiner compiles to a join junction');
  A.eq(j.expect, 2, 'the joiner counts its two in-lanes');
  A.eq(j.timeoutMin, 10, 'default barrier timeout is 10 minutes');
  A.eq(plan.junctions['3,0'].fanout, true, 'a split upstream of a joiner is a FAN-OUT split');
  A.ok(!plan.errors.some(e => e.code === 'JOIN_ONE_LANE'), 'no one-lane warning on a two-lane joiner');
  A.eq(plan.chains.A.next.join(','), 'D', 'A chains through the joiner to D');
  A.eq(plan.chains.B.next.join(','), 'D', 'B chains through the joiner to D');
  // chainStep from A meets the barrier, not D
  const st = P.chainStep(plan, 'A', onLine(plan, 'A'));
  A.ok(st && st.join === '9,4', 'chainStep from A stops at the joiner (' + JSON.stringify(st) + ')');
  A.eq(st.expect, 2, 'the step carries the barrier size');
  A.eq(st.next, 'D', 'the step names the dock past the barrier');
  A.eq(P.chainNext(plan, 'A', onLine(plan, 'A')), 'D', 'chainNext still reads straight through (older surfaces)');
  A.eq(P.fanSiblings(plan, 'A').join(','), 'B', 'A\'s fan-out sibling is B');
  A.eq(P.fanSiblings(plan, 'B').join(','), 'A', 'B\'s fan-out sibling is A');
  A.eq(P.fanSiblings(plan, 'D').length, 0, 'D is on no fan-out lane');
  // resume from the released joiner: the exit lane leads to D
  const res = P.chainStep(plan, 'A', onLine(plan, 'A', { fromTile: { x: 9, y: 4 } }));
  A.eq(res && res.agentId, 'D', 'resuming past the joiner reaches D');
  // the hash moves with the topology (joiner is dispatch topology)
  const plain = P.compileRoutingPlan(joinFloor([]));
  A.eq(plain.hash, plan.hash, 'same floor, same hash');
  // a configured timeout rides through
  const g2 = joinFloor(); g2.props[4].timeoutMin = 3;
  A.eq(P.compileRoutingPlan(g2).junctions['9,4'].timeoutMin, 3, 'timeoutMin is plan-configurable');
  A.ok(P.compileRoutingPlan(g2).hash !== plan.hash, 'timeout config moves the hash (it is junction config)');
}

/* one-lane joiner warns like a one-lane splitter */
{
  const plan = P.compileRoutingPlan(geo(
    [{ id: 'p1', t: 'intake', x: 0, y: 0, w: 1, h: 1 }, { id: 'p2', t: 'joiner', x: 2, y: 0, w: 1, h: 1 },
     { id: 'p3', t: 'bay', x: 4, y: 0, w: 2, h: 2, agentId: 'A' }],
    [belt(1, 0, 'E'), belt(2, 0, 'E'), belt(3, 0, 'E')]
  ));
  A.ok(plan.errors.some(e => e.code === 'JOIN_ONE_LANE' && e.warn), 'a joiner with <2 in-lanes warns JOIN_ONE_LANE');
  A.ok(P.ok(plan), 'JOIN_ONE_LANE is advice, not a blocker');
  A.ok(!plan.junctions['2,0'].fanout, 'no split, nothing marked fanout');
}

/* a plain split with NO joiner keeps round-robin meaning */
{
  const plan = P.compileRoutingPlan(geo(
    [{ id: 'p1', t: 'intake', x: 0, y: 0, w: 1, h: 1 }, { id: 'p2', t: 'splitter', x: 2, y: 0, w: 1, h: 1 },
     { id: 'p3', t: 'bay', x: 4, y: 0, w: 2, h: 2, agentId: 'A' }, { id: 'p4', t: 'bay', x: 1, y: 3, w: 2, h: 2, agentId: 'B' }],
    [belt(1, 0, 'E'), belt(2, 0, 'E'), belt(3, 0, 'E'), belt(2, 1, 'S'), belt(2, 2, 'S')]
  ));
  A.ok(!plan.junctions['2,0'].fanout, 'a joiner-less split is not a fan-out');
  A.eq(P.fanSiblings(plan, 'A').length, 0, 'no siblings on a load-balancing split');
}

/* THE LOOP FLOOR: INBOX -> drafter -> reviewer -> LOOP gate -> (done: E -> publisher | back: N ... -> drafter)
     intake (0,4); belts E to drafter at (3,3) 2x2 [ring x2..5,y2..5]; drafter ships (5,4)E..(7,4)E into
     reviewer at (8,3) 2x2 [ring x7..10,y2..5]; reviewer ships (10,4)E,(11,4)E into the loop gate at (12,4).
     done lane E: (13,4)E,(14,4)E -> publisher at (15,3) [ring x14..17]. back lane N: (12,3)N,(12,2)N,(12,1)W ...
     (6,1)W then (5,1)S -> (5,2) which is in the drafter's ring -> drafter re-entered. */
function loopFloor(gateCfg) {
  const gate = Object.assign({ id: 'p5', t: 'loop', x: 12, y: 4, w: 1, h: 1, done: 'E' }, gateCfg || {});
  const belts = [belt(1, 4, 'E'), belt(2, 4, 'E'), belt(5, 4, 'E'), belt(6, 4, 'E'), belt(7, 4, 'E'), belt(10, 4, 'E'), belt(11, 4, 'E'), belt(12, 4, 'E'),
    belt(13, 4, 'E'), belt(14, 4, 'E'), belt(12, 3, 'N'), belt(12, 2, 'N'), belt(12, 1, 'W')];
  for (let x = 11; x >= 6; x--) belts.push(belt(x, 1, 'W'));
  belts.push(belt(5, 1, 'S'), belt(5, 2, 'S'));
  return geo(
    [{ id: 'p1', t: 'intake', x: 0, y: 4, w: 1, h: 1 },
     { id: 'p2', t: 'bay', x: 3, y: 3, w: 2, h: 2, agentId: 'drafter' },
     { id: 'p3', t: 'bay', x: 8, y: 3, w: 2, h: 2, agentId: 'reviewer' },
     gate,
     { id: 'p6', t: 'bay', x: 15, y: 3, w: 2, h: 2, agentId: 'publisher' }],
    belts
  );
}

{
  const plan = P.compileRoutingPlan(loopFloor());
  A.ok(P.ok(plan), 'a review-until-pass loop floor compiles deployable: ' + JSON.stringify(plan.errors));
  A.ok(!plan.errors.some(e => e.code === 'CYCLE' || e.code === 'CHAIN_CYCLE'), 'a cycle THROUGH a loop gate is legal');
  const g = plan.junctions['12,4'];
  A.ok(g && g.kind === 'loop', 'the gate compiles to a loop junction');
  A.eq(g.done, 'E', 'done lane is E'); A.eq(g.back, 'N', 'back lane is N');
  A.eq(g.max, 5, 'default max iterations = 5');
  A.eq(g.backTo, 'drafter', 'the back lane re-enters at the drafter');
  A.eq(plan.chains.reviewer.next.join(','), 'publisher', 'statically the reviewer chains to the publisher (done lane)');
  const st = P.chainStep(plan, 'reviewer', onLine(plan, 'reviewer'));
  A.ok(st && st.loop === '12,4', 'chainStep from the reviewer meets the loop gate');
  A.eq(st.max, 5, 'step carries max'); A.eq(st.backTo, 'drafter', 'step carries backTo'); A.eq(st.next, 'publisher', 'step carries the done dock');
  const back = P.chainStep(plan, 'reviewer', onLine(plan, 'reviewer', { fromTile: { x: 12, y: 4 }, via: 'back' }));
  A.eq(back && back.agentId, 'drafter', 'resuming via the back lane reaches the drafter');
  A.eq(P.chainNext(plan, 'reviewer', onLine(plan, 'reviewer')), 'publisher', 'chainNext reads the loop as spent (done lane)');
  // config
  A.eq(P.compileRoutingPlan(loopFloor({ maxIter: 3 })).junctions['12,4'].max, 3, 'maxIter is plan-configurable');
  A.eq(P.compileRoutingPlan(loopFloor({ maxIter: 99 })).junctions['12,4'].max, 20, 'maxIter is hard-capped at 20');
  // LOOP_NO_DONE rule (2026-08-22): an unset `done` takes the compiler's own default (first exit in E,S,W,N
  // order) and is NOT a finding — every user-drawn loop used to nag. Warn only when no exit qualifies, or when
  // a configured `done` names a lane that is not an exit (the config was silently overridden).
  A.ok(!P.compileRoutingPlan(loopFloor({ done: null })).errors.some(e => e.code === 'LOOP_NO_DONE'), 'an unset done lane takes the default exit — no LOOP_NO_DONE');
  A.eq(P.compileRoutingPlan(loopFloor({ done: null })).junctions['12,4'].done, 'E', 'the default done lane is the first exit (E)');
  A.ok(P.compileRoutingPlan(loopFloor({ done: 'W' })).errors.some(e => e.code === 'LOOP_NO_DONE' && e.warn), 'a configured done that is not an exit warns LOOP_NO_DONE');
}

/* THE CASCADE (2026-08-30): a floor goes wider than 3 branches by CHAINING splitters — and every
   promised branch must be visible to the runner. The single-path sibling walk saw ONE dock per lane
   of the outer split, so on a cascaded floor the runner silently never launched the inner split's
   other dock and the joiner sat on a partial until timeout.
     intake(0,6) -> splitA(3,6): N lane -> A(10,0); S lane -> splitB(6,12): N -> B(10,7), S -> C(10,14);
     all three ship into the joiner(16,8) -> D(19,7). */
function cascadeFloor() {
  return geo(
    [{ id: 'i', t: 'intake', x: 0, y: 6, w: 1, h: 1 },
     { id: 'sA', t: 'splitter', x: 3, y: 6, w: 1, h: 1 },
     { id: 'sB', t: 'splitter', x: 6, y: 12, w: 1, h: 1 },
     { id: 'b1', t: 'bay', x: 10, y: 0, w: 2, h: 2, agentId: 'A' },
     { id: 'b2', t: 'bay', x: 10, y: 7, w: 2, h: 2, agentId: 'B' },
     { id: 'b3', t: 'bay', x: 10, y: 14, w: 2, h: 2, agentId: 'C' },
     { id: 'j', t: 'joiner', x: 16, y: 8, w: 1, h: 1 },
     { id: 'd', t: 'bay', x: 19, y: 7, w: 2, h: 2, agentId: 'D' }],
    [belt(1, 6, 'E'), belt(2, 6, 'E'), belt(3, 6, 'E'),
     belt(3, 5, 'N'), belt(3, 4, 'N'), belt(3, 3, 'N'), belt(3, 2, 'N'), belt(3, 1, 'E'), belt(4, 1, 'E'), belt(5, 1, 'E'), belt(6, 1, 'E'), belt(7, 1, 'E'), belt(8, 1, 'E'), belt(9, 1, 'E'),
     belt(3, 7, 'S'), belt(3, 8, 'S'), belt(3, 9, 'S'), belt(3, 10, 'S'), belt(3, 11, 'S'), belt(3, 12, 'E'), belt(4, 12, 'E'), belt(5, 12, 'E'), belt(6, 12, 'E'),
     belt(6, 11, 'N'), belt(6, 10, 'N'), belt(6, 9, 'N'), belt(6, 8, 'E'), belt(7, 8, 'E'), belt(8, 8, 'E'), belt(9, 8, 'E'),
     belt(6, 13, 'S'), belt(6, 14, 'S'), belt(6, 15, 'E'), belt(7, 15, 'E'), belt(8, 15, 'E'), belt(9, 15, 'E'),
     belt(12, 1, 'E'), belt(13, 1, 'E'), belt(14, 1, 'E'), belt(15, 1, 'E'), belt(16, 1, 'S'), belt(16, 2, 'S'), belt(16, 3, 'S'), belt(16, 4, 'S'), belt(16, 5, 'S'), belt(16, 6, 'S'), belt(16, 7, 'S'),
     belt(12, 8, 'E'), belt(13, 8, 'E'), belt(14, 8, 'E'), belt(15, 8, 'E'),
     belt(12, 15, 'E'), belt(13, 15, 'E'), belt(14, 15, 'E'), belt(15, 15, 'E'), belt(16, 15, 'N'), belt(16, 14, 'N'), belt(16, 13, 'N'), belt(16, 12, 'N'), belt(16, 11, 'N'), belt(16, 10, 'N'), belt(16, 9, 'N'),
     belt(16, 8, 'E'), belt(17, 8, 'E'), belt(18, 8, 'E')]
  );
}
{
  const plan = P.compileRoutingPlan(cascadeFloor());
  A.ok(P.ok(plan), 'the cascade compiles deployable: ' + JSON.stringify(plan.errors));
  A.eq(plan.errors.length, 0, 'and with zero warns');
  A.eq(plan.junctions['3,6'].fanout, true, 'the outer split fans out');
  A.eq(plan.junctions['6,12'].fanout, true, 'the inner split fans out');
  A.eq(plan.junctions['16,8'].expect, 3, 'the joiner counts all three in-lanes');
  // EVERY dock's siblings are the whole promised set, whichever dock the dispatcher picked
  A.eq(P.fanSiblings(plan, 'A').join(','), 'B,C', 'A sees both inner-branch siblings');
  A.eq(P.fanSiblings(plan, 'B').join(','), 'A,C', 'B (inner) sees the outer branch too');
  A.eq(P.fanSiblings(plan, 'C').join(','), 'A,B', 'C (inner) sees the outer branch too');
  A.eq(P.fanSiblings(plan, 'D').length, 0, 'D is past the barrier — no siblings');
  ['A', 'B', 'C'].forEach(a => {
    const st = P.chainStep(plan, a, onLine(plan, a));
    A.ok(st && st.join === '16,8' && st.expect === 3, a + ' meets the 3-way barrier (' + JSON.stringify(st) + ')');
  });
}
/* mid-chain cascade: a DOCK ships into the fan-out — its chainStep must name EVERY promised branch,
   including the docks behind the inner split (the old walk dropped the inner {branches} result) */
{
  const g = cascadeFloor();
  // replace the intake with a dock X shipping into the same entry lane
  g.props[0] = { id: 'x', t: 'bay', x: 0, y: 5, w: 2, h: 2, agentId: 'X' };
  const plan = P.compileRoutingPlan(g);
  A.ok(P.ok(plan), 'dock-fed cascade compiles: ' + JSON.stringify(plan.errors));
  const st = P.chainStep(plan, 'X', onLine(plan, 'X'));
  A.ok(st && st.branches, 'chainStep from X returns fan-out branches (' + JSON.stringify(st) + ')');
  A.eq((st.branches || []).slice().sort().join(','), 'A,B,C',
    'the branch set spans the WHOLE cascade — inner split docks included');
}

/* THE BACK LANE IS LIVE (2026-08-29). Static flow cuts the back edge on purpose, so flooding only the
   static graph left every tile of a working back lane COLD — the energized-tile promise lying in the
   other direction, and two-thirds of a stamped REVISION LOOP drawn frozen. */
{
  const plan = P.compileRoutingPlan(loopFloor());
  const live = P.liveTiles(plan);
  A.ok(live['12,3'], 'the tile the back lane leaves the gate on is energized');
  A.ok(live['8,1'] && live['5,1'], 'the whole run home is energized');
  A.ok(live['5,2'], 'right up to the drafter it re-enters at');
  // a gate NOTHING feeds lights nothing: cut the reviewer's lane into it and the back lane goes dark
  const g = loopFloor(); g.belts = g.belts.filter(b => !(b.y === 4 && (b.x === 10 || b.x === 11)));
  const cold = P.liveTiles(P.compileRoutingPlan(g));
  A.ok(!cold['12,3'], 'an unfed gate does not energize its own back lane');
}

/* AN UNCREWED DOCK ON THE BACK LANE IS NOT A WIRING FAULT (2026-08-29). LOOP_NO_BACK means "the back
   lane reaches no dock"; a lane that lands on a bay nobody has crewed yet is already named by
   UNBOUND_BAY, and a freshly stamped REVISION LOOP must never nag twice for one next step. */
{
  const g = loopFloor();
  delete g.props[1].agentId;   // the drafter the back lane re-enters, uncrewed
  const plan = P.compileRoutingPlan(g);
  A.ok(plan.errors.some(e => e.code === 'UNBOUND_BAY'), 'the uncrewed drafter still nags UNBOUND_BAY');
  A.ok(!plan.errors.some(e => e.code === 'LOOP_NO_BACK'), 'and the gate does NOT also nag LOOP_NO_BACK');
  A.eq(plan.junctions['12,4'].backTo, null, 'backTo stays null — there is no agent to name yet');
  // a back lane that reaches NOTHING still warns
  const g2 = loopFloor(); g2.props.splice(1, 1);   // no drafter at all
  A.ok(P.compileRoutingPlan(g2).errors.some(e => e.code === 'LOOP_NO_BACK' && e.warn),
    'a back lane reaching no dock at all still warns LOOP_NO_BACK');
}

/* THE STRANDED-USER FLOOR (2026-08-22): writer -> reviewer -> LOOP{done: E -> OUTBOX, back: N -> writer}.
   The reviewer's static chain is TERMINAL (its done lane ships out, `next: []`) so chainStep returned null and
   the runner never met the gate: the line never looped once. */
function loopToOutboxFloor(gateCfg) {
  const g = loopFloor(gateCfg);
  g.props[4] = { id: 'p6', t: 'outbox', x: 15, y: 3, w: 2, h: 2 };   // publisher dock -> OUTBOX
  return g;
}
{
  const plan = P.compileRoutingPlan(loopToOutboxFloor());
  A.ok(P.ok(plan), 'loop-then-outbox compiles deployable: ' + JSON.stringify(plan.errors));
  A.ok(!plan.errors.some(e => e.code === 'CHAIN_CYCLE' || e.code === 'CYCLE'), 'no cycle error on a gated loop that exits to OUTBOX');
  A.eq(plan.chains.reviewer.next.length, 0, 'statically the reviewer is terminal (done lane -> OUTBOX)');
  A.eq(plan.chains.reviewer.outbox, true, 'and its lane ships out');
  A.eq(plan.chains.reviewer.gated, true, 'the lane is marked gated (a loop sits on it)');
  const st = P.chainStep(plan, 'reviewer', onLine(plan, 'reviewer'));
  A.ok(st && st.loop === '12,4', 'chainStep from a terminal reviewer STILL meets the loop gate (' + JSON.stringify(st) + ')');
  A.eq(st.backTo, 'drafter', 'the step carries backTo'); A.eq(st.next, null, 'the done dock is null (ships out)');
  const back = P.chainStep(plan, 'reviewer', onLine(plan, 'reviewer', { fromTile: { x: 12, y: 4 }, via: 'back' }));
  A.eq(back && back.agentId, 'drafter', 'the back lane re-enters the drafter');
  A.eq(P.chainNext(plan, 'reviewer', onLine(plan, 'reviewer')), null, 'chainNext (older surfaces) still reads terminal');
  A.ok(!plan.chains.drafter.gated, 'an ungated lane carries no gated flag');
  A.ok(!plan.errors.some(e => e.code === 'LOOP_NO_DONE'), 'default done lane: no LOOP_NO_DONE nag');
}
/* the same hole for a JOINER whose exit goes straight to OUTBOX: the branches must still meet the barrier */
{
  const g = joinFloor(); g.props[5] = { id: 'p6', t: 'outbox', x: 12, y: 4, w: 2, h: 2 };
  const plan = P.compileRoutingPlan(g);
  A.ok(P.ok(plan), 'join-then-outbox compiles deployable: ' + JSON.stringify(plan.errors));
  A.eq(plan.chains.A.next.length, 0, 'A is statically terminal'); A.eq(plan.chains.A.gated, true, 'A lane is gated by the joiner');
  const st = P.chainStep(plan, 'A', onLine(plan, 'A'));
  A.ok(st && st.join === '9,4' && st.expect === 2 && st.next === null, 'chainStep from A meets the joiner barrier with no dock past it (' + JSON.stringify(st) + ')');
  A.eq(plan.junctions['3,0'].fanout, true, 'the split still fans out');
}

/* a loop-less cycle is STILL refused (the existing guard is untouched) */
{
  const plan = P.compileRoutingPlan(loopFloor({ t: 'merger', done: undefined }));   // same belts, the gate is a funnel -> real belt cycle
  A.ok(plan.errors.some(e => e.code === 'CYCLE' || e.code === 'CHAIN_CYCLE'), 'the same belts without a loop gate are a cycle error: ' + JSON.stringify(plan.errors));
  A.ok(!P.ok(plan), 'and that is still a blocker');
}
{
  // dock-to-dock chain loop with no gate anywhere
  const plan = P.compileRoutingPlan(geo(
    [{ id: 'p1', t: 'bay', x: 0, y: 0, w: 2, h: 2, agentId: 'A' }, { id: 'p2', t: 'bay', x: 6, y: 0, w: 2, h: 2, agentId: 'B' }],
    [belt(2, 0, 'E'), belt(3, 0, 'E'), belt(4, 0, 'E'), belt(5, 0, 'E'), belt(5, 1, 'W'), belt(4, 1, 'W'), belt(3, 1, 'W'), belt(2, 1, 'W')]
  ));
  A.ok(plan.errors.some(e => e.code === 'CHAIN_CYCLE' || e.code === 'CYCLE'), 'a gate-less dock loop is still refused');
}

/* joinPayload marks partial sets */
{
  const full = P.joinPayload([{ agentId: 'A', text: 'alpha' }, { agentId: 'B', text: 'beta' }], []);
  A.ok(/2 of 2 branches delivered/.test(full) && /BRANCH 1 of 2 — A/.test(full) && /BRANCH 2 of 2 — B/.test(full), 'a full join names every branch');
  A.ok(!/PARTIAL/.test(full), 'a full join is not marked partial');
  const part = P.joinPayload([{ agentId: 'A', text: 'alpha' }], ['B']);
  A.ok(/1 of 2 branches delivered/.test(part) && /PARTIAL: 1 branch never delivered/.test(part) && /\(B\)/.test(part), 'a partial join is marked and names the missing branch');
}

A.report('pipeline.join-loop');
