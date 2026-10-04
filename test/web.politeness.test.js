/* node test/web.politeness.test.js — process-owned per-host request spacing and backoff. */
'use strict';
const A = require('./_assert.js');
const { makeWebTools, makePoliteScheduler } = require('../sidecar/tools/builtin/web.js');

function response(status, body, headers) {
  headers = headers || {};
  return {
    status,
    headers: { get: name => headers[String(name || '').toLowerCase()] || (name === 'content-type' ? 'text/plain' : '') },
    text: async () => body || ''
  };
}

(async () => {
  // Same host is spaced; a different host gets an independent first request.
  {
    const waits = [], calls = []; let clock = 0;
    const scheduler = makePoliteScheduler({ minGapMs: 250, now: () => clock, wait: async ms => { waits.push(ms); clock += ms; } });
    const web = makeWebTools({
      lookup: null, politeness: scheduler,
      fetchImpl: async url => { calls.push(String(url)); return response(200, 'ok'); }
    });
    await web.webFetch('https://a.example/one');
    await web.webFetch('https://a.example/two');
    await web.webFetch('https://b.example/one');
    A.eq(calls.length, 3, 'all three authorized requests run');
    A.eq(waits, [250], 'only the repeated same-host request is delayed');
    const snap = scheduler.snapshot();
    A.eq(snap.find(x => x.host === 'a.example').requests, 2, 'scheduler measures requests per host');
    A.eq(snap.find(x => x.host === 'b.example').lastDelayMs, 0, 'a different host has an independent bucket');
  }

  // Retry-After delta-seconds is honored but capped; no automatic retry is hidden from the caller.
  {
    const waits = []; let clock = 0;
    const scheduler = makePoliteScheduler({ minGapMs: 100, maxBackoffMs: 5000, now: () => clock, wait: async ms => { waits.push(ms); clock += ms; } });
    let n = 0;
    const web = makeWebTools({
      lookup: null, politeness: scheduler,
      fetchImpl: async () => ++n === 1 ? response(429, 'slow down', { 'retry-after': '2' }) : response(200, 'recovered')
    });
    let first = '';
    try { await web.webFetch('https://limited.example/a'); } catch (e) { first = e.message; }
    A.eq(first, 'http 429', 'the original 429 remains the truthful result — scheduler does not auto-retry');
    clock = 1500; // ordinary work elapsed before the next request; only the remaining cooldown is owed
    const ok = await web.webFetch('https://limited.example/b');
    A.eq(ok.text, 'recovered', 'a later request may succeed');
    A.eq(waits, [500], 'Retry-After is an absolute cooldown, not a fresh full delay after time already elapsed');
    A.eq(scheduler.snapshot()[0].backoffMs, 0, 'a successful response clears the remembered penalty');
  }

  // Repeated refusal without Retry-After backs off exponentially within the configured ceiling.
  {
    const waits = []; let clock = 0;
    const scheduler = makePoliteScheduler({ minGapMs: 100, initialBackoffMs: 800, maxBackoffMs: 2000, now: () => clock, wait: async ms => { waits.push(ms); clock += ms; } });
    const web = makeWebTools({ lookup: null, politeness: scheduler, fetchImpl: async () => response(403, 'no') });
    for (let i = 0; i < 3; i++) { try { await web.webFetch('https://refuses.example/' + i); } catch (_) {} }
    A.eq(waits, [800, 1600], 'repeated refusal backs off exponentially before later requests');
    A.eq(scheduler.snapshot()[0].backoffMs, 2000, 'remembered backoff is capped at the configured ceiling');
  }

  // A caller cancelled while queued behind a same-host request exits immediately; it is not held
  // hostage by work it no longer wants, and its request function never runs.
  {
    const scheduler = makePoliteScheduler({ minGapMs: 0 });
    let releaseFirst, secondRan = false;
    const first = scheduler.run('https://queue.example/a', null, () => new Promise(resolve => { releaseFirst = resolve; }));
    await Promise.resolve();
    const ac = new AbortController();
    const second = scheduler.run('https://queue.example/b', ac.signal, async () => { secondRan = true; return response(200); });
    ac.abort(new Error('cancelled in queue'));
    let reason = '';
    try { await second; } catch (error) { reason = error.message; }
    A.eq(reason, 'cancelled in queue', 'queued cancellation is observed before the preceding request finishes');
    A.eq(secondRan, false, 'a cancelled queued request is never sent');
    releaseFirst(response(200));
    await first;
  }

  // Process lifetime can see arbitrarily many domains. Idle buckets are LRU-bounded so politeness
  // telemetry cannot become a permanent host-name memory leak.
  {
    const scheduler = makePoliteScheduler({ minGapMs: 0, maxHosts: 2 });
    for (const host of ['one.example', 'two.example', 'three.example']) {
      await scheduler.run('https://' + host + '/', null, async () => response(200));
    }
    const hosts = scheduler.snapshot().map(row => row.host).sort();
    A.eq(hosts, ['three.example', 'two.example'], 'idle host state is capped and evicts the least-recently-used bucket');
  }

  A.report('web.politeness.test');
})();
