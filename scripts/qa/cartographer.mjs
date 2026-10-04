#!/usr/bin/env node
/* scripts/qa/cartographer.mjs — the Station Atlas MAPPER (the perfection-loop machine's script half).
 *
 * WHY THIS EXISTS: the QA Station (qa/QA_STATION.md) is a REGRESSION watch — it proves trunk
 * stays green and the app keeps booting. It CANNOT answer "is every single UI element / feature
 * correct, purposeful, and polished?" because nothing enumerates the full surface. The Cartographer
 * is that missing layer: it mechanically ENUMERATES every surface element (UI controls, slash
 * commands, API routes, bus events, shoot states) and keeps a sharded registry (qa/atlas/areas/*.json)
 * honest — appending a skeleton entry for anything new, refreshing lastSeen for anything still there,
 * and marking `missing:true` (+ ONE ledger finding) for anything that vanished. A Perfectionist SESSION
 * (loops/perfectionist.md) then drives each entry to `perfected`. The convergence gauge is `--status`.
 *
 * THE STATION LAW (Charter Part 2, absolute here): scripts DETECT + write the ledger; sessions JUDGE
 * + notify. So this script writes ONLY the harvested/mechanical fields (skeletons, lastSeen, missing,
 * firstSeen, harvested label/selector/state). It NEVER touches the SESSION-OWNED judgment fields
 * (purpose / promise / wiring / coverage / status-beyond-unmapped / auditedAt). A sweep that re-finds
 * an existing entry updates its lastSeen and NOTHING a human decided. The Cartographer never notifies.
 *
 * HOUSE PATTERN (matches scripts/qa/{ledger,guardian,janitor}.mjs + the sidecar stores): the CORE is a
 * PURE factory `makeCartographer({ io, clock, git })`. No ambient time, no ambient disk, no child
 * processes, no git in the core — the host injects all three. The core's job is the DECISION logic:
 * validate + merge harvested elements into the registry shards, slug ids deterministically, derive
 * staleness from git output, and render the STATUS row + ATLAS.md index. That makes the whole merge/
 * status judgement testable headlessly (test/qa-cartographer.test.js) without a browser, a real git,
 * or a real clock. The IO SHELL / CLI below owns Chrome/CDP, the seeded sidecar, git, and disk — the
 * one place ambient effects live, exactly like ledger.mjs's CLI block.
 *
 * NO-FAKE-GREEN LAW (Charter Part 5): a --sweep that CANNOT run (boot/CDP failure, a state drive
 * NOTFOUND, a spawn error) files a P0 BLOCKED finding (with the log path as evidence) and exits 2. It
 * never silently passes. Exit 0 = clean sweep · 1 = sweep ran and filed dead-entry findings · 2 = BLOCKED.
 *
 * PORT LAW (Charter Part 3/5): the live DOM sweep boots sidecars ONLY in the Cartographer range
 * 8920-8929 (CDP 9320-9329). Defaults: SKYNET_ATLAS_PORT=8920, SKYNET_ATLAS_CDP=9320.
 *
 * makeCartographer({ io, clock, git }) -> {
 *   entryId({ kind, area, key })     -> stable slugged id (deterministic)
 *   validateEntry(entry, where)      -> throws loudly (file+id) on a malformed entry
 *   mergeSweep(shards, harvest)      -> { shards, created, updated, missing, findings }   // the merge logic
 *   deriveStatus(shards)             -> { total, byStatus, byArea, stale:[ids], queue, perfectedFresh, markdown }
 *   renderAtlasMd(derived)           -> markdown for qa/atlas/ATLAS.md (the human index)
 *   statusRow(derived, cycle)        -> the Cartographer row for qa/STATUS.md
 *   renderStatus(existingMd, row)    -> { markdown, replaced }   // splice-or-insert the row
 *   areaOfState(name)                -> 'crew'|'work'|'build'|'system'|'world'
 * }
 *
 * CLI:
 *   node scripts/qa/cartographer.mjs --sweep                 # static enum + live DOM sweep; merge shards
 *   node scripts/qa/cartographer.mjs --sweep --static-only   # skip the browser half (no Chrome)
 *   node scripts/qa/cartographer.mjs --status                # convergence gauge + regen ATLAS.md + STATUS row
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

/* ─────────────────────────────── PURE CORE ─────────────────────────────── */

const CREW = 'Cartographer';

// The area taxonomy — every entry lives in exactly one. UI/state kinds land in the four station
// groups + world; the static kinds each own a synthetic area so the queue reads cleanly.
export const AREAS = Object.freeze(['crew', 'work', 'build', 'system', 'world', 'commands', 'routes', 'events', 'props']);
const AREA_SET = new Set(AREAS);

// The status lifecycle. The script may only ever WRITE 'unmapped' (on a fresh skeleton); everything
// beyond it is session-owned and the merge never regresses it.
export const STATUSES = Object.freeze(['unmapped', 'mapped', 'audited', 'perfected']);
const STATUS_SET = new Set(STATUSES);

const KINDS = new Set(['ui', 'command', 'route', 'event', 'state', 'prop']);

// The fields the SCRIPT owns (safe to overwrite on a re-sweep). Everything NOT in this set is
// session-owned judgment and is preserved byte-for-byte across sweeps.
const SCRIPT_OWNED = new Set(['name', 'selector', 'state', 'kind', 'area', 'firstSeen', 'lastSeen', 'missing']);

function str(v) { return v == null ? '' : String(v); }
function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; }
function arr(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }
function shortSha(sha) { return str(sha).trim().slice(0, 8) || '(unknown)'; }

// Deterministic slug: lowercase, keep [a-z0-9], collapse everything else to single dashes, trim
// leading/trailing dashes, cap length. Same input -> same slug, forever (stable ids across runs).
export function slug(s) {
  return str(s).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'x';
}

// state name -> area. The shoot states are named `ingame` / `crew-*` / `work-*` / `build-*` / `sys-*`.
// sys -> system, ingame -> world, else the leading group segment (crew/work/build).
export function areaOfState(name) {
  const n = str(name).toLowerCase();
  if (n === 'ingame' || n.startsWith('ingame')) return 'world';
  const g = n.split('-')[0];
  if (g === 'sys' || g === 'system') return 'system';
  if (g === 'crew') return 'crew';
  if (g === 'work') return 'work';
  if (g === 'build') return 'build';
  return 'world';
}

// Enumerate the real placeable furniture registry. `propsprites.js` exports CATALOG as the palette
// and renderer contract, so harvesting that catalog is authoritative (not a hand-maintained list).
// Fail closed if a catalog row is malformed, duplicated, or has no renderer.
export function enumerateProps(catalog, hasRenderer) {
  if (!Array.isArray(catalog) || catalog.length === 0) throw new Error('[atlas] prop catalog is missing or empty');
  if (typeof hasRenderer !== 'function') throw new Error('[atlas] prop renderer authority is unavailable');
  const seen = new Set();
  const seenAtlasIds = new Set();
  return catalog.map((prop, index) => {
    const where = 'prop catalog[' + index + ']';
    if (!prop || typeof prop !== 'object' || Array.isArray(prop)) throw new Error('[atlas] ' + where + ' is malformed');
    const id = str(prop.id).trim();
    if (!id || seen.has(id)) throw new Error('[atlas] ' + where + ' has a missing/duplicate id');
    if (!str(prop.label).trim() || !str(prop.cat).trim() || !['functional', 'cosmetic'].includes(str(prop.tier).trim())) throw new Error('[atlas] ' + where + ' lacks valid label/category/tier');
    if (!Number.isInteger(Number(prop.w)) || !Number.isInteger(Number(prop.h)) || !(Number(prop.w) > 0) || !(Number(prop.h) > 0)) {
      throw new Error('[atlas] ' + where + ' lacks a positive integer footprint');
    }
    if (!hasRenderer(id)) throw new Error('[atlas] ' + where + ' has no renderer: ' + id);
    const atlasId = 'prop/' + slug(id);
    if (seenAtlasIds.has(atlasId)) throw new Error('[atlas] ' + where + ' collides after Atlas ID normalization: ' + atlasId);
    seen.add(id); seenAtlasIds.add(atlasId);
    return {
      id: atlasId, kind: 'prop', area: 'props',
      name: str(prop.label).trim() + ' [' + str(prop.tier).trim() + '/' + str(prop.cat).trim() + '] ' + Number(prop.w) + 'x' + Number(prop.h)
    };
  });
}

