/* node test/qa-cartographer.test.js — the Station Atlas MAPPER's pure core (the perfection-loop
   machine's script half), fed a controllable clock + a fake injected git (zero disk, zero browser,
   zero real git). Asserts the station law made mechanical:
     (a) sweep merge classification — new element -> skeleton (correct id/area/status), existing ->
         lastSeen refreshed + session-owned fields UNTOUCHED, vanished (of a swept kind) -> missing:true
         + a dead-entry finding routed to the ledger-ready findings list.
     (b) id slugging determinism + stable id sort within a shard.
     (c) staleness derivation — fake git returns output -> effective 'stale'; empty -> 'perfected'/fresh.
     (d) schema validation rejects a malformed entry LOUDLY (throws, naming the entry).
     (e) STATUS row splice — replaced when the row exists, inserted after Janitor when it doesn't.
   Pure + deterministic — every timestamp comes from the injected clock, never Date.now(). */
'use strict';
const A = require('./_assert.js');
const { makeCartographer, enumerateProps, slug, areaOfState, computeProbeKeys, harvestRoutes, DATA_DRIVEN_LISTS, AREAS, STATUSES } = require('../scripts/qa/cartographer.mjs');

// a fixed clock so firstSeen/lastSeen are deterministic ISO strings.
let clk = Date.UTC(2026, 6, 7, 12, 0, 0);          // 2026-07-07T12:00:00.000Z
const clock = { now: () => clk };
const ISO0 = new Date(clk).toISOString();
const AUDIT_SHA = 'a'.repeat(40);

// a fake injected git: logSince returns whatever we stage per (sha) — non-empty => the files moved.
function fakeGit(moved) {
  return { logSince: (sha, files) => (moved && moved[sha]) ? moved[sha] : '' };
}

// build a shards map { area -> { area, updatedAt, entries[] } } from a flat entry list.
function shardsFrom(entries) {
  const shards = {};
  for (const e of (entries || [])) {
    const a = e.area;
    (shards[a] || (shards[a] = { area: a, updatedAt: ISO0, entries: [] })).entries.push(e);
  }
  return shards;
}

// a fully-formed session-owned entry (as a human would leave it after auditing).
const fullEntry = (over) => Object.assign({
  id: 'ui/system/bb-recruit', kind: 'ui', area: 'system', name: 'RECRUIT',
  selector: '#bb-recruit', state: 'crew-recruit',
  purpose: 'opens the recruitment bay', promise: 'click -> bay overlay opens',
  wiring: { files: ['frontend/js/navdock.js'], events: [] }, coverage: [{ kind: 'journey', ref: 'J1' }],
  status: 'perfected', auditedAt: { sha: AUDIT_SHA, date: ISO0 }, findings: [],
  firstSeen: ISO0, lastSeen: ISO0, missing: false
}, over || {});

// ---- (b) id slugging determinism + stable sort ----
{
  A.eq(slug('#bb-recruit'), 'bb-recruit', 'slug strips leading # and lowercases');
  A.eq(slug('POST /api/run'), 'post-api-run', 'slug collapses spaces+slashes to single dashes');
  A.eq(slug('  Weird__Name!!  '), 'weird-name', 'slug trims + collapses punctuation runs');
  A.eq(slug('POST /api/run'), slug('POST /api/run'), 'slug is deterministic (same input, same output)');

  const carto = makeCartographer({ clock, git: fakeGit() });
  A.eq(carto.entryId({ kind: 'ui', area: 'crew', key: '#bb-recruit' }), 'ui/crew/bb-recruit', 'ui id carries area + slug');
  A.eq(carto.entryId({ kind: 'command', area: 'commands', key: 'help' }), 'command/help', 'command id is kind/slug');
  A.eq(carto.entryId({ kind: 'route', area: 'routes', key: 'GET-/api/version' }), 'route/get-api-version', 'route id slugs method+path');
  A.eq(carto.entryId({ kind: 'event', area: 'events', key: 'agent.run.start' }), 'event/agent-run-start', 'event id slugs the type');

  // stable sort: merge two out-of-order new elements, assert the shard comes out id-sorted.
  const shards = {};
  const harvest = {
    elements: [
      { id: 'command/zebra', kind: 'command', area: 'commands', name: '/zebra' },
      { id: 'command/alpha', kind: 'command', area: 'commands', name: '/alpha' }
    ],
    sweptKinds: ['command'], reportRel: '.uiatlas/sweep-report.json'
  };
  const res = carto.mergeSweep(shards, harvest);
  const ids = res.shards.commands.entries.map(e => e.id);
  A.eq(ids, ['command/alpha', 'command/zebra'], 'entries are stable-sorted by id (clean diffs)');
}

