/* node test/web.fetch-jina.test.js — web_fetch must not spend a doomed round-trip on a keyed proxy.

   FOUND 2026-07-25 from a real user transcript ("sometimes my agent finds a way around, other times not").
   Jina Reader's KEYLESS tier is gone: every r.jina.ai request without a token now returns
   401 AuthenticationRequiredError — verified live against example.com, Wikipedia and a vendor docs site, so
   it is auth, not a rate limit. The code still described it as "keyless 20 RPM" and attempted it FIRST on
   every single web_fetch, so every fetch paid a guaranteed-failing hop and then silently fell back to
   directFetch — which returns our own cruder htmlToText and is refused outright by anti-bot sites.

   Contract locked here:
     • no key  -> Jina is not attempted AT ALL (one hop, straight to direct)
     • key set -> Jina IS attempted, and a failure still falls back rather than erroring the tool */
'use strict';
const A = require('./_assert.js');
const { makeWebTools } = require('../sidecar/tools/builtin/web.js');

function spy(jinaStatus) {
  const hits = [];
  const impl = (u) => {
    hits.push(String(u));
    if (String(u).indexOf('r.jina.ai') >= 0) {
      return Promise.resolve({ status: jinaStatus, headers: { get: () => 'text/plain' }, text: async () => 'JINA TEXT' });
    }
    return Promise.resolve({ status: 200, headers: { get: () => 'text/plain' }, text: async () => 'DIRECT BODY' });
  };
  return { impl, hits, jina: () => hits.filter(h => h.indexOf('r.jina.ai') >= 0).length };
}

(async () => {
  // ---- A. NO key: the keyed proxy must not be touched ----
  {
    const s = spy(401);
    const r = await makeWebTools({ fetchImpl: s.impl, lookup: null }).webFetch('https://example.com');
    A.eq(s.jina(), 0, 'with no key configured, r.jina.ai is never called (no wasted hop on every fetch)');
    A.eq(s.hits.length, 1, 'exactly one request is made');
    A.eq(r.source, 'direct', 'the direct path serves the page');
    A.ok(/DIRECT BODY/.test(r.text), 'the page text comes back');
  }

  // ---- B. key set: the proxy IS used, and its 401 still degrades gracefully ----
  {
    const s = spy(200);
    const r = await makeWebTools({ fetchImpl: s.impl, lookup: null, jinaKey: 'jina_test_key' }).webFetch('https://example.com');
    A.eq(s.jina(), 1, 'a configured key means the clean-extraction path IS attempted');
    A.eq(r.source, 'jina', 'and it serves the page when it works');
    A.ok(/JINA TEXT/.test(r.text), 'the extracted text comes back');

    const s2 = spy(401);
    const r2 = await makeWebTools({ fetchImpl: s2.impl, lookup: null, jinaKey: 'stale_key' }).webFetch('https://example.com');
    A.eq(s2.jina(), 1, 'a stale/invalid key still attempts once');
    A.eq(r2.source, 'direct', 'and a 401 falls back to direct rather than failing the tool');
    A.ok(/DIRECT BODY/.test(r2.text), 'the user still gets the page');
  }

  // ---- C. the key is a SECRET: it must never surface in what the tool returns ----
  {
    const s = spy(200);
    const r = await makeWebTools({ fetchImpl: s.impl, lookup: null, jinaKey: 'jina_SECRET_value' }).webFetch('https://example.com');
    A.ok(JSON.stringify(r).indexOf('jina_SECRET_value') < 0, 'the Jina key never appears in the fetch result');
  }

  // ---- D. the context preview ceiling retains the complete extracted page for the central parker ----
  {
    const complete = 'PAGE'.repeat(2000);
    const W = makeWebTools({ fetchImpl: async () => ({ status: 200, headers: { get: () => 'text/plain' }, text: async () => complete }), lookup: null });
    const r = await W.webFetch('https://example.com/large');
    A.ok(r.text.length < complete.length, 'large page text stays bounded in context');
    A.eq(r.fullText, complete, 'the exact extracted page crosses the durable-output seam without a second fetch');
  }

  /* ---- a hostile page must not be able to freeze the single-process station ----
     htmlToText was a chain of lazy `[\s\S]*?` replaces, every one QUADRATIC on input the fetch does not
     control: `<script` with no `</script>` makes the scan walk to end-of-input from each start position.
     Measured on repeated "<script>": 64KB -> 55ms, 256KB -> 880ms, 1MB -> 14.3 SECONDS of event-loop
     freeze, and web_fetch is read-only, no-consent, callable on any URL. Now a single linear pass. ---- */
  {
    const W = makeWebTools({ fetchImpl: async () => ({ status: 200, headers: { get: () => '' }, text: async () => '' }), lookup: null });
    const H = W._internals.htmlToText;
    // well-formed HTML is unchanged
    A.eq(H('<h1>Title</h1><p>a <b>b</b> &amp; c</p><ul><li>x</li></ul>'), 'Title\na b & c\nx', 'ordinary HTML extracts exactly as before');
    A.eq(H('<script>var a="</p>";</script><p>after</p>'), 'after', 'script CONTENTS never reach the text');
    A.eq(H('<!-- c --><p>k</p>'), 'k', 'comments are dropped');
    A.eq(H('<br><br/>x'), 'x', 'br variants become newlines');
    // malformed input is bounded AND no longer leaks raw source as page text
    A.eq(H('<p>a</p><script>unclosed'), 'a', 'an UNCLOSED script no longer leaks its source into the page text');
    A.eq(H('text<!--unclosed'), 'text', 'an unterminated comment is not page text');
    // and the cost is linear, not quadratic
    for (const kb of [256, 1024, 4096]) {
      const t0 = Date.now();
      H('<script>'.repeat(kb * 128));
      const ms = Date.now() - t0;
      A.ok(ms < 2000, kb + 'KB of hostile markup extracts in ' + ms + 'ms (was 14290ms at 1MB)');
    }
    const t1 = Date.now(); H('<'.repeat(1024 * 1024));
    A.ok(Date.now() - t1 < 2000, 'a megabyte of bare "<" is linear too');
  }

  A.report('web.fetch-jina.test');
})().catch(e => { console.log('FAIL: web.fetch-jina threw — ' + (e && e.stack || e)); process.exit(1); });