// DATA-DRIVEN LIST AUTHORITY. Some surfaces render an UNBOUNDED, data-driven list of near-identical
// rows from a warmed catalog (e.g. the COMMS model dock's #model-dock-list, whose rows come from the
// live provider catalog). Enumerating one Atlas entry PER row is a lie: the rows are unjudgeable
// individually and churn (missing/staleness) on every catalog refresh. The FIX is at the harvester —
// any ANONYMOUS element (no id / data-term / aria-label, so it would otherwise get a positional
// txt-fallback key) whose NEAREST id-bearing ancestor is a listed container collapses to ONE
// deterministic representative key, so N rows dedup to a single entry. Keyed by that ancestor selector
// ('#'+id) -> { key: the representative slug-key, label: a stable honest name for the collapsed row }.
// Only anonymous descendants collapse: a row that carries its OWN id/data-term/aria-label is
// individually judgeable and keeps its own key (the #id / [data-term] / aria branches win first).
// ADD a container here ONLY when it exhibits the SAME pattern (unbounded, data-driven, identical rows).
export const DATA_DRIVEN_LISTS = Object.freeze({
  '#model-dock-list': { key: 'model-list-row', label: 'a model row in the model dock (data-driven from the provider catalog)' }
});

// Pure, browser-free MIRROR of ENUM_PROBE's key-assignment logic. Given an ordered list of node
// descriptors { id?, dataTerm?, ariaLabel?, tag, txt, anc } (`anc` = '#'+id of the nearest
// id-bearing ancestor, '' if none), it returns the SAME key each element would get in-page, using the
// SAME precedence (#id > [data-term] > aria-label > data-driven-list collapse > txt:tag:anc:txt:n) and
// the SAME per-(tag,anc,txt) ordinal bucket. This exists so the failure modes — a positional key that
// shifts under unrelated DOM growth, AND the over-harvest of a data-driven list — can be locked in a
// Chrome-free unit test. It MUST stay byte-for-byte in step with the ENUM_PROBE string in the CLI IO
// shell below (see the NOTE there).
export function computeProbeKeys(nodes) {
  const bucket = new Map();
  return arr(nodes).map((el) => {
    el = el || {};
    const tag = str(el.tag).toLowerCase();
    if (str(el.id)) return '#' + str(el.id);
    if (str(el.dataTerm)) return '[data-term=' + str(el.dataTerm) + ']';
    if (str(el.ariaLabel)) return 'aria:' + str(el.ariaLabel).slice(0, 40);
    const anc = str(el.anc);
    // DATA-DRIVEN LIST COLLAPSE: an anonymous row inside a listed container collapses to ONE
    // representative key so an unbounded catalog list never enumerates as N per-row atlas entries.
    const ddl = DATA_DRIVEN_LISTS[anc];
    if (ddl) return str(ddl.key);
    const txt = str(el.txt).trim().replace(/\s+/g, ' ').slice(0, 40);
    const bk = tag + '|' + anc + '|' + txt;
    const n = (bucket.get(bk) || 0) + 1; bucket.set(bk, n);
    return 'txt:' + tag + ':' + anc + ':' + txt + ':' + n;
  });
}

// Pure, disk-free ROUTE HARVESTER — the single authority for enumerating sidecar/index.js's HTTP routes.
// The router is a flat list of `if (req.method === 'X' && <url match>) return handler(req, res);` guards;
// the url match appears in several forms, ALL captured here:
//   req.url === '/api/...'
//   req.url.split('?')[0] === '/api/...'
//   req.url.indexOf('/api/...') === 0        (prefix)
//   req.url.startsWith('/api/...')           (prefix)
//   apiauth.pathOf(req.url) === '/api/...'
// THE SEAM THIS FIXES: the method token and the path token MUST come from the SAME guard statement. The
// gap between them is a TEMPERED run — each character may not begin a `return` token nor be a `;`, the two
// tokens that close a guard — so a method can never bind to a path in a LATER guard. That cross-statement
// bleed had two symptoms, both live-verified against index.js:
//   (a) DROPPED path-match routes: the GET SSE stream `req.url.split('?')[0] === '/api/channels/events'`
//       (index.js:4597) was invisible because a preceding guard's loose gap swallowed its `req.method`
//       token before the real GET statement could match.
//   (b) MINTED phantom method variants: a POST skeleton for the GET-only /api/channels/events (a preceding
//       POST guard reached across `}` into the SSE path), and a GET label for the POST-only
//       /api/auth/codex/logout (the GET /api/models/ guard, whose own path form it could not match, reached
//       forward into the next guard's POST path). Tempering the gap mints a variant only when the guard it
//       comes from actually proves that method.
// A multi-method OR guard — `(req.method === 'GET' || req.method === 'POST' || ...) && <url match>` — still
// binds the FIRST method in the group (there is no `return`/`;` between the alternatives), preserving the
// long-standing behavior for routes like GET /api/nightshift/focus. Dedup by method+path; FIRST wins.
// Exported so the failure mode is lockable Chrome-, disk-, and git-free in test/qa-cartographer.test.js.
export function harvestRoutes(src) {
  const routeRe = /req\.method\s*===\s*'([A-Z]+)'(?:(?!\breturn\b|;)[\s\S]){0,240}?(?:req\.url(?:\.split\('\?'\)\[0\])?\s*===\s*'(\/api[^']*)'|req\.url\.indexOf\('(\/api[^']*)'\)\s*===\s*0|req\.url\.startsWith\('(\/api[^']*)'\)|apiauth\.pathOf\(req\.url\)\s*===\s*'(\/api[^']*)')/g;
  const seen = new Set();
  const out = [];
  const add = (method, p) => {
    if (!p) return;
    const key = method + '-' + p;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ method, path: p, key });
  };
  let m;
  while ((m = routeRe.exec(str(src)))) add(m[1], m[2] || m[3] || m[4] || m[5] || '');
  // The declarative ROUTES table form (sidecar/index.js dispatchRoute refactor): one-line entries like
  //   { m: 'GET', exact: '/api/version', h: handleVersion }
  //   { m: ['GET', 'POST', 'DELETE'], qsplit: '/api/nightshift/focus', h: handleNightshiftFocus }
  // Same harvest contract as the guard form: only /api literal paths; a multi-method entry binds its
  // FIRST method (mirrors the OR-guard behavior above); dedup by method+path, first wins.
  const tableRe = /\bm:\s*(?:'([A-Z]+)'|\[\s*'([A-Z]+)')[^}\n]*?\b(?:exact|qsplit|prefix|qprefix):\s*'(\/api[^']*)'/g;
  while ((m = tableRe.exec(str(src)))) add(m[1] || m[2], m[3] || '');
  return out;
}

