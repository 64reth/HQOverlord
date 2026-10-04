'use strict';
// permgrants.test.js — the standing-grant manager behind the Permissions Panel (autonomy B1).
// Security-critical: grants are LOCAL-ONLY + curated; persist is fail-closed; revoke withdraws ANY consent.
const assert = require('assert');
const { makeGrantManager, GRANTABLE } = require('../sidecar/permgrants.js');

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// a fake durable sink we can inspect + make throw.
function fakeStore() {
  const calls = [];
  let boom = false;
  return {
    calls,
    fail() { boom = true; },
    heal() { boom = false; },
    persist(arr) { if (boom) throw new Error('disk full'); calls.push(arr.slice()); }
  };
}

// --- the curated catalog is LOCAL-ONLY (the security boundary) ---
ok(Array.isArray(GRANTABLE) && GRANTABLE.length >= 1, 'GRANTABLE is a non-empty list');
ok(GRANTABLE.includes('cabinet:write'), 'GRANTABLE includes the local file-write class');
ok(!GRANTABLE.some(k => /:execute$/.test(k)), 'GRANTABLE contains NO execute class (autonomous exec is hard-locked)');
ok(GRANTABLE.every(k => /^[a-z_]+:(read|write)$/.test(k)), 'every grantable key is a LOCAL read/write scope (never execute/send/publish/spend)');
ok(GRANTABLE.every(k => /^cabinet:/.test(k)), 'v1 grantable capability is the local fs cabinet only');

// --- snapshot ---
{
  const set = new Set(); const s = fakeStore();
  const gm = makeGrantManager({ grantsPermanent: set, persist: s.persist });
  const snap = gm.snapshot();
  ok(Array.isArray(snap.grants) && snap.grants.length === 0, 'snapshot.grants empty on a clean store');
  ok(snap.grantable.includes('cabinet:write'), 'snapshot.grantable surfaces the curated catalog');
}

// --- grant a curated key ---
{
  const set = new Set(); const s = fakeStore();
  const gm = makeGrantManager({ grantsPermanent: set, persist: s.persist });
  const r = gm.grant('cabinet:write');
  ok(r.ok === true, 'grant of a curated key succeeds');
  ok(set.has('cabinet:write'), 'the in-memory broker Set now carries the grant (effective next run)');
  ok(s.calls.length === 1 && s.calls[0].includes('cabinet:write'), 'persist was called with the new key');
  ok(r.grants.includes('cabinet:write'), 'returned grants reflect the add');
}

// --- grant of a NON-curated key is refused (the panel can never hand out exec/send) ---
{
  const set = new Set(); const s = fakeStore();
  const gm = makeGrantManager({ grantsPermanent: set, persist: s.persist });
  for (const bad of ['workbench:execute', 'net:send', 'cabinet:read', 'spend:money', '']) {
    const r = gm.grant(bad);
    ok(r.ok === false, 'grant refused for non-curated/empty key: ' + JSON.stringify(bad));
  }
  ok(set.size === 0, 'no non-curated key ever entered the grant Set');
  ok(s.calls.length === 0, 'persist never called for a refused grant');
}

// --- grant is idempotent ---
{
  const set = new Set(['cabinet:write']); const s = fakeStore();
  const gm = makeGrantManager({ grantsPermanent: set, persist: s.persist });
  const r = gm.grant('cabinet:write');
  ok(r.ok === true && set.size === 1, 're-granting an existing key is a no-op success');
  ok(s.calls.length === 0, 'idempotent grant does not re-persist');
}

// --- grant FAILS CLOSED when persist throws ---
{
  const set = new Set(); const s = fakeStore(); s.fail();
  const gm = makeGrantManager({ grantsPermanent: set, persist: s.persist });
  const r = gm.grant('cabinet:write');
  ok(r.ok === false, 'grant returns ok:false when the durable write throws');
  ok(!set.has('cabinet:write'), 'fail-closed: the grant did NOT commit to memory when persist failed');
}

// --- revoke a curated grant ---
{
  const set = new Set(['cabinet:write']); const s = fakeStore();
  const gm = makeGrantManager({ grantsPermanent: set, persist: s.persist });
  const r = gm.revoke('cabinet:write');
  ok(r.ok === true && !set.has('cabinet:write'), 'revoke removes the grant from memory');
  ok(s.calls.length === 1 && !s.calls[0].includes('cabinet:write'), 'persist called with the key removed');
}

