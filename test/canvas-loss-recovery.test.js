/* node test/canvas-loss-recovery.test.js — THE STATION MAY NEVER SILENTLY GO BLACK.

   Reported by Andrew on 0.10.2: "the station randomly went black and the only thing that appears
   is the agents, and the props." That symptom names its cause. Every layer that is NOT redrawn
   from scratch each frame lives in an offscreen <canvas> — the station bake (floors/walls/hull +
   lightmap), the SpaceBG sky, the Terrain ground. Agents draw from <img> sprite sheets and props
   draw procedurally, so those two rebuild every frame, and those two are exactly what survived.

   A GPU/driver reset (sleep-wake, display or DPI change, a TDR, the WebView's GPU process
   restarting) zeroes the backing store of every accelerated 2D canvas: the objects survive at
   full size, the PIXELS do not, and nothing throws. `cache` stays a well-formed bake, frameBody
   blits a transparent plate every frame, and it NEVER heals — a bake only re-runs when the
   geometry changes, and no geometry changed.

   Measured live in the seeded app (worktree agent/black-station, 808x752 stage) by zeroing the
   plates in place via World._dbgLoseCanvases():
       healthy frame   86.15% non-black px, mean luma 26.44
       plates zeroed   15.88% non-black px, mean luma  6.93   <- the reported frame
       after watchdog  86.18% non-black px, mean luma 26.23
   The 15.88% residue is precisely props + agents + HUD chrome standing in a black void.

   world.js / spacebg.js / terrain.js are browser-flow IIFEs with no module.exports (the
   world-setskin.test.js house pattern), so the wiring is SOURCE-LOCKED here and the pixel proof
   above is the live half. COMMENTS ARE STRIPPED BEFORE MATCHING — this file describes the very
   identifiers it asserts, and a test that passes on its own prose proves nothing. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const app = f => fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', f), 'utf8');

/* Strip block + line comments so every assertion below binds to real CODE. Naive on purpose:
   it only needs to be safe for these three files, and it errs toward deleting (a stripper that
   ate too much would make assertions FAIL, never falsely pass). String literals are preserved
   so quoted event names ('contextlost') still match. */
function stripComments(src) {
  let out = '', i = 0, n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; out += ' '; continue; }
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; out += ' '; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += c; i++;
      while (i < n) { const s = src[i]; out += s; i++; if (s === '\\') { out += src[i]; i++; continue; } if (s === q) break; }
      continue;
    }
    out += c; i++;
  }
  return out;
}

const worldSrc = stripComments(app('world.js'));
const spaceSrc = stripComments(app('spacebg.js'));
const terrSrc = stripComments(app('terrain.js'));

// the stripper itself must work, or every assertion below is vacuous
A.ok(!/THE STATION MAY NEVER SILENTLY GO BLACK/.test(stripComments('/* THE STATION MAY NEVER SILENTLY GO BLACK */ var x = 1;')),
  'stripComments removes block comments (assertions bind to code, not prose)');
A.ok(/var x = 1/.test(stripComments('// note\nvar x = 1;')), 'stripComments keeps the code around a line comment');
A.ok(/'contextlost'/.test(stripComments("el.addEventListener('contextlost', f); /* c */")),
  'stripComments preserves string literals (quoted event names still match)');

/* ---- 1. THE CACHE OWNERS CAN BE REBUILT AT ALL ----
   This is the structural gap that made the black station permanent: SpaceBG and Terrain built
   their plates once and exposed NO way to drop them, so a blanked sky/ground could never come
   back for the life of the page. */
A.ok(/function invalidate\(\)\s*\{[^}]*\bst = null\b/.test(spaceSrc),
  'SpaceBG.invalidate drops the built sky state so the next draw re-lays it');
A.ok(/function invalidate\(\)\s*\{[^}]*\bbuiltId = ''/.test(spaceSrc),
  'SpaceBG.invalidate clears the build key (id alone gates the rebuild path)');
A.ok(/return \{[^}]*\binvalidate\b[^}]*\}/.test(spaceSrc), 'SpaceBG exports invalidate');

A.ok(/function invalidate\(\)\s*\{[^}]*\bst = null\b/.test(terrSrc),
  'Terrain.invalidate drops the built ground state (and with it the cached CanvasPatterns)');
A.ok(/function invalidate\(\)\s*\{[^}]*\bbuiltId = ''/.test(terrSrc), 'Terrain.invalidate clears the build key');
A.ok(/return \{[^}]*\binvalidate\b[^}]*\}/.test(terrSrc), 'Terrain exports invalidate');

