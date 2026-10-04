// scripts/lib/states.mjs — the canonical list of UI states the screenshotter drives.
//
// The bottom dock (#bottombar) groups items into 4 popovers (CREW / WORK / BUILD / SYSTEM).
// Each item keeps a STABLE id or data-term (see frontend/index.html / navdock.js), so we click
// by id/[data-term] instead of by visible text — text drifts, ids don't. The popover need not
// be open: .click() fires the item's bound handler even while the flyout is visually hidden.
//
// Re-derived from current trunk (index.html lines 166-200): adds MANUAL + NOTIFS panels that
// the old text-matched list missed, and fixes ROSTER (it opens the full-bleed RECRUITMENT BAY).

// Close whatever panel/overlay/mode is open so panels don't stack between shots.
// Hardened against an early call (guards document.body) — the cold-boot race could fire this
// before the page finished, which is what threw the old "classList of null" warning.
export const CLOSE = `(() => {
  if (!document.body) return 'no-body';
  // exit REFIT/BUILD mode first (a full-canvas mode, not a #terms panel)
  const rd = document.getElementById('refit-done'); if (rd) { try { rd.click(); } catch {} }
  document.querySelectorAll('.refit-overlay').forEach(o => { try { o.remove(); } catch {} });
  try { document.body.classList.remove('refit-on'); } catch {}
  // Click the REAL close button on every open window so the app's own closeTerm() runs and its
  // internal open{} map clears (nuking #terms.innerHTML leaves that map populated → corrupts the
  // single-vs-cascade placement logic).
  document.querySelectorAll('.term-x, #terms .x, #terms .close, #terms [data-close], .term-close, .panel-close, .win-close, .rb-close, .recruit-close').forEach(b => { try { b.click(); } catch {} });
  // Dismiss the one-time grouped-dock coach (#nav-coach, index.html) with its own GOT-IT control:
  // shoot runs on a fresh browser profile every time, so without this the coach pops mid-sweep on a
  // timing-dependent frame (it dimmed work-automation on 2026-08-05) and poisons golden determinism.
  const nc = document.getElementById('nav-coach-x'); if (nc) { try { nc.click(); } catch {} }
  // Escape as a backstop for panels that honor it (recruitment bay, etc.)
  ['keydown','keyup'].forEach(type => document.dispatchEvent(new KeyboardEvent(type, { key:'Escape', code:'Escape', keyCode:27, which:27, bubbles:true })));
  return 'closed';
})()`;

// Open a dock panel by a STABLE selector (id or [data-term]); reports NOTFOUND if absent.
export const openSel = (sel, label) => `(() => {
  ${CLOSE};
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return 'NOTFOUND:' + ${JSON.stringify(sel)};
  try { el.click(); } catch (e) { return 'CLICK_ERR:' + e.message; }
  return 'opened:' + ${JSON.stringify(label || sel)};
})()`;

// The notifications panel is intentionally user-owned state, so its rows carry
// wall-clock timestamps and whatever the capture run happened to emit. Normalize
// only the rendered rows for this screenshot frame. Seed one notification through the real
// API first: the empty-state renderer has no .nf-list, so relying on incidental boot events
// made identical builds alternate between the empty and populated layouts. This runs only
// in the screenshotter's disposable browser profile.
export const openStableNotifs = `(() => {
  if (typeof StationUI === 'undefined' || typeof StationUI.notify !== 'function') return 'DRIVE_ERR:notification-api-missing';
  StationUI.notify('Screenshot fixture notification', 'good');
  ${openSel('[data-term="notifs"]', 'NOTIFS')};
  const list = document.querySelector('.nf-list');
  if (!list) return 'DRIVE_ERR:notification-list-missing';
  if (list) {
    const rows = [
      ['07:00', 'Station layout saved', 'good'],
      ['07:01', 'NOVA is online - anthropic/claude-3.5-sonnet', 'good'],
      ['07:02', 'Connector "local" connected', 'good'],
      ['07:03', 'saved briefing.md - your agent runs on it now', 'gold'],
      ['07:04', 'routine ran', 'good'],
      ['07:05', 'budget resumed - global cap raised; agents can run again', 'good'],
      ['07:06', 'StarNet is up to date', 'good'],
      ['07:07', 'routine "morning check" scheduled for NOVA', 'good'],
      ['07:08', 'copied the last reply', 'good'],
      ['07:09', 'rewound agent to an earlier restore point', 'warn'],
      ['07:10', 'Connector "local" removed', ''],
      ['07:11', 'first steps complete - you have got the controls', 'gold']
    ];
    list.innerHTML = rows.map(r => '<div class="nf ' + r[2] + '"><span class="ts">[' + r[0] + ']</span> ' + r[1] + '</div>').join('');
  }
  return 'opened:NOTIFS';
})()`;

