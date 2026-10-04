#!/usr/bin/env node
/* dev/settings-perf-shots.mjs — live proof for the two SETTINGS complaints of 2026-08-15:
 *   1. "the settings menu is laggier than ever"
 *   2. "windows change size depending on the settings category — it should stay the same size"
 *
 * Boots a seeded sidecar from THIS worktree and drives the REAL app over CDP (the established
 * headless pattern — dev/permissions-shots.mjs / scripts/lib/cdp.mjs). The preview pane clamps
 * background timers AND never fires requestAnimationFrame, so the chunked swatch painter can only
 * be observed here, in a compositing browser.
 *
 * WHAT WAS WRONG (measured on trunk b6e890c5c, 1280x720, seeded station):
 *   - buildSettings painted all six BACKDROP swatches with the REAL world renderer, inline, on
 *     every build of the panel. Per chip: moon 400ms, forest 150ms, nursery 54ms, ocean 26ms,
 *     city 14ms, void 9ms ≈ 600ms of blocked main thread. openTerm('settings') = 501ms, and
 *     rerender('settings') = 405-534ms — for a picker that lives in a pane most opens never show.
 *   - `.term.console` was `height:auto`, so a shorter section shrank the window; a never-moved
 *     window is CSS-centred, so the whole box re-centred and the rail moved under the cursor.
 *     Measured: 590 / 534 / 462 px across the ten sections.
 *
 * WHAT THIS ASSERTS: the panel opens fast, every section holds ONE height, the swatches still
 * paint (the real renderer, never a stand-in — blank chips would be the cheat this guards), and
 * a second visit is a cache hit rather than a second 600ms build.
 *
 *   node dev/settings-perf-shots.mjs
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9746';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9747);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-settings-perf');

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ok   ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))); }
  else { fail++; console.log('  FAIL ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))); }
};

/* ⛔ PREFLIGHT — this repo is built by 7–10 agents at once, each running its own sidecar on its own
   port. If something is ALREADY listening here, bootSeededSidecar's bind fails, `waitUp` cheerfully
   answers true against the SQUATTER, and every number below silently describes another lane's app. */
function portFree(port) {
  return new Promise(resolve => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(Number(port), '127.0.0.1');
  });
}

