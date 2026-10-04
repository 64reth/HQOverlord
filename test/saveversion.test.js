/* node test/saveversion.test.js — FORWARD-VERSION GUARDS (update-safety audit P0.3).

   A save written by a NEWER StarNet must never be silently adopted, migrated, re-stamped, or clobbered by this
   older code. This locks the three seams that used to violate that:

     • frontend/app/save.js   — load()/loadStatus() REFUSE a doc whose version > CURRENT and leave the stored
                                 raw doc BYTE-FOR-BYTE untouched (no migrate → no version re-stamp → no field drop).
     • frontend/app/cloudsave.js — reconcile() never adopts a future-version LOCAL or REMOTE into localStorage;
                                 it hands the boot path a { __futureSave } sentinel and leaves the cache unchanged.
                                 The post-adoption fallback re-validates and prefers prior local on failure.
     • frontend/app/backup.js — validate() refuses an import whose backup envelope version > Backup.VERSION.

   Pure + deterministic: a tiny in-memory localStorage shim, no real fetch/DOM. */
'use strict';
const A = require('./_assert.js');

// ---- in-memory localStorage shim (records exact bytes so we can prove "untouched") ----
const mem = {};
global.localStorage = {
  getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; },
  clear: () => { for (const k in mem) delete mem[k]; }
};
const SAVE_KEY = 'starnet.save';

// expose Save/Backup as globals too: cloudsave.js reads a module-scope `Save` global for its forward-version
// ceiling + the re-validation re-read, exactly as it does in the browser (where these are window globals).
const Save = global.Save = require('../frontend/app/save.js');
const Backup = global.Backup = require('../frontend/app/backup.js');
const CloudSave = require('../frontend/app/cloudsave.js');

const FUTURE_V = Save.CURRENT + 42;   // unambiguously ahead of this build's ceiling
// a well-formed envelope EXCEPT for a future version + a field this build has never heard of.
function futureRaw(over) {
  return JSON.stringify(Object.assign({
    schema: 'starnet.save', version: FUTURE_V, updatedAt: 5000,
    agent: { id: 'agent', name: 'NOVA', stats: { xp: 9 } },
    somethingV99Added: { a: 1, b: [2, 3] }   // the "unread future field" that must not be dropped
  }, over || {}));
}

