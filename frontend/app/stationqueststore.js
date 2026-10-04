/* STARNET — stationqueststore.js : the live wiring around the pure StationQuests engine (G1b).

   The killer generator, wired to real signals. It owns everything the pure engine can't touch:
     • the SIGNAL — subscribes to `agent.tool_call` on U.bus (harness.js re-emits every hero tool step;
       the SSE tee re-broadcasts routed-run tool calls NAME-ONLY — the same event that already drives the
       G0 per-tool prop pulse). Every real tool fire is checked: does the acting agent's ROOM grant the
       capability that tool needs? If not, a station quest is minted. This is the honest signal the audit
       flagged — a `capdenied` (or, the richer form, a tool reached-for that the floor can't grant) becomes
       playable direction. It NEVER emits on U.bus (subscription only) — the frozen contract is untouched
       and lint-emits has nothing to catch.
     • the RESOLUTION — on every sync it re-reads the live floor (World.heroCaps) and flips a gap done the
       instant its cap is granted (a prop was placed). Placement is the completion signal, never a claim.
     • the LABELS — resolved from the LIVE catalog (WorldModel.CAP_LABEL + the capability's canonical prop
       label from PropSprites.CATALOG) and the live roster (the agent's display name), never hardcoded.
     • the STANDING candidate — the one known non-tool gap: an OUTBOX quest when unattended work exists
       with no outbox placed (ReturnStore.pendingCount() > 0). (The STUDIO gap is a plain tool-gap — see below.)

   Self-persists to its own localStorage key (rides the backup prefix, like queststatestore/curiositystore —
   no save.js change). The projection (quests()) is joined into QuestStore.view, so these quests ride the
   EXACT same quest-log render + QuestState fold as every other quest — one shape, and completion gets G1a's
   gold celebration for free. NOTHING MINTS XP (the xp.js law): a station quest pays out the real capability
   on the floor, plus the shared celebration — never points. */
