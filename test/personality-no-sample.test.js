/* node test/personality-no-sample.test.js — personality selection never shows an example message (source-locks).

   Andrew's spec (2026-07-20): picking a personality must NOT display a sample reply. The quote was removed
   from BOTH selection surfaces (genesis create screen + dossier PERSONALITY card). personas.js keeps
   sampleVoiceReply as DATA because voice.js pre-warms the TTS cache with it (never rendered), and cardLine
   remains defined but must stay unrendered. This lock keeps a future surface from quietly reintroducing
   the example message anywhere in the UI. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const APP_DIR = path.join(__dirname, '../frontend/app');
// The ONLY files allowed to mention the sample fields: personas.js (defines them) and voice.js (TTS
// cache pre-warm — audio plumbing, not a rendered example).
const ALLOWED = new Set(['personas.js', 'voice.js']);

for (const f of fs.readdirSync(APP_DIR)) {
  if (!f.endsWith('.js') || ALLOWED.has(f)) continue;
  const src = fs.readFileSync(path.join(APP_DIR, f), 'utf8');
  A.ok(!/sampleVoiceReply/.test(src), f + ' never renders sampleVoiceReply (personality example messages are gone)');
  A.ok(!/\bcardLine\b/.test(src), f + ' never renders cardLine');
}

// the two surfaces that used to show the quote stay quote-free
const appSrc = fs.readFileSync(path.join(APP_DIR, 'app.js'), 'utf8');
const stationSrc = fs.readFileSync(path.join(APP_DIR, 'stationui.js'), 'utf8');
{
  const start = appSrc.indexOf('function renderVoicePreview');
  A.ok(start > 0, 'app.js still has renderVoicePreview (the tuned: readout for resumed agents)');
  const body = appSrc.slice(start, appSrc.indexOf('function initConnect'));
  A.ok(!/vp-quote/.test(body), 'genesis voice preview renders no quote block');
}
{
  const start = stationSrc.indexOf('function personaCard');
  A.ok(start > 0, 'stationui.js still has the dossier personaCard');
  const body = stationSrc.slice(start, start + 2000);
  A.ok(!/vp-quote|ov-vpreview/.test(body), 'dossier PERSONALITY card renders no example preview');
}

// voice.js's use stays what it is: cache pre-warm, not UI
const voiceSrc = fs.readFileSync(path.join(APP_DIR, 'voice.js'), 'utf8');
A.ok(/prewarm/i.test(voiceSrc.slice(Math.max(0, voiceSrc.indexOf('sampleVoiceReply') - 1500), voiceSrc.indexOf('sampleVoiceReply'))),
  "voice.js's sampleVoiceReply use is the TTS pre-warm (if this moves into UI rendering, remove it instead)");

A.report('personality-no-sample.test');
