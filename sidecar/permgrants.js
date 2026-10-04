/* sidecar/permgrants.js — the STANDING-GRANT manager behind the Permissions Panel (autonomy Stage B / B1).

   The consent broker (permissions.js) already CONSUMES permanent grants (grantsPermanent: a Set of
   dangerKeys the user has blessed forever, restored from permissions.allow.json on boot). But the only way
   to ADD one today is to answer a mid-run interactive prompt with "always" — and an AUTONOMOUS run never
   prompts. So there is no way to PROACTIVELY pre-bless a capability, see what's blessed, or REVOKE it. This
   module is that missing surface: a small, pure, injected-dependency manager the /api/permissions routes wrap.

   makeGrantManager({ grantsPermanent, persist, grantable, meta, now }) -> { snapshot, grant, revoke }
     snapshot()      -> { grants:[dangerKey...], grantable:[dangerKey...], meta:{key:{grantedAt}} }  // grants = EVERYTHING blessed (honest)
     grant(key)      -> { ok, grants, reason? }   // only a CURATED, local-safe key may be ADDED
     revoke(key)     -> { ok, grants }            // ANY key may be REMOVED (the user can always withdraw consent)

   PROVENANCE (additive, B1.1): each grant carries a small `meta` record — right now just { grantedAt } (epoch
   ms, from the injected `now`) so the Standing-Approvals ledger can show WHEN a capability was blessed. It is
   PURELY additive: `meta` is an injected/optional store (defaults to {}), it is stamped only when NEW grants
   land, and older on-disk records that have no meta still load and list fine (grantedAt just reads null). We do
   NOT record which prompt/run a grant came from — that would mean threading the interactive consent-prompt flow,
   which this slice does not touch; that provenance stays an honest gap, never a fabricated value. The broker
   (permissions.js) is untouched: it reads only the `grants` Set, never `meta`.

   THE CURATED CATALOG (`GRANTABLE`) is the security boundary of the panel: it is the ONLY set of danger
   classes the UI is allowed to hand out unprompted, and it is deliberately LOCAL-ONLY (write files in the
   agent's own jailed workspace). It can NEVER include execute (the broker hard-locks autonomous exec anyway,
   permissions.js:92), nor send/publish/spend. Adding to it is a deliberate, reviewed act — not a config.

   FAIL-CLOSED like the broker's 'always' path: a grant/revoke commits to the in-memory Set ONLY after the
   durable persist() succeeds; a thrown persist leaves state untouched and returns ok:false. The in-memory Set
   is the SAME reference every per-run broker reads (index.js wires grantsPermanent through), so a successful
   grant takes effect for the very next autonomous run with no restart.

   Pure: no IO, no clock, no env — persist is injected. Node-testable; UMD so the frontend catalog test can
   import GRANTABLE and cross-lock against the panel's catalog (single source of truth for the key set). */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).permgrants = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // The curated, LOCAL-ONLY danger classes the Permissions Panel may grant unprompted. dangerKey =
  // capability:scope (see permissions.js). 'cabinet:write' = the fs.write/edit/append/patch family — create
  // and edit files INSIDE the agent's jailed workspace (.env/.git stay hardline-blocked; every write is
  // checkpointed + reversible). Keep this list tiny and local; never add execute/network/send classes here.
  const GRANTABLE = ['cabinet:write'];

  function makeGrantManager(opts) {
    opts = opts || {};
    const grantsPermanent = opts.grantsPermanent instanceof Set ? opts.grantsPermanent : new Set();
    const persist = typeof opts.persist === 'function' ? opts.persist : null;
    const grantable = new Set(Array.isArray(opts.grantable) ? opts.grantable : GRANTABLE);
    // provenance store (additive): { dangerKey: { grantedAt } }. Injected so it can be loaded from disk and
    // shared with the persist sink; defaults to an empty object so an un-wired manager behaves exactly as before.
    const meta = (opts.meta && typeof opts.meta === 'object') ? opts.meta : {};
    // clock is INJECTED (pure module, no wall-clock read): the sidecar edge wires Date.now. With no clock wired
    // (unit tests that don't care about time), a grant stamps grantedAt:null — honest, never a fabricated time.
    const now = typeof opts.now === 'function' ? opts.now : (() => null);

    const sortedGrants = () => Array.from(grantsPermanent).sort();
    // a shallow copy of the provenance, keyed only by grants that are actually held (drops orphaned meta rows so
    // the ledger never shows a "when granted" for a capability that isn't blessed anymore).
    const metaView = () => {
      const out = {};
      for (const k of grantsPermanent) if (meta[k]) out[k] = { grantedAt: meta[k].grantedAt != null ? meta[k].grantedAt : null };
      return out;
    };

    function snapshot() {
      return { grants: sortedGrants(), grantable: Array.from(grantable).sort(), meta: metaView() };
    }

    // ADD a standing grant — only a curated, local-safe key. Persist-before-commit (fail-closed). Stamps a
    // grantedAt provenance record for NEW grants (additive; a re-grant keeps the original timestamp).
    function grant(key) {
      if (typeof key !== 'string' || !key) return { ok: false, reason: 'missing key', grants: sortedGrants() };
      if (!grantable.has(key)) return { ok: false, reason: 'not a grantable capability', grants: sortedGrants() };
      if (grantsPermanent.has(key)) return { ok: true, grants: sortedGrants() };   // idempotent
      const next = new Set(grantsPermanent); next.add(key);
      const stampedAt = now();
      const nextMeta = Object.assign({}, meta, { [key]: { grantedAt: stampedAt } });
      if (persist) {
        try { persist(Array.from(next), nextMeta); }
        catch (e) { return { ok: false, reason: 'could not persist grant — denied', grants: sortedGrants() }; }
      }
      grantsPermanent.add(key);
      meta[key] = { grantedAt: stampedAt };
      return { ok: true, grants: sortedGrants() };
    }

    // REMOVE a standing grant — ANY key (withdrawing consent is always allowed, even for a non-curated class
    // the user blessed via a past interactive prompt). Persist-before-commit so a torn write never silently
    // "revokes" a grant that's still on disk. Also drops the provenance row for the withdrawn key.
    function revoke(key) {
      if (typeof key !== 'string' || !key) return { ok: false, reason: 'missing key', grants: sortedGrants() };
      if (!grantsPermanent.has(key)) return { ok: true, grants: sortedGrants() };   // idempotent
      const next = new Set(grantsPermanent); next.delete(key);
      const nextMeta = Object.assign({}, meta); delete nextMeta[key];
      if (persist) {
        try { persist(Array.from(next), nextMeta); }
        catch (e) { return { ok: false, reason: 'could not persist revoke — kept', grants: sortedGrants() }; }
      }
      grantsPermanent.delete(key);
      delete meta[key];
      return { ok: true, grants: sortedGrants() };
    }

    return { snapshot, grant, revoke };
  }

  return { makeGrantManager, GRANTABLE };
});