'use strict';
const StationQuestStore = (() => {
  const KEY = 'starnet.stationquests.v1';
  let state = null;
  let bound = false;

  function load() { try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch (_) { return null; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {} }
  const ready = () => typeof StationQuests !== 'undefined' && state;
  const nowMs = () => (typeof Date !== 'undefined' ? Date.now() : 0);

  /* ---------- live catalog / roster reads (the labels the engine can't know) ---------- */

  // the capability a firing tool NEEDS — the render-side mapper (toolprops.js), then prop→cap (worldmodel).
  // Returns the capability objectType string ('dish'|'cabinet'|'notebook'|'studio'|'jukebox') or null.
  function capForTool(name) {
    const propType = (typeof ToolProps !== 'undefined' && ToolProps.toolPropType) ? ToolProps.toolPropType(name) : null;
    if (!propType) return null;
    // toolprops returns a PROP TYPE keyed identically to worldmodel's CAP_PROP_MAP values for the cosmetic-name
    // cases (jukebox) and the canonical cap-prop cases; normalize through CAP_PROP_MAP so 'dish'→'dish' etc.
    const cap = (typeof WorldModel !== 'undefined' && WorldModel.CAP_PROP_MAP) ? WorldModel.CAP_PROP_MAP[propType] : null;
    return cap || propType;   // propType IS the cap for the direct cases (dish/cabinet/notebook/studio/jukebox)
  }

  // the plain-English power word for a capability (WEB/FILES/MEMORY/…), from the one owned source.
  function capLabelFor(cap) {
    const L = (typeof WorldModel !== 'undefined' && WorldModel.CAP_LABEL) ? WorldModel.CAP_LABEL[cap] : null;
    return L || String(cap || '').toUpperCase();
  }

  // the canonical placeable prop LABEL that grants a capability, resolved from the LIVE catalog — the first
  // catalog entry whose type maps to this cap (e.g. dish→"DISH", studio→"STUDIO"). Never hardcoded, so a
  // renamed/added prop can't drift. Returns NULL when no catalogued prop grants this cap — the honesty
  // guard: a quest completed by PLACEMENT must never be minted for a cap placement can't grant (e.g.
  // jukebox/Spotify, whose real unlock is OAuth in TOOLSETS, not a prop — a prop quest there could
  // literally never complete).
  function propLabelFor(cap) {
    const cat = (typeof PropSprites !== 'undefined' && PropSprites.CATALOG) ? PropSprites.CATALOG : [];
    const map = (typeof WorldModel !== 'undefined' && WorldModel.CAP_PROP_MAP) ? WorldModel.CAP_PROP_MAP : {};
    for (const c of cat) { if (c && map[c.id] === cap) return c.label; }
    return null;
  }

  // the acting agent's display name (roster), or the id if we can't resolve it.
  function agentLabelFor(agentId) {
    if (!agentId) return 'the agent';
    try {
      if (typeof App !== 'undefined' && App.agentName) { const n = App.agentName(agentId); if (n) return n; }
    } catch (_) {}
    return agentId;
  }

  // the capability set the acting agent's ROOM actually grants right now (World.heroCaps → [{objectType}]).
  // COMPUTE is the harness freebie and CONNECTORS are account-level — heroCaps already excludes both — so
  // this is precisely the placed-on-the-floor set the gap detector compares against.
  function grantedCaps(agentId) {
    const out = new Set();
    try {
      const caps = (typeof World !== 'undefined' && World.heroCaps) ? World.heroCaps(agentId) : [];
      for (const c of (caps || [])) { const t = (c && typeof c === 'object') ? c.objectType : c; if (t) out.add(t); }
    } catch (_) {}
    return out;
  }

  // the engine's completion predicate: does THIS gap's agent room now grant the capability?
  function gapGranted(entry) {
    if (!entry || !entry.cap) return false;
    return grantedCaps(entry.agentId).has(entry.cap);
  }

  /* ---------- signal handling ---------- */

  // a real tool fired — if it needs a capability the acting agent's room doesn't grant, mint the quest.
  // Only cap-mappable tools (dish/cabinet/notebook/studio/jukebox) can gap — connector/workbench/compute
  // have their own floor story (toolprops returns null / the cap is the freebie), so they never mint here.
  function onToolCall(p) {
    if (!ready() || !p || !p.name) return;
    const cap = capForTool(p.name);
    if (!cap) return;
    if (grantedCaps(p.agentId).has(cap)) return;   // the room already grants it — no gap, no quest
    const propLabel = propLabelFor(cap);
    if (!propLabel) return;   // no placeable prop grants this cap → placement can't close it → never mint (honesty guard)
    const rec = StationQuests.record(state, {
      agentId: p.agentId || 'agent',
      cap,
      capLabel: capLabelFor(cap),
      propLabel,
      agentLabel: agentLabelFor(p.agentId)
    }, nowMs());
    if (rec) { save(); poke(); }
  }

  // if the log is open, refresh it so the new pin/row lands immediately (a no-op when closed).
  function poke() { try { if (typeof StationUI !== 'undefined' && StationUI.rerender) StationUI.rerender('quests', false); } catch (_) {} }

  /* ---------- the STANDING candidate (a non-tool gap folded through the same engine) ----------
     The STUDIO gap needs no special case: it's a plain tool-gap — the moment an `image_generate` fires in a
     room with no STUDIO prop, capForTool('image_generate')→'studio' mints "reached for STUDIO — place a
     STUDIO in its bay", and placing the studio prop closes it (feature 3 makes that prop real). The one gap
     with no tool signal is the OUTBOX: unattended work exists but nowhere to stage it. It's modeled against
     the FOCUSED hero (App.heroId) so it rides the same (agent,cap) dedup + projection, with a synthetic cap
     key ('outbox') that no tool maps to — so it can never collide with a real tool-gap entry. */
  function heroId() {
    try { if (typeof App !== 'undefined' && App.heroId) return App.heroId(); } catch (_) {}
    return 'agent';
  }

  // OUTBOX: unattended work exists (ReturnStore.pendingCount > 0) but no OUTBOX prop is placed to stage it.
  function evalOutboxCandidate() {
    if (!ready()) return;
    let pending = 0, hasOutbox = false;
    try { pending = (typeof ReturnStore !== 'undefined' && ReturnStore.pendingCount) ? (ReturnStore.pendingCount() | 0) : 0; } catch (_) {}
    try {
      const doc = (typeof World !== 'undefined' && World.stationDoc) ? World.stationDoc() : null;
      hasOutbox = !!(doc && Array.isArray(doc.props) && doc.props.some(p => p && p.t === 'outbox'));
    } catch (_) {}
    if (pending > 0 && !hasOutbox) {
      StationQuests.record(state, { agentId: heroId(), cap: 'outbox', capLabel: 'DELIVERY', propLabel: 'OUTBOX', agentLabel: 'The station' }, nowMs());
    }
  }

  /* ---------- the heartbeat: resolve + re-evaluate standing candidates. Driven by the same 1s station
     tick + every quest-log render (mirrors QuestStateStore.sync). Idempotent + side-effect-light. ---------- */
  function sync() {
    if (!ready()) return;
    evalOutboxCandidate();
    // resolve completed gaps against the live floor. The synthetic 'outbox' cap isn't in heroCaps (no
    // capability grant), so it's resolved explicitly via the doc read — it closes when its prop is placed.
    const closed = StationQuests.refresh(state, entry => {
      if (entry.cap === 'outbox') {   // the OUTBOX standing quest closes when an OUTBOX prop lands on the floor
        try {
          const doc = (typeof World !== 'undefined' && World.stationDoc) ? World.stationDoc() : null;
          return !!(doc && Array.isArray(doc.props) && doc.props.some(p => p && p.t === 'outbox'));
        } catch (_) { return false; }
      }
      return gapGranted(entry);
    }, nowMs());
    if (closed.length) {
      save();   // completedAt is durable the instant the gap closes (the celebration rides QuestState's fold over quests())
      // G1c QUEST CHAINING: a station gap just closed (a prop was placed → a real capability is live). Offer the
      // natural follow-up ONCE, through SuggestStore's EXISTING idea cadence — it rides the suggest slot and
      // respects its cooldown/session cap. If the suggest gate is blocked, it drops silently (anti-nag; never
      // queued). Prefer a genuine tool-gap capability over the synthetic OUTBOX standing quest.
      const chainable = closed.find(e => e && e.cap && e.cap !== 'outbox') || null;
      if (chainable && typeof SuggestStore !== 'undefined' && SuggestStore.armChain) {
        try { SuggestStore.armChain(chainable.capLabel || chainable.cap); } catch (_) {}
      }
    }
  }

  /* ---------- the projection consumed by QuestStore.view (so these ride the shared render + fold) ---------- */
  function quests() { return ready() ? StationQuests.project(state) : []; }
  function openCount() { return ready() ? StationQuests.openCount(state) : 0; }

  // wave a station quest off forever (always dismissible — the sandbox law: a fix-it is a suggestion, never
  // a push). Returns true when it took. Routed from the quest-log dismiss ✕ (stationui buildQuests).
  function dismiss(id) {
    if (!ready() || !id) return false;
    const ok = StationQuests.dismiss(state, id, nowMs());
    if (ok) save();
    return ok;
  }
  const isDismissed = id => ready() ? StationQuests.isDismissed(state, id) : false;

  /* ---------- lifecycle ---------- */
  function bind() {
    if (bound) return;
    if (typeof U !== 'undefined' && U.bus && U.bus.on) {
      U.bus.on('agent.tool_call', onToolCall);   // subscription only — NEVER an emit (the frozen contract stands)
      bound = true;
    }
  }
  function init() {
    state = (typeof StationQuests !== 'undefined') ? StationQuests.hydrate(load()) : null;
    bind();
    sync();
  }

  // a NEW AGENT starts with no station-quest history (own key — Save.clear() only wipes starnet.save; mirrors
  // QuestStateStore.reset / CuriosityStore.reset). The next init() hydrates clean.
  function reset() { state = null; try { localStorage.removeItem(KEY); } catch (_) {} }

  return { init, sync, quests, openCount, dismiss, isDismissed, reset,
    // exposed for tests: the pure-ish seams the browser flow drives
    _onToolCall: onToolCall, _capForTool: capForTool };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { StationQuestStore };