// --- revoke works on ANY key (withdraw a previously-blessed non-curated class) ---
{
  const set = new Set(['net:send', 'cabinet:write']); const s = fakeStore();
  const gm = makeGrantManager({ grantsPermanent: set, persist: s.persist });
  const r = gm.revoke('net:send');
  ok(r.ok === true && !set.has('net:send'), 'revoke withdraws even a non-curated standing grant');
  ok(set.has('cabinet:write'), 'revoke is surgical — other grants untouched');
}

// --- revoke idempotent + fail-closed ---
{
  const set = new Set(['cabinet:write']); const s = fakeStore();
  const gm = makeGrantManager({ grantsPermanent: set, persist: s.persist });
  ok(gm.revoke('cabinet:read').ok === true, 'revoking an absent key is a no-op success');
  ok(s.calls.length === 0, 'no-op revoke does not persist');
  s.fail();
  const r = gm.revoke('cabinet:write');
  ok(r.ok === false && set.has('cabinet:write'), 'fail-closed: a torn persist keeps the grant');
}

// --- PROVENANCE (additive B1.1): a grant stamps grantedAt; snapshot exposes it; revoke drops it ---
{
  const set = new Set(); const s = fakeStore(); const meta = {};
  const gm = makeGrantManager({ grantsPermanent: set, persist: s.persist, meta, now: () => 1700000000000 });
  ok(gm.snapshot().meta && Object.keys(gm.snapshot().meta).length === 0, 'clean snapshot has an empty meta map');
  gm.grant('cabinet:write');
  const snap = gm.snapshot();
  ok(snap.meta['cabinet:write'] && snap.meta['cabinet:write'].grantedAt === 1700000000000, 'grant stamped grantedAt from the injected clock');
  ok(meta['cabinet:write'] && meta['cabinet:write'].grantedAt === 1700000000000, 'provenance committed to the shared meta store');
  // persist carried BOTH the allow array and the new meta (second arg) so index.js can durably write it.
  ok(s.calls.length === 1, 'grant persisted once');
  gm.revoke('cabinet:write');
  ok(!gm.snapshot().meta['cabinet:write'], 'revoke dropped the provenance row');
  ok(!meta['cabinet:write'], 'shared meta store no longer carries the revoked key');
}

// --- meta VIEW is scoped to held grants: an orphan meta row (no matching grant) is never surfaced ---
{
  const set = new Set(['cabinet:write']); const s = fakeStore();
  const meta = { 'cabinet:write': { grantedAt: 111 }, 'ghost:write': { grantedAt: 222 } };
  const gm = makeGrantManager({ grantsPermanent: set, persist: s.persist, meta });
  const snap = gm.snapshot();
  ok(snap.meta['cabinet:write'] && snap.meta['cabinet:write'].grantedAt === 111, 'held grant surfaces its provenance');
  ok(!snap.meta['ghost:write'], 'an orphan meta row (no held grant) is NOT surfaced');
}

// --- LEGACY store (no meta injected) still works: grants list, snapshot.meta is {} not undefined ---
{
  const set = new Set(['cabinet:write']); const s = fakeStore();
  const gm = makeGrantManager({ grantsPermanent: set, persist: s.persist });   // no meta / no now → old callers
  const snap = gm.snapshot();
  ok(snap.grants.includes('cabinet:write'), 'legacy manager still lists grants');
  ok(snap.meta && typeof snap.meta === 'object', 'snapshot.meta is always an object (no provenance → empty)');
}

// --- fail-closed provenance: a torn persist commits NEITHER the grant NOR its meta ---
{
  const set = new Set(); const s = fakeStore(); s.fail(); const meta = {};
  const gm = makeGrantManager({ grantsPermanent: set, persist: s.persist, meta, now: () => 42 });
  const r = gm.grant('cabinet:write');
  ok(r.ok === false, 'grant denied when persist throws');
  ok(!set.has('cabinet:write') && !meta['cabinet:write'], 'fail-closed: neither the grant nor its provenance committed');
}

console.log('permgrants.test.js OK —', n, 'assertions');
