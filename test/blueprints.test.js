/* test/blueprints.test.js — STARTER-LINE blueprints (the beginner onramp, 2026-08-04).

   The contract under lock:
     1. Every blueprint stamps whole (machines + belts) as ONE undoable action — a single undo
        removes the entire line, a single redo restores it.
     2. A fresh stamp compiles to UNBOUND_BAY warns ONLY — no blockers, no BELT_BURIED, no
        ORPHAN_* / BAY_NOT_FED / FILTER_NO_DEFAULT / SPLIT_ONE_LANE surprises. The amber
        "NO AGENT — CLICK" nag is the built-in next step, and nothing else nags.
     3. With every bay bound, the plan is fully clean (zero errors), deployable (Pipeline.ok),
        and COMPLETE where the blueprint has an intake: reach[agent] true, liveTiles energized —
        the exact condition REFIT's auto-narrated first ride keys on.
     4. Placement is all-or-nothing on clear deck: off-deck, over a prop, or over an existing
        belt all refuse without half-stamping. */
'use strict';
const A = require('./_assert.js');
const WM = require('../frontend/app/worldmodel.js');
const P = require('../frontend/app/pipeline.js');

A.ok(Array.isArray(WM.BLUEPRINTS) && WM.BLUEPRINTS.length >= 9, 'the starter-line shelf ships (9+ blueprints)');
const IDS = WM.BLUEPRINTS.map(b => b.id);
for (const want of ['front_desk', 'research_line', 'revision_loop', 'sorting_office', 'triage_desk',
                    'parallel_crew', 'swarm_synthesis', 'second_opinion', 'ship_out',
                    'assembly_line', 'code_foundry', 'gauntlet',
                    'crucible', 'mission_control', 'deep_dive',
                    'allowance_desk', 'two_doors', 'load_balancer', 'fire_escape'])
  A.ok(IDS.indexOf(want) >= 0, 'blueprint catalog carries ' + want);
A.eq(IDS.length, new Set(IDS).size, 'blueprint ids are unique');
// THE LIBRARY: every blueprint names its section (build.js groups the shelf by grp — an unknown
// grp falls into the last section rather than vanishing, but the catalog itself must be complete)
for (const bp of WM.BLUEPRINTS)
  A.ok(['chain', 'sort', 'crew', 'gate', 'flagship'].indexOf(bp.grp) >= 0,
    bp.id + ': carries a known library group (got ' + bp.grp + ')');
/* THE DECLARED BOX IS THE OFFER. w/h drive the shelf chip, the NO ROOM copy and the candidate-field
   scan; a blueprint whose parts hang outside its box would be offered a spot it cannot take. */
for (const bp of WM.BLUEPRINTS) {
  for (const p of bp.props)
    A.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= bp.w && p.y + p.h <= bp.h,
      bp.id + ': machine ' + p.t + ' sits inside the declared ' + bp.w + '×' + bp.h + ' box');
  const at = {};
  for (const b of bp.belts) {
    A.ok(b.x >= 0 && b.y >= 0 && b.x < bp.w && b.y < bp.h, bp.id + ': belt inside the declared box');
    A.ok(!at[b.x + ',' + b.y], bp.id + ': no two belts on tile ' + b.x + ',' + b.y);
    at[b.x + ',' + b.y] = b.d;
  }
  // a MULTI-TILE machine may never sit on its own line (only a 1×1 junction rides the belt it routes)
  for (const p of bp.props) {
    if (p.w === 1 && p.h === 1) continue;
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++)
      A.ok(!at[x + ',' + y], bp.id + ': ' + p.t + ' does not bury its own belt at ' + x + ',' + y);
  }
}

// a fresh station with one big empty deck to stamp on (beside the seed room)
function freshFloor() {
  const s = WM.create();
  const r = s.addRoom({ kind: 'hab', rect: { x1: 30, y1: 0, x2: 69, y2: 14 } });   // 40 wide - THE DEEP DIVE is 31
  A.ok(r.ok, 'test deck placed');
  return s;
}
const AT = { x: 32, y: 2 };   // stamp origin — fully inside the test deck for every blueprint (max 31×10)

