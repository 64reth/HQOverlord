/* sidecar/agent-lifecycle.js — composes the workspace lease with active-run truth for agent-wide operations. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).agentLifecycle = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function makeAgentLifecycle(opts) {
    opts = opts || {};
    const lease = opts.workspaceLease;
    const isActive = typeof opts.isActive === 'function' ? opts.isActive : function () { return false; };
    if (!lease || typeof lease.acquire !== 'function' || typeof lease.release !== 'function') {
      throw new Error('makeAgentLifecycle: workspaceLease is required');
    }
    const deleting = new Set();
    const key = value => String(value == null ? '' : value);

    function canStart(agentId) { return !deleting.has(key(agentId)); }

    async function acquireMutation(agentId, operationId) {
      agentId = key(agentId); operationId = key(operationId);
      if (deleting.has(agentId)) return { ok: false, deleting: true };
      const got = await lease.acquire(agentId, operationId);
      if (!got.ok) return got;
      // A deletion may have reserved the lifecycle while this mutation waited behind another holder.
      if (deleting.has(agentId)) {
        lease.release(agentId, operationId);
        return { ok: false, deleting: true };
      }
      return { ok: true, release: () => lease.release(agentId, operationId) };
    }

    async function beginDelete(agentId, operationId) {
      agentId = key(agentId); operationId = key(operationId);
      if (deleting.has(agentId)) return { ok: false, deleting: true };
      if (isActive(agentId)) return { ok: false, active: true };
      // Reserve synchronously before awaiting the workspace. Run admission consults canStart(), so no new run
      // can enter between the active check and the archive.
      deleting.add(agentId);
      const got = await lease.acquire(agentId, operationId);
      if (!got.ok) {
        deleting.delete(agentId);
        return got;
      }
      // Defense in depth for a run admitted immediately before the reservation became visible.
      if (isActive(agentId)) {
        lease.release(agentId, operationId);
        deleting.delete(agentId);
        return { ok: false, active: true };
      }
      let finished = false;
      return {
        ok: true,
        finish() {
          if (finished) return;
          finished = true;
          lease.release(agentId, operationId);
          deleting.delete(agentId);
        }
      };
    }

    return { canStart, acquireMutation, beginDelete, isDeleting: agentId => deleting.has(key(agentId)) };
  }

  return { makeAgentLifecycle };
});
