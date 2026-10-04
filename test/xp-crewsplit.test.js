/* node test/xp-crewsplit.test.js — P3.2 CREW-RUN ATTRIBUTION (Xp.crewSplit).

   A 👍 on a LEAD run has one Commander-defined value. A named worker run-end proves participation; spend and tool
   volume describe execution shape but never the value of the outcome. The browser projection collapses duplicate
   workers and requests equal credit; the sidecar independently rebuilds the canonical list from durable child runs. */
'use strict';
const A = require('./_assert.js');
const Xp = require('../frontend/app/xp.js');

/* ---------- 1. no workers → lead-only, no fabricated split ---------- */
let r = Xp.crewSplit({ leadDelta: 6, leadCost: 0.4, workers: [] });
A.eq(r.lead.delta, 6, 'the lead keeps its full delta when there is no crew');
A.eq(r.workers.length, 0, 'no workers → no worker shares (nothing fabricated)');

/* ---------- 2. named run receipts count even when the work was free/unmetered ---------- */
r = Xp.crewSplit({ leadDelta: 6, leadCost: 0.4, workers: [{ agentId: 'w1', usd: 0 }, { agentId: 'w2' }] });
A.eq(r.workers.map(w => w.delta), [6, 6], 'free/unmetered named workers receive the same explicit verdict value');
A.eq(r.lead.delta, 6, 'the lead still keeps its full delta');

/* ---------- 3. a named worker receives exactly the lead verdict value ---------- */
r = Xp.crewSplit({ leadDelta: 8, leadCost: 0.5, workers: [{ agentId: 'w1', usd: 0.5 }] });
A.eq(r.lead.delta, 8, 'the lead keeps its full delta regardless of the split');
A.eq(r.workers.length, 1, 'a worker with provable cost is credited');
A.eq(r.workers[0].agentId, 'w1', 'the credited worker is identified by its real agentId');
A.eq(r.workers[0].delta, 8, 'worker credit is equal to the Commander verdict, not a cost fraction');

/* ---------- 4. spend cannot rank multiple contributors ---------- */
r = Xp.crewSplit({ leadDelta: 10, leadCost: 0, workers: [{ agentId: 'big', usd: 0.9 }, { agentId: 'small', usd: 0.1 }] });
const big = r.workers.find(w => w.agentId === 'big');
const small = r.workers.find(w => w.agentId === 'small');
A.ok(big && small, 'both proven workers are credited');
A.eq(big.delta, small.delta, 'the bigger spender cannot outrank another proven contributor');
A.eq(big.delta, 10, 'the expensive contributor receives the one verdict value');
A.eq(small.delta, 10, 'the inexpensive contributor receives the same verdict value');

/* ---------- 5. worker credit is bounded by and equal to the sanitized verdict delta ---------- */
r = Xp.crewSplit({ leadDelta: 3, leadCost: 0, workers: [{ agentId: 'w1', usd: 100 }] });
A.eq(r.workers[0].delta, 3, 'a lone proven worker share is capped at the lead\'s delta (never more than the whole)');
r = Xp.crewSplit({ leadDelta: 5, leadCost: 100, workers: [{ agentId: 'w1', usd: 0.001 }] });
A.eq(r.workers[0].delta, 5, 'a tiny-cost contributor is not valued below an expensive one');

/* ---------- 6. the size hint each worker rides matches its own spend (feeds xp.js scoreEvent) ---------- */
r = Xp.crewSplit({ leadDelta: 6, leadCost: 0.2, workers: [{ agentId: 'w1', usd: 0.6 }] });
A.eq(r.workers[0].size, 'large', 'a worker\'s size hint derives from ITS OWN spend (0.6 usd → large)');

/* ---------- 7. defensive: garbage / missing args never throw, never fabricate ---------- */
A.eq(Xp.crewSplit().workers.length, 0, 'no args → empty split, no throw');
A.eq(Xp.crewSplit({ leadDelta: 5 }).workers.length, 0, 'missing workers → empty split');
r = Xp.crewSplit({ leadDelta: NaN, workers: [{ agentId: 'w1', usd: 0.5 }] });
A.ok(r.lead.delta >= 1, 'a NaN leadDelta is sanitized to a valid delta (>=1)');

r = Xp.crewSplit({ leadDelta: 4, workers: [{ agentId: 'w1', usd: 1 }, { agentId: 'w1', usd: 5 }] });
A.eq(r.workers.length, 1, 'duplicate receipts for one named worker cannot double-award the verdict');

A.report('xp-crewsplit.test');
