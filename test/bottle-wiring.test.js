/* node test/bottle-wiring.test.js — source-lock for R5 "BOTTLE A RUN" wiring across chat.js / app.js / index.html.

   BottleStore's gate + beat + denylist are behaviorally tested in bottlestore.test.js; recipes.mintFromRun in
   recipes.test.js. What those can't reach is the browser-flow WIRING (chat.js is DOM/streaming, not node-loadable):
   the 👍 verdict hand-off, the recipe-launch marker recorded in RUN_META, and the app.js dep contract. Like
   chat-runmeta.test.js / harness-internal.test.js, we lock those invariants by reading the source. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const chatSrc = fs.readFileSync(path.join(__dirname, '../frontend/app/chat.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(__dirname, '../frontend/app/app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '../frontend/index.html'), 'utf8');
const recipesSrc = fs.readFileSync(path.join(__dirname, '../frontend/app/recipes.js'), 'utf8');

/* ---------- chat.js: the verdict hand-off + the recipe-launch marker ---------- */
// rateWork hands its DIRECT (never-on-the-bus) verdict to BottleStore, alongside the ConfBeats hand-off.
const iRate = chatSrc.indexOf('function rateWork');
A.ok(iRate > 0, 'chat.js defines rateWork');
A.ok(/BottleStore\.onVerdict\(\s*runId\s*,\s*verdict\s*,\s*agentId/.test(chatSrc.slice(iRate, chatSrc.indexOf('const WORKRATE_COACH_KEY', iRate))),
  'rateWork hands the runId + verdict + agentId to BottleStore.onVerdict (the direct 👍 hand-off)');
A.ok(chatSrc.indexOf('BottleStore') > chatSrc.indexOf('ConfBeats.onFeedback'),
  'the bottle hand-off sits alongside the confidence-narrative hand-off (both fed by the same direct verdict)');

// RUN_META records the run's directive + recipe provenance at run start (onRunId), so BottleStore can gate truthfully.
const rec = /RUN_META\.set\(\s*id\s*,\s*\{([^}]*)\}/.exec(chatSrc);
A.ok(rec, 'RUN_META.set(id, {...}) records the run at start');
A.ok(/\bdirective\b/.test(rec[1]), 'the ledger entry captures the run directive (BottleStore templates from it)');
A.ok(/\bfromRecipe\b/.test(rec[1]), 'the ledger entry captures fromRecipe (a recipe-launched run is never re-bottled)');
// send() accepts the fromRecipe marker (additive opts), so launchRecipe can mark its runs.
A.ok(/const\s+fromRecipe\s*=\s*!!\(opts\s*&&\s*opts\.fromRecipe\)/.test(chatSrc),
  'send() reads opts.fromRecipe (the additive recipe-launch marker)');
// a read-only "did this run do real work" accessor is exposed (so a pure-chat run is never bottle-offered).
A.ok(/function\s+runDidWork\s*\(/.test(chatSrc), 'chat.js defines runDidWork (real-work gate)');
A.ok(/return\s*\{[^}]*\brunDidWork\b[^}]*\}/.test(chatSrc), 'runDidWork is exported on the Chat public API');

/* ---------- app.js: the launch marker + the dep contract + the editor route ---------- */
// Template launches remain recipe-marked; direct user tasks may earn a reusable recipe.
// direct-work-launch.test.js exercises both branches and the busy no-op behavior.
A.ok(/Chat\.send\(text,\s*\{\s*fromRecipe:\s*!\(source\s*&&\s*source\.direct\)/.test(appSrc),
  'launchRecipe distinguishes direct user requests from recipe launches');
// BottleStore is initialized with BOTH deps: openEditor (opens the R2 editor) + runInfo (the honest facts).
A.ok(/BottleStore\.init\(\{\s*openEditor:\s*openBottleEditor,\s*runInfo:\s*runBottleInfo\s*\}\)/.test(appSrc),
  'app.js inits BottleStore with openEditor + runInfo deps');
// runBottleInfo reads the honest run facts from RUN_META + runDidWork.
const iInfo = appSrc.indexOf('function runBottleInfo');
A.ok(iInfo > 0, 'app.js defines runBottleInfo');
const infoBody = appSrc.slice(iInfo, iInfo + 500);
A.ok(/Chat\.runMeta/.test(infoBody) && /Chat\.runDidWork/.test(infoBody),
  'runBottleInfo derives its facts from Chat.runMeta + Chat.runDidWork (no fabricated state)');
A.ok(/fromRecipe:\s*!!m\.fromRecipe/.test(infoBody) && /directive:\s*m\.directive/.test(infoBody),
  'runBottleInfo threads the recipe provenance + directive through to the gate');
// openBottleEditor opens the bay's RECIPES tab, seeding the R2 editor with the bottled proposal (additive ctx seed).
const iOpen = appSrc.indexOf('function openBottleEditor');
A.ok(iOpen > 0, 'app.js defines openBottleEditor');
const openBody = appSrc.slice(iOpen, iOpen + 500);
A.ok(/Marketplace\.open\(/.test(openBody) && /tab:\s*'recipes'/.test(openBody), 'openBottleEditor opens the bay on the RECIPES tab');
A.ok(/recipeMint:\s*proposal/.test(openBody), 'openBottleEditor seeds the editor via ctx.recipeMint (the additive pre-fill seed)');
// a fresh hero re-earns every offer (reset alongside the other own-key stores).
A.ok(/BottleStore\.reset\(\)/.test(appSrc), 'app.js resets BottleStore on new-hero (own-key denylist clears)');

/* ---------- recipes.js: mintFromRun + sourceRunId are exported/present ---------- */
A.ok(/mintFromRun/.test(recipesSrc) && /\bsourceRunId\b/.test(recipesSrc),
  'recipes.js carries mintFromRun + the sourceRunId provenance field');

/* ---------- index.html: bottlestore.js loads after recipes.js, before app.js ---------- */
const iRecipes = htmlSrc.indexOf('app/recipes.js');
const iBottle = htmlSrc.indexOf('app/bottlestore.js');
const iApp = htmlSrc.indexOf('app/app.js');
A.ok(iBottle > 0, 'index.html includes bottlestore.js');
A.ok(iRecipes > 0 && iRecipes < iBottle, 'bottlestore.js loads AFTER recipes.js (it calls Recipes.mintFromRun)');
A.ok(iBottle < iApp, 'bottlestore.js loads BEFORE app.js (app.js inits it)');

A.report('bottle-wiring.test');
