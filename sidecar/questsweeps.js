/* sidecar/questsweeps.js — QUEST V2: the PURE matching half of the mechanical contract sweeps.

   quest-store.js owns completion (completeByContract / bindRun / stallRun) but is deliberately exact-key:
   it never decides WHICH keys a live seam just proved. That decision is seam-specific — "is this capability
   live" or "does this committed memory cover that fact" — and this module
   holds it as pure, node-testable functions so sidecar/index.js only wires call sites (composition-root law).

   The three real sweeps (each caller passes questStore.openForAgent(agentId) — its own + station-wide quests):

     • prop     — livePropKeys(quests, agentId, station, resolved): the run-admission seam is where the sidecar
                  PROVES a capability is live — resolveTools projects the placed office into real grants, fresh
                  every run. A prop key may name a placeable objectType (dish/cabinet/workbench/…), a capId
                  family (web/cabinet/workbench/…), a resolved tool name (covers live MCP connector tools), or
                  'compute'. There is no other server-side placement signal (the world/build lives in the
                  browser); a run carrying the grant IS the harness's proof the capability went live.

     • fact     — learnedFactKeys(quests, agentId, record): fires from writeMemoryRecord (sidecar/index.js), the
                  ONE server-side path that commits a memory record (silent auto-save + Keep/Edit turn-in). A
                  fact key matches when it IS the committed record's id, equals the committed content, or appears
                  verbatim inside it (normalized, ≥ MIN_FACT_KEY chars so 'a' can never match) — the durable
                  record is the proof the harness learned it. NOTE the dossier itself lives in the BROWSER
                  (localStorage; /api/study/resolve only reconciles stashes and does not carry the accepted
                  dimension), so there is no honest server-side dossier-write seam — the memory commit is the
                  closest real proof point, and dossier-dim keys simply stay open until a memory covers them.

     • artifact — artifactQuestKeys(quests, agentId): the run-end settle hook resolves each open artifact key
                  inside the CALLING agent's fs jail (fsJail.resolveInside — same proof /api/file uses) and
                  completes only when the file EXISTS on disk. This module only selects the candidates; the
                  existence check stays at the composition root (it needs the real fs + jail). Workshop/night-
                  shift builds ride the same runOnce host, so their manifests land under the same sweep.

   PURE: no fs / clock / rng / network (lint-determinism.js scans sidecar/). Every function is defensive about
   its inputs (junk quests/absent fields never throw) and re-checks visibility (open + own-or-station-wide)
   rather than trusting the caller's read. */
'use strict';

const MIN_FACT_KEY = 4;   // a normalized fact key shorter than this can never substring-match (anti 'a'-matches-everything)

// normalized comparison key: lowercase, collapse whitespace, trim (the quest-store normTitle idiom).
function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }

// is this quest open with a contract of `type`, and visible to `agentId` (its own or station-wide)?
function openFor(q, type, agentId) {
  return !!(q && q.status === 'open' && q.contract && q.contract.type === type
    && (q.agentId == null || q.agentId === String(agentId == null ? '' : agentId)));
}

// ---- prop: which open prop-contract keys does THIS run's resolved capability set prove live? ----
// live vocabulary = placed objectTypes in the agent's room + resolved capId families + resolved tool names
// (+ 'compute' when the gate is open). Returns the ORIGINAL contract keys (completeByContract is exact-key).
function livePropKeys(quests, agentId, station, resolved) {
  const live = new Set();
  try {
    const agent = station && station.agents && station.agents[String(agentId == null ? '' : agentId)];
    const room = agent && station.rooms && station.rooms[agent.room];
    for (const o of ((room && room.objects) || [])) { const t = norm(o && o.objectType); if (t) live.add(t); }
  } catch (_) { /* a malformed station proves nothing — never throws */ }
  for (const g of ((resolved && resolved.grants) || [])) { const c = norm(g && g.capId); if (c) live.add(c); }
  for (const t of ((resolved && resolved.tools) || [])) { const n = norm(t); if (n) live.add(n); }
  if (resolved && resolved.hasCompute) live.add('compute');
  const out = []; const seen = new Set();
  for (const q of (Array.isArray(quests) ? quests : [])) {
    if (!openFor(q, 'prop', agentId)) continue;
    const k = norm(q.contract.key);
    if (k && live.has(k) && !seen.has(k)) { seen.add(k); out.push(q.contract.key); }
  }
  return out;
}

// ---- fact: which open fact-contract keys does this COMMITTED memory record prove learned? ----
// record = { id, content } (the durable notebook record just written). A key matches when it IS the record id,
// equals the content, or appears verbatim inside it (normalized, ≥ MIN_FACT_KEY chars). Returns original keys.
function learnedFactKeys(quests, agentId, record) {
  const rid = String((record && record.id) || '');
  const content = norm(record && record.content);
  const out = []; const seen = new Set();
  for (const q of (Array.isArray(quests) ? quests : [])) {
    if (!openFor(q, 'fact', agentId)) continue;
    const rawKey = q.contract.key;
    const k = norm(rawKey);
    if (!k || seen.has(k)) continue;
    const hit = (rid && rawKey === rid) || k === content || (k.length >= MIN_FACT_KEY && content.indexOf(k) >= 0);
    if (hit) { seen.add(k); out.push(rawKey); }
  }
  return out;
}

// ---- artifact: the open artifact-contract candidates for this agent — the caller (composition root) resolves
//      each key inside the agent's fs jail and completes only the keys whose file EXISTS (truthful telemetry). ----
function artifactQuestKeys(quests, agentId) {
  const out = []; const seen = new Set();
  for (const q of (Array.isArray(quests) ? quests : [])) {
    if (!openFor(q, 'artifact', agentId)) continue;
    const key = String(q.contract.key == null ? '' : q.contract.key).trim();
    if (key && !seen.has(key)) { seen.add(key); out.push({ id: q.id, key: key }); }
  }
  return out;
}

module.exports = { livePropKeys, learnedFactKeys, artifactQuestKeys, _internals: { norm, openFor, MIN_FACT_KEY } };
