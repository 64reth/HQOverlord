/* node test/channels.setup-guide.test.js — the CHANNELS setup guide must be VISIBLE on a cold card.

   The defect this locks (F7 of docs/CONNECTOR_UX_PLAN.md): every platform card rendered its SETUP GUIDE
   as a collapsed <details>, so a first-time Commander saw only "BOT TOKEN — FROM @BOTFATHER" and an empty
   input. The steps that tell you where the token comes from existed and were good — they were folded away
   at exactly the moment they were needed, which is the whole reason people report "I didn't know I had to
   go add it manually."

   Source-lock (the window is browser-only DOM code with no importable seam), asserting both halves:
   the guide starts OPEN, and it folds only once the platform is really CONFIGURED — not merely
   `connected`, because a saved-but-offline platform is set up while a cold card still needs its steps.
   Plus the website/app generated-mirror parity assertion (website/app is a mirror; see
   website-app-generated-mirror). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const REL = path.join('frontend', 'app', 'windows', 'messaging.js');
const ui = fs.readFileSync(path.join(root, REL), 'utf8');

// ---- A. the card renders the guide already open ----
A.ok(/<details class="ch-setup" open data-autofold="1">/.test(ui),
  'the SETUP GUIDE <details> is rendered open, with the one-shot autofold flag');
A.ok(/<summary>SETUP GUIDE<\/summary>/.test(ui), 'the guide still carries its SETUP GUIDE summary');

// ---- B. while untouched, it tracks `configured` in BOTH directions, never `conn` ----
A.ok(/dataset\.autofold === '1'\) guide\.open = !configured/.test(ui),
  'the untouched guide closes for CONFIGURED and reopens when the card becomes cold again');
A.ok(!/autofold[\s\S]{0,60}&& conn\b/.test(ui),
  'the fold is not keyed off `conn` — connected-vs-configured are different truths here');

// ---- C. one-shot: only activating the summary takes the flag away for good ----
A.ok(/querySelector\('summary'\)/.test(ui), 'the hand-toggle detector is scoped to the guide summary');
A.ok(/summary\.addEventListener\('click', \(\) => \{ delete guide\.dataset\.autofold; \}\)/.test(ui),
  'a pointer/keyboard summary activation clears the autofold flag so the UI never fights the Commander');
A.ok(!/guide\.addEventListener\('toggle'/.test(ui),
  'programmatic guide.open changes cannot consume the human-override flag');
A.ok(/dataset\.foldWired/.test(ui), 'the summary listener is installed once, not on every paint');

// ---- D. website/app is a generated mirror and must carry the same fix ----
{
  const mirror = path.join(root, 'website', 'app', 'app', 'windows', 'messaging.js');
  const m = fs.readFileSync(mirror, 'utf8');
  A.ok(/<details class="ch-setup" open data-autofold="1">/.test(m),
    'the website/app mirror carries the open SETUP GUIDE (run npm run sync:website)');
  A.ok(/dataset\.autofold === '1'\) guide\.open = !configured/.test(m),
    'the website/app mirror carries the reversible configured-keyed auto-fold');
  A.ok(/summary\.addEventListener\('click'/.test(m),
    'the website/app mirror preserves the human-only override seam');
}

A.report();