for (const bp of WM.BLUEPRINTS) {
  const s = freshFloor();
  const propsBefore = s.props().length, beltsBefore = s.belts().length;

  /* ---- validation is a read: a red ghost mutates nothing ---- */
  const off = s.canPlaceBlueprint(bp.id, 500, 500);
  A.ok(!off.ok && off.error === 'OFF_DECK', bp.id + ': off-deck placement refused (' + off.error + ')');
  A.eq(s.props().length, propsBefore, bp.id + ': refused validation did not mutate');

  /* ---- the stamp: one call, whole line ---- */
  const v = s.canPlaceBlueprint(bp.id, AT.x, AT.y);
  A.ok(v.ok, bp.id + ': clear-deck placement validates');
  const res = s.stampBlueprint(bp.id, AT.x, AT.y);
  A.ok(res.ok, bp.id + ': stamps');
  A.eq(s.props().length, propsBefore + bp.props.length, bp.id + ': every machine landed');
  A.eq(s.belts().length, beltsBefore + bp.belts.length, bp.id + ': every belt tile landed');

  /* ---- bays stamp UNBOUND; the filter stamps configured ---- */
  const bays = s.props().filter(p => p.t === 'bay');
  A.ok(bays.every(p => !p.agentId), bp.id + ': bays stamp unbound (the amber nag is the next step)');
  for (const f of s.props().filter(p => p.t === 'filter')) {
    A.ok(f.def, bp.id + ': stamped filter carries a default lane (never introduces FILTER_NO_DEFAULT)');
    A.ok(f.routes && Object.keys(f.routes).length, bp.id + ': stamped filter carries content routes');
  }

  /* ---- freshly stamped: the compiled plan is amber-only, and only UNBOUND_BAY ---- */
  let plan = P.compileRoutingPlan(s.projectGeometry());
  A.ok(P.ok(plan), bp.id + ': fresh stamp is deployable (no blocking errors)');
  const codes = plan.errors.map(e => e.code).sort();
  A.ok(plan.errors.every(e => e.warn && e.code === 'UNBOUND_BAY'),
    bp.id + ': fresh-stamp errors are UNBOUND_BAY warns only (got: ' + (codes.join(',') || 'none') + ')');
  A.eq(plan.errors.length, bays.length, bp.id + ': one UNBOUND_BAY warn per stamped bay');

  /* ---- bind every bay -> plan is fully clean + complete ---- */
  bays.forEach((b, i) => A.ok(s.assignPropAgent(b.id, 'crew' + i).ok, bp.id + ': bay ' + i + ' binds'));
  plan = P.compileRoutingPlan(s.projectGeometry());
  A.eq(plan.errors.length, 0, bp.id + ': bound plan has ZERO errors (got: '
    + plan.errors.map(e => e.code).join(',') + ')');
  A.ok(P.ok(plan), bp.id + ': bound plan deployable');
  const live = P.liveTiles(plan);
  A.ok(Object.keys(live).length > 0, bp.id + ': bound line energizes (liveTiles non-empty)');
  if (bp.props.some(p => p.t === 'intake')) {
    // the auto-first-ride condition: an intake lane actually REACHES a bound bay
    A.ok(Object.keys(plan.reach).some(a => plan.reach[a]), bp.id + ': intake line reaches a bound bay (reach true)');
  }

  /* ---- ONE undo slot: a single undo removes the whole line, a single redo restores it ---- */
  const boundProps = s.props().length, boundBelts = s.belts().length;
  const undosForBinds = bays.length;   // each bind burns one slot; the stamp itself burns exactly one more
  for (let i = 0; i < undosForBinds; i++) A.ok(s.undo().ok, bp.id + ': undo bind ' + i);
  A.ok(s.undo().ok, bp.id + ': undo the stamp');
  A.eq(s.props().length, propsBefore, bp.id + ': ONE undo removed every stamped machine');
  A.eq(s.belts().length, beltsBefore, bp.id + ': ONE undo removed every stamped belt');
  A.ok(s.redo().ok, bp.id + ': redo restores the stamp');
  A.eq(s.props().length, propsBefore + bp.props.length, bp.id + ': redo restored every machine');
  A.eq(s.belts().length, beltsBefore + bp.belts.length, bp.id + ': redo restored every belt');
  // restore binds so the doc round-trip below sees the full state
  for (let i = 0; i < undosForBinds; i++) s.redo();
  A.eq(s.props().length, boundProps, bp.id + ': redo chain restores the bound floor');
  A.eq(s.belts().length, boundBelts, bp.id + ': redo chain restores the belts');

  /* ---- clear-deck law: a second stamp over the first refuses whole ---- */
  const again = s.stampBlueprint(bp.id, AT.x, AT.y);
  A.ok(!again.ok, bp.id + ': stamping over the existing line refuses');
  A.eq(s.props().length, boundProps, bp.id + ': refused stamp added no props');
  A.eq(s.belts().length, boundBelts, bp.id + ': refused stamp added no belts');

  /* ---- persistence: the stamped line survives serialize/deserialize ---- */
  const back = WM.deserialize(s.serialize());
  A.eq(back.props().length, boundProps, bp.id + ': machines survive the save round-trip');
  A.eq(back.belts().length, boundBelts, bp.id + ': belts survive the save round-trip');
  const f2 = back.props().find(p => p.t === 'filter');
  if (f2) A.ok(f2.def && f2.routes, bp.id + ': filter config survives the save round-trip');
}