// ---- (a) sweep merge classification: new / existing-untouched / vanished ----
{
  const carto = makeCartographer({ clock, git: fakeGit() });

  // seed: one fully-audited UI entry + one command that WILL vanish this sweep.
  const seedUi = fullEntry();
  const seedCmd = { id: 'command/oldcmd', kind: 'command', area: 'commands', name: '/oldcmd',
    purpose: 'p', promise: 'q', wiring: { files: [], events: [] }, coverage: [], status: 'mapped',
    auditedAt: null, findings: [], firstSeen: ISO0, lastSeen: ISO0, missing: false };
  const shards = shardsFrom([seedUi, seedCmd]);

  // advance the clock so lastSeen refresh is observable.
  clk += 60000; const ISO1 = new Date(clk).toISOString();

  const harvest = {
    elements: [
      // existing UI element re-seen with a NEW harvested label (script-owned field refresh only).
      { id: 'ui/system/bb-recruit', kind: 'ui', area: 'system', name: 'RECRUIT (relabeled)', selector: '#bb-recruit', state: 'sys-something' },
      // a brand-new command -> skeleton.
      { id: 'command/newcmd', kind: 'command', area: 'commands', name: '/newcmd — a new one' }
      // NOTE: command/oldcmd is absent this sweep -> should be marked missing (command IS a swept kind).
    ],
    sweptKinds: ['command', 'ui'], reportRel: '.uiatlas/sweep-report.json'
  };
  const res = carto.mergeSweep(shards, harvest);

  // new element -> skeleton with correct id/area/status + timestamps.
  const newEntry = res.shards.commands.entries.find(e => e.id === 'command/newcmd');
  A.ok(!!newEntry, 'new element appended as a skeleton');
  A.eq(newEntry.status, 'unmapped', 'a fresh skeleton is status:unmapped (the only status the script writes)');
  A.eq(newEntry.area, 'commands', 'skeleton carries the right area');
  A.eq(newEntry.firstSeen, ISO1, 'skeleton firstSeen stamped from the injected clock');
  A.eq(newEntry.lastSeen, ISO1, 'skeleton lastSeen == firstSeen on creation');
  A.eq(newEntry.purpose, '', 'skeleton purpose is empty (session-owned, seeded blank)');
  A.eq(res.created, 1, 'exactly one entry created');

  // existing element -> lastSeen refreshed, session-owned fields UNTOUCHED.
  const kept = res.shards.system.entries.find(e => e.id === 'ui/system/bb-recruit');
  A.eq(kept.lastSeen, ISO1, 'existing entry lastSeen refreshed to now');
  A.eq(kept.name, 'RECRUIT (relabeled)', 'script-owned name refreshed from the harvest');
  A.eq(kept.state, 'crew-recruit', 'FIRST-seen state preserved (not overwritten by a later state)');
  A.eq(kept.purpose, 'opens the recruitment bay', 'session-owned purpose UNTOUCHED by the sweep');
  A.eq(kept.status, 'perfected', 'session-owned status UNTOUCHED (never regressed by the script)');
  A.eq(JSON.stringify(kept.auditedAt), JSON.stringify({ sha: AUDIT_SHA, date: ISO0 }), 'session-owned auditedAt UNTOUCHED');
  A.eq(JSON.stringify(kept.coverage), JSON.stringify([{ kind: 'journey', ref: 'J1' }]), 'session-owned coverage UNTOUCHED');

  // vanished element -> missing:true + a dead-entry finding routed to the ledger-ready list.
  const gone = res.shards.commands.entries.find(e => e.id === 'command/oldcmd');
  A.eq(gone.missing, true, 'a swept-kind entry not seen this sweep is marked missing:true');
  A.eq(res.missing.length, 1, 'one missing id reported');
  A.eq(res.missing[0], 'command/oldcmd', 'the vanished id is reported');
  A.eq(res.findings.length, 1, 'exactly ONE dead-entry finding filed (skeletons are NOT findings)');
  const f = res.findings[0];
  A.eq(f.crew, 'Cartographer', 'finding routed to the Cartographer crew');
  A.eq(f.checkId, 'dead-entry', 'finding checkId is dead-entry');
  A.eq(f.subject, 'command/oldcmd', 'finding subject is the vanished id');
  A.eq(f.severity, 'P2', 'a dead entry is P2 (informational reconcile, never a blocker)');
  A.ok(Array.isArray(f.evidence) && f.evidence.length > 0, 'finding carries an evidence path (evidence law)');

  // a static-only re-sweep (sweptKinds without 'ui') must NOT mark a UI entry missing even if unseen.
  clk += 60000;
  const res2 = carto.mergeSweep(shardsFrom([fullEntry()]), { elements: [], sweptKinds: ['command'], reportRel: 'r' });
  const ui2 = res2.shards.system.entries.find(e => e.id === 'ui/system/bb-recruit');
  A.eq(ui2.missing, false, 'a UI entry is NOT marked missing by a sweep that did not cover the ui kind');
  A.eq(res2.findings.length, 0, 'no dead-entry finding for an unswept kind');

  // resurrection: a previously-missing entry re-seen clears the flag.
  const missingSeed = fullEntry({ missing: true });
  const res3 = carto.mergeSweep(shardsFrom([missingSeed]), {
    elements: [{ id: 'ui/system/bb-recruit', kind: 'ui', area: 'system', name: 'RECRUIT', selector: '#bb-recruit', state: 'sys-x' }],
    sweptKinds: ['ui'], reportRel: 'r'
  });
  A.eq(res3.shards.system.entries[0].missing, false, 'a re-seen entry has its missing flag cleared');
}

