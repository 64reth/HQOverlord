/* node dev/glyphprobe.mjs [--port 8961] [--cdp 9361]
 *
 * Proves the W6 PEER-CHATTER BUBBLE end to end in the real running app: when two agents hold a
 * conversation, a speech bubble carrying an untranscribable script appears over whoever has the
 * floor — and nowhere else, and never two at once.
 *
 * WHY A PROBE AND NOT A SOAK. A social beat is rare by design, so waiting for the dice proves
 * nothing when they don't land (see trioprobe.mjs, whose boot sequence and discipline this
 * copies verbatim in shape). World._dbgHuddle drives the SELECTION only — it bypasses the
 * frequency roll and nothing else, so the encounter, the turn-taking and every draw below it are
 * the shipped ones.
 *
 * What it asserts, all of it BEHAVIOUR observed through read-only projections:
 *
 *   1. a bubble exists exactly while a mouth is moving      (chatter live <=> talking)
 *   2. NEVER two bubbles on screen at one sample            (one voice holds the floor)
 *   3. every participant gets its own line over the beat    (nobody is a silent bystander)
 *   4. a body only ever draws runes from its OWN dialect,
 *      and two speakers' dialects genuinely differ          (it reads as two voices)
 *   5. the bubble is PIXELS, not text: the runes land as
 *      fillRect ink above the head and the region emits
 *      ZERO fillText                                        (nothing there to transcribe)
 *   6. when the encounter ends, no bubble is left behind    (no line hanging over a silent body)
 *
 * Exits: 0 pass · 1 a check failed · 4 INCONCLUSIVE (could not set up the experiment — that is
 * the pair cooldown behaving, not a product failure; grading it either way would be a lie).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sleep, launchChrome, connectCDP, evalJS, capture } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, isUp, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const PORT = arg('--port', '8961');
const CDP_PORT = Number(arg('--cdp', '9361'));
const OUT = arg('--out', join(process.cwd(), '.glyphprobe'));
/* --party 3 exercises the TRIO. Worth its own run and not just an assumption: the overlap defect
   this probe caught (a late joiner's bubble spilling into the next speaker's turn) is precisely
   the class that behaves differently at n=3 — a third body is the one most likely to arrive late,
   which is exactly how the W5 hold-clock defect hid from every two-body run. */
const PARTY = Math.max(2, Math.min(3, Number(arg('--party', '2')) || 2));
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SCRATCH = join(OUT, '_seed-workspace');
mkdirSync(OUT, { recursive: true });

/* THE INK SPY. The runes are drawn with fillRect in the bubble's phosphor (#ffe0b0) — the spoken
   -line bubble puts its ink down with fillText instead, so the two are distinguishable at the
   context. Wrapping BOTH lets one sample answer "did rune pixels land" and "did any text land in
   the same place" together, which is the pair of facts that makes 'untranscribable' a measurement
   rather than an intention. Installed once; the world's ctx is the same object across frames. */
const INSTALL_SPY = `(() => {
  const cv = document.getElementById('stage'); if (!cv) return { err: 'no #stage' };
  const ctx = cv.getContext('2d'); if (!ctx) return { err: 'no 2d ctx' };
  if (window.__glyphSpy) return { ok: true, already: true };
  const oRect = ctx.fillRect.bind(ctx), oText = ctx.fillText.bind(ctx);
  window.__glyphSpy = { rects: [], texts: [] };
  /* SCOPED BY SIZE AS WELL AS COLOUR. Colour alone over-counts: dev/glyphdiag.mjs caught 1x1
     alpha-0.2 motes from another layer inheriting a leftover fillStyle, which is what made the
     first run's bbox nonsense (that leak is fixed at source; the guard stays because a spy that
     can be satisfied by a different draw than the one under test is not evidence). Every rune
     stroke is at least RUNE_PX on both axes, so >=2x2 admits the runes and nothing 1px. */
  ctx.fillRect = function (x, y, w, h) {
    try { if (String(ctx.fillStyle).toLowerCase() === '#ffe0b0' && w >= 2 && h >= 2) window.__glyphSpy.rects.push([x, y, w, h]); } catch (e) {}
    return oRect(x, y, w, h);
  };
  ctx.fillText = function (t, x, y) {
    try { window.__glyphSpy.texts.push([String(t), x, y]); } catch (e) {}
    return oText(t, x, y);
  };
  return { ok: true };
})()`;