// The seeded dossier opens before its lazily-loaded skin is guaranteed to be ready. Capturing on
// the fixed panel delay alone therefore alternated between the procedural loading mannequin and
// the real portrait depending on whether the preceding IN-GAME frame bought the loader enough
// time. Make this frame wait on the same sprite authority the dossier uses, then yield two paints
// so drawPortrait's already-registered promise callback reaches the canvas before CDP reads it.
// This is deliberately scoped to the seeded golden driver: the seed's hero wears DEFAULT_SKIN.
export const openStableAgents = `(async () => {
  const opened = ${openSel('[data-term="agents"]', 'AGENTS')};
  if (/^(NOTFOUND|CLICK_ERR)/.test(String(opened))) return opened;
  const loaderReady = await new Promise(resolve => {
    const deadline = performance.now() + 5000;
    const probe = () => {
      if (typeof SPRITES === 'object' && SPRITES.ready && typeof SPRITES.ensureSkin === 'function' &&
          typeof DATA !== 'undefined' && DATA.DEFAULT_SKIN) return resolve(true);
      if (performance.now() >= deadline) return resolve(false);
      setTimeout(probe, 25);
    };
    probe();
  });
  if (!loaderReady) return opened + ':portrait-loader-timeout';
  let ready = false;
  try {
    ready = !!(await Promise.race([
      SPRITES.ensureSkin(DATA.DEFAULT_SKIN),
      new Promise(resolve => setTimeout(() => resolve(false), 5000))
    ]));
  } catch (_) {}
  if (ready) await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return opened + (ready ? ':portrait-ready' : ':portrait-timeout');
})()`;

// Provider health is deliberately live in the product, but a golden frame must not depend on whether an
// external endpoint answered during its 650 ms capture window. The seeded profile carries a placeholder
// OpenRouter credential, so Settings otherwise alternates between CHECKING, NOT VERIFIED, and CHECK FAILED.
// Stub only the screenshot browser's no-generation probe before the panel opens, then wait for its real
// coalesced repaint. Product code and ordinary seeded runs still exercise the live probe unchanged.
export const openStableSettings = `(async () => {
  try {
    if (typeof Harness === 'object' && Harness) {
      Harness.probeProvider = async () => ({ reachable: false, credentialVerified: false, screenshotFixture: true });
    }
  } catch (_) {}
  const opened = ${openSel('[data-term="settings"]', 'SETTINGS')};
  if (/^(NOTFOUND|CLICK_ERR)/.test(String(opened))) return opened;
  const settled = await new Promise(resolve => {
    const deadline = performance.now() + 3000;
    const probe = () => {
      const panel = document.querySelector('#terms .term');
      const checking = panel && /CHECKING/.test(String(panel.textContent || ''));
      if (panel && !checking) return resolve(true);
      if (performance.now() >= deadline) return resolve(false);
      setTimeout(probe, 25);
    };
    probe();
  });
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return opened + (settled ? ':provider-health-settled' : ':provider-health-timeout');
})()`;

// The quest refresher is intentionally ambient: it may finish its startup cycle at any point in the
// screenshot sweep, and a seeded placeholder credential can add a provider-error ledger row. Freeze
// only the screenshot browser's read seam to a truthful empty/not-yet-run fixture before opening the
// panel. This keeps the golden frame about layout while the real refresh lifecycle stays covered by
// its store, HTTP, and journey tests.
export const openStableQuests = `(async () => {
  try {
    if (typeof QuestRefreshStore === 'object' && QuestRefreshStore) {
      QuestRefreshStore.sync = () => {};
      QuestRefreshStore.status = () => ({
        enabled: true, northStar: null, lastCycleAt: 0, dueAt: 0, due: false,
        why: null, binding: null, inFlight: false, openCount: 0, ledger: []
      });
      QuestRefreshStore.isRunning = () => false;
    }
  } catch (_) {}
  const opened = ${openSel('[data-term="quests"]', 'QUESTS')};
  if (/^(NOTFOUND|CLICK_ERR)/.test(String(opened))) return opened;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return opened + ':refresh-fixture-settled';
})()`;