/* ---- 2. THE SENTINEL: a pixel the bake painted opaque, recorded on every bake ---- */
A.ok(/function rebake\(\)\s*\{[\s\S]*?recordBakeProbe\(\);[\s\S]*?\n  \}/.test(worldSrc),
  'every rebake re-records the loss sentinel (a stale probe would point into the old plate)');
A.ok(/function recordBakeProbe\(\)/.test(worldSrc), 'world.js defines recordBakeProbe');
A.ok(/readAlpha1\([^)]*\) > 0/.test(worldSrc),
  'the sentinel is chosen by ALPHA — the one property a zeroed backing store cannot fake');
A.ok(/function bakeWentBlank\(\)[\s\S]{0,400}?readAlpha1\([^)]*\) === 0/.test(worldSrc),
  'bakeWentBlank reports loss when that opaque pixel has gone transparent');
/* THE READBACK LAW (2026-08-26 lag escape, shipped in v0.10.10): getImageData on a canvas the
   frame loop draws trips Chromium's readback heuristic and silently drops THAT canvas to
   software rasterization — app-wide lag that builds over minutes and resets only on relaunch.
   Both watchdogs must read their one pixel through the dedicated willReadFrequently probe
   canvas (readAlpha1), never from the bake plate or the visible stage directly. */