// ---- (c) staleness derivation: git output -> stale; empty -> fresh/perfected ----
{
  // fresh: git returns nothing -> the perfected entry stays perfected, and is counted as perfected-fresh.
  const fresh = makeCartographer({ clock, git: fakeGit() });
  const dFresh = fresh.deriveStatus(shardsFrom([fullEntry()]));
  A.eq(dFresh.byStatus.perfected, 1, 'a perfected entry whose files did not move stays perfected');
  A.eq(dFresh.byStatus.stale, 0, 'nothing stale when git reports no movement');
  A.eq(dFresh.perfectedFresh, 1, 'perfected-fresh count reflects the fresh entry');
  A.eq(dFresh.total, 1, 'total counts the entry');
  A.ok(/PERFECTED-fresh 1 \/ total 1 \(100%\)/.test(dFresh.markdown), 'gauge renders 100% when the sole entry is perfected+fresh');

  // stale: git returns a commit line for the audited sha -> the entry is effectively STALE, not perfected.
  const stale = makeCartographer({ clock, git: fakeGit({ [AUDIT_SHA]: 'deadbee some later commit touched the file' }) });
  const dStale = stale.deriveStatus(shardsFrom([fullEntry()]));
  A.eq(dStale.byStatus.perfected, 0, 'a perfected entry whose files MOVED is no longer counted perfected');
  A.eq(dStale.byStatus.stale, 1, 'the moved-files entry is effectively stale');
  A.eq(dStale.stale.length, 1, 'the stale id is reported');
  A.eq(dStale.stale[0], 'ui/system/bb-recruit', 'the correct id is flagged stale');
  A.eq(dStale.perfectedFresh, 0, 'a stale entry does not count as perfected-fresh');
  A.eq(dStale.queue.stale, 1, 'stale feeds the re-queue count');

  // an entry with NO auditedAt sha can never be stale (no baseline to compare against).
  const noSha = makeCartographer({ clock, git: fakeGit({ [AUDIT_SHA]: 'x' }) });
  const dNo = noSha.deriveStatus(shardsFrom([fullEntry({ auditedAt: null, status: 'mapped' })]));
  A.eq(dNo.byStatus.stale, 0, 'no auditedAt sha -> never stale');
  A.eq(dNo.byStatus.mapped, 1, 'a mapped entry is counted as mapped');

  // a missing entry is counted separately and never as perfected.
  const dMiss = fresh.deriveStatus(shardsFrom([fullEntry({ missing: true })]));
  A.eq(dMiss.byStatus.missing, 1, 'a missing entry is counted in the missing bucket');
  A.eq(dMiss.byStatus.perfected, 0, 'a missing entry is not counted perfected even if its status says so');
}