export function makeCartographer(opts) {
  opts = opts || {};
  const clock = opts.clock || { now() { return 0; } };
  const nowIso = () => new Date(clock.now()).toISOString();
  // git is injected so staleness derivation is testable with a fake. Contract:
  //   git.logSince(sha, files) -> string (git log --oneline <sha>..HEAD -- <files...>); non-empty => moved.
  const git = opts.git || {};
  const logSince = typeof git.logSince === 'function'
    ? git.logSince.bind(git)
    : () => { throw new Error('[atlas] git.logSince unavailable — freshness is unprovable'); };

  // A stable id for an entry. UI/state ids include the area so `ui/system/x` never collides with
  // `ui/crew/x`; the static kinds are globally unique on their key already.
  function entryId(parts) {
    parts = parts || {};
    const kind = str(parts.kind);
    const area = str(parts.area);
    const key = slug(parts.key);
    if (kind === 'ui') return 'ui/' + area + '/' + key;
    if (kind === 'command') return 'command/' + key;
    if (kind === 'route') return 'route/' + key;      // key already carries method+path
    if (kind === 'event') return 'event/' + key;
    if (kind === 'state') return 'state/' + key;
    if (kind === 'prop') return 'prop/' + key;
    return kind + '/' + area + '/' + key;
  }

  // A fresh skeleton — status ALWAYS 'unmapped' (the only status the script writes). Session-owned
  // fields are seeded EMPTY for a human to fill; the merge never rewrites them afterward.
  function skeleton(el) {
    const now = nowIso();
    const entry = {
      id: str(el.id),
      kind: str(el.kind),
      area: str(el.area),
      name: str(el.name),
      purpose: '',
      promise: '',
      wiring: { files: [], events: [] },
      coverage: [],
      status: 'unmapped',
      auditedAt: null,
      findings: [],
      firstSeen: now,
      lastSeen: now,
      missing: false
    };
    if (el.kind === 'ui') { entry.selector = str(el.selector); entry.state = str(el.state); }
    return entry;
  }

  // Validate an entry loudly — reject a malformed one naming file + id (load-time guard). Applied by
  // the CLI on every shard it reads AND by the merge on every skeleton it mints (so a bug that writes
  // garbage is caught immediately, not silently persisted).
  function validateEntry(entry, where) {
    const at = str(where) || (entry && entry.id) || '(no id)';
    const bad = (msg) => { throw new Error('[atlas] malformed entry ' + at + ': ' + msg); };
    if (!entry || typeof entry !== 'object') bad('not an object');
    if (!str(entry.id)) bad('missing id');
    if (!KINDS.has(str(entry.kind))) bad('bad kind "' + str(entry.kind) + '" (want one of ' + [...KINDS].join('/') + ')');
    if (!AREA_SET.has(str(entry.area))) bad('bad area "' + str(entry.area) + '" (want one of ' + AREAS.join('/') + ')');
    if (!str(entry.name)) bad('missing name');
    if (!STATUS_SET.has(str(entry.status))) bad('bad status "' + str(entry.status) + '" (want one of ' + STATUSES.join('/') + ')');
    if (entry.wiring && typeof entry.wiring !== 'object') bad('wiring must be an object');
    if (entry.coverage != null && !Array.isArray(entry.coverage)) bad('coverage must be an array');
    if (entry.findings != null && !Array.isArray(entry.findings)) bad('findings must be an array');
    const status = str(entry.status);
    if (status !== 'unmapped') {
      if (!str(entry.purpose).trim()) bad(status + ' requires a non-blank purpose');
      if (!str(entry.promise).trim()) bad(status + ' requires a non-blank promise');
      const files = entry.wiring && arr(entry.wiring.files).map(str).map(s => s.trim()).filter(Boolean);
      if (!files || files.length === 0) bad(status + ' requires non-empty wiring.files');
    }
    if (status === 'audited' || status === 'perfected') {
      const audited = entry.auditedAt;
      if (!audited || typeof audited !== 'object') bad(status + ' requires auditedAt');
      if (!/^[0-9a-f]{40}$/i.test(str(audited && audited.sha))) bad(status + ' requires a full auditedAt.sha');
      if (!str(audited && audited.date) || !Number.isFinite(Date.parse(str(audited && audited.date)))) bad(status + ' requires a parseable auditedAt.date');
    }
    if (status === 'perfected') {
      const coverage = arr(entry.coverage);
      if (coverage.length === 0) bad('perfected requires non-empty coverage');
      for (const item of coverage) {
        if (!item || typeof item !== 'object' || !str(item.kind).trim() || !str(item.ref).trim()) {
          bad('perfected coverage entries require kind + ref');
        }
      }
    }
    return entry;
  }

  // Validate the registry as one authority. A missing/corrupt/empty area must never collapse into a
  // smaller denominator that can report 100%. This is intentionally separate from deriveStatus so
  // small pure-unit shards remain useful, while every CLI/aggregate load is fail-closed.
  function validateShardSet(shards, requiredAreas, options) {
    options = options || {};
    const allowEmptyAreas = new Set(arr(options.allowEmptyAreas));
    if (!shards || typeof shards !== 'object' || Array.isArray(shards)) throw new Error('[atlas] shard set is not an object');
    const required = arr(requiredAreas && requiredAreas.length ? requiredAreas : AREAS);
    const missingAreas = required.filter(area => !Object.prototype.hasOwnProperty.call(shards, area));
    if (missingAreas.length) throw new Error('[atlas] required area shard(s) missing: ' + missingAreas.join(', '));
    const seen = new Set();
    let total = 0;
    for (const area of required) {
      const shard = shards[area];
      if (!shard || typeof shard !== 'object' || Array.isArray(shard)) throw new Error('[atlas] malformed shard: ' + area);
      if (str(shard.area) !== area) throw new Error('[atlas] shard area mismatch: key=' + area + ' value=' + str(shard.area));
      if (!Array.isArray(shard.entries) || (shard.entries.length === 0 && !allowEmptyAreas.has(area))) throw new Error('[atlas] required area shard is empty: ' + area);
      for (const entry of shard.entries) {
        validateEntry(entry, 'areas/' + area + '.json#' + str(entry && entry.id));
        if (str(entry.area) !== area) throw new Error('[atlas] entry area mismatch: ' + str(entry.id) + ' is in ' + area + ' but declares ' + str(entry.area));
        if (seen.has(str(entry.id))) throw new Error('[atlas] duplicate entry id: ' + str(entry.id));
        seen.add(str(entry.id)); total++;
      }
    }
    if (total === 0) throw new Error('[atlas] registry inventory is empty');
    return { total, areas: required.slice(), ids: seen };
  }

  // Sort a shard's entries by id (stable, byte-clean diffs).
  function sortEntries(entries) {
    return entries.slice().sort((a, b) => str(a.id).localeCompare(str(b.id)));
  }

  // Merge a harvest (the flat list of enumerated elements, each already carrying id/kind/area/name +
  // maybe selector/state) into the registry shards. `shards` is a map { area -> { area, updatedAt,
  // entries:[] } }. `harvest.elements` = the enumerated list; `harvest.sweptKinds` = the kinds this
  // sweep actually covered (so a static-only sweep never marks UI entries missing). `harvest.reportRel`
  // = the evidence path filed on a dead-entry finding.
  //
  // Rules (the station law made mechanical):
  //   - new element      -> append a SKELETON (status 'unmapped'); count created.
  //   - existing element -> refresh ONLY script-owned fields (name/selector/state/lastSeen), clear a
  //                         prior missing flag; NEVER touch a session-owned field. count updated.
  //   - a registry entry of a SWEPT kind NOT seen this sweep -> set missing:true + ONE P2 dead-entry
  //                         finding (skeletons are the queue, not findings — only vanished entries file).
  function mergeSweep(shards, harvest) {
    shards = shards || {};
    harvest = harvest || {};
    const elements = arr(harvest.elements);
    const sweptKinds = new Set(arr(harvest.sweptKinds));
    const reportRel = str(harvest.reportRel) || '.uiatlas/sweep-report.json';
    const now = nowIso();

    // index every existing entry by id across all shards.
    const byId = new Map();
    for (const area of Object.keys(shards)) {
      const shard = shards[area] || {};
      for (const e of arr(shard.entries)) byId.set(str(e.id), { entry: e, area });
    }

    const seen = new Set();
    let created = 0, updated = 0;
    const touchedAreas = new Set();

    for (const el of elements) {
      if (!el || !el.id) continue;
      validateEntry(skeleton(el), 'harvest:' + el.id);   // validate the SHAPE we'd mint (catches a bad harvester)
      const id = str(el.id);
      seen.add(id);
      const hit = byId.get(id);
      if (!hit) {
        // new: append a skeleton into its area shard.
        const area = str(el.area);
        const shard = shards[area] || (shards[area] = { area, updatedAt: now, entries: [] });
        shard.entries.push(skeleton(el));
        byId.set(id, { entry: shard.entries[shard.entries.length - 1], area });
        created++;
        touchedAreas.add(area);
      } else {
        // existing: refresh ONLY script-owned fields; leave every session-owned field untouched.
        const e = hit.entry;
        e.name = str(el.name) || e.name;
        if (el.kind === 'ui') {
          if (str(el.selector)) e.selector = str(el.selector);
          if (str(el.state) && !str(e.state)) e.state = str(el.state);   // keep the FIRST state it was seen in
        }
        e.lastSeen = now;
        if (e.missing) { e.missing = false; touchedAreas.add(hit.area); }  // resurrected — clear the flag
        updated++;
      }
    }

    // dead-entry pass: any entry of a SWEPT kind that we did NOT see this sweep is missing.
    const missing = [];
    const findings = [];
    for (const [id, { entry, area }] of byId.entries()) {
      const kind = str(entry.kind);
      if (!sweptKinds.has(kind)) continue;                 // this sweep didn't cover that kind — can't judge it
      if (seen.has(id)) continue;
      if (!entry.missing) { entry.missing = true; touchedAreas.add(area); }
      missing.push(id);
      // ONE deduped P2 finding per vanished entry (fingerprint is stable per id via the ledger).
      findings.push({
        crew: CREW, severity: 'P2',
        title: 'Atlas dead entry: ' + id + ' no longer found by the sweep',
        detail: 'A prior-mapped ' + kind + ' surface (' + id + ') was not enumerated this sweep — it was removed, renamed, or is unreachable. Reconcile the registry (retire it, or fix the regression that hid it).',
        evidence: [reportRel],
        checkId: 'dead-entry',
        subject: id
      });
    }

    // bump updatedAt + re-sort every touched shard (stable id order => clean diffs).
    for (const area of touchedAreas) {
      const shard = shards[area];
      if (shard) { shard.entries = sortEntries(shard.entries); shard.updatedAt = now; }
    }

    return { shards, created, updated, missing, findings, sweptKinds: [...sweptKinds] };
  }

  // Derive the convergence report from the loaded shards. Effective status:
  //   - 'missing' entries are counted separately (they're out of the surface now).
  //   - an entry with auditedAt.sha AND non-empty wiring.files whose files MOVED since that sha is STALE
  //     (perfection went out of date). Stale is the re-queue signal — it beats 'perfected'.
  function deriveStatus(shards) {
    shards = shards || {};
    const areas = Object.keys(shards).sort();
    const byStatus = { unmapped: 0, mapped: 0, audited: 0, perfected: 0, stale: 0, missing: 0 };
    const byArea = {};
    const staleIds = [];
    let total = 0, perfectedFresh = 0;

    for (const area of areas) {
      const per = { total: 0, unmapped: 0, mapped: 0, audited: 0, perfected: 0, stale: 0, missing: 0 };
      for (const e of arr(shards[area] && shards[area].entries)) {
        validateEntry(e, 'areas/' + area + '.json#' + str(e && e.id));
        total++; per.total++;
        if (e.missing) { byStatus.missing++; per.missing++; continue; }
        let st = STATUS_SET.has(str(e.status)) ? str(e.status) : 'unmapped';
        // staleness: only a perfected/audited entry with a recorded sha + tracked files can go stale.
        const sha = e.auditedAt && str(e.auditedAt.sha);
        const files = (e.wiring && arr(e.wiring.files)) || [];
        if (sha && files.length) {
          const moved = str(logSince(sha, files)).trim();
          if (moved) { st = 'stale'; staleIds.push(str(e.id)); }
        }
        byStatus[st] = (byStatus[st] || 0) + 1;
        per[st] = (per[st] || 0) + 1;
        if (st === 'perfected') perfectedFresh++;
      }
      byArea[area] = per;
    }

    const pct = total ? Math.round((perfectedFresh / total) * 100) : 0;
    const queue = { unmapped: byStatus.unmapped, stale: byStatus.stale };
    const markdown = 'PERFECTED-fresh ' + perfectedFresh + ' / total ' + total + ' (' + pct + '%)';
    return { areas, total, perfectedFresh, pct, byStatus, byArea, stale: staleIds, queue, markdown };
  }

  // The human index qa/atlas/ATLAS.md — the gauge line + a per-area table + a datestamp.
  function renderAtlasMd(derived, meta) {
    derived = derived || {};
    meta = meta || {};
    const L = [];
    const p = (x) => L.push(x);
    p('# Station Atlas — convergence index');
    p('');
    p('> **GENERATED FILE — do not edit by hand.** Regenerated by `npm run qa:atlas:status`');
    p('> (`scripts/qa/cartographer.mjs --status`). The source of truth is the sharded registry under');
    p('> `qa/atlas/areas/*.json`; the charter is `qa/atlas/README.md`. Edit those, not this.');
    p('');
    p('**Gauge:** ' + str(derived.markdown));
    p('');
    p('The goal: every entry `perfected` AND fresh at the current trunk. `unmapped` + `stale` is the');
    p('work queue a Perfectionist session (`loops/perfectionist.md`) burns down. `missing` = a surface');
    p('that vanished (retire it from the registry or fix the regression that hid it).');
    p('');
    p('| Area | Total | Unmapped | Mapped | Audited | Perfected | Stale | Missing |');
    p('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const area of arr(derived.areas)) {
      const a = (derived.byArea && derived.byArea[area]) || {};
      p('| ' + area + ' | ' + num(a.total) + ' | ' + num(a.unmapped) + ' | ' + num(a.mapped) +
        ' | ' + num(a.audited) + ' | ' + num(a.perfected) + ' | ' + num(a.stale) + ' | ' + num(a.missing) + ' |');
    }
    // totals row
    const bs = derived.byStatus || {};
    p('| **all** | **' + num(derived.total) + '** | ' + num(bs.unmapped) + ' | ' + num(bs.mapped) +
      ' | ' + num(bs.audited) + ' | ' + num(bs.perfected) + ' | ' + num(bs.stale) + ' | ' + num(bs.missing) + ' |');
    p('');
    p('_Last regenerated: ' + (str(meta.date) || nowIso()) + (meta.sha ? ' @ ' + shortSha(meta.sha) : '') + '._');
    p('');
    return L.join('\n');
  }

  // The Cartographer row for qa/STATUS.md. cycle = { isoTime, sha, gauge, unmapped }.
  function statusRow(derived, cycle) {
    derived = derived || {};
    cycle = cycle || {};
    const iso = str(cycle.isoTime) || '—';
    const sha = shortSha(cycle.sha);
    const lastRun = iso === '—' ? '—' : (iso + ' @ ' + sha);
    const gauge = str(cycle.gauge) || str(derived.markdown) || '—';
    const unmapped = cycle.unmapped != null ? num(cycle.unmapped) : num(derived.queue && derived.queue.unmapped);
    return '| Cartographer | Is every surface element mapped and perfected? | ' +
      lastRun + ' | ' + gauge + ' | ' + unmapped + ' |';
  }

  // Splice the Cartographer row into an existing STATUS.md, preserving every other row byte-for-byte.
  // If the row is absent, insert it right after the Janitor row (so the crew table stays grouped); if
  // there's no Janitor row either, append at the end of the first markdown table block. Mirrors
  // guardian.renderStatus's single-row splice technique.
  function renderStatus(existingMd, row) {
    const md = str(existingMd);
    const lines = md.split('\n');
    let replaced = false;
    let out = lines.map(line => {
      if (!replaced && /^\|\s*Cartographer\s*\|/.test(line)) { replaced = true; return row; }
      return line;
    });
    if (replaced) return { markdown: out.join('\n'), replaced: true, inserted: false };

    // not present — insert after the Janitor row.
    let janitorIdx = -1;
    for (let i = 0; i < out.length; i++) if (/^\|\s*Janitor\s*\|/.test(out[i])) { janitorIdx = i; break; }
    if (janitorIdx >= 0) {
      out.splice(janitorIdx + 1, 0, row);
      return { markdown: out.join('\n'), replaced: false, inserted: true };
    }
    return { markdown: md, replaced: false, inserted: false };  // no crew table found — caller warns
  }

  return {
    entryId, slug, skeleton, validateEntry, validateShardSet, mergeSweep, deriveStatus,
    renderAtlasMd, statusRow, renderStatus, areaOfState,
    _internals: { sortEntries, SCRIPT_OWNED }
  };
}