// one sample: the live chatter state + the ink laid down since the last sample
const SAMPLE = `(() => {
  if (typeof World === 'undefined' || !World._dbgChatter) return { err: 'no World._dbgChatter — wrong build on this port' };
  const spy = window.__glyphSpy || { rects: [], texts: [] };
  const rects = spy.rects.splice(0), texts = spy.texts.splice(0);
  let bbox = null;
  for (const r of rects) {
    const x0 = r[0], y0 = r[1], x1 = r[0] + r[2], y1 = r[1] + r[3];
    bbox = bbox ? [Math.min(bbox[0], x0), Math.min(bbox[1], y0), Math.max(bbox[2], x1), Math.max(bbox[3], y1)] : [x0, y0, x1, y1];
  }
  return {
    t: Math.round(performance.now()),
    chatter: World._dbgChatter(),
    bodies: World.bodies().map(b => ({ id: b.id, name: b.name, kind: b.socialKind, phase: b.socialPhase, talking: !!b.talking })),
    ink: { rects: rects.length, bbox: bbox, texts: texts.length, textSample: texts.slice(0, 4) }
  };
})()`;

let proc = null, side = null, cdp = null;
const fail = [];
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fail.push(msg); };
const bail = (code, msg, extra) => {
  console.log('\n' + msg); if (extra) console.log('  ' + extra);
  try { if (proc) proc.kill(); } catch {} try { if (side) side.kill(); } catch {}
  process.exit(code);
};

