/* node test/g3btrophy.test.js — the TROPHY CASE prop chain (G3b), cloning g1bprops.test.js's approach.

   The TROPHY CASE is functional-but-NOT-capability (the workstation-model rule): it lives in its OWN COMMAND
   category and must grant NO tools, ever (the tripwire — a trophy surface can never inflate capability or XP).
   This locks the whole seam end to end: catalog entry → NO CAP_PROP_MAP entry (grants nothing) → the click
   routing (world.js hit-test → app.js → StationUI.openTerm('trophies')) → the sprite pin feed. A break at ANY
   link (a rename, an accidental capability grant) fails here, not in a demo. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const WM = require('../frontend/app/worldmodel.js');
const PS = require('../frontend/app/propsprites.js');

/* ================= catalog: functional-but-NOT-capability, its OWN category ================= */
const tc = PS.spec('trophycase');
A.ok(tc, 'the catalog has a TROPHY CASE prop');
A.eq(tc.tier, 'functional', 'TROPHY CASE is a SYSTEMS-tier prop (it does something: projects real achievements + opens the surface)');
A.eq(tc.cat, 'command', 'TROPHY CASE shares the COMMAND category with the MISSION BOARD (functional-but-not-capability, never mixed into capability/cosmetics)');
A.ok(['workstation', 'workflow', 'capability', 'isolation'].indexOf(tc.cat) < 0, 'that category is none of the tool-granting functional ones');
A.ok(PS.has('trophycase'), 'TROPHY CASE has a real draw function (palette preview + floor render work)');

/* ================= the tripwire: it grants NOTHING (no XP, no tools) ================= */
A.eq(WM.CAP_PROP_MAP.trophycase, undefined, 'TROPHY CASE grants NO capability (CAP_PROP_MAP has no entry) — the tripwire');
A.eq(WM.grantLabelForProp('trophycase'), null, '…and no power word (it is a projection of the past, never a grant)');
A.eq(WM.capForProp ? WM.capForProp('trophycase') : null, null, 'station.capForProp knows it grants nothing');
{
  const m = WM.create();
  m.addProp({ t: 'bay', x: 2, y: 2, w: 2, h: 2, agentId: 'a1' });
  const put = m.addProp({ t: 'trophycase', x: 8, y: 2, w: tc.w, h: tc.h });
  A.ok(put.ok, 'the TROPHY CASE places on the floor');
  A.eq(m.bayObjects('a1').length, 0, 'a placed TROPHY CASE grants nothing to the room\'s agent — it only remembers');
}

/* ================= the click + feed wiring (browser flow — source locks) ================= */
const worldSrc = fs.readFileSync(path.join(__dirname, '../frontend/app/world.js'), 'utf8');
A.ok(/function trophyCaseAt\(/.test(worldSrc), 'world.js hit-tests the TROPHY CASE (the MISSION BOARD click seam, cloned)');
A.ok(/setOnTrophyCase/.test(worldSrc), 'world.js exposes the click callback');
A.ok(/setTrophyCount/.test(worldSrc), 'world.js feeds the live earned-trophy count to the sprite (real completions, never invented)');

const appSrc = fs.readFileSync(path.join(__dirname, '../frontend/app/app.js'), 'utf8');
A.ok(/setOnTrophyCase/.test(appSrc) && /openTerm\('trophies'\)/.test(appSrc), 'app.js routes the case click to the TROPHY surface panel');
A.ok(/SeedReuseStore\.init/.test(appSrc), 'app.js arms the seed-reuse aggregate store');
A.ok(/SeedReuseStore\.reset/.test(appSrc), '…and resets it on new-hero (a fresh Commander inherits no tool-usage tally)');

const psSrc = fs.readFileSync(path.join(__dirname, '../frontend/app/propsprites.js'), 'utf8');
A.ok(/setTrophyCount/.test(psSrc) && /F\.trophycase\s*=/.test(psSrc), 'propsprites carries the trophy feed + the case sprite');

const uiSrc = fs.readFileSync(path.join(__dirname, '../frontend/app/windows/trophies.js'), 'utf8');   // TROPHY window extracted from stationui.js (BUILDERS split)
A.ok(/registerWindow\('trophies',\s*'TROPHY CASE',\s*buildTrophies/.test(uiSrc) && /function buildTrophies\(/.test(uiSrc), 'the TROPHY surface builder registers its window entry (StationUI.registerWindow)');
A.ok(/Trophies\.build/.test(uiSrc), '…and it projects through the pure Trophies engine (real completions only)');
A.ok(/SeedReuseStore\.livingTools/.test(uiSrc), '…and reads the living-tools shelf from the seed-reuse aggregate');
A.ok(/date unknown/.test(uiSrc), 'the surface renders "date unknown" (never a fabricated 1969) for an undated completion');

const rsSrc = fs.readFileSync(path.join(__dirname, '../frontend/app/returnstore.js'), 'utf8');
A.ok(/SeedReuseStore\.recordAnnotatedRows/.test(rsSrc), 'the digest feeds provenance-matched rows into the seed-reuse aggregate');

/* ================= no-XP tripwire: nothing in the trophy seam mints XP ================= */
A.ok(!/XpStore|applyEvent|mintXp|awardXp/.test(fs.readFileSync(path.join(__dirname, '../frontend/app/trophies.js'), 'utf8')),
  'the pure Trophies engine never touches XP (quests/trophies never inflate the ladder — the XP law)');
A.ok(!/XpStore|applyEvent|awardXp/.test(fs.readFileSync(path.join(__dirname, '../frontend/app/seedreuse.js'), 'utf8')),
  'the seed-reuse aggregate never mints XP');

A.report('g3btrophy.test');