/* ───────────────────────────── IO SHELL / CLI ─────────────────────────────
 * The ONLY place ambient effects live: static enumeration (require sidecar/slash.js, scan
 * sidecar/index.js text, import shared/events.js + scripts/lib/states.mjs), the live DOM sweep
 * (headless Chrome + CDP + a seeded sidecar), git (for staleness), and disk (the shards + ATLAS.md
 * + STATUS row). Runs only when invoked directly. The static fs/path/url/child_process imports are
 * side-effect-free so a CJS test can require() the pure core without any of this executing.
 */

const INVOKED_DIRECTLY = (() => {
  try { return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href; }
  catch (_) { return false; }
})();

if (INVOKED_DIRECTLY) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const REPO = path.resolve(__dirname, '..', '..');            // scripts/qa/ -> repo root
  const AREAS_DIR = path.join(REPO, 'qa', 'atlas', 'areas');
  const ATLAS_MD = path.join(REPO, 'qa', 'atlas', 'ATLAS.md');
  const STATUS_FILE = path.join(REPO, 'qa', 'STATUS.md');
  const LEDGER_CLI = path.join(REPO, 'scripts', 'qa', 'ledger.mjs');
  const OUT_DIR = path.join(REPO, '.uiatlas');
  const SWEEP_REPORT = path.join(OUT_DIR, 'sweep-report.json');
  const SWEEP_LOG = path.join(OUT_DIR, 'sweep.log');
  const HARVEST_DUMP = path.join(OUT_DIR, 'harvest.json');

  // Cartographer port range (Charter §8): 8920-8929 sidecar, 9320-9329 CDP.
  const PORT = process.env.SKYNET_ATLAS_PORT || '8920';
  const CDP_PORT = Number(process.env.SKYNET_ATLAS_CDP || 9320);
  const APP_URL = 'http://127.0.0.1:' + PORT + '/';

  const require_ = createRequire(import.meta.url);
  const log = (...a) => console.log('[cartographer]', ...a);
  const errlog = (...a) => console.error('[cartographer]', ...a);

  const nowIsoReal = () => new Date().toISOString();

  function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
  function appendLog(line) { try { ensureDir(OUT_DIR); fs.appendFileSync(SWEEP_LOG, str(line) + '\n', 'utf8'); } catch (_) {} }

  function readJsonMaybe(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } }

  // ---- git shell (staleness only; read-only) ----
  function gitShell() {
    return {
      logSince(sha, files) {
        if (!/^[0-9a-f]{40}$/i.test(str(sha)) || !arr(files).length) throw new Error('[atlas] invalid staleness proof input for ' + str(sha));
        try {
          const r = spawnSync('git', ['log', '--oneline', str(sha) + '..HEAD', '--'].concat(arr(files).map(String)),
            { cwd: REPO, encoding: 'utf8', windowsHide: true });
          if (r.error || r.status !== 0) throw new Error(str(r.stderr || (r.error && r.error.message) || 'git log failed'));
          return str(r.stdout).trim();
        } catch (e) { throw new Error('[atlas] could not prove freshness from ' + str(sha) + ': ' + (e && e.message || e)); }
      },
      head() {
        try {
          const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8', windowsHide: true });
          const sha = str(r.stdout).trim();
          if (r.error || r.status !== 0 || !/^[0-9a-f]{40}$/i.test(sha)) throw new Error(str(r.stderr || (r.error && r.error.message) || 'invalid HEAD'));
          return sha;
        } catch (e) { throw new Error('[atlas] could not resolve exact HEAD: ' + (e && e.message || e)); }
      }
    };
  }

  // ---- shard IO ----
  const carto = makeCartographer({ clock: { now: () => Date.now() }, git: gitShell() });

  function loadShards(options) {
    options = options || {};
    const bootstrapAreas = new Set(arr(options.bootstrapAreas));
    const shards = {};
    let names = [];
    try { names = fs.readdirSync(AREAS_DIR); }
    catch (e) { throw new Error('[atlas] areas directory unreadable: ' + (e && e.message || e)); }
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      const shard = readJsonMaybe(path.join(AREAS_DIR, n));
      if (!shard || typeof shard !== 'object') throw new Error('[atlas] shard unreadable or invalid JSON: ' + n);
      const fileArea = n.replace(/\.json$/, '');
      const area = str(shard.area);
      if (!area || area !== fileArea) throw new Error('[atlas] shard area mismatch: ' + n + ' declares ' + (area || '(blank)'));
      if (Object.prototype.hasOwnProperty.call(shards, area)) throw new Error('[atlas] duplicate area shard: ' + area);
      // validate every entry LOUDLY (naming file + id) — a corrupt shard must never silently pass.
      for (const e of arr(shard.entries)) carto.validateEntry(e, n + '#' + str(e && e.id));
      shards[area] = { area, updatedAt: str(shard.updatedAt) || nowIsoReal(), entries: arr(shard.entries) };
    }
    for (const area of bootstrapAreas) {
      if (!AREAS.includes(area)) throw new Error('[atlas] invalid bootstrap area: ' + area);
      if (!Object.prototype.hasOwnProperty.call(shards, area)) shards[area] = { area, updatedAt: nowIsoReal(), entries: [] };
    }
    carto.validateShardSet(shards, AREAS, { allowEmptyAreas: [...bootstrapAreas] });
    return shards;
  }

  function writeShards(shards, onlyAreas) {
    ensureDir(AREAS_DIR);
    const areas = onlyAreas ? [...onlyAreas] : Object.keys(shards);
    for (const area of areas) {
      const shard = shards[area];
      if (!shard) continue;
      const file = path.join(AREAS_DIR, area + '.json');
      fs.writeFileSync(file, JSON.stringify({ area: shard.area, updatedAt: shard.updatedAt, entries: shard.entries }, null, 2) + '\n', 'utf8');
    }
  }

  // ---- STATIC ENUMERATION (no browser) ----
  // Returns { elements, eyeballs } where eyeballs is a per-kind sanity count printed so a miss is visible.
  function staticEnumerate() {
    const elements = [];
    const counts = { command: 0, route: 0, event: 0, state: 0, prop: 0 };

    // 1. slash commands — enumerate the catalog with EMPTY recipes/skills (built-ins only), the same
    //    call /api/slash/catalog makes. One entry per built-in command.
    try {
      const slash = require_(path.join(REPO, 'sidecar', 'slash.js'));
      const cat = slash.catalog({ recipes: [], skills: [] });
      for (const c of arr(cat.commands)) {
        if (!c || !c.name) continue;
        const id = carto.entryId({ kind: 'command', area: 'commands', key: c.name });
        elements.push({
          id, kind: 'command', area: 'commands',
          name: '/' + c.name + (c.desc ? ' — ' + c.desc : '')
        });
        counts.command++;
      }
    } catch (e) { appendLog('static/slash FAILED: ' + (e && e.message || e)); throw new Error('static enumeration of slash commands failed: ' + (e && e.message || e)); }

    // 2. API routes — scan sidecar/index.js text with the pure `harvestRoutes()` authority (defined in the
    //    PURE CORE above, so the exact same-statement binding logic is unit-locked without disk). See that
    //    function for the url-match forms and the tempered-gap seam it fixes (SSE path-match routes + phantom
    //    method variants).
    try {
      const src = fs.readFileSync(path.join(REPO, 'sidecar', 'index.js'), 'utf8');
      const routes = harvestRoutes(src);
      for (const r of routes) {
        const id = carto.entryId({ kind: 'route', area: 'routes', key: r.key });
        elements.push({ id, kind: 'route', area: 'routes', name: r.method + ' ' + r.path });
        counts.route++;
      }
      // eyeball: how many `req.method ===` guards exist at all (an upper bound on routes). Reported so a
      // gap between the two numbers is visible in the sweep report (some guards are multi-condition/HEAD dupes).
      const guardCount = (src.match(/req\.method\s*===\s*'[A-Z]+'/g) || []).length;
      counts._routeGuards = guardCount;
      counts._routeMatched = routes.length;
    } catch (e) { appendLog('static/routes FAILED: ' + (e && e.message || e)); throw new Error('static enumeration of API routes failed: ' + (e && e.message || e)); }

    // 3. events — import shared/events.js (READ ONLY; owned contract file) and enumerate EVENTS keys.
    try {
      const events = require_(path.join(REPO, 'shared', 'events.js'));
      const keys = typeof events.names === 'function' ? events.names() : Object.keys(events.EVENTS || {});
      for (const type of keys) {
        const id = carto.entryId({ kind: 'event', area: 'events', key: type });
        elements.push({ id, kind: 'event', area: 'events', name: type });
        counts.event++;
      }
    } catch (e) { appendLog('static/events FAILED: ' + (e && e.message || e)); throw new Error('static enumeration of events failed: ' + (e && e.message || e)); }

    // 4. placeable props — enumerate the real palette/renderer catalog, never a copied list.
    try {
      const props = require_(path.join(REPO, 'frontend', 'app', 'propsprites.js'));
      const harvested = enumerateProps(props && props.CATALOG, props && props.has);
      elements.push(...harvested);
      counts.prop = harvested.length;
    } catch (e) { appendLog('static/props FAILED: ' + (e && e.message || e)); throw new Error('static enumeration of props failed: ' + (e && e.message || e)); }

    // 5. shoot states — import buildStates() and one entry per state, area = its group.
    try {
      const url = pathToFileURL(path.join(REPO, 'scripts', 'lib', 'states.mjs')).href;
      // dynamic import via the CLI's own loader (top-level await is fine here — this block only runs as a CLI).
      return import(url).then(mod => {
        const states = typeof mod.buildStates === 'function' ? mod.buildStates() : [];
        for (const s of arr(states)) {
          const area = carto.areaOfState(s.name);
          const id = carto.entryId({ kind: 'state', area, key: s.name });
          elements.push({ id, kind: 'state', area, name: 'shoot state: ' + s.name });
          counts.state++;
        }
        return { elements, counts };
      });
    } catch (e) { appendLog('static/states FAILED: ' + (e && e.message || e)); throw new Error('static enumeration of states failed: ' + (e && e.message || e)); }
  }

  // ---- the in-page enumerator probe (collects every interactive element in the current state) ----
  // Returns a flat list of { key, label, selector, visible }. Stable key precedence: #id |
  // [data-term=..] | aria-label | txt:tag:anc:txt:n — where anc = '#'+id of the NEAREST ancestor
  // carrying an element id ('' if none) and n = ordinal WITHIN the (tag, anc, txt) bucket (NOT a
  // global per-tag counter). Anchoring to the nearest id-bearing ancestor keeps the fallback key
  // stable under unrelated DOM growth elsewhere on the page; the ordinal disambiguates only true
  // same-labeled siblings. Dedup within a state by key.
  //   NOTE: the key-assignment formula here (including the DATA-DRIVEN LIST collapse and the
  //   txt-fallback) is mirrored, byte-for-byte, by the pure exported `computeProbeKeys()` +
  //   `DATA_DRIVEN_LISTS` (used by test/qa-cartographer.test.js to lock the failure modes without a
  //   browser). If you change the key shape OR the collapse map below, change those to match.
  const ENUM_PROBE = `(() => {
    const SEL = 'button, [role="button"], [role="menuitem"], [role="tab"], a[href], input, select, textarea, summary, [onclick], [data-term]';
    const DDL = ${JSON.stringify(DATA_DRIVEN_LISTS)};   // anc('#'+id) -> { key, label }; injected from DATA_DRIVEN_LISTS (kept in step by that single source)
    const nodes = Array.from(document.querySelectorAll(SEL));
    const out = [];
    const seen = new Set();
    const cssEsc = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\\\#.:\\[\\]]/g, '\\\\$&');
    const txtBucket = new Map();   // (tag|anc|txt) -> ordinal; disambiguates only true same-labeled siblings
    for (const el of nodes) {
      const tag = el.tagName.toLowerCase();
      let key = '', selector = '', ddlLabel = '';
      if (el.id) { key = '#' + el.id; selector = '#' + cssEsc(el.id); }
      else if (el.getAttribute && el.getAttribute('data-term')) { const t = el.getAttribute('data-term'); key = '[data-term=' + t + ']'; selector = '[data-term="' + t + '"]'; }
      else if (el.getAttribute && el.getAttribute('aria-label')) { const a = el.getAttribute('aria-label'); key = 'aria:' + a.slice(0, 40); selector = tag + '[aria-label="' + a.replace(/"/g, '\\\\"') + '"]'; }
      else {
        // nearest ancestor carrying an element id anchors the key so DOM growth elsewhere never shifts it.
        let anc = '';
        for (let p = el.parentElement; p; p = p.parentElement) { if (p.id) { anc = '#' + p.id; break; } }
        if (DDL[anc]) {
          // DATA-DRIVEN LIST COLLAPSE: an anonymous row inside a listed container collapses to ONE
          // representative entry (unbounded catalog rows must never enumerate as N per-row entries).
          key = DDL[anc].key; ddlLabel = DDL[anc].label; selector = anc + ' ' + tag;
        } else {
          const txt = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
          const bk = tag + '|' + anc + '|' + txt;
          const n = (txtBucket.get(bk) || 0) + 1; txtBucket.set(bk, n);
          key = 'txt:' + tag + ':' + anc + ':' + txt + ':' + n;
          selector = tag + (txt ? '' : '');   // best-effort; the session refines the selector
        }
      }
      if (seen.has(key)) continue;
      seen.add(key);
      const label = ddlLabel || (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60) || tag;
      let visible = false;
      try {
        const r = el.getBoundingClientRect();
        visible = !!(el.offsetParent !== null || (r.width > 0 && r.height > 0));
      } catch (_) {}
      out.push({ key, label, selector, visible, tag });
    }
    return out;
  })()`;

  // ---- LIVE DOM SWEEP ----
  // Boot the seeded sidecar exactly like journeys.mjs, walk every buildStates() state, run its drive,
  // wait its wait, enumerate. Dedup across states by key (FIRST state wins). Returns { elements, states }.
  async function liveSweep() {
    const { sleep, launchChrome, connectCDP, evalJS } = await import(pathToFileURL(path.join(REPO, 'scripts', 'lib', 'cdp.mjs')).href);
    const { materializeSeedWorkspace, bootSeededSidecar, isUp, waitUp, waitDevReady } = await import(pathToFileURL(path.join(REPO, 'scripts', 'lib', 'seed.mjs')).href);
    const statesMod = await import(pathToFileURL(path.join(REPO, 'scripts', 'lib', 'states.mjs')).href);

    const scratch = path.join(OUT_DIR, '_seed-workspace');
    const profile = path.join(OUT_DIR, '_profile');
    let sidecar = null, chromeProc = null, cdp = null;
    const cleanup = () => {
      try { cdp && cdp.ws.close(); } catch (_) {}
      try { chromeProc && chromeProc.kill('SIGKILL'); } catch (_) {}
      try { sidecar && sidecar.kill('SIGKILL'); } catch (_) {}
    };

    try {
      if (await isUp(APP_URL)) throw new Error('BLOCKED: atlas port :' + PORT + ' already has a server; set SKYNET_ATLAS_PORT to a free port');
      appendLog('booting seeded sidecar on :' + PORT);
      materializeSeedWorkspace(scratch);
      sidecar = bootSeededSidecar({ port: PORT, scratchDir: scratch });
      if (!(await waitUp(APP_URL))) throw new Error('BLOCKED: seeded sidecar failed to come up on :' + PORT);

      const win = process.env.SKYNET_SHOT_SIZE || '1440,900';
      const launched = launchChrome({ cdpPort: CDP_PORT, win, profileDir: profile });
      chromeProc = launched.proc;
      chromeProc.on('error', (e) => appendLog('chrome spawn error: ' + (e && e.message)));
      cdp = await connectCDP(CDP_PORT);
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Page.navigate', { url: APP_URL });
      const floorReady = await waitDevReady(cdp, evalJS, { tries: 40, url: APP_URL });
      if (!floorReady) throw new Error('BLOCKED: never reached in-game (floor did not come up)');
      appendLog('floor ready; walking states');

      const states = statesMod.buildStates();
      const elements = [];
      const seenKeys = new Set();
      const perState = [];
      for (const s of states) {
        const drive = await evalJS(cdp, s.drive).catch((e) => 'ERR:' + (e && e.message));
        if (typeof drive === 'string' && drive.indexOf('NOTFOUND') === 0) {
          throw new Error('BLOCKED: state "' + s.name + '" drive returned ' + drive + ' (a dock target is missing — the sweep cannot enumerate it honestly)');
        }
        await sleep(num(s.wait) || 700);
        const found = await evalJS(cdp, ENUM_PROBE).catch((e) => { appendLog('enum probe threw in ' + s.name + ': ' + (e && e.message)); return []; });
        const list = arr(found);
        perState.push({ state: s.name, area: carto.areaOfState(s.name), count: list.length });
        for (const el of list) {
          if (!el || !el.key) continue;
          if (seenKeys.has(el.key)) continue;               // FIRST state an element is seen in wins
          seenKeys.add(el.key);
          const area = carto.areaOfState(s.name);
          const id = carto.entryId({ kind: 'ui', area, key: el.key });
          elements.push({
            id, kind: 'ui', area, name: str(el.label) || str(el.key),
            selector: str(el.selector), state: s.name
          });
        }
      }
      appendLog('walked ' + states.length + ' states; ' + elements.length + ' distinct UI elements');
      return { elements, states: perState };
    } finally {
      cleanup();
    }
  }

  // File a finding through the ledger CLI (the ONE dedup/known path). Returns true if handled.
  function fileFinding(finding) {
    const r = spawnSync(process.execPath, [LEDGER_CLI, '--add', '--json', JSON.stringify(finding)], {
      cwd: REPO, encoding: 'utf8', windowsHide: true
    });
    const out = str(r.stdout).trim(); const err = str(r.stderr).trim();
    if (out) log('ledger:', out);
    if (err) errlog('ledger:', err);
    return (r.status === 0 || r.status === 2);   // exit 2 = refused/known — a HANDLED outcome, not our error
  }

  function fileBlocked(reason, logPath) {
    const finding = {
      crew: CREW, severity: 'P0',
      title: 'Cartographer BLOCKED: sweep could not run',
      detail: 'The Atlas sweep could not complete: ' + str(reason) + '. A detector that cannot run is a P0 (no-fake-green law) — treat as red until it runs clean.',
      evidence: [logPath && fs.existsSync(logPath) ? logPath : SWEEP_LOG],
      checkId: 'blocked', subject: 'sweep/blocked'
    };
    fileFinding(finding);
  }

  // ---- --sweep ----
  async function runSweep(staticOnly) {
    ensureDir(OUT_DIR);
    try { fs.writeFileSync(SWEEP_LOG, '[atlas] sweep start ' + nowIsoReal() + (staticOnly ? ' (static-only)' : '') + '\n', 'utf8'); } catch (_) {}
    const sha = gitShell().head();

    // static enumeration (throws -> BLOCKED). staticEnumerate returns a PROMISE (it dynamic-imports states).
    let staticResult;
    try { staticResult = await staticEnumerate(); }
    catch (e) {
      errlog('BLOCKED (static): ' + (e && e.message || e));
      appendLog('BLOCKED static: ' + (e && e.stack || e));
      fileBlocked('static enumeration failed — ' + (e && e.message || e), SWEEP_LOG);
      return 2;
    }
    const elements = staticResult.elements.slice();
    const counts = staticResult.counts;
    const sweptKinds = new Set(['command', 'route', 'event', 'state', 'prop']);
    let statesWalked = [];

    if (!staticOnly) {
      let live;
      try { live = await liveSweep(); }
      catch (e) {
        errlog('BLOCKED (live): ' + (e && e.message || e));
        appendLog('BLOCKED live: ' + (e && e.stack || e));
        fileBlocked('live DOM sweep failed — ' + (e && e.message || e), SWEEP_LOG);
        return 2;
      }
      for (const el of live.elements) elements.push(el);
      statesWalked = live.states;
      sweptKinds.add('ui');
      counts.ui = live.elements.length;
    }

    // merge into the shards.
    const shards = loadShards({ bootstrapAreas: ['props'] });
    const reportRel = path.relative(REPO, SWEEP_REPORT).replace(/\\/g, '/');
    const merge = carto.mergeSweep(shards, { elements, sweptKinds: [...sweptKinds], reportRel });
    carto.validateShardSet(merge.shards, AREAS);
    writeShards(merge.shards);

    // file ONE ledger finding per vanished entry (skeletons are NOT findings — the registry is the queue).
    for (const f of merge.findings) fileFinding(f);

    // per-area / per-kind counts for the report.
    const byArea = {};
    for (const area of Object.keys(merge.shards)) byArea[area] = arr(merge.shards[area].entries).length;

    const report = {
      schemaVersion: 1,
      result: merge.missing.length ? 'RED' : 'GREEN',
      ranAt: nowIsoReal(), sha, staticOnly: !!staticOnly,
      counts, sweptKinds: [...sweptKinds],
      created: merge.created, updated: merge.updated,
      missing: merge.missing, missingCount: merge.missing.length,
      statesWalked, byArea,
      newIds: []   // filled below
    };
    // recover the ids created this sweep for the report (a skeleton has firstSeen === lastSeen just now).
    for (const area of Object.keys(merge.shards)) {
      for (const e of arr(merge.shards[area].entries)) {
        if (e.firstSeen && e.firstSeen === e.lastSeen && e.status === 'unmapped') report.newIds.push(e.id);
      }
    }
    fs.writeFileSync(SWEEP_REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8');

    log('sweep done — created ' + merge.created + ', updated ' + merge.updated + ', missing ' + merge.missing.length);
    log('  static: ' + counts.command + ' commands · ' + counts.route + ' routes (' + (counts._routeMatched || counts.route) + ' matched / ' + (counts._routeGuards || '?') + ' method-guards) · ' + counts.event + ' events · ' + counts.state + ' states · ' + counts.prop + ' props');
    if (!staticOnly) log('  live: ' + (counts.ui || 0) + ' distinct UI elements across ' + statesWalked.length + ' states');
    log('  report: ' + reportRel);
    return merge.missing.length ? 1 : 0;
  }

  // ---- --dump-harvest ----
  // Run the EXACT same static + live harvest as --sweep, but write the raw enumerated element list to
  // HARVEST_DUMP and touch NOTHING else — no shard merge, no ledger findings. This is the seam the
  // one-time key migration (scripts/qa/atlas-migrate-keys.mjs) consumes so it can reason about the NEW
  // keys BEFORE the registry is churned, reusing this machinery instead of duplicating it.
  async function runDumpHarvest(staticOnly) {
    ensureDir(OUT_DIR);
    try { fs.writeFileSync(SWEEP_LOG, '[atlas] dump-harvest start ' + nowIsoReal() + (staticOnly ? ' (static-only)' : '') + '\n', 'utf8'); } catch (_) {}
    const sha = gitShell().head();

    let staticResult;
    try { staticResult = await staticEnumerate(); }
    catch (e) { errlog('BLOCKED (static): ' + (e && e.message || e)); appendLog('BLOCKED static: ' + (e && e.stack || e)); return 2; }
    const elements = staticResult.elements.slice();
    const sweptKinds = new Set(['command', 'route', 'event', 'state', 'prop']);
    let statesWalked = [];

    if (!staticOnly) {
      let live;
      try { live = await liveSweep(); }
      catch (e) { errlog('BLOCKED (live): ' + (e && e.message || e)); appendLog('BLOCKED live: ' + (e && e.stack || e)); return 2; }
      for (const el of live.elements) elements.push(el);
      statesWalked = live.states;
      sweptKinds.add('ui');
    }

    fs.writeFileSync(HARVEST_DUMP, JSON.stringify({
      schemaVersion: 1, ranAt: nowIsoReal(), sha, staticOnly: !!staticOnly,
      sweptKinds: [...sweptKinds], statesWalked, count: elements.length, elements
    }, null, 2) + '\n', 'utf8');
    log('dump-harvest done — ' + elements.length + ' elements -> ' + path.relative(REPO, HARVEST_DUMP).replace(/\\/g, '/'));
    return 0;
  }

  // ---- --status ----
  function runStatus() {
    const shards = loadShards();
    const derived = carto.deriveStatus(shards);
    const sha = gitShell().head();
    const date = nowIsoReal();

    // regenerate ATLAS.md
    try {
      ensureDir(path.dirname(ATLAS_MD));
      fs.writeFileSync(ATLAS_MD, carto.renderAtlasMd(derived, { date, sha }) + '\n', 'utf8');
      log('wrote ' + path.relative(REPO, ATLAS_MD).replace(/\\/g, '/'));
    } catch (e) { errlog('could not write ATLAS.md: ' + (e && e.message || e)); }

    // update the Cartographer STATUS row (splice or insert-after-Janitor)
    const isoTime = new Date().toISOString().slice(0, 16).replace('T', ' ') + 'Z';
    const row = carto.statusRow(derived, { isoTime, sha, gauge: derived.markdown, unmapped: derived.queue.unmapped });
    try {
      const existing = fs.readFileSync(STATUS_FILE, 'utf8');
      const { markdown, replaced, inserted } = carto.renderStatus(existing, row);
      if (replaced || inserted) { fs.writeFileSync(STATUS_FILE, markdown, 'utf8'); log('STATUS.md Cartographer row ' + (replaced ? 'updated' : 'inserted')); }
      else errlog('WARNING: no crew table / Janitor row in ' + STATUS_FILE + '; STATUS not updated');
    } catch (e) { errlog('WARNING: could not update STATUS.md: ' + (e && e.message || e)); }

    // print the convergence report
    const L = [];
    L.push('Station Atlas — ' + derived.markdown);
    L.push('  by status: ' + Object.keys(derived.byStatus).map(k => k + '=' + derived.byStatus[k]).join(' · '));
    L.push('  queue: unmapped=' + derived.queue.unmapped + ' · stale=' + derived.queue.stale);
    L.push('  per area:');
    for (const area of derived.areas) {
      const a = derived.byArea[area];
      L.push('    ' + area.padEnd(9) + ' total ' + a.total + ' | unmapped ' + a.unmapped + ' mapped ' + a.mapped + ' audited ' + a.audited + ' perfected ' + a.perfected + ' stale ' + a.stale + ' missing ' + a.missing);
    }
    console.log(L.join('\n'));
    return 0;
  }

  // ---- arg parse + dispatch ----
  (async () => {
    const argv = process.argv.slice(2);
    const wantSweep = argv.includes('--sweep');
    const wantStatus = argv.includes('--status');
    const wantDump = argv.includes('--dump-harvest');
    const staticOnly = argv.includes('--static-only');

    if (wantDump) { process.exit(await runDumpHarvest(staticOnly)); }
    else if (wantStatus && !wantSweep) { process.exit(runStatus()); }
    else if (wantSweep) { process.exit(await runSweep(staticOnly)); }
    else {
      console.error('usage: node scripts/qa/cartographer.mjs [--sweep [--static-only]] [--dump-harvest [--static-only]] [--status]');
      process.exit(1);
    }
  })().catch(e => { errlog('FATAL: ' + (e && e.stack || e)); try { fileBlocked('FATAL: ' + (e && e.message || e), SWEEP_LOG); } catch (_) {} process.exit(2); });
}