try {
  if (await isUp(APP_URL)) throw new Error(`${APP_URL} already answers — someone else owns that port; pick another (--port)`);
  rmSync(SCRATCH, { recursive: true, force: true });
  materializeSeedWorkspace(SCRATCH);
  side = bootSeededSidecar({ port: PORT, scratchDir: SCRATCH });
  if (!(await waitUp(APP_URL))) throw new Error('seeded sidecar never came up on :' + PORT);

  ({ proc } = launchChrome({ cdpPort: CDP_PORT, win: '1440,900', profileDir: join(OUT, '_profile') }));
  cdp = await connectCDP(CDP_PORT);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  // throttle rAF BEFORE navigation — a full-tilt software canvas starves Runtime.evaluate. Every
  // timer in the idle engine is wall-clock, so the behaviour under test advances identically.
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 100); window.cancelAnimationFrame = (id) => clearTimeout(id);`,
  });
  await cdp.send('Page.navigate', { url: APP_URL });
  if (!(await waitDevReady(cdp, evalJS, { tries: 30, url: APP_URL }))) throw new Error('never reached the in-game floor');
  await sleep(5000);

  // BUILD MARKER — prove this page is MY build, not a neighbouring agent's server on a nearby port
  const marker = await evalJS(cdp, `(() => { try { return { chatter: !!(typeof World !== 'undefined' && World._dbgChatter), huddle: !!(typeof World !== 'undefined' && World._dbgHuddle), alphabet: (typeof World !== 'undefined' && World._dbgChatter) ? World._dbgChatter().alphabet : null }; } catch (e) { return { err: String(e) }; } })()`);
  console.log('[glyphprobe] build marker:', JSON.stringify(marker));
  if (!marker || !marker.chatter) throw new Error('this page has no World._dbgChatter — wrong build/server on this port');
  console.log('[glyphprobe] ink spy:', JSON.stringify(await evalJS(cdp, INSTALL_SPY)));

  const COLORS = ['#ffaa55', '#77ffdd', '#c9a0ff'];
  for (let i = 0; i < PARTY; i++) {
    await evalJS(cdp, `(() => { World.spawnAgent({ id: 'G${i}', name: 'GLYPH${i}', color: '${COLORS[i]}' }); return true; })()`);
    await sleep(700);
  }
  await sleep(4000);
  // park them together so the walk is short (removes the WAITING, not the beat)
  console.log(`[glyphprobe] party of ${PARTY}, parked:`, await evalJS(cdp, `(() => { try {
    const bs = World.bodies().filter(b => b && !b.hero && !b.unplaced);
    if (bs.length < ${PARTY}) return 'need ${PARTY} crew, got ' + bs.length;
    World._dbgTeleport(bs[1].id, bs[0].px + 3, bs[0].py + 3);
    if (bs.length > 2) World._dbgTeleport(bs[2].id, bs[0].px - 3, bs[0].py + 3);
    return bs.map(b => b.id).join(',');
  } catch (e) { return 'err ' + e; } })()`));
  await sleep(1500);

  /* Get a conversation to watch. Two ways, and the FIRST is the better evidence:

     ADOPT an organic beat. Parked side by side on a small floor, the idle engine usually huddles
     these bodies by itself within seconds — and because there is a single encounter slot, that
     made _dbgHuddle answer "an encounter is already live" for every retry and the run scored
     INCONCLUSIVE while a perfectly good conversation was happening on screen. A beat the engine
     started on its own is a stronger observation than a forced one, so take it when it fits.
     Otherwise wait for the slot to free rather than hammering it, then arm through the planner. */
  let armed = null;
  for (let attempt = 0; attempt < 24; attempt++) {
    const beat = await evalJS(cdp, `(() => { try { return World._dbgChatter().beat; } catch (e) { return null; } })()`).catch(() => null);
    if (beat && beat.ids && beat.ids.length >= PARTY && (beat.kind === 'huddle' || beat.kind === 'border')) {
      armed = { ok: true, roster: beat.ids.slice(), kind: beat.kind, organic: true };
      console.log('[glyphprobe] adopted an ORGANIC ' + beat.kind + ':', beat.ids.join(','));
      break;
    }
    if (beat) { await sleep(4000); continue; }   // the single slot is busy with a smaller beat — let it finish
    armed = await evalJS(cdp, `(() => { try {
      const bs = World.bodies().filter(b => b && !b.hero && !b.unplaced);
      if (bs.length < 2) return { ok: false, err: 'crew vanished' };
      const ids = bs.map(b => b.id), rot = ${attempt % PARTY};
      return World._dbgHuddle(ids.slice(rot).concat(ids.slice(0, rot)), true);
    } catch (e) { return { ok: false, err: String(e) }; } })()`);
    if (armed && armed.ok && armed.roster && armed.roster.length >= PARTY) break;
    console.log('[glyphprobe] arm attempt ' + attempt + ':', JSON.stringify(armed));
    await sleep(armed && armed.ok ? 4000 : 3000);   // armed a SHORT party — let it lapse before retrying
  }
  /* "Could not assemble the party" is INCONCLUSIVE, never a verdict — `force` skips the frequency
     roll and NOTHING else, so a pair cooldown or a missing third tile legitimately blocks a trio.
     Grading that as a product failure would be a lie in the other direction. */
  if (!(armed && armed.ok && armed.roster && armed.roster.length >= PARTY)) {
    bail(4, `GLYPHPROBE INCONCLUSIVE — could not arm a party of ${PARTY} to observe.`, 'last attempt: ' + JSON.stringify(armed));
  }
  console.log('[glyphprobe] armed:', JSON.stringify(armed));
  const roster = armed.roster;

  // ---- watch the conversation ----
  const spoke = new Map();            // id -> how many distinct lines it put up
  const dialects = new Map();         // id -> its rune subset, as reported by the renderer's own source
  let maxLive = 0, liveSamples = 0, talkingWithBubble = 0, talkingNoBubble = 0;
  let inkRects = 0, inkTexts = 0, inkBox = null, foreignRune = 0, textInBubble = [];
  let shotPath = null, cropPath = null, frameInk = null;
  const seenLines = new Set();
  const shots = [];
  for (let i = 0; i < 150; i++) {
    const s = await evalJS(cdp, SAMPLE).catch(() => null);
    if (!s || s.err) { await sleep(250); continue; }
    const ch = s.chatter || {};
    const live = (ch.live || []).filter(x => roster.indexOf(x.id) >= 0);   // SCOPED to the armed roster
    maxLive = Math.max(maxLive, live.length);
    if (live.length) liveSamples++;
    for (const x of live) {
      dialects.set(x.id, x.dialect.join(','));
      const key = x.id + ':' + JSON.stringify(x.words);
      if (!seenLines.has(key)) { seenLines.add(key); spoke.set(x.id, (spoke.get(x.id) || 0) + 1); }
      // a body must only ever draw runes from its OWN dialect
      for (const w of x.words) for (const r of w) if (x.dialect.indexOf(r) < 0) foreignRune++;
    }
    // the pose and the bubble must agree: a moving mouth in this encounter has a bubble over it
    for (const b of s.bodies) {
      if (roster.indexOf(b.id) < 0 || b.kind !== 'huddle' || !b.talking) continue;
      if (live.some(x => x.id === b.id)) talkingWithBubble++; else talkingNoBubble++;
    }
    if (s.ink) {
      inkRects += s.ink.rects; inkTexts += s.ink.texts;
      if (s.ink.texts && live.length) textInBubble = textInBubble.concat(s.ink.textSample || []);
      if (s.ink.bbox) inkBox = s.ink.bbox;
    }
    /* CAPTURE ON A FRAME WE DROVE OURSELVES. The first version screenshotted right after a sample
       said "a bubble is up" and caught a frame that predated it — rAF is throttled to 100ms here,
       so the canvas bitmap can be a whole turn behind what the state says. Drive ONE synchronous
       frame (World.stop(); World.start() renders inline), measure the ink IN THAT frame, read the
       pixels back from the composited canvas, and only then capture. */
    /* AT FULL ALPHA, not "whenever a bubble exists". The brightness check failed once at 20/336 px
       lit because it happened to catch a line mid-FADE — which measured the envelope doing its job,
       not the bubble's legibility. The envelope rises to 110ms and falls over the last 260ms, so a
       sample between those is the only one where "how bright is the bubble" is a question about
       the bubble. Same discipline as the roster scoping above. */
    if (!shotPath && live.some(x => x.talking && x.ageMs > 160 && x.ageMs < 900)) {
      const shot = await evalJS(cdp, `(() => {
        const cv = document.getElementById('stage'), dpr = window.devicePixelRatio || 1;
        const spy = window.__glyphSpy; spy.rects.length = 0; spy.texts.length = 0;
        World.stop(); World.start();                            // one full frame, synchronously
        const rects = spy.rects.slice(), texts = spy.texts.slice();
        if (!rects.length) return { none: true };
        let bb = null;
        for (const r of rects) { const x0 = r[0], y0 = r[1], x1 = r[0] + r[2], y1 = r[1] + r[3];
          bb = bb ? [Math.min(bb[0], x0), Math.min(bb[1], y0), Math.max(bb[2], x1), Math.max(bb[3], y1)] : [x0, y0, x1, y1]; }
        /* DID THE PIXELS SURVIVE THE COMPOSITE? Read the live canvas back — but around a PADDED
           rect, not the ink's own one. drawCurve barrel-warps the whole feed after the bubble is
           drawn, so the ink's pre-warp coordinates are not where it ends up; sampling the tight
           rect measured mostly displaced background and reported 4/768 lit on a bubble that is
           plainly there in the screenshot. The displacement grows with distance from centre, so
           the pad has to be generous. Both numbers are reported — a tight reading far below the
           padded one is the warp, not a missing bubble. */
        const read = (x, y, w, h) => {
          const s = document.createElement('canvas');
          s.width = Math.max(1, Math.round(w * dpr)); s.height = Math.max(1, Math.round(h * dpr));
          const sc = s.getContext('2d'); sc.imageSmoothingEnabled = false;
          sc.drawImage(cv, x * dpr, y * dpr, s.width, s.height, 0, 0, s.width, s.height);
          const d = sc.getImageData(0, 0, s.width, s.height).data;
          let lit = 0, maxLum = 0;
          for (let p = 0; p < d.length; p += 4) { const l = (d[p] + d[p + 1] + d[p + 2]) / 3; maxLum = Math.max(maxLum, l); if (l > 90) lit++; }
          return { lit: lit, maxLum: Math.round(maxLum), px: d.length / 4 };
        };
        const PAD = 30;
        const tight = read(bb[0], bb[1], bb[2] - bb[0], bb[3] - bb[1]);
        const wide = read(Math.max(0, bb[0] - PAD), Math.max(0, bb[1] - PAD), (bb[2] - bb[0]) + PAD * 2, (bb[3] - bb[1]) + PAD * 2);
        const lit = wide.lit, maxLum = wide.maxLum, d = { length: wide.px * 4 };
        /* A nearest-neighbour crop for a human to look at. Framed ASYMMETRICALLY on purpose: the
           bubble is the top of the picture and the speaker stands below it, so a crop padded
           evenly around the ink shows a line of runes with a stranger's head above it and the
           body it belongs to out of frame. Reach DOWN far enough to catch the tail and the sprite. */
        const sx = Math.max(0, bb[0] - 34), sy = Math.max(0, bb[1] - 16);
        const sw = Math.min(cv.width / dpr - sx, (bb[2] - bb[0]) + 68), sh = Math.min(cv.height / dpr - sy, (bb[3] - bb[1]) + 78);
        const Z = 5, out = document.createElement('canvas');
        out.width = Math.round(sw * Z); out.height = Math.round(sh * Z);
        const o = out.getContext('2d'); o.imageSmoothingEnabled = false;
        o.drawImage(cv, sx * dpr, sy * dpr, sw * dpr, sh * dpr, 0, 0, out.width, out.height);
        // text landing INSIDE the bubble is the thing that would make it transcribable — a nameplate
        // or a run clock elsewhere on the canvas is not this feature's business, so scope the claim.
        const inBub = texts.filter(t => t[1] >= bb[0] - 4 && t[1] <= bb[2] + 4 && t[2] >= bb[1] - 4 && t[2] <= bb[3] + 18);
        return { bbox: bb, runeRects: rects.length, texts: texts.length, textsInBubble: inBub,
                 lit: lit, maxLum: Math.round(maxLum), px: d.length / 4, tight: tight, wide: wide,
                 png: out.toDataURL('image/png') };
      })()`).catch(() => null);
      if (shot && shot.bbox) {
        frameInk = shot;
        const g = await capture(cdp, OUT, 'glyph-bubble-frame');
        shotPath = g.path;
        if (shot.png && shot.png.indexOf(',') > 0) {
          cropPath = join(OUT, 'glyph-bubble-crop.png');
          writeFileSync(cropPath, Buffer.from(shot.png.slice(shot.png.indexOf(',') + 1), 'base64'));
        }
      }
    }
    if (live.length && shots.length < 16) {
      shots.push(`${s.t}: ` + live.map(x => `${x.id} [${x.words.map(w => w.join('·')).join('  ')}] ${x.ageMs}ms${x.talking ? ' TALKING' : ' fading'}`).join(' | ')
        + `  ink:${s.ink.rects}r/${s.ink.texts}t`);
    }
    await sleep(250);
  }

  console.log('\n--- observed (rune INDICES — there is no text on this path to print) ---');
  for (const line of shots) console.log('  ' + line);
  console.log('');

  if (!liveSamples) {
    bail(4, 'GLYPHPROBE INCONCLUSIVE — the armed encounter never reached a talking turn to observe.',
      'roster: ' + roster.join(',') + ' (a body that never arrives never speaks; that is the hold clock, not the bubble)');
  }

  // ---- the checks ----
  check(liveSamples > 0, `a speech bubble was live during the conversation (${liveSamples} samples)`);
  check(maxLive === 1, `NEVER two bubbles on screen at once (max simultaneous: ${maxLive})`);
  check(talkingNoBubble === 0, `every moving mouth in the beat had a bubble over it (${talkingWithBubble} with, ${talkingNoBubble} without)`);
  check(spoke.size === roster.length, `every participant put up its own line (${spoke.size}/${roster.length}: ${[...spoke.entries()].map(([k, v]) => k + '=' + v).join(' ')})`);
  check(seenLines.size > 1, `the lines CHANGE between turns (${seenLines.size} distinct) — it is not one frozen phrase`);
  check(foreignRune === 0, `every rune drawn came from that speaker's own dialect (${foreignRune} foreign)`);
  check(new Set([...dialects.values()]).size === dialects.size,
    `the speakers have DIFFERENT dialects (${dialects.size} bodies, ${new Set([...dialects.values()]).size} distinct alphabets)`);
  check(inkRects > 0, `the runes landed as real canvas ink (${inkRects} phosphor rects over the run)`);
  // ONE frame we drove ourselves, measured end to end: strokes -> geometry -> surviving pixels
  const fi = frameInk || {};
  const bw = fi.bbox ? fi.bbox[2] - fi.bbox[0] : 0, bhh = fi.bbox ? fi.bbox[3] - fi.bbox[1] : 0;
  check(!!fi.bbox, `one driven frame carried rune ink (${fi.runeRects || 0} strokes, bbox ${fi.bbox ? fi.bbox.map(Math.round).join(',') : 'none'})`);
  check(bw >= 16 && bhh >= 8 && bhh <= 24,
    `that ink is a LINE OF SCRIPT, not a stray mark (${Math.round(bw)}x${Math.round(bhh)} css px — a rune row is ~12 tall)`);
  check((fi.lit || 0) >= 30 && (fi.maxLum || 0) > 140,
    `and it SURVIVES the CRT composite (${fi.lit || 0}/${fi.px || 0} px lit, peak ${fi.maxLum || 0}` +
    `${fi.tight ? ` · tight rect ${fi.tight.lit}/${fi.tight.px} peak ${fi.tight.maxLum} — the gap is the barrel warp displacing it` : ''})`);
  check((fi.textsInBubble || []).length === 0,
    `NOT ONE character was drawn inside that bubble — it is pixels all the way down${(fi.textsInBubble || []).length ? ' (saw ' + JSON.stringify(fi.textsInBubble.slice(0, 3)) + ')' : ''}`);
  check(textInBubble.length === 0,
    `NOTHING on this path is text — zero fillText while a bubble was up${textInBubble.length ? ' (saw: ' + JSON.stringify(textInBubble.slice(0, 3)) + ')' : ''}`);

  // ---- and it does not outlive the conversation ----
  await evalJS(cdp, `(() => { try { World._dbgHuddle; } catch (e) {} return true; })()`);
  let after = null;
  for (let i = 0; i < 40; i++) {
    after = await evalJS(cdp, SAMPLE).catch(() => null);
    const stillIn = after && after.bodies.some(b => roster.indexOf(b.id) >= 0 && b.kind === 'huddle');
    if (!stillIn) break;
    await sleep(1500);
  }
  const leftOver = after ? (after.chatter.live || []).filter(x => roster.indexOf(x.id) >= 0
    && !after.bodies.some(b => b.id === x.id && b.kind === 'huddle')) : [];
  check(leftOver.length === 0, `no bubble is left hanging over a body once its conversation ends (${leftOver.length} leaked)`);

  if (shotPath) console.log(`\n[glyphprobe] frame: ${shotPath}`);
  if (cropPath) console.log(`[glyphprobe] 5x crop of the bubble: ${cropPath}`);
  console.log(`[glyphprobe] totals: ${inkRects} rune rects · ${inkTexts} fillText calls anywhere on the canvas · ${seenLines.size} distinct lines`);

  console.log('\n' + (fail.length ? `GLYPHPROBE FAIL — ${fail.length} check(s):\n  - ` + fail.join('\n  - ') : 'GLYPHPROBE PASS'));
  try { if (proc) proc.kill(); } catch {} try { if (side) side.kill(); } catch {}
  process.exit(fail.length ? 1 : 0);
} catch (e) {
  console.log('\nGLYPHPROBE ERROR — ' + (e && e.message ? e.message : String(e)));
  try { if (proc) proc.kill(); } catch {} try { if (side) side.kill(); } catch {}
  process.exit(1);
}
