'use strict';
// A connection continuation shares only its original task's connector-write replay scope.
// It grants no tools and cannot bypass the normal run admission or consent path.
function continuationScope(rows, sourceRunId, agentId, streamId) {
  if (!sourceRunId) return null;
  if (!streamId || typeof sourceRunId !== 'string') throw new Error('Connection continuation requires its original task.');
  const byId = new Map(rows.map(r => [r.runId, r]));
  const seen = new Set();
  let id = sourceRunId;
  for (;;) {
    const row = byId.get(id);
    if (!row || row.agentId !== agentId || row.streamId !== streamId || row.reason !== 'done' || seen.has(id)) {
      throw new Error('The original connection task is unavailable or no longer safe to continue.');
    }
    if (row.uncertainMutations && row.uncertainMutations.length) throw new Error('Review the original task’s uncertain actions before continuing.');
    seen.add(id);
    if (!row.parentRunId) return 'run:' + id;
    id = row.parentRunId;
  }
}
module.exports = { continuationScope };