A.ok(/function readAlpha1\(/.test(worldSrc), 'world.js defines the readAlpha1 probe-canvas reader');
A.ok(/getContext\('2d', \{ willReadFrequently: true \}\)/.test(worldSrc),
  'the probe canvas opts into willReadFrequently — IT is the only canvas allowed to be read repeatedly');
A.ok(/globalCompositeOperation = 'copy'/.test(worldSrc),
  "the probe blits with 'copy' so a stale opaque probe pixel can never mask a fresh loss");
{
  // every getImageData must name one of the dedicated CPU-side contexts (sentinelCtx probe,
  // pctx GL sample probe, _warpCtx LUT builder) — a bare/ctx./baseCv-derived read is the bug
  const reads = worldSrc.match(/[\w$.]*getImageData\(/g) || [];
  const rogue = reads.filter(r => !/^(sentinelCtx|pctx|_warpCtx)\.getImageData\($/.test(r));
  A.ok(reads.length >= 1 && rogue.length === 0,
    'every world.js getImageData reads a dedicated probe/offscreen context — NEVER the stage or the bake plate (rogue: ' + rogue.join(', ') + ')');
}
A.ok(/catch \(e\) \{ probeOff = true;/.test(worldSrc),
  'an unreadable (tainted) canvas disables the probe instead of throwing every second');
A.ok(/if \(W < 2 \|\| H < 2\) return;/.test(worldSrc),
  'a 1x1 blank bake records no sentinel — the watchdog stays inert rather than rebaking forever');

/* ---- 3. THE WATCHDOG runs in the frame, and the SAME frame repaints ----
   Detecting the loss one frame and healing it the next would still flash a black station. */
const fb = /function frameBody\(now\)\s*\{([\s\S]*?)\n    ctx\.setTransform\(1, 0, 0, 1, 0, 0\);/.exec(worldSrc);
A.ok(fb, 'world.js still defines frameBody with the pre-draw block');
const fbHead = fb ? fb[1] : '';
A.ok(/watchCanvasLoss\(now\);/.test(fbHead), 'frameBody runs the canvas-loss watchdog before drawing');
A.ok(/watchCanvasLoss\(now\);[\s\S]*?if \(bakeDirty \|\| !cache\) rebake\(\);/.test(fbHead),
  'a detected loss re-bakes in the SAME frame (no black flash between detect and repaint)');
A.ok(/function watchCanvasLoss\(now\)[\s\S]{0,300}?now - lastProbeAt < PROBE_MS/.test(worldSrc),
  'the sentinel read is throttled (one 1x1 readback per second, not per frame)');

/* ---- 4. RECOVERY rebuilds ALL THREE cache owners ----
   The bake is only what the watchdog can SEE. The same reset blanked the sky and the ground, so
   healing the floor alone would leave a starless void behind a correct station. */
const rec = /function recoverLostCanvases\(now, why\)\s*\{([\s\S]*?)\n  \}/.exec(worldSrc);
A.ok(rec, 'world.js defines recoverLostCanvases');
const recBody = rec ? rec[1] : '';
A.ok(/bakeDirty = true/.test(recBody), 'recovery marks the bake dirty');
A.ok(/SpaceBG\.invalidate\(\)/.test(recBody), 'recovery rebuilds the sky too');
A.ok(/Terrain\.invalidate\(\)/.test(recBody), 'recovery rebuilds the ground too');
A.ok(!/\bcache = null\b/.test(recBody),
  'recovery never nulls the bake — if rederive cannot produce geometry, the last good bake still beats an empty stage');
/* THE BACKOFF MUST NOT BE A FLAT COOLDOWN. A plain `now - lastRecoverAt < COOLDOWN` was the
   obvious guard and it was wrong — caught by wiping the plates five times in a row live, where
   the cooldown earned by the FIRST loss made the station sit black through the next one
   (cycles 2/4/5 came back 14.7%/10.1%/11.4% non-black with the sentinel still reading blank).
   Only a recovery that changed NOTHING is evidence of a broken GPU worth rate-limiting. */
A.ok(/futileRecoveries > 0 && now - lastRecoverAt < RECOVER_COOLDOWN_MS/.test(recBody),
  'recovery backs off ONLY after a futile recovery — a healthy GPU heals the next loss instantly');
A.ok(/futileRecoveries = bakeProbe \? 0 : futileRecoveries \+ 1/.test(worldSrc),
  'a recovery that restored an opaque bake clears the futile count (success is proof the GPU is fine)');
A.ok(/if \(!bakeWentBlank\(\)\) \{ futileRecoveries = 0; return; \}/.test(worldSrc),
  'a healthy sentinel read clears the futile count, so an old broken spell never gates a new loss');
A.ok(/if \(!recoverLostCanvases\([\s\S]{0,80}?\) return;\s*rebake\(\);/.test(worldSrc),
  'the watchdog rebakes inside the same call, so the fresh plate is testable immediately');
A.ok(/const PROBE_MS = (\d+)/.test(worldSrc) && Number(/const PROBE_MS = (\d+)/.exec(worldSrc)[1]) <= 250,
  'the sentinel is read at least 4x a second — a lost frame is a flicker, never a black station');

/* ---- 5. THE BROWSER-EVENT PATH: belt to the watchdog's braces ----
   preventDefault() on 'contextlost' is what ASKS for restoration; without it 'contextrestored'
   never fires and the stage stays dead. */
A.ok(/addEventListener\('contextlost'/.test(worldSrc), 'world.js listens for 2d canvas context loss');
A.ok(/addEventListener\('contextlost'[\s\S]{0,200}?ev\.preventDefault\(\)/.test(worldSrc),
  "'contextlost' calls preventDefault — the request for restoration");
A.ok(/addEventListener\('contextrestored'[\s\S]{0,300}?recoverLostCanvases\(/.test(worldSrc),
  "'contextrestored' runs the same recovery");
A.ok(/addEventListener\('contextrestored'[\s\S]{0,300}?lastRecoverAt = 0/.test(worldSrc),
  'an explicit restore beats the recovery cooldown (the browser told us; do not wait)');

/* ---- 6. COMING BACK FROM THE BACKGROUND ----
   A GPU reset usually lands while the app is hidden (machine slept, display changed), so the
   first frame back is exactly when the damage shows. */
A.ok(/visibilitychange[\s\S]{0,160}?lastProbeAt = 0/.test(worldSrc),
  'becoming visible re-arms the sentinel for the next frame');
A.ok(/addEventListener\('focus'[\s\S]{0,120}?lastProbeAt = 0/.test(worldSrc),
  'regaining focus re-arms the sentinel');

/* ---- 7. THE FAILURE STAYS REPRODUCIBLE ----
   There is no JS API to lose a 2D context on demand, so the only way to keep this honest is a
   hook that reproduces its EFFECT: zero the plates in place, objects and sizes intact. */
A.ok(/_dbgLoseCanvases/.test(worldSrc) && /return \{[\s\S]*\b_dbgLoseCanvases\b/.test(worldSrc),
  'World exports _dbgLoseCanvases so the black station can be reproduced on demand');
A.ok(/_dbgCanvasLoss/.test(worldSrc) && /return \{[\s\S]*\b_dbgCanvasLoss\b/.test(worldSrc),
  'World exports _dbgCanvasLoss so a verify script can assert RECOVERY, not just returned pixels');
A.ok(/function _dbgLosePixels\(\)/.test(spaceSrc), 'SpaceBG can zero its plates in place for the repro');
A.ok(/function _dbgLosePixels\(\)/.test(terrSrc), 'Terrain can zero its plates in place for the repro');
A.ok(/clearRect\(0, 0, [a-z]+\.width, [a-z]+\.height\)/.test(spaceSrc),
  'the repro CLEARS pixels rather than resizing — a resize would be a different bug than the reported one');

A.report('canvas-loss-recovery');