/* ---- a belt already on the deck blocks the stamp (never bury or overwrite a laid lane) ---- */
{
  const s = freshFloor();
  A.ok(s.setBelt(33, 3, 'E').ok, 'pre-existing belt laid');
  const v = s.canPlaceBlueprint('research_line', AT.x, AT.y);
  A.ok(!v.ok && v.error === 'ON_BELT', 'a stamp over an existing belt refuses with ON_BELT (got ' + v.error + ')');
}

/* ---- a blocking prop in the footprint blocks the stamp ---- */
{
  const s = freshFloor();
  A.ok(s.addProp({ t: 'crate', x: 34, y: 3, w: 1, h: 1, block: true }).ok, 'obstacle placed');
  const v = s.canPlaceBlueprint('research_line', AT.x, AT.y);
  A.ok(!v.ok, 'a stamp over a blocking prop refuses (' + v.error + ')');
}

/* ---- the machine each line EXISTS to teach actually compiles as that machine ----
   "zero errors" only proves the line is legal; these prove it is the line the card promises. */
function crewed(id) {
  const s = freshFloor();
  A.ok(s.stampBlueprint(id, AT.x, AT.y).ok, id + ': stamps for the mechanic check');
  s.props().filter(p => p.t === 'bay').forEach((b, i) => s.assignPropAgent(b.id, 'crew' + i));
  return P.compileRoutingPlan(s.projectGeometry());
}
{
  const plan = crewed('revision_loop');
  const g = Object.keys(plan.junctions).map(k => plan.junctions[k]).find(j => j.kind === 'loop');
  A.ok(g, 'revision_loop compiles a LOOP gate');
  A.eq(g.when, 'approved', 'the gate stamps verdict-gated (else every pass loops to the cap)');
  A.eq(g.max, 3, 'the gate stamps a 3-pass cap');
  A.ok(g.done && g.back && g.done !== g.back, 'the gate has BOTH a done lane and a back lane');
  A.eq(g.backTo, 'crew0', 'the back lane re-enters at the DRAFTER (the first dock)');
  // and the back lane RENDERS live: a working lane the floor draws frozen is the cold lie
  const live = P.liveTiles(plan);
  const p = Object.keys(plan.junctions).find(k => plan.junctions[k].kind === 'loop').split(',');
  const bx = +p[0] + (g.back === 'E' ? 1 : g.back === 'W' ? -1 : 0), by = +p[1] + (g.back === 'S' ? 1 : g.back === 'N' ? -1 : 0);
  A.ok(live[bx + ',' + by], 'the gate\'s back lane is energized, not frozen');
}
{
  const plan = crewed('swarm_synthesis');
  const js = Object.keys(plan.junctions).map(k => plan.junctions[k]);
  const split = js.find(j => j.kind === 'split'), join = js.find(j => j.kind === 'join');
  A.ok(split && split.fanout === true, 'RESEARCH SWARM splits as a FAN-OUT (every branch runs), not round-robin');
  A.ok(join && join.expect === 3, 'and its joiner waits for all three branches');
  A.eq(P.fanSiblings(plan, 'crew0').sort().join(','), 'crew1,crew2', 'each branch knows its siblings');
}
{
  const plan = crewed('second_opinion');
  const js = Object.keys(plan.junctions).map(k => plan.junctions[k]);
  A.ok(js.some(j => j.kind === 'split' && j.fanout === true), 'SECOND OPINION fans out to both docks');
  A.ok(js.some(j => j.kind === 'join' && j.expect === 2), 'and joins both takes into one crate');
}
{
  const plan = crewed('triage_desk');
  const f = Object.keys(plan.junctions).map(k => plan.junctions[k]).find(j => j.kind === 'filter');
  A.ok(f && f.def, 'TRIAGE DESK stamps a default lane');
  const Classify = require('../frontend/app/classify.js');
  const lanes = Object.assign({}, f.routes); lanes[Classify.getTag('')] = f.def;
  // every tag the classifier can EMIT must have a lane — a routed tag the classifier never emits is a dark dock
  for (const probe of ['refactor this .ts file', 'research the market for me', 'hello there'])
    A.ok(f.routes[Classify.getTag(probe)] || f.def, 'tag ' + Classify.getTag(probe) + ' has a lane');
  A.eq(Object.keys(f.routes).sort().join(','), 'code,research', 'the two routed lanes are the two non-default tags');
  A.ok(Object.keys(plan.junctions).map(k => plan.junctions[k]).some(j => j.kind === 'merge'),
    'and the three lanes funnel back through a MERGER to one outbox');
}