export const closeOnly = `(() => { ${CLOSE}; return 'reset'; })()`;

// REFIT first-use guide: on a fresh browser profile, build.js showGuide() paints a full-canvas
// "▮ BUILD YOUR STATION" modal (.refit-guide) OVER the canvas. It intercepts every pointer event, so
// synthetic canvas input (CDP Input.dispatchMouseEvent) hits the guide, not the grid. The Truth-Auditor
// prop-place scenario must clear it before any real-mouse placement. Clicking #refit-guide-go marks it
// seen (localStorage) so it never re-shows; remove() is the backstop. Returns the count dismissed.
export const dismissRefitGuide = `(() => {
  let n = 0;
  document.querySelectorAll('.refit-guide').forEach(g => {
    const go = g.querySelector('#refit-guide-go');
    try { if (go) { go.click(); n++; } else { g.remove(); n++; } } catch (_) {}
  });
  return n;
})()`;

// Every key UI state: the floor at rest + each of the 15 dock panels.
// Re-derived from the post-nav-condense dock (frontend/index.html #bottombar, 2026-08-05):
// ROUTINES+LOOPS collapsed into AUTOMATION, SKILLS merged into ABILITIES (the connectors term),
// REWIND+LOGBOOK joined the Commander dossier, UPDATES is its own SYSTEM window again, and
// QUESTS gained a dock door. State names stay stable where the surface persisted (the atlas and
// golden baselines key on them); only renamed/removed surfaces change names.
export function buildStates() {
  return [
    { name: 'ingame',          drive: closeOnly,                                   wait: 900 },
    // CREW group
    { name: 'crew-agents',     drive: openStableAgents },
    // ONE recruit door now (#bb-recruit): the old ROSTER/SUMMON split collapsed into a single
    // bay whose class dossier carries both verbs, so one state captures it.
    { name: 'crew-recruit',    drive: openSel('#bb-recruit', 'RECRUIT'),           wait: 1800 },
    { name: 'crew-commander',  drive: openSel('[data-term="commander"]', 'COMMANDER') },
    // WORK group
    { name: 'work-tasks',      drive: openSel('[data-term="tasks"]', 'TASKS') },
    // DELIVERABLES: the backend-backed run-artifact + Workshop library. The panel fetches
    // GET /api/deliverables on open, so give it a wait to let the async rows/toolbar settle
    // before the enumerator probe runs (finding 206d3ceb).
    { name: 'work-deliverables', drive: openSel('[data-term="deliverables"]', 'DELIVERABLES'), wait: 1200 },
    { name: 'work-recipes',    drive: openSel('#bb-missions', 'RECIPES') },
    // AUTOMATION replaced the ROUTINES door when ROUTINES+LOOPS merged into one window
    // (nav-condense, 2026-08-04) — keep the canonical post-condense state key so the
    // state enumerator and golden baseline describe the same live surface.
    { name: 'work-automation', drive: openSel('[data-term="automation"]', 'AUTOMATION') },
    { name: 'work-quests',     drive: openStableQuests },
    // BUILD group
    { name: 'build-station',   drive: openSel('#bb-build', 'REFIT STATION'),       wait: 2000 },
    // ABILITIES kept the stable connectors term when SKILLS folded into it (nav-condense2),
    // so the state name stays build-connectors for atlas/golden continuity.
    { name: 'build-connectors',drive: openSel('[data-term="connectors"]', 'ABILITIES') },
    { name: 'sys-messaging',   drive: openSel('[data-term="messaging"]', 'CHANNELS') },
    // SYSTEM group
    { name: 'build-manual',    drive: openSel('[data-term="manual"]', 'FIELD MANUAL') },
    { name: 'sys-settings',    drive: openStableSettings },
    { name: 'sys-updates',     drive: openSel('[data-term="updates"]', 'UPDATES') },
    { name: 'sys-notifs',      drive: openStableNotifs },
  ];
}
