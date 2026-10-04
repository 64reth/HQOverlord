/* test/prop-starter-shelf.test.js — locks the STARTER shelf (the pinned essentials above the
   ⚙ SYSTEMS drawers). The shelf exists for the user who SKIPPED the tutorial: it must keep
   naming a real, working starter set, and it must keep agreeing with the set the tutorial
   route teaches — two onboarding paths teaching two different "essential" lists is exactly
   the beginner confusion the shelf was built to remove. */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');
const PS = require('../frontend/app/propsprites.js');

const STARTER = PS.STARTER;

/* ---- 1. the list is real: exported, non-empty, shelf-sized, no duplicates ---- */
A.ok(Array.isArray(STARTER) && STARTER.length >= 4 && STARTER.length <= 8,
  'STARTER is a shelf, not a drawer (4-8 ids, got ' + (STARTER && STARTER.length) + ')');
A.ok(new Set(STARTER).size === STARTER.length, 'STARTER has no duplicate ids');

/* ---- 2. every id is a placeable FUNCTIONAL catalog prop (a decor pick here would be a lie) ---- */
for (const id of STARTER) {
  const c = PS.spec(id);
  A.ok(!!c, 'STARTER id "' + id + '" exists in the CATALOG');
  A.ok(c && c.tier === 'functional', 'STARTER "' + id + '" is tier functional');
  A.ok(PS.has(id), 'STARTER "' + id + '" has a draw fn (renders in the shelf preview)');
}

/* ---- 3. the shelf is CAPABILITY GRANTS ONLY: the tutorial kit + studio ----
   Andrew's scope call (2026-08-18): no BAY (conveyor equipment, not a necessity) and no seat
   workstation — every tile must be a prop that grants a real power, because the shelf's whole
   claim is "these are the powers an agent needs" and its satisfied-tick logic keys on the grant.
   tutorial.js KIT_SPEC is the other authority on "what a first agent needs"; read its prop ids
   from source (it is a browser script, not a require()-able module) and require every one to be
   on the shelf, so the two onboarding routes can never drift apart silently. */
const WM = require('../frontend/app/worldmodel.js');
A.ok(!STARTER.includes('bay'), 'STARTER has NO bay (conveyor gear, not a necessity)');
A.ok(!STARTER.some(id => { const c = PS.spec(id); return c && c.seat; }),
  'STARTER has no seat workstation');
A.ok(STARTER.includes('studio'), 'STARTER carries the STUDIO (the power users miss)');
for (const id of STARTER) {
  A.ok(!!(WM.grantLabelForProp && WM.grantLabelForProp(id)),
    'STARTER "' + id + '" grants a real power (satisfied-tick keys on this)');
}
const tut = fs.readFileSync(path.join(__dirname, '../frontend/app/tutorial.js'), 'utf8');
const kitBlock = tut.match(/KIT_SPEC = \[([\s\S]*?)\]/);
A.ok(!!kitBlock, 'tutorial.js still declares KIT_SPEC');
const kitProps = [...kitBlock[1].matchAll(/prop:\s*'([^']+)'/g)].map(m => m[1]);
A.ok(kitProps.length >= 3, 'KIT_SPEC names its props (got ' + kitProps.length + ')');
for (const p of kitProps) {
  A.ok(STARTER.includes(p), 'tutorial kit prop "' + p + '" is on the STARTER shelf');
}

/* ---- 4. the card actually renders it, from THIS list ----
   Presentation (Andrew 2026-08-18): the STARTER checklist REPLACED the STATION ORDERS card —
   the floating REFIT card slot, not a shelf inside the prop palette (that v1/v2 shelf is gone).
   The deep locks on the card's mechanics (grant-keyed done, self-retire without burning the
   dismiss key) live in refit-card-stack.test.js next to the rest of the card-slot laws. */
const build = fs.readFileSync(path.join(__dirname, '../frontend/app/build.js'), 'utf8');
A.ok(/PropSprites\.STARTER/.test(build), 'build.js reads PropSprites.STARTER (no second list)');
A.ok(/▸ EQUIPMENT BY PURPOSE/.test(build), 'the existing card explains abilities without implying a mandatory kit');
A.ok(/Choose what your task needs/.test(build), 'equipment follows the task rather than a completion checklist');
A.ok(!/refit-startergrid/.test(build), 'the retired palette shelf is not still half-rendered');

A.report('prop-starter-shelf');