/* ---- the power tier's mechanics compile as the cards promise ---- */
{
  const plan = crewed('code_foundry');
  const js = Object.keys(plan.junctions).map(k => plan.junctions[k]);
  const f = js.find(j => j.kind === 'filter'), g = js.find(j => j.kind === 'loop');
  A.ok(f && f.routes.code && f.def, 'CODE FOUNDRY sorts code onto the reviewed lane, the rest to the default');
  A.ok(g && g.when === 'approved' && g.max === 3, 'and its gate stamps verdict-gated');
  A.eq(g.backTo, 'crew0', 'the back lane re-enters at the ENGINEER (rebuild, not re-review)');
  A.eq(plan.chains.crew0.next.join(','), 'crew1', 'engineer hands off to the reviewer');
}
{
  const plan = crewed('gauntlet');
  const js = Object.keys(plan.junctions).map(k => plan.junctions[k]);
  A.ok(js.some(j => j.kind === 'split' && j.fanout === true), 'THE GAUNTLET fans out (both crews run)');
  A.ok(js.some(j => j.kind === 'join' && j.expect === 2), 'the joiner waits for both takes');
  const g = js.find(j => j.kind === 'loop');
  A.ok(g && g.when === 'approved' && g.backTo === 'crew2',
    'the gate re-enters at the ANALYST — a failed review redoes the synthesis, never the crews');
  A.eq(plan.chains.crew2.next.join(','), 'crew3', 'analyst hands off to the reviewer');
}
{
  const plan = crewed('assembly_line');
  A.eq(['crew0', 'crew1', 'crew2', 'crew3'].map(a => plan.chains[a].next.join(',')).join('|'),
    'crew1|crew2|crew3|', 'ASSEMBLY LINE chains all four stages in order to the outbox');
  A.ok(plan.chains.crew3.outbox, 'and the last stage ships out');
}
/* the REVISION LOOP's back-lane column reaches the lane row — the gap Andrew circled (2026-08-29):
   the column stopped at (3,2), one tile short of the lane, and read as a broken line. */
{
  const bp = WM.BLUEPRINTS.find(b => b.id === 'revision_loop');
  A.ok(bp.belts.some(b => b.x === 3 && b.y === 3 && b.d === 'S'),
    'the back lane column runs all the way down to the lane row (no visual gap)');
}