async function main() {
  for (const [label, port] of [['sidecar', PORT], ['CDP', CDP_PORT]]) {
    if (!(await portFree(port))) {
      throw new Error(`port ${port} (${label}) is already in use — another agent's station is probably there.\n` +
        `  Re-run with a free pair, e.g. SKYNET_SHOT_PORT=<free> SKYNET_CDP_PORT=<free+1> node dev/settings-perf-shots.mjs`);
    }
  }
  const scratch = mkdtempSync(join(tmpdir(), 'setperf-'));
  materializeSeedWorkspace(join(scratch, 'ws'));
  const side = bootSeededSidecar({ port: PORT, scratchDir: join(scratch, 'ws') });
  let chrome = null, cdp = null;
  try {
    if (!(await waitUp(URL))) throw new Error('sidecar never came up on ' + URL);
    // Second belt: prove the served bundle is THIS worktree's build before believing any measurement.
    const marker = await (await fetch(URL + 'app/stationui.js')).text();
    if (!marker.includes('paintBackdropSwatches')) {
      throw new Error('the app served on ' + URL + ' is not this worktree\'s build (no lazy swatch painter) — ' +
        'refusing to measure a station this harness did not boot');
    }
    chrome = launchChrome({ cdpPort: CDP_PORT, profileDir: join(scratch, 'chrome') });
    await sleep(1200);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Runtime.enable');
    const diag = collectDiagnostics(cdp);
    await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never reached the game screen');
    await sleep(1500);
    mkdirSync(OUT, { recursive: true });
    // freeze the world so its rAF loop can't be mistaken for (or hide) the panel's own cost
    await evalJS(cdp, `(() => { if (document.body) document.body.classList.add('no-flicker');
      if (typeof World !== 'undefined' && World.stop) { World.stop(); return 'frozen'; } return 'no-world'; })()`);

    /* ── 1. THE OPEN ────────────────────────────────────────────────────────────────────────────
       The number Andrew feels. Landing section is PROVIDERS, so a correct build paints NO swatch. */
    console.log('\n— OPENING SETTINGS —');
    const opened = await evalJS(cdp, `(() => {
      const t0 = performance.now();
      StationUI.openTerm('settings', 'providers');
      const openMs = +(performance.now() - t0).toFixed(1);
      const win = document.querySelector('.term.console');
      void win.offsetHeight;                       // flush layout into the measurement
      return { openMs, totalMs: +(performance.now() - t0).toFixed(1), nodes: win.querySelectorAll('*').length };
    })()`);
    console.log('   open cost: ' + opened.openMs + 'ms JS · ' + opened.totalMs + 'ms incl. layout · ' + opened.nodes + ' nodes');
    // Trunk measured 501ms here. 150ms is a generous ceiling that still fails loudly on a regression.
    check('opening SETTINGS costs well under 150ms (was 501ms)', opened.totalMs < 150, opened.totalMs + 'ms');
    await sleep(600);
    console.log('shot', await capture(cdp, OUT, 'settings-00-providers'));

    /* ── 2. ONE HEIGHT, EVERY SECTION ───────────────────────────────────────────────────────────
       offsetHeight, not getBoundingClientRect: the power-on keyframe is a scaleY transform, so the
       rect lies about the box while it plays. The window is CSS-centred, so a height change also
       MOVES the rail — assert both, since it is the moving rail the user actually reports. */
    console.log('\n— WINDOW SIZE ACROSS SECTIONS —');
    const sizes = await evalJS(cdp, `(() => {
      const win = document.querySelector('.term.console');
      const tabs = [...win.querySelectorAll('.con-rail-item')];
      const rows = tabs.map(t => {
        const a = performance.now();
        t.click();
        const clickMs = +(performance.now() - a).toFixed(1);
        const last = win.querySelector('.con-rail-item:last-child').getBoundingClientRect();
        return { sec: t.dataset.section, h: win.offsetHeight, w: win.offsetWidth,
                 railY: Math.round(last.top), clickMs };
      });
      return { rows, heights: [...new Set(rows.map(r => r.h))], widths: [...new Set(rows.map(r => r.w))],
               railYs: [...new Set(rows.map(r => r.railY))] };
    })()`);
    for (const r of sizes.rows) console.log('   ' + r.sec.padEnd(12) + r.h + 'px  rail@' + r.railY + '  ' + r.clickMs + 'ms');
    check('every section holds ONE window height', sizes.heights.length === 1, sizes.heights);
    check('every section holds ONE window width', sizes.widths.length === 1, sizes.widths);
    check('the section rail never moves between sections', sizes.railYs.length === 1, sizes.railYs);
    const slowest = Math.max(...sizes.rows.map(r => r.clickMs));
    check('no section swap blocks longer than 60ms', slowest < 60, slowest + 'ms');

    /* ── 3. THE SWATCHES STILL PAINT ────────────────────────────────────────────────────────────
       The whole point of the lazy painter is that it DEFERS work, never that it skips it. A blank
       chip would be the cheat: the picker's contract is that a preview is the real renderer's
       output, so sample real pixels and demand each chip be non-uniform (a place, not a fill). */
    console.log('\n— APPEARANCE: THE BACKDROP SWATCHES —');
    const reveal = await evalJS(cdp, `(() => {
      const win = document.querySelector('.term.console');
      const t = performance.now();
      win.querySelector('.con-rail-item[data-section="appearance"]').click();
      return { clickMs: +(performance.now() - t).toFixed(1) };
    })()`);
    check('revealing APPEARANCE does not block the click (was ~600ms inline)', reveal.clickMs < 60, reveal.clickMs + 'ms');
    await sleep(2500);   // the chunked painter yields a frame between chips
    const chips = await evalJS(cdp, `(() => {
      const win = document.querySelector('.term.console');
      const out = [...win.querySelectorAll('#set-backdrop [data-bd]')].map(b => {
        const cv = b.querySelector('canvas');
        if (!cv) return { id: b.dataset.bd, painted: false, why: 'no canvas' };
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let min = 255, max = 0, sum = 0;
        for (let i = 0; i < d.length; i += 4) {
          const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
          if (l < min) min = l; if (l > max) max = l; sum += l;
        }
        return { id: b.dataset.bd, mean: +(sum / (d.length / 4)).toFixed(1), range: Math.round(max - min),
                 painted: (max - min) > 8 };
      });
      return out;
    })()`);
    for (const c of chips) console.log('   ' + String(c.id).padEnd(9) + 'mean ' + c.mean + '  range ' + c.range + (c.painted ? '  ✓' : '  BLANK'));
    check('all six backdrop swatches painted real content', chips.length === 6 && chips.every(c => c.painted),
      chips.filter(c => !c.painted).map(c => c.id));
    console.log('shot', await capture(cdp, OUT, 'settings-01-appearance'));

    /* ── 4. THE SECOND VISIT IS FREE ────────────────────────────────────────────────────────────
       The memoised sample is the half of the fix that survives a rebuild: a rerender re-runs the
       whole builder, and before this it re-ran the whole world renderer with it. */
    console.log('\n— REPAINT COST AFTER THE CACHE IS WARM —');
    const warm = await evalJS(cdp, `(() => {
      const rr = [];
      for (let i = 0; i < 3; i++) { const t = performance.now(); StationUI.rerender('settings'); rr.push(+(performance.now() - t).toFixed(1)); }
      const win = document.querySelector('.term.console');
      const chips = [...win.querySelectorAll('#set-backdrop [data-bd]')];
      const direct = chips.map(b => {
        const cv = b.querySelector('canvas'); if (!cv) return null;
        const ground = typeof Terrain !== 'undefined' && Terrain.GROUNDS && Terrain.GROUNDS[b.dataset.bd];
        const t = performance.now();
        if (ground) Terrain.paintSample(cv.getContext('2d'), cv.width, cv.height, b.dataset.bd);
        else SpaceBG.paintSample(cv.getContext('2d'), cv.width, cv.height, b.dataset.bd, 8000);
        return [b.dataset.bd, +(performance.now() - t).toFixed(1)];
      }).filter(Boolean);
      return { rerenderMs: rr, sampleMs: direct, sampleTotal: +direct.reduce((s, x) => s + x[1], 0).toFixed(1) };
    })()`);
    console.log('   rerender: ' + warm.rerenderMs.join('ms, ') + 'ms');
    console.log('   warm samples: ' + warm.sampleMs.map(x => x[0] + ' ' + x[1] + 'ms').join(' · ') + '  = ' + warm.sampleTotal + 'ms');
    check('rerender(settings) costs under 60ms (was 405-534ms)', Math.max(...warm.rerenderMs) < 60, warm.rerenderMs);
    check('a warm swatch repaint of all six costs under 20ms (was ~600ms)', warm.sampleTotal < 20, warm.sampleTotal + 'ms');

    /* ── 4b. THE OTHER THING A USER DRAGS ───────────────────────────────────────────────────────
       Reported, not asserted at a tight bound: the APPEARANCE sliders recolour the whole station
       per input tick (applySettings), which is a real cost this lane did not touch. Printing it
       keeps the next person from re-discovering it as "settings is still laggy". */
    const slider = await evalJS(cdp, `(() => {
      const win = document.querySelector('.term.console');
      win.querySelector('.con-rail-item[data-section="appearance"]').click();
      const hue = win.querySelector('#set-hue');
      if (!hue) return null;
      const ticks = [];
      for (let i = 0; i < 6; i++) {
        hue.value = String(30 + i * 4);
        const t = performance.now();
        hue.dispatchEvent(new Event('input', { bubbles: true }));
        void win.offsetHeight;
        ticks.push(+(performance.now() - t).toFixed(1));
      }
      return ticks;
    })()`);
    if (slider) console.log('   HUE slider, ms per drag tick: ' + slider.join(', ') + '  (untouched by this lane)');

    /* ── 5. THE PANE STILL SCROLLS ──────────────────────────────────────────────────────────────
       A fixed shell is only honest if the content it can no longer grow for is reachable. */
    console.log('\n— THE CONTENT IS STILL REACHABLE —');
    const scroll = await evalJS(cdp, `(() => {
      const win = document.querySelector('.term.console');
      win.querySelector('.con-rail-item[data-section="permissions"]').click();
      const pane = win.querySelector('.con-pane');
      pane.scrollTop = 1e6;
      return { scrollH: pane.scrollHeight, clientH: pane.clientHeight, landedAtBottom: pane.scrollTop > 0,
               atEnd: Math.abs(pane.scrollTop + pane.clientHeight - pane.scrollHeight) < 2 };
    })()`);
    check('an overflowing section scrolls to its end inside the fixed shell',
      scroll.scrollH > scroll.clientH && scroll.landedAtBottom && scroll.atEnd, scroll);

    /* ── 6. EVERY OTHER CONSOLE ─────────────────────────────────────────────────────────────────
       `.term.console` is shared, so this change is not a SETTINGS change — it is a shell change.
       Sweep the rest of the consoles rather than assume. */
    console.log('\n— EVERY CONSOLE HOLDS ONE SHELL —');
    const shellH = sizes.heights[0];   // what SETTINGS settled at; every console reads the same --con-h
    /* DELIVERABLES is `console`-classed but mounts its own body rather than mountConsole's rail, so
       it has no tabs to sweep. The thing its dropped `.dlv-win` height rule protected was the DETAILS
       DRAWER — toggling one used to re-centre the window and slide the row out from under the pointer
       — so drive that instead of pretending it is a tab set. */
    for (const key of ['agents', 'connectors', 'messaging', 'automation', 'deliverables']) {
      const r = await evalJS(cdp, `(async () => {
        StationUI.openTerm(${JSON.stringify(key)});
        await new Promise(r => setTimeout(r, 900));
        const wins = [...document.querySelectorAll('.term.console')];
        const win = wins[wins.length - 1];
        if (!win) return { key: ${JSON.stringify(key)}, missing: true };
        const hs = [];
        const tabs = [...win.querySelectorAll('.con-rail-item')];
        let mode = 'tabs';
        if (tabs.length) {
          for (const t of tabs) { t.click(); await new Promise(r => setTimeout(r, 60)); hs.push(win.offsetHeight); }
        } else {
          /* no rail: drive the tallest content toggle this window owns (a card's details drawer).
             NEVER a bare button selector — it matched the window's own close control and shut the
             thing under measurement, which reads as a height of 0 rather than as a harness bug. */
          mode = 'drawer';
          const togs = [...win.querySelectorAll('.dlv-card, .con-sec-body details > summary')].slice(0, 4);
          if (!togs.length) {
            // still record the shell it opened at — this is the one window whose explicit
            // dlv-win height rule this change removed, so "it kept the shell" must be measured.
            const h = win.offsetHeight;
            StationUI.closeTerm(${JSON.stringify(key)});
            return { key: ${JSON.stringify(key)}, noToggle: true, openedAt: h };
          }
          hs.push(win.offsetHeight);
          for (const t of togs) { try { t.click(); } catch (_) {} await new Promise(r => setTimeout(r, 150)); hs.push(win.offsetHeight); }
        }
        const scroller = win.querySelector('.con-pane') || win.querySelector('.term-body');
        const out = { key: ${JSON.stringify(key)}, mode, steps: hs.length, heights: [...new Set(hs)],
                      fill: scroller ? Math.round(100 * scroller.scrollHeight / win.offsetHeight) : null };
        StationUI.closeTerm(${JSON.stringify(key)});
        return out;
      })()`);
      if (r.missing) { check(key + ' console opened', false, 'no .term.console found'); continue; }
      if (r.noToggle) {
        console.log('   ' + key.padEnd(13) + 'opened at ' + r.openedAt + 'px · no card/drawer on a seeded station, so the drawer sweep is skipped');
        check(key + ' opens at the shared console shell height', r.openedAt === shellH, r.openedAt + 'px vs ' + shellH + 'px');
        continue;
      }
      console.log('   ' + r.key.padEnd(13) + r.steps + ' ' + r.mode + ' · heights ' + JSON.stringify(r.heights) +
        (r.fill == null ? '' : ' · content is ~' + r.fill + '% of the shell'));
      check(r.key + ' holds ONE height across its ' + r.mode, r.heights.length === 1, r.heights);
    }

    const errs = diag.consoleMsgs.filter(m => m.type === 'error' && !/favicon/i.test(m.text)).concat(diag.exceptions);
    check('no console errors or exceptions', errs.length === 0, errs.slice(0, 5));

    console.log('\n' + (fail ? 'FAIL' : 'PASS') + ' — ' + pass + ' ok / ' + fail + ' failed · shots in ' + OUT);
    process.exitCode = fail ? 1 : 0;
  } finally {
    try { if (chrome) chrome.kill(); } catch (_) {}
    try { if (side) side.kill(); } catch (_) {}
  }
}

main().catch(e => { console.error(e); process.exit(1); });