(async () => {
// ============================================================================
// 1. save.js — load() refuses a future doc AND leaves the stored bytes untouched
// ============================================================================
{
  localStorage.clear();
  const raw = futureRaw();
  localStorage.setItem(SAVE_KEY, raw);

  A.eq(Save.load(), null, 'load() returns null for a future-version save (no legacy caller can adopt it)');
  A.ok(Save.isFuture(), 'isFuture() is true for a future-version save');

  const st = Save.loadStatus();
  A.eq(st.status, 'future', 'loadStatus() reports status:future');
  A.eq(st.version, FUTURE_V, 'loadStatus() surfaces the stored future version');
  A.eq(st.doc, null, 'loadStatus() hands back no doc for a future save');

  // THE key invariant: the stored doc is byte-for-byte unchanged (not migrated, not re-stamped to CURRENT,
  // the v99 field NOT dropped, no pre-migrate backup key minted).
  A.eq(localStorage.getItem(SAVE_KEY), raw, 'stored raw doc is byte-identical after a refused load');
  A.eq(localStorage.getItem(Save.PRE_MIGRATE_BACKUP_KEY), null, 'no pre-migrate backup was written for a future save');
}

// ---- sanity: a CURRENT / older doc still loads + migrates normally (guard did not over-reach) ----
{
  localStorage.clear();
  localStorage.setItem(SAVE_KEY, JSON.stringify({ schema: 'starnet.save', version: Save.CURRENT, updatedAt: 1, agent: { id: 'agent', name: 'NOVA' } }));
  const d = Save.load();
  A.ok(d && d.agent && d.agent.name === 'NOVA', 'a current-version save still loads normally');
  A.ok(!Save.isFuture(), 'isFuture() is false for a current-version save');
  A.eq(d.version, Save.CURRENT, 'current save keeps CURRENT version');
}

// ============================================================================
// 2. cloudsave.js reconcile() — future LOCAL / future REMOTE never adopted
// ============================================================================

// 2a. future LOCAL cache → sentinel, cache untouched, no network needed
{
  localStorage.clear();
  const raw = futureRaw();
  localStorage.setItem(SAVE_KEY, raw);
  // reconcile receives what Save.load() returns for a future save (null). It must still detect the future case:
  // we pass the parsed future doc directly to exercise the isFutureSave() branch the boot path relies on.
  const futureDoc = JSON.parse(raw);
  const out = await CloudSave.reconcile(futureDoc);
  A.ok(CloudSave.isFutureSentinel(out), 'reconcile(futureLocal) returns a future-save sentinel');
  A.eq(out.version, FUTURE_V, 'sentinel carries the future version');
  A.eq(localStorage.getItem(SAVE_KEY), raw, 'local cache byte-unchanged after future-local reconcile');
  A.ok(CloudSave._isFutureSave(futureDoc), '_isFutureSave() recognises a future doc');
}

// 2b. future REMOTE (pull returns a newer doc) → not adopted, sentinel, cache untouched
{
  localStorage.clear();
  const localRaw = JSON.stringify({ schema: 'starnet.save', version: Save.CURRENT, updatedAt: 10, agent: { id: 'agent', name: 'LOCALGUY' } });
  localStorage.setItem(SAVE_KEY, localRaw);
  const localDoc = JSON.parse(localRaw);

  // stub fetch so pull() returns a FUTURE remote that is also "newer" by updatedAt (would normally be adopted).
  const remote = JSON.parse(futureRaw({ updatedAt: 99999 }));
  global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ save: remote }) });

  const out = await CloudSave.reconcile(localDoc);
  A.ok(CloudSave.isFutureSentinel(out), 'reconcile(futureRemote) returns a future-save sentinel');
  A.eq(out.version, FUTURE_V, 'remote-sentinel carries the future version');
  A.eq(localStorage.getItem(SAVE_KEY), localRaw, 'local cache NOT overwritten by a future remote');
  delete global.fetch;
}

// 2c. an OLDER remote still adopts + re-validates through Save.load() (guard did not break normal restore)
{
  localStorage.clear();
  // no local at all → remote wins. remote is a valid v(CURRENT) doc, so Save.load() re-reads a migrated doc.
  const remote = { schema: 'starnet.save', version: Save.CURRENT, updatedAt: 500, agent: { id: 'agent', name: 'REMOTEGAL', stats: { xp: 1 } } };
  global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ save: remote }) });
  const out = await CloudSave.reconcile(null);
  A.ok(out && out.agent && out.agent.name === 'REMOTEGAL', 'a valid older/current remote is still adopted normally');
  A.ok(!CloudSave.isFutureSentinel(out), 'a normal adoption is not a future sentinel');
  delete global.fetch;
}

// ============================================================================
// 3. backup.js validate() — refuse a backup file from a newer StarNet
// ============================================================================
{
  const goodStore = { 'starnet.save': JSON.stringify({ schema: 'starnet.save', version: Save.CURRENT, agent: { name: 'NOVA' } }) };

  // future backup version → refused with a clear string the import UI surfaces.
  const err = Backup.validate({ schema: 'starnet.backup', version: Backup.VERSION + 1, store: goodStore });
  A.ok(typeof err === 'string' && /newer StarNet/i.test(err), 'validate() refuses a future-version backup with a clear message');

  // applyBundle refuses it too (never writes any key) — validate() gates it.
  localStorage.clear();
  const res = Backup.applyBundle({ schema: 'starnet.backup', version: Backup.VERSION + 1, store: goodStore });
  A.eq(res.ok, false, 'applyBundle refuses a future-version backup');
  A.eq(localStorage.getItem('starnet.save'), null, 'no save key written from a refused future backup');

  // a CURRENT-version backup still validates + applies (guard did not over-reach).
  A.eq(Backup.validate({ schema: 'starnet.backup', version: Backup.VERSION, store: goodStore }), null, 'a current-version backup still validates');
}

A.report('saveversion');
})();
