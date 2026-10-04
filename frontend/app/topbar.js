/* STARNET — topbar.js : the TOPBAR INSTRUMENT-CLUSTER logic (read-only wiring).

   The topbar holds one cockpit gauge group: COMMANDER (level + achievement progress)
   and the moved-up session-status instruments (UPLINK / ONLINE / save).

   This module OWNS none of the data. It is a pure read-only consumer:
     - COMMANDER level   — read from JourneyStore's server-owned progression snapshot.
                             Crew XP cannot write this headline or celebrate its level.
     - UPLINK / ONLINE / save — their markup was moved up from #bottombar .bb-right with ids
                             intact, so main.js save() and stationui.js tick()/flashSave() keep
                             writing them with zero changes here.

   It NEVER emits a bus event and never mutates another module's state — the frozen
   shared/events.js contract stays untouched, and the lint-emits gate has nothing to catch. */
'use strict';
const Topbar = (() => {
  let wired = false;
  let lastCommanderLevel = null;

  const $ = sel => document.querySelector(sel);

  // ---- Commander achievement sliver: read-only projection of durable Journey proof ----
  function paintXp() {
    try {
      const j = typeof JourneyStore !== 'undefined' && JourneyStore.status ? JourneyStore.status() : null;
      const g = j && j.progression;
      const label = document.getElementById('gt-station');
      if (!g || !Number.isFinite(g.level)) {
        if (label) label.textContent = '—'; lastCommanderLevel = null;
        const emptyFill = $('#tb-station .tb-xp-fill'); if (emptyFill) emptyFill.style.width = '0%';
        return;
      }
      const stale = JourneyStore.state && JourneyStore.state().stale;
      if (label) label.textContent = 'Lv ' + g.level + (stale ? ' · saved' : '');
      if (lastCommanderLevel != null && g.level > lastCommanderLevel) {
        const chip = document.getElementById('tb-station');
        if (chip) { chip.classList.remove('lvup'); void chip.offsetWidth; chip.classList.add('lvup'); }
        if (typeof SFX !== 'undefined' && SFX.level) SFX.level();
      }
      lastCommanderLevel = g.level;
      const fill = $('#tb-station .tb-xp-fill');
      if (fill && g.nextLevelAt > g.levelStartsAt) {
        const pct = Math.max(0, Math.min(100, Math.round(100 * (g.points - g.levelStartsAt) / (g.nextLevelAt - g.levelStartsAt))));
        fill.style.width = pct + '%';
        const xp = $('#tb-station .tb-xp');
        if (xp) xp.title = 'COMMANDER Lv ' + g.level + ' — ' + g.points + ' achievement points; ' + g.pointsToNextLevel + ' to the next level';
      }
    } catch (_) { /* honest no-op: leave the sliver where it is */ }
  }

  /* ---- UPLINK (#sig): wired to the REAL SSE bridge health (World.linkState), the same predicate the
     canvas dims its live telemetry with. Full bars + UPLINK while the bridge is up; when it dies the
     bars collapse to the dead glyph and the label flips to LINK DOWN in red (mirrors the canvas
     LINK DOWN marker). Before the bridge is ever opened (title screen / pre-entry) it shows a neutral
     STANDBY rather than a false green or a false alarm. Was static HTML no JS ever wrote. ---- */
  // UP = the rising full-signal glyph (only when the bridge is proven live); DOWN = the dead flat glyph;
  // STANDBY = an EVEN, dim mid-level bar — deliberately NOT the full-signal glyph, so a pre-bridge state can
  // never read as a live green uplink (the bug: STANDBY painted a full SIG_UP beside the ONLINE pill).
  const SIG_UP = '▂▄▆█', SIG_DOWN = '▁▁▁▁', SIG_STANDBY = '▃▃▃▃';
  function linkNow() {
    try { if (typeof World !== 'undefined' && World.linkState) return World.linkState(); } catch (_) {}
    return null;
  }
  function paintSig() {
    const el = $('#sig'); if (!el) return;
    const bars = el.querySelector('b'); if (!bars) return;
    const ls = linkNow();
    // no world / never bridged / deliberately paused → neutral standby (never a false ONLINE-green,
    // never a false DOWN-red). Only a genuinely bridged-but-dead link paints the red fault state.
    if (!ls || !ls.bridged || ls.paused) {
      el.classList.remove('down');
      el.classList.add('standby');
      el.childNodes[0].nodeValue = 'STANDBY ';
      bars.textContent = SIG_STANDBY;   // dim even bars — NOT full signal
      el.title = ls && ls.paused ? 'connection to the background service is paused (disconnected)' : 'connection to StarNet’s background service — standby (not connected yet)';
      return;
    }
    if (ls.down) {
      el.classList.remove('standby');
      el.classList.add('down');
      el.childNodes[0].nodeValue = 'LINK DOWN ';
      bars.textContent = SIG_DOWN;
      el.title = 'lost the connection to StarNet’s background service — live numbers pause until it’s back (is the app still running?)';
    } else {
      el.classList.remove('down', 'standby');
      el.childNodes[0].nodeValue = 'UPLINK ';
      bars.textContent = SIG_UP;
      el.title = 'connected to StarNet’s background service — everything on screen is live';
    }
  }

  function init() {
    if (wired) return;
    wired = true;

    // first paints (may run before any event — honest current level)
    paintXp();
    paintSig();

    if (typeof U !== 'undefined' && U.bus) {
      // the same real outcomes xpstore.js grows the station on — repaint the sliver after it folds.
      for (const n of ['agent.run.end', 'agent.tool_result', 'memory.feedback', 'workitem.delivered', 'channel.delivery']) {
        U.bus.on(n, () => { try { paintXp(); } catch (_) {} });
      }
    }

    // repaint the XP sliver on a slow cadence too, in case a level-up celebration reset the level
    // (cheap: one read-only compute; no network). Piggybacks the same 30s tick.
    setInterval(paintXp, 30000);

    // UPLINK health: poll World.linkState on a short cadence (the readyState check is the fast signal;
    // 3s catches a dropped socket well within the DOWN threshold) so #sig tracks the live bridge, not
    // a frozen glyph. Cheap: one read-only predicate, no network.
    setInterval(paintSig, 3000);
  }

  // start once the DOM + app globals exist (this script loads after app.js)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // expose a tiny read-only surface for dev/verification (mirrors testapi.js style; inert otherwise)
  return { init, _paintXp: paintXp, _paintSig: paintSig };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { Topbar };