// ---- (d) schema validation rejects a malformed entry LOUDLY ----
{
  const carto = makeCartographer({ clock, git: fakeGit() });
  A.notThrows(() => carto.validateEntry(fullEntry(), 'areas/system.json#ui/system/bb-recruit'), 'a well-formed entry validates clean');

  // bad kind
  A.throws(() => carto.validateEntry(fullEntry({ kind: 'widget' }), 'system.json#bad'), 'a bad kind throws');
  // bad area
  A.throws(() => carto.validateEntry(fullEntry({ area: 'nowhere' }), 'system.json#bad'), 'a bad area throws');
  // bad status
  A.throws(() => carto.validateEntry(fullEntry({ status: 'shipped' }), 'system.json#bad'), 'a bad status throws');
  // missing id
  A.throws(() => carto.validateEntry(fullEntry({ id: '' }), 'system.json#noid'), 'a missing id throws');
  // missing name
  A.throws(() => carto.validateEntry(fullEntry({ name: '' }), 'system.json#noname'), 'a missing name throws');
  A.throws(() => carto.validateEntry(fullEntry({ purpose: '' }), 'system.json#nopurpose'), 'a perfected entry without purpose throws');
  A.throws(() => carto.validateEntry(fullEntry({ promise: '' }), 'system.json#nopromise'), 'a perfected entry without promise throws');
  A.throws(() => carto.validateEntry(fullEntry({ wiring: { files: [], events: [] } }), 'system.json#nowiring'), 'a perfected entry without wiring files throws');
  A.throws(() => carto.validateEntry(fullEntry({ coverage: [] }), 'system.json#nocoverage'), 'a perfected entry without coverage throws');
  A.throws(() => carto.validateEntry(fullEntry({ auditedAt: null }), 'system.json#noaudit'), 'a perfected entry without audit provenance throws');
  A.throws(() => carto.validateEntry(fullEntry({ auditedAt: { sha: 'abc1234', date: ISO0 } }), 'system.json#shortsha'), 'a short/ambiguous audit SHA throws');
  // the error names the location (file+id) so a corrupt shard is greppable.
  let msg = '';
  try { carto.validateEntry(fullEntry({ kind: 'widget' }), 'areas/system.json#ui/system/bb-recruit'); }
  catch (e) { msg = e.message; }
  A.ok(/areas\/system\.json#ui\/system\/bb-recruit/.test(msg), 'the validation error names the file+id location');

  // the merge validates the SHAPE it would mint (a garbage harvest element is caught, not silently persisted).
  A.throws(() => carto.mergeSweep({}, { elements: [{ id: 'x/y', kind: 'bogus', area: 'commands', name: 'n' }], sweptKinds: [], reportRel: 'r' }),
    'the merge rejects a harvest element with a bad kind');
}

// ---- (d2) aggregate registry authority cannot shrink its denominator or double-count ids ----
{
  const carto = makeCartographer({ clock, git: fakeGit() });
  const complete = {};
  for (const area of AREAS) {
    complete[area] = { area, updatedAt: ISO0, entries: [fullEntry({
      id: 'state/' + area, kind: 'state', area, name: area
    })] };
  }
  A.eq(carto.validateShardSet(complete).total, AREAS.length, 'complete non-empty required area set validates');
  const missing = Object.assign({}, complete); delete missing.props;
  A.throws(() => carto.validateShardSet(missing), 'missing props area blocks instead of shrinking the denominator');
  const empty = Object.assign({}, complete, { props: { area: 'props', updatedAt: ISO0, entries: [] } });
  A.throws(() => carto.validateShardSet(empty), 'empty required area blocks');
  const duplicate = JSON.parse(JSON.stringify(complete));
  duplicate.props.entries[0].id = duplicate.system.entries[0].id;
  A.throws(() => carto.validateShardSet(duplicate), 'duplicate ids across shards block');
  const gitError = makeCartographer({ clock, git: { logSince() { throw new Error('git unavailable'); } } });
  A.throws(() => gitError.deriveStatus(shardsFrom([fullEntry()])), 'git failure blocks freshness instead of counting perfected');
}

// ---- (d3) props are harvested from the real catalog contract, never a copied inventory ----
{
  const catalog = [
    { id: 'desk', label: 'DESK', cat: 'workstation', tier: 'functional', w: 2, h: 1 },
    { id: 'rug', label: 'RUG', cat: 'decor', tier: 'cosmetic', w: 4, h: 3 }
  ];
  const rows = enumerateProps(catalog, id => id === 'desk' || id === 'rug');
  A.eq(rows.map(row => row.id), ['prop/desk', 'prop/rug'], 'catalog IDs become stable prop Atlas IDs');
  A.eq(rows[0].area, 'props', 'harvested props land in the props authority shard');
  A.ok(/functional\/workstation/.test(rows[0].name), 'harvested name carries truthful tier/category metadata');
  A.throws(() => enumerateProps([], () => true), 'empty catalog blocks enumeration');
  A.throws(() => enumerateProps(catalog.concat(catalog[0]), () => true), 'duplicate prop IDs block enumeration');
  A.throws(() => enumerateProps([
    { id: 'a_b', label: 'A', cat: 'decor', tier: 'cosmetic', w: 1, h: 1 },
    { id: 'a-b', label: 'B', cat: 'decor', tier: 'cosmetic', w: 1, h: 1 }
  ], () => true), 'different raw IDs that normalize to one Atlas ID block enumeration');
  A.throws(() => enumerateProps(catalog, id => id !== 'rug'), 'catalog prop without a renderer blocks enumeration');
  A.throws(() => enumerateProps([{ id: 'x', label: 'X', cat: 'decor', tier: 'unknown', w: 1, h: 1 }], () => true), 'invalid prop tier blocks enumeration');
  A.throws(() => enumerateProps([{ id: 'x', label: 'X', cat: 'decor', tier: 'cosmetic', w: 1.5, h: 1 }], () => true), 'fractional prop footprint blocks enumeration');

  const PropSprites = require('../frontend/app/propsprites.js');
  const real = enumerateProps(PropSprites.CATALOG, PropSprites.has);
  A.ok(real.length > 0 && real.length === PropSprites.CATALOG.length, 'real catalog is fully harvested and nonempty');
  A.eq(new Set(real.map(row => row.id)).size, real.length, 'real catalog yields unique Atlas IDs');
  A.ok(real.every(row => PropSprites.has(row.id.replace(/^prop\//, '').replace(/-/g, '_')) || PropSprites.CATALOG.some(p => 'prop/' + slug(p.id) === row.id && PropSprites.has(p.id))),
    'every real harvested row resolves to a real renderer');
  A.eq(real.some(row => row.id === 'prop/belth'), false, 'legacy draw-only beltH is excluded from the placeable catalog inventory');
}

// ---- (e) STATUS row splice: replaced vs inserted-after-Janitor ----
{
  const carto = makeCartographer({ clock, git: fakeGit() });
  const derived = carto.deriveStatus(shardsFrom([fullEntry()]));
  const row = carto.statusRow(derived, { isoTime: '2026-07-07 12:00Z', sha: 'abc1234def', gauge: derived.markdown, unmapped: 0 });
  A.ok(/^\| Cartographer \|/.test(row), 'the row starts with the Cartographer cell');
  A.ok(/PERFECTED-fresh/.test(row), 'the row carries the gauge');

  // REPLACED: an existing Cartographer row is spliced in place, other rows byte-preserved.
  const withRow = [
    '| Crew | Q | Last run | Result | Open |',
    '| --- | --- | --- | --- | --- |',
    '| Janitor | rot? | 2026-07-01 | clean | 0 |',
    '| Cartographer | old | 2026-07-01 | OLD | 9 |',
    '| Overseer | dig | 2026-07-01 | — | — |'
  ].join('\n');
  const r1 = carto.renderStatus(withRow, row);
  A.eq(r1.replaced, true, 'an existing Cartographer row is REPLACED');
  A.eq(r1.inserted, false, 'not inserted when it already exists');
  A.ok(r1.markdown.indexOf('| Cartographer | old |') < 0, 'the old row is gone');
  A.ok(r1.markdown.indexOf(row) >= 0, 'the fresh row is present');
  A.ok(/\| Overseer \| dig \|/.test(r1.markdown), 'other rows preserved byte-for-byte');

  // INSERTED: no Cartographer row -> inserted right after the Janitor row.
  const noRow = [
    '| Crew | Q | Last run | Result | Open |',
    '| --- | --- | --- | --- | --- |',
    '| Janitor | rot? | 2026-07-01 | clean | 0 |',
    '| Overseer | dig | 2026-07-01 | — | — |'
  ].join('\n');
  const r2 = carto.renderStatus(noRow, row);
  A.eq(r2.replaced, false, 'nothing to replace');
  A.eq(r2.inserted, true, 'the row is INSERTED when absent');
  const lines = r2.markdown.split('\n');
  const jIdx = lines.findIndex(l => /^\|\s*Janitor\s*\|/.test(l));
  A.ok(/^\|\s*Cartographer\s*\|/.test(lines[jIdx + 1]), 'the new row sits immediately after the Janitor row');

  // NEITHER: no crew table at all -> returned unchanged, flagged for the caller to warn.
  const r3 = carto.renderStatus('# just a heading\n\nno table here\n', row);
  A.eq(r3.replaced, false, 'no table -> not replaced');
  A.eq(r3.inserted, false, 'no table -> not inserted');
  A.eq(r3.markdown, '# just a heading\n\nno table here\n', 'no-table input returned unchanged');
}

// ---- (f) sanity: areaOfState mapping + exported taxonomy ----
{
  A.eq(areaOfState('ingame'), 'world', 'ingame -> world');
  A.eq(areaOfState('sys-settings'), 'system', 'sys-* -> system');
  A.eq(areaOfState('crew-recruit'), 'crew', 'crew-* -> crew');
  A.eq(areaOfState('work-tasks'), 'work', 'work-* -> work');
  A.eq(areaOfState('build-station'), 'build', 'build-* -> build');
  A.ok(AREAS.includes('commands') && AREAS.includes('routes') && AREAS.includes('events') && AREAS.includes('props'), 'the static areas are in the taxonomy');
  A.ok(STATUSES.length === 4 && STATUSES[0] === 'unmapped' && STATUSES[3] === 'perfected', 'the status lifecycle is unmapped..perfected');
}

// ---- (g) ENUM_PROBE fallback keys are ANCHOR-STABLE, not positional (regression lock) ----
// The defect: the no-id/no-aria fallback keyed elements as 'txt:'+tag+':'+txt+':'+n where n was a
// GLOBAL per-tag counter across the page. Any DOM insertion shifted every subsequent unlabeled key,
// orphaning hundreds of session-judged entries en masse. The fix anchors the key to the nearest
// id-bearing ancestor and scopes the ordinal to the (tag, anc, txt) bucket. computeProbeKeys is the
// pure mirror of the in-page ENUM_PROBE, so this locks the shape + stability without a browser.
{
  const carto = makeCartographer({ clock, git: fakeGit() });

  // (a) the new key shape is what entryId slugs.
  const k = computeProbeKeys([{ tag: 'button', anc: '#bay-panel', txt: 'Save' }])[0];
  A.eq(k, 'txt:button:#bay-panel:Save:1', 'fallback key = txt:tag:anc:txt:ordinal (anchor-scoped)');
  A.eq(carto.entryId({ kind: 'ui', area: 'system', key: k }), 'ui/system/txt-button-bay-panel-save-1', 'entryId slugs the new key shape');

  // the ordinal disambiguates ONLY true same-(tag,anc,txt) siblings.
  const sibs = computeProbeKeys([
    { tag: 'button', anc: '#list', txt: 'X' },
    { tag: 'button', anc: '#list', txt: 'X' }
  ]);
  A.eq(sibs[0], 'txt:button:#list:X:1', 'first same-labeled sibling is ordinal 1');
  A.eq(sibs[1], 'txt:button:#list:X:2', 'second same-labeled sibling is ordinal 2');
  // an element under a DIFFERENT ancestor with the SAME text is NOT bumped to :2 (own bucket).
  const twoAnc = computeProbeKeys([
    { tag: 'button', anc: '#panelA', txt: 'Go' },
    { tag: 'button', anc: '#panelB', txt: 'Go' }
  ]);
  A.eq(twoAnc[0], 'txt:button:#panelA:Go:1', 'same text under panelA is ordinal 1');
  A.eq(twoAnc[1], 'txt:button:#panelB:Go:1', 'same text under panelB is ALSO ordinal 1 (separate bucket)');

  // (b) inserting ONE new unlabeled button BEFORE the existing ones does not change the keys of
  // elements under different ancestors or with different text (the old global counter DID shift them).
  const before = [
    { tag: 'button', anc: '#panelA', txt: 'Save' },
    { tag: 'button', anc: '#panelB', txt: 'Cancel' },
    { tag: 'button', anc: '#panelA', txt: 'Delete' }
  ];
  const after = [
    { tag: 'button', anc: '#panelC', txt: 'New' },   // freshly inserted at the FRONT of the DOM
    { tag: 'button', anc: '#panelA', txt: 'Save' },
    { tag: 'button', anc: '#panelB', txt: 'Cancel' },
    { tag: 'button', anc: '#panelA', txt: 'Delete' }
  ];
  const kBefore = computeProbeKeys(before);
  const kAfter = computeProbeKeys(after);
  A.eq(kAfter[1], kBefore[0], 'Save key unchanged by an unrelated front insertion');
  A.eq(kAfter[2], kBefore[1], 'Cancel key unchanged by an unrelated front insertion');
  A.eq(kAfter[3], kBefore[2], 'Delete key unchanged by an unrelated front insertion');
  A.eq(kAfter[0], 'txt:button:#panelC:New:1', 'only the genuinely-new element gets a new key');

  // and the merge treats that stability correctly: seed the registry with `before`, re-sweep with
  // `after`, and NOTHING churns except one created skeleton (no missing, no re-created originals).
  const uiHarvest = (nodes, keys) => keys.map((key, i) => ({
    id: carto.entryId({ kind: 'ui', area: 'system', key }), kind: 'ui', area: 'system',
    name: nodes[i].txt, selector: 'button', state: 'sys-x'
  }));
  const seed = carto.mergeSweep({}, { elements: uiHarvest(before, kBefore), sweptKinds: ['ui'], reportRel: 'r' });
  A.eq(seed.created, 3, 'seed sweep creates the three original skeletons');
  const resweep = carto.mergeSweep(seed.shards, { elements: uiHarvest(after, kAfter), sweptKinds: ['ui'], reportRel: 'r' });
  A.eq(resweep.created, 1, 'the re-sweep creates ONLY the newly-inserted button');
  A.eq(resweep.missing.length, 0, 'no original entry is orphaned/missing by the insertion');
  A.eq(resweep.findings.length, 0, 'no dead-entry finding filed (the churn bug is fixed)');
  const ids = new Set(resweep.shards.system.entries.map(e => e.id));
  A.ok(ids.has(carto.entryId({ kind: 'ui', area: 'system', key: kBefore[0] })), 'the Save entry survives under its stable id');
}

// ---- (g2) DATA-DRIVEN LIST COLLAPSE: an unbounded catalog list harvests to ONE representative ----
// The defect (finding e9d24ac6): the #model-dock-list model rows are data-driven from the live provider
// catalog (~400 rows), each an anonymous <button> whose nearest id-bearing ancestor is #model-dock-list.
// The txt-fallback minted ONE atlas entry PER model row — unjudgeable individually, churning
// missing/staleness on every catalog refresh. The fix collapses any anonymous element inside a listed
// container (DATA_DRIVEN_LISTS) to ONE representative key. computeProbeKeys is the pure mirror of the
// in-page ENUM_PROBE, so this locks the collapse without a browser.
{
  const carto = makeCartographer({ clock, git: fakeGit() });

  // (a) the collapse map exists and names the model dock list container -> a stable representative.
  A.ok(DATA_DRIVEN_LISTS && DATA_DRIVEN_LISTS['#model-dock-list'], 'DATA_DRIVEN_LISTS registers the model-dock list container');
  A.eq(DATA_DRIVEN_LISTS['#model-dock-list'].key, 'model-list-row', 'the model-dock list collapses to the model-list-row key');

  // (b) N different model rows under #model-dock-list ALL collapse to the ONE representative key.
  const rows = [
    { tag: 'button', anc: '#model-dock-list', txt: 'claude opus 4.8 MED' },
    { tag: 'button', anc: '#model-dock-list', txt: 'llama 4 scout OFF' },
    { tag: 'button', anc: '#model-dock-list', txt: 'gpt 5 MED' },
    { tag: 'button', anc: '#model-dock-list', txt: 'gemini 2.5 pro MED' }
  ];
  const keys = computeProbeKeys(rows);
  A.eq(new Set(keys).size, 1, 'N model rows collapse to exactly ONE distinct key');
  A.eq(keys[0], 'model-list-row', 'the collapsed key is the representative model-list-row');
  A.eq(carto.entryId({ kind: 'ui', area: 'world', key: keys[0] }), 'ui/world/model-list-row', 'entryId yields the single representative id');

  // (c) an id/data-term/aria-bearing row is individually judgeable and is NOT collapsed (precedence).
  const named = computeProbeKeys([
    { id: 'model-dock-search', tag: 'input', anc: '#model-dock-list' },
    { dataTerm: 'foo', tag: 'button', anc: '#model-dock-list' },
    { ariaLabel: 'refresh catalog', tag: 'button', anc: '#model-dock-list' }
  ]);
  A.eq(named[0], '#model-dock-search', 'an id-bearing element in the container keeps its #id key (not collapsed)');
  A.eq(named[1], '[data-term=foo]', 'a data-term element keeps its own key (not collapsed)');
  A.eq(named[2], 'aria:refresh catalog', 'an aria-labelled element keeps its own key (not collapsed)');

  // (d) elements OUTSIDE any listed container are untouched — the collapse is scoped, not global.
  const outside = computeProbeKeys([
    { tag: 'button', anc: '#bay-panel', txt: 'Save' },
    { tag: 'button', anc: '', txt: 'Loose' }
  ]);
  A.eq(outside[0], 'txt:button:#bay-panel:Save:1', 'an anonymous element under a non-listed ancestor keeps its txt-fallback key');
  A.eq(outside[1], 'txt:button::Loose:1', 'an anonymous element with no id-ancestor keeps its txt-fallback key');

  // (e) the MERGE consequence: a sweep enumerating N collapsed model rows creates ONE entry, not N.
  const uiHarvest = (ks) => ks.map((key) => ({
    id: carto.entryId({ kind: 'ui', area: 'world', key }), kind: 'ui', area: 'world',
    name: 'a model row in the model dock', selector: '#model-dock-list button', state: 'ingame'
  }));
  const merged = carto.mergeSweep({}, { elements: uiHarvest(keys), sweptKinds: ['ui'], reportRel: 'r' });
  A.eq(merged.created, 1, 'N enumerated model rows merge into exactly ONE created entry (over-harvest fixed)');
  A.eq((merged.shards.world.entries || []).length, 1, 'the world shard carries a single model-list-row entry');
  A.eq(merged.shards.world.entries[0].id, 'ui/world/model-list-row', 'the single entry is the representative id');
}

// ---- (h) route harvester: same-statement method<->path binding (SSE path-match + phantom-variant lock) ----
// The defect: the route regex paired a `req.method === 'X'` token with the FIRST /api path within 240 chars,
// even across `}`/`return`/`;` into a LATER guard. That both DROPPED path-match routes (the GET SSE stream
// whose method token got swallowed by a preceding guard's loose gap) and MINTED phantom method variants
// (a POST skeleton for a GET-only SSE path; a GET label for a POST-only route). harvestRoutes is the pure
// authority the CLI uses; this fixture reproduces the EXACT index.js shapes so the fix is locked disk-free.
{
  // reproduces sidecar/index.js: the generic-channels block (POST/GET guards whose url match is NOT an /api
  // literal) immediately followed by the GET SSE path-match guard for /api/channels/events (index.js:4597).
  const sseFixture = [
    "  {",
    "    const gm = req.url.match(/^\\/api\\/channels\\/(slack|matrix|signal)\\/(connect|sync|disconnect|status)$/);",
    "    if (gm) {",
    "      if (req.method === 'POST' && gm[2] === 'connect') return handleGenericChannelConnect(req, res, gm[1]);",
    "      if (req.method === 'POST' && gm[2] === 'disconnect') return handleGenericChannelDisconnect(req, res, gm[1]);",
    "      if (req.method === 'GET' && gm[2] === 'status') return handleGenericChannelStatus(req, res, gm[1]);",
    "    }",
    "  }",
    "  if (req.method === 'GET' && req.url.split('?')[0] === '/api/channels/events') return handleChannelEvents(req, res);",
  ].join('\n');
  const sse = harvestRoutes(sseFixture);
  const sseKeys = sse.map(r => r.key);
  A.ok(sseKeys.includes('GET-/api/channels/events'), 'the GET SSE path-match route is harvested (2a: path-match seam no longer invisible)');
  A.eq(sseKeys.includes('POST-/api/channels/events'), false, 'no phantom POST variant minted for the GET-only SSE path (2b)');

  // reproduces index.js:4631-4632 — the GET /api/models/ prefix guard (a split+indexOf form the regex does
  // NOT match as a path) immediately followed by the POST-only /api/auth/codex/logout guard. The old regex
  // let the GET reach forward and mislabel logout as GET; the tempered gap forbids crossing `return`/`;`.
  const codexFixture = [
    "  if (req.method === 'GET' && req.url.split('?')[0].indexOf('/api/models/') === 0) return handleProviderModels(req, res);",
    "  if (req.method === 'POST' && req.url === '/api/auth/codex/logout') return handleCodexLogout(req, res);",
  ].join('\n');
  const codex = harvestRoutes(codexFixture).map(r => r.key);
  A.ok(codex.includes('POST-/api/auth/codex/logout'), 'the POST-only logout route is harvested with its real method (2b)');
  A.eq(codex.includes('GET-/api/auth/codex/logout'), false, 'no phantom GET variant minted for the POST-only logout route (2b)');

  // a clean single guard binds its own method+path.
  const one = harvestRoutes("  if (req.method === 'GET' && req.url === '/api/version') return handleVersion(req, res);");
  A.eq(one.length, 1, 'a single clean guard yields exactly one route');
  A.eq(one[0].method + ' ' + one[0].path, 'GET /api/version', 'the clean guard binds its own method+path');

  // a multi-method OR guard still binds the FIRST method (no return/; between the alternatives) — preserves
  // the long-standing behavior for routes like GET /api/nightshift/focus (POST/DELETE documented in notes).
  const orGuard = harvestRoutes("  if ((req.method === 'GET' || req.method === 'POST' || req.method === 'DELETE') && req.url.split('?')[0] === '/api/nightshift/focus') return handleNightshiftFocus(req, res);");
  A.eq(orGuard.map(r => r.key), ['GET-/api/nightshift/focus'], 'an OR-method guard binds the FIRST method (behavior preserved)');

  // all four url-match forms are recognized.
  const forms = harvestRoutes([
    "if (req.method === 'GET' && req.url === '/api/a') return h(req, res);",
    "if (req.method === 'GET' && req.url.split('?')[0] === '/api/b') return h(req, res);",
    "if (req.method === 'GET' && req.url.indexOf('/api/c') === 0) return h(req, res);",
    "if (req.method === 'GET' && req.url.startsWith('/api/d')) return h(req, res);",
    "if (req.method === 'GET' && apiauth.pathOf(req.url) === '/api/e') return h(req, res);",
  ].join('\n')).map(r => r.path);
  A.eq(forms, ['/api/a', '/api/b', '/api/c', '/api/d', '/api/e'], 'all four url-match forms (===, split===, indexOf, startsWith, pathOf) are harvested');

  // dedup: the same method+path guarded twice yields ONE route.
  const dup = harvestRoutes("if (req.method === 'GET' && req.url === '/api/x') return a(req, res);\nif (req.method === 'GET' && req.url === '/api/x') return b(req, res);");
  A.eq(dup.length, 1, 'a duplicate method+path guard is deduped to one route');
}

A.report('qa-cartographer.test');
