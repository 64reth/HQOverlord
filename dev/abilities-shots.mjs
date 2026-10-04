#!/usr/bin/env node
/* dev/abilities-shots.mjs — live proof shots for the ABILITIES console.
 *
 * Boots a seeded sidecar from THIS worktree, drives the REAL app over CDP (the established
 * headless pattern — see dev/brightness-shots.mjs / scripts/lib/cdp.mjs), opens ABILITIES and
 * captures EVERY tab. The console mounts all panes at once and tab clicks only toggle visibility,
 * so a shot per tab is the only way to see what a Commander actually lands on.
 *
 *   node dev/abilities-shots.mjs                 (ports: SKYNET_SHOT_PORT / SKYNET_CDP_PORT)
 *   node dev/abilities-shots.mjs --only keys
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9541';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9543);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-abilities');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1]
  || (process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null);

// Every section the console registers. The lane sections (skill library / agent skills) are pushed
// by stationui.js at build time, so they are driven by rail label rather than a hardcoded id.
const TABS = ['toolsets', 'catalog', 'keys', 'mcp', 'extensions'];

// Click the REAL rail button — never call selectSection directly. The rail click is what a
// Commander does, and it is the path that carries the pane-repoll wiring (e.g. the KEYS tab
// re-reads /api/servicekeys on click).
const clickTab = (id) => `(() => {
  const b = document.querySelector('#con-tab-connectors-${id}');
  if (!b) return 'no-tab:${id}';
  b.click();
  return 'clicked:${id}';
})()`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'abilityshots-'));
  materializeSeedWorkspace(join(scratch, 'ws'));
  const side = bootSeededSidecar({ port: PORT, scratchDir: join(scratch, 'ws') });
  let chrome = null, cdp = null;
  try {
    if (!(await waitUp(URL))) throw new Error('sidecar never came up on ' + URL);
    chrome = launchChrome({ cdpPort: CDP_PORT, profileDir: join(scratch, 'chrome') });
    await sleep(1200);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Runtime.enable');
    const diag = collectDiagnostics(cdp);
    await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never reached the game screen');
    await sleep(1500);
    mkdirSync(OUT, { recursive: true });
    // Freeze the world so a translucent panel does not inherit a different agent position per run.
    await evalJS(cdp, `(() => { if (document.body) document.body.classList.add('no-flicker');
      if (typeof World !== 'undefined' && World.stop) { World.stop(); return 'frozen'; } return 'no-world'; })()`);

    await evalJS(cdp, `StationUI.openTerm('connectors')`);
    await sleep(1800);   // the panes fetch /api/toolsets, /api/connectors/catalog, /api/servicekeys

    for (const id of TABS) {
      if (ONLY && id !== ONLY) continue;
      console.log(id, await evalJS(cdp, clickTab(id)));
      await sleep(1100);
      console.log('shot', await capture(cdp, OUT, 'abilities-' + id));
    }

    // ---- behavioural round-trips: prove the new controls DO something, not just that they render ----
    if (!ONLY || ONLY === 'catalog') {
      await evalJS(cdp, clickTab('catalog'));
      await sleep(600);
      const filterProbe = await evalJS(cdp, `(() => {
        const vis = () => [...document.querySelectorAll('#cc-list .cc-card')].filter(c => !c.hidden).length;
        const groups = () => [...document.querySelectorAll('#cc-list .cc-group')].filter(g => !g.hidden).length;
        const hit = (f) => {
          const b = document.querySelector('.cc-filter[data-cc-filter="' + f + '"]');
          if (!b) return 'no-btn:' + f;
          b.click();
          return { cards: vis(), groups: groups(), active: b.classList.contains('active') };
        };
        const out = { all: hit('all'), none: hit('none'), apikey: hit('apikey'), oauth: hit('oauth'), installed: hit('installed') };
        // RENDERED truth, not the property I just set: .cc-card/.cc-group carry an explicit display:flex,
        // which outranks the UA [hidden]{display:none} rule — so a card can be "hidden" and fully visible.
        document.querySelector('.cc-filter[data-cc-filter="none"]').click();
        const cards = [...document.querySelectorAll('#cc-list .cc-card')];
        out.painted = { flaggedHidden: cards.filter(c => c.hidden).length,
                        actuallyPainted: cards.filter(c => c.offsetParent !== null).length,
                        groupsPainted: [...document.querySelectorAll('#cc-list .cc-group')].filter(g => g.offsetParent !== null).length };
        document.querySelector('.cc-filter[data-cc-filter="all"]').click();
        // the group counter must re-state what is SHOWN, never the authored total
        document.querySelector('.cc-filter[data-cc-filter="none"]').click();
        const g0 = document.querySelector('#cc-list .cc-group:not([hidden])');
        out.countMatchesShown = g0
          ? (g0.querySelector('.sec-tag').textContent === String([...g0.querySelectorAll('.cc-card')].filter(c => !c.hidden).length))
          : 'no-visible-group';
        document.querySelector('.cc-filter[data-cc-filter="all"]').click();
        return out;
      })()`);
      console.log('FILTER PROBE', JSON.stringify(filterProbe));
      await evalJS(cdp, `document.querySelector('.cc-filter[data-cc-filter="none"]').click()`);
      await sleep(500);
      console.log('shot', await capture(cdp, OUT, 'abilities-catalog-filtered'));
      await evalJS(cdp, `document.querySelector('.cc-filter[data-cc-filter="all"]').click()`);
    }

    if (!ONLY || ONLY === 'mcp') {
      // the front door must actually navigate, and the empty-state jump must use the same contract
      await evalJS(cdp, clickTab('toolsets'));
      await sleep(400);
      const routeProbe = await evalJS(cdp, `(() => {
        const active = () => (document.querySelector('.con-rail-item.active') || {}).dataset?.section || '?';
        const r = {};
        r.landedOn = active();
        document.querySelector('.ab-route[data-ab-to="catalog"]').click();
        r.afterCatalogRoute = active();
        document.querySelector('.ab-route[data-ab-to="mcp"]').click();
        r.afterMcpRoute = active();
        // the advanced fold must exist, be shut by default, and still hold the two power fields
        const adv = document.querySelector('.mc-adv');
        // NB: a closed <details> in Chrome uses content-visibility, not display:none, so its children
        // keep a non-null offsetParent. Height + checkVisibility are the honest "did it paint" probes.
        const ta = adv && adv.querySelector('#mc-headers');
        r.advanced = adv ? { open: adv.open,
          holdsHeaders: !!ta, holdsTimeout: !!adv.querySelector('#mc-timeout'),
          shutHeight: Math.round(ta.getBoundingClientRect().height),
          shutVisible: ta.checkVisibility ? ta.checkVisibility({ contentVisibilityAuto: true }) : 'n/a' } : 'missing';
        if (adv) { adv.open = true;
          r.advanced.openHeight = Math.round(ta.getBoundingClientRect().height);
          r.advanced.openVisible = ta.checkVisibility ? ta.checkVisibility({ contentVisibilityAuto: true }) : 'n/a';
          adv.open = false; }
        // KEYS empty-state jump — the button added beside a cured dead end must not be a new one
        document.querySelector('#con-tab-connectors-keys').click();
        const kb = document.querySelector('#ky-platforms [data-ab-to="catalog"]');
        if (kb) { kb.click(); r.emptyStateJump = active(); } else r.emptyStateJump = 'no-button';
        return r;
      })()`);
      console.log('ROUTER PROBE', JSON.stringify(routeProbe));
      await evalJS(cdp, clickTab('mcp'));
      await sleep(700);
      console.log('shot', await capture(cdp, OUT, 'abilities-mcp-form'));
    }

    if (!ONLY || ONLY === 'toolsets') {
      await evalJS(cdp, clickTab('toolsets'));
      await sleep(600);
      const moreProbe = await evalJS(cdp, `(() => {
        const row = document.querySelector('.ts-row .ts-tools button[data-ts-more]');
        if (!row) return 'no-more-button';
        const wrap = row.parentElement;
        // painted, not flagged — same trap the catalog filter fell into
        const painted = () => [...wrap.querySelectorAll('code')].filter(c => c.offsetParent !== null).length;
        const before = painted();
        row.click();
        return { paintedBefore: before, paintedAfter: painted(), total: wrap.querySelectorAll('code').length,
                 buttonGone: !wrap.querySelector('button[data-ts-more]') };
      })()`);
      console.log('TOOL-CHIP EXPANDER PROBE', JSON.stringify(moreProbe));
      // the inert row's cure: it must reach the REAL placement surface (REFIT), not no-op.
      const placeProbe = await evalJS(cdp, `(() => {
        const btn = document.querySelector('.ts-inert button[data-ts-place]');
        if (!btn) return 'no-place-button';
        const obj = btn.dataset.tsPlace;
        btn.click();
        return { object: obj,
                 refitOpen: !!(typeof Build !== 'undefined' && Build.isOpen && Build.isOpen()),
                 refitOn: document.body.classList.contains('refit-on'),
                 armedTile: (document.querySelector('.refit-proptile.active') || {}).dataset ? document.querySelector('.refit-proptile.active').dataset.prop : null };
      })()`);
      console.log('PLACE-ONE PROBE', JSON.stringify(placeProbe));
      await sleep(900);
      console.log('shot', await capture(cdp, OUT, 'abilities-place-refit'));
    }

    // ---- the CROSS-WINDOW routes. These are the two front-door answers that leave ABILITIES, and
    //      they take a different code path from the in-console tab jumps (openTerm, not a rail click),
    //      so a passing in-console probe says nothing about them.
    if (!ONLY) {
      const crossProbe = await evalJS(cdp, `(() => {
        const r = {};
        const titleOf = () => { const t = document.querySelector('#terms .term:last-child .term-title, #terms .term:last-child .tt-label');
          return t ? t.textContent.trim() : '(none)'; };
        const openKeys = () => Object.keys(window.__ABIL_OPEN__ || {});
        StationUI.openTerm('connectors');
        document.querySelector('.ab-route[data-ab-term="messaging"]').click();
        r.channels = { termCount: document.querySelectorAll('#terms .term').length, title: titleOf() };
        StationUI.openTerm('connectors');
        document.querySelector('.ab-route[data-ab-term="settings"]').click();
        r.settings = { termCount: document.querySelectorAll('#terms .term').length, title: titleOf(),
          // the section arg must land the settings rail ON providers, not just open the window
          providersActive: !!document.querySelector('#con-tab-settings-providers.active') };
        return r;
      })()`);
      console.log('CROSS-WINDOW PROBE', JSON.stringify(crossProbe));

      // ---- KEYS pick-a-platform: the cards were re-gridded, so re-prove a click still PREFILLS.
      await evalJS(cdp, `StationUI.openTerm('connectors')`);
      await sleep(500);
      const pickProbe = await evalJS(cdp, `(() => {
        document.querySelector('#con-tab-connectors-keys').click();
        const card = document.querySelector('#ky-catalog [data-ky-pick]');
        if (!card) return 'no-card';
        const id = card.dataset.kyPick;
        card.click();
        return new Promise(res => setTimeout(() => res({ picked: id,
          name: document.querySelector('#ky-name').value,
          docs: document.querySelector('#ky-docs').value ? 'set' : 'empty',
          msg: (document.querySelector('#ky-msg').textContent || '').slice(0, 60),
          focused: document.activeElement === document.querySelector('#ky-key') }), 400));
      })()`);
      console.log('KEYS PREFILL PROBE', JSON.stringify(pickProbe));
    }

    // ---- RESPONSIVE: this console is a DRAG-RESIZABLE window, so a media query cannot see it
    //      ([[comms-composer-fit-lane]]). The router + card grids must reflow on container width alone.
    if (!ONLY) {
      // measure with the CATALOG pane actually VISIBLE — a hidden pane's grid never reflows, and the
      // first #terms .term is not necessarily this console.
      await evalJS(cdp, `StationUI.openTerm('connectors')`);
      await sleep(400);
      await evalJS(cdp, `document.querySelector('#con-tab-connectors-catalog').click()`);
      await sleep(400);
      const reflow = await evalJS(cdp, `(() => {
        const pane = document.querySelector('#cc-list'); if (!pane) return 'no-catalog';
        const term = pane.closest('.term'); if (!term) return 'no-term';
        const cols = sel => { const g = term.querySelector(sel);
          return g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 'missing'; };
        const prev = term.style.width;
        const at = w => { term.style.width = w; void term.offsetWidth;
          return { px: Math.round(term.getBoundingClientRect().width),
                   router: cols('.ab-router-grid'),
                   cards: cols('#cc-list .cc-group:not([hidden]) .cc-grid') }; };
        const out = { wide: at('1180px'), mid: at('820px'), narrow: at('560px') };
        // nothing may overflow horizontally at the narrow width
        const body = term.querySelector('.term-console-body');
        out.narrowOverflow = body ? (body.scrollWidth - body.clientWidth) : 'no-body';
        term.style.width = prev;
        return out;
      })()`);
      console.log('REFLOW PROBE', JSON.stringify(reflow));

      // ---- the INSTALLED card state (.cc-on / .added). Nothing is connected on a seeded station and
      //      a real connect needs the public internet, so this is a CSS-ONLY check of the two states.
      // ⛔ `.cc-card` now TRANSITIONS border-color (depth pass), so a computed read taken in the same
      //    tick returns the START colour and the state reads as broken. Every read below is taken
      //    after the transition settles. (A frozen timeline does the same thing permanently — see the
      //    Browser-pane note in the lane memory.)
      const stateProbe = await evalJS(cdp, `(async () => {
        const settle = () => new Promise(r => setTimeout(r, 400));   // past --t-fast (120ms)
        const card = document.querySelector('#cc-list .cc-card'); if (!card) return 'no-card';
        const base = getComputedStyle(card).borderTopColor;
        card.classList.add('cc-on');
        await settle();
        const on = getComputedStyle(card).borderTopColor;
        card.classList.remove('cc-on');
        await settle();
        // the KEYS "already added" state signals through BORDER + TITLE COLOUR (never opacity — the
        // cardIn animation's retained final value outranks a normal opacity declaration).
        const ky = document.querySelector('#ky-catalog [data-ky-pick]');
        let added = 'no-ky-card';
        if (ky) {
          const t = ky.querySelector('.cc-top b');
          const before = { border: getComputedStyle(ky).borderTopColor, title: t ? getComputedStyle(t).color : '?' };
          ky.classList.add('added');
          await settle();
          const after = { border: getComputedStyle(ky).borderTopColor, title: t ? getComputedStyle(t).color : '?' };
          ky.classList.remove('added');
          await settle();
          // an un-clickable card must not ANSWER the pointer: no lift, edge stays green
          ky.classList.add('added');
          const hoverBase = getComputedStyle(ky);
          const hoverState = { translate: hoverBase.translate, border: hoverBase.borderTopColor };
          ky.classList.remove('added');
          await settle();
          added = { before, after, borderChanged: before.border !== after.border, titleDimmed: before.title !== after.title,
                    addedHover: hoverState };
        }
        return { baseBorder: base, connectedBorder: on, differs: base !== on, keyAdded: added };
      })()`);
      console.log('INSTALLED-STATE PROBE (css only)', JSON.stringify(stateProbe));

      // ---- the other theme: every new rule uses theme vars, so green must repaint with no literals.
      await evalJS(cdp, `StationUI.setTheme('green')`);
      await sleep(700);
      console.log('shot', await capture(cdp, OUT, 'abilities-green-theme'));
      const themeProbe = await evalJS(cdp, `(() => {
        const q = s => { const e = document.querySelector(s); return e ? getComputedStyle(e).color : 'missing'; };
        return { routeTitle: q('.ab-route-title'), filterActive: q('.cc-filter.active'), more: q('.ts-more') };
      })()`);
      console.log('GREEN THEME PROBE', JSON.stringify(themeProbe));
      await evalJS(cdp, `StationUI.setTheme('amber')`);
      await sleep(500);
    }

    // ---- A REAL CONNECT, end to end. Everything above is layout + wiring; this is the only probe that
    //      proves the installed path. Clicks a genuine no-setup catalog card, waits for the sidecar to
    //      really connect, then asserts the card flips to the installed state AND that the "connected"
    //      filter — which reported 0 on a cold station — now finds it. Runs against the throwaway seeded
    //      workspace this script creates, never the Commander's real station. Needs public internet;
    //      reports SKIPPED-OFFLINE rather than failing, so a boxed run stays honest.
    if (!ONLY || ONLY === 'connect') {
      await evalJS(cdp, `StationUI.openTerm('connectors')`);
      await sleep(400);
      await evalJS(cdp, `document.querySelector('#con-tab-connectors-catalog').click()`);
      await sleep(500);
      const started = await evalJS(cdp, `(() => {
        const btn = document.querySelector('#cc-list .cc-card[data-auth="none"][data-installed="0"] button[data-cc-act="add"]');
        if (!btn) return 'no-add-button';
        const card = btn.closest('.cc-card');
        btn.click();
        return { id: card.dataset.id };
      })()`);
      console.log('REAL CONNECT start', JSON.stringify(started));
      let connected = null;
      for (let i = 0; i < 20; i++) {
        await sleep(1500);
        connected = await evalJS(cdp, `(() => {
          const msg = (document.querySelector('#cc-msg').textContent || '');
          const card = document.querySelector('.cc-card[data-id="' + ${JSON.stringify(started.id || '')} + '"]');
          return { msg: msg.slice(0, 90), installed: card ? card.dataset.installed : '?',
                   ccOn: card ? card.classList.contains('cc-on') : false };
        })()`);
        if (connected.installed === '1' || /✕/.test(connected.msg)) break;
      }
      console.log('REAL CONNECT result', JSON.stringify(connected));
      if (connected && connected.installed === '1') {
        const after = await evalJS(cdp, `(() => {
          document.querySelector('.cc-filter[data-cc-filter="installed"]').click();
          const cards = [...document.querySelectorAll('#cc-list .cc-card')];
          const painted = cards.filter(c => c.offsetParent !== null);
          const r = { connectedFilterFinds: painted.length, ids: painted.map(c => c.dataset.id),
                      groupsPainted: [...document.querySelectorAll('#cc-list .cc-group')].filter(g => g.offsetParent !== null).length };
          document.querySelector('.cc-filter[data-cc-filter="all"]').click();
          return r;
        })()`);
        console.log('CONNECTED-FILTER PROBE', JSON.stringify(after));
        // and the MCP CONNECTORS pane must now show the same server as a live row
        await evalJS(cdp, `document.querySelector('#con-tab-connectors-mcp').click()`);
        await sleep(900);
        console.log('shot', await capture(cdp, OUT, 'abilities-connected'));
        const rowProbe = await evalJS(cdp, `(() => {
          const row = document.querySelector('#mc-list .mc-row');
          return row ? { id: row.dataset.id, state: (row.querySelector('.mc-state') || {}).textContent } : 'no-row';
        })()`);
        console.log('MCP ROW PROBE', JSON.stringify(rowProbe));
      } else {
        console.log('REAL CONNECT: SKIPPED-OFFLINE or refused — installed path NOT proven this run');
      }
    }

    // ---- NO WHITE HTML CONTROLS (standing order). The three OS-paint signatures are a white/near-white
    //      buttonface, the grey ButtonBorder, and black Arial. Sweep every control this console renders.
    if (!ONLY) {
      const paint = await evalJS(cdp, `(() => {
        const OS_BG = ['rgb(255, 255, 255)', 'rgb(239, 239, 239)'];
        const OS_BORDER = 'rgb(118, 118, 118)';
        const bad = [];
        const scope = document.querySelector('#terms .term');
        if (!scope) return 'no-console-open';
        scope.querySelectorAll('button, select, textarea, input, summary, details').forEach(el => {
          const cs = getComputedStyle(el);
          const hits = [];
          if (OS_BG.includes(cs.backgroundColor)) hits.push('bg:' + cs.backgroundColor);
          if (cs.borderTopColor === OS_BORDER) hits.push('border:' + cs.borderTopColor);
          if (/arial|sans-serif/i.test(cs.fontFamily) && !/VT323/i.test(cs.fontFamily)) hits.push('font:' + cs.fontFamily);
          if (hits.length) bad.push({ sel: el.tagName.toLowerCase() + '.' + (el.className || '(none)'), hits });
        });
        return { scanned: scope.querySelectorAll('button, select, textarea, input, summary, details').length, offenders: bad.slice(0, 12) };
      })()`);
      console.log('OS-PAINT SWEEP', JSON.stringify(paint));
    }

    if (diag.exceptions.length) console.log('PAGE EXCEPTIONS:', diag.exceptions);
    const errs = diag.consoleMsgs.filter(m => m.type === 'error');
    if (errs.length) console.log('CONSOLE ERRORS:', errs.slice(0, 10));
    console.log('done ->', OUT);
  } finally {
    try { if (chrome && chrome.proc) chrome.proc.kill(); } catch {}
    try { if (side && side.kill) side.kill(); } catch {}
  }
}
main().catch(e => { console.error(e); process.exit(1); });