/* ---- the flagships compile as the cards promise ---- */
{
  const plan = crewed('crucible');
  const gates = Object.keys(plan.junctions).map(k => plan.junctions[k]).filter(j => j.kind === 'loop');
  A.eq(gates.length, 2, 'THE CRUCIBLE compiles TWO loop gates');
  A.ok(gates.every(g => g.when === 'approved' && g.max === 3), 'both gates stamp verdict-gated');
  A.eq(gates.map(g => g.backTo).sort().join(','), 'crew0,crew2',
    'each gate re-enters its OWN stage — gate 1 the drafter, gate 2 the polisher');
  A.eq(['crew0', 'crew1', 'crew2', 'crew3'].map(a => plan.chains[a].next.join(',')).join('|'),
    'crew1|crew2|crew3|', 'the four stages chain in order to the outbox');
}
{
  const plan = crewed('mission_control');
  const js = Object.keys(plan.junctions).map(k => plan.junctions[k]);
  const f = js.find(j => j.kind === 'filter');
  A.ok(f && f.routes.code && f.routes.research && f.def, 'MISSION CONTROL routes all three classifier tags');
  A.ok(js.some(j => j.kind === 'merge'), 'and funnels every lane through one MERGER');
  A.eq(plan.chains.crew0.next.join(','), 'crew1', 'the code lane is two stages: engineer then reviewer');
  A.eq(plan.chains.crew3.next.join(','), 'crew4', 'the research lane is two stages: researcher then writer');
  A.ok(plan.chains.crew1.outbox && plan.chains.crew2.outbox && plan.chains.crew4.outbox,
    'every lane ships out by the one door');
}
{
  const plan = crewed('deep_dive');
  const js = Object.keys(plan.junctions).map(k => plan.junctions[k]);
  A.ok(js.some(j => j.kind === 'split' && j.fanout === true), 'THE DEEP DIVE fans out (all three researchers run)');
  A.ok(js.some(j => j.kind === 'join' && j.expect === 3), 'the joiner waits for all three');
  const g = js.find(j => j.kind === 'loop');
  A.ok(g && g.when === 'approved' && g.backTo === 'crew4',
    'the gate re-enters at the WRITER — a failed review rewrites, never re-runs the swarm');
  A.eq(plan.chains.crew3.next.join(','), 'crew4', 'analyst hands to the writer');
  A.eq(plan.chains.crew4.next.join(','), 'crew5', 'writer hands to the reviewer');
}
/* ---- the useful trio (2026-08-30) compiles as the cards promise ---- */
{
  // ALLOWANCE DESK: the INBOX stamps pre-labeled and pre-budgeted, through the shared normalizer,
  // and both survive the save round-trip (migrate whitelist)
  const s = freshFloor();
  A.ok(s.stampBlueprint('allowance_desk', AT.x, AT.y).ok, 'allowance_desk stamps');
  const it = s.props().find(p => p.t === 'intake');
  A.eq(it.label, 'ALLOWANCE', 'the door stamps named');
  A.ok(it.limits && it.limits.maxUsdPerDay === 5 && it.limits.maxUsdPerMessage === 1,
    'the door stamps with the $5/day + $1/message budget (got ' + JSON.stringify(it.limits) + ')');
  A.eq(it.limits.maxHops, 6, 'unset budget fields take the executor defaults via the ONE normalizer');
  const back = WM.deserialize(s.serialize()).props().find(p => p.t === 'intake');
  A.ok(back.label === 'ALLOWANCE' && back.limits && back.limits.maxUsdPerDay === 5,
    'name + budget survive the save round-trip');
}
{
  // TWO DOORS: two intakes = two sources, funneled by a merger to one desk
  const plan = crewed('two_doors');
  A.eq(plan.sources.length, 2, 'TWO DOORS compiles two intake sources');
  A.ok(Object.keys(plan.junctions).map(k => plan.junctions[k]).some(j => j.kind === 'merge'),
    'and funnels them through a MERGER');
  A.ok(plan.reach.crew0, 'both doors reach the one desk');
}
{
  // LOAD BALANCER: a joiner-less split stays ROUND-ROBIN (each job runs on ONE desk), and both
  // desks ship by the same door
  const plan = crewed('load_balancer');
  const js = Object.keys(plan.junctions).map(k => plan.junctions[k]);
  const sp = js.find(j => j.kind === 'split');
  A.ok(sp && !sp.fanout, 'the split is round-robin, NOT a fan-out (halved queue, not doubled spend)');
  A.ok(js.some(j => j.kind === 'merge'), 'both desks funnel through the MERGER');
  A.ok(plan.chains.crew0.outbox && plan.chains.crew1.outbox, 'both desks ship out by the one door');
}

{
  // FIRE ESCAPE: the gate compiles all THREE lanes, the fixer is fed by its gate (never BAY_NOT_FED),
  // and the escalation dock ships out on its own lane
  const plan = crewed('fire_escape');
  const g = Object.keys(plan.junctions).map(k => plan.junctions[k]).find(j => j.kind === 'loop');
  A.ok(g && g.done === 'E' && g.back === 'N' && g.esc === 'S', 'the gate carries done + back + escalation lanes');
  A.eq(g.when, 'approved', 'verdict-gated'); A.eq(g.backTo, 'crew0', 'back re-enters the drafter');
  A.eq(g.escTo, 'crew2', 'the escalation lane resolves to the FIXER');
  A.ok(!plan.errors.length, 'the crewed FIRE ESCAPE has zero errors (got: ' + plan.errors.map(e => e.code).join(',') + ')');
  A.ok(plan.chains.crew2.outbox, 'the fixer ships out by the same door');
}

/* every crewed line is FULLY energized — no belt on a working line may render frozen (the
   back-lane merge tile sat cold until liveTiles rode through the re-entry hookup, 2026-08-30) */
for (const bp of WM.BLUEPRINTS) {
  const plan = crewed(bp.id);
  const live = P.liveTiles(plan);
  // compare inside the plan's OWN frame (plan.belts is the compiled key->dir map, projectGeometry's
  // local frame — never world tiles); the station holds ONLY the stamped line, so every key is ours
  const cold = Object.keys(plan.belts).filter(k => !live[k]);
  A.eq(cold.length, 0, bp.id + ': every belt tile energizes when crewed (cold: ' + cold.join(' ') + ')');
}

A.report('blueprints');
