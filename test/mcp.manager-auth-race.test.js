/* node test/mcp.manager-auth-race.test.js — GitHub #5 residue (audit 2026-09-03): the connector manager's
   http call path under CONCURRENT auth failures, Mcp-Session-Id expiry (HTTP 404), and typed refresh outcomes.

   (a) two calls that 401 together at token expiry, refresh works: exactly ONE reconnect, BOTH calls succeed,
       state stays up (before: the second connect superseded the first, caller A saw 'connecting', fell through to
       markAuthRequired and its teardown killed caller B — a VALID refreshed grant reported "reauth required").
   (b) a 404 (expired session) earns ONE re-initialize + retry and stays up; consecutive 404s take the normal
       consecutive-failure path (before: three idle-expired sessions flipped a healthy server to "unreachable").
   (c) the provider's typed refresh outcome: invalid_grant -> authRequired (no backoff); a network miss keeps
       the old token, does NOT set authRequired, and arms the bounded reconnect backoff instead. */
'use strict';
const A = require('./_assert.js');
const { makeConnectorManager } = require('../sidecar/mcp/manager.js');

function makeFake(spec) {
  const timers = [];
  const log = { inits: 0, calls: 0, tokens: [] };
  const mgr = makeConnectorManager({
    makeTransport: ({ token }) => { log.tokens.push(token); return { token, send() {}, onMessage() {}, close() {} }; },
    makeClient: ({ transport }) => ({
      initialize: async () => {
        log.inits++;
        if (spec.init401) throw new Error('connector HTTP 401');
        if (spec.acceptToken && transport.token !== spec.acceptToken) throw new Error('connector HTTP 401');
        return { serverInfo: {} };
      },
      serverCapabilities: { tools: {} },
      supports: k => k === 'tools',
      listTools: async () => [{ name: 'read_mail', inputSchema: { type: 'object' } }],
      callTool: async () => {
        log.calls++;
        if (typeof spec.onCall === 'function') { const r = spec.onCall(transport, log); if (r) throw r; }
        return { content: [{ type: 'text', text: 'ok:' + transport.token }] };
      },
      close() {}, isClosed: () => false
    }),
    setTimeoutImpl: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeoutImpl: () => {},
    onEvent: () => {}
  });
  return { mgr, timers, log };
}
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

(async () => {
  // ── (a) concurrent 401s at expiry, refreshed token is GOOD ──
  {
    const spec = { acceptToken: 'old', onCall: (tp) => tp.token !== spec.acceptToken ? new Error('connector HTTP 401 — invalid_token') : null };
    const f = makeFake(spec);
    const forced = [];
    const gate = defer();   // the host's single-flight refresh: both callers wait on the SAME promise
    await f.mgr.configure('gmail', { url: 'https://gmail.example/mcp', oauth: true,
      tokenProvider: async (force) => { if (!force) return spec.acceptToken; forced.push(true); await gate.promise; return 'fresh'; } });
    A.eq(f.mgr.status('gmail').state, 'up', 'connected with the old bearer');
    spec.acceptToken = 'fresh';                 // the server now rejects 'old' — the bearer expired mid-session
    const initsBefore = f.log.inits;
    const pA = f.mgr.call('gmail', 'read_mail', {});
    const pB = f.mgr.call('gmail', 'read_mail', {});
    await new Promise(r => setTimeout(r, 5));  // let both 401s land + both callers reach the shared refresh
    gate.resolve();
    const [rA, rB] = await Promise.all([pA.catch(e => e), pB.catch(e => e)]);
    A.ok(rA && rA.content && rA.content[0].text === 'ok:fresh', 'caller A succeeds on the refreshed bearer (' + ((rA && rA.message) || 'ok') + ')');
    A.ok(rB && rB.content && rB.content[0].text === 'ok:fresh', 'caller B succeeds on the refreshed bearer (' + ((rB && rB.message) || 'ok') + ')');
    A.eq(f.log.inits - initsBefore, 1, 'exactly ONE reconnect served both 401s (single-flight connect)');
    A.eq(f.mgr.status('gmail').state, 'up', 'state stays up — a valid refreshed grant is never reported as reauth');
    A.eq(f.mgr.status('gmail').authRequired, false, 'no reauth flag');
    A.eq(f.timers.length, 0, 'no backoff armed');
    await f.mgr.close();
  }

  // ── (b) Mcp-Session-Id expiry: 404 -> ONE re-initialize + retry, stays up ──
  {
    let expired = true;
    const spec = { onCall: () => { if (expired) { expired = false; return new Error('connector HTTP 404 — session_not_found'); } return null; } };
    const f = makeFake(spec);
    await f.mgr.configure('docs', { url: 'https://docs.example/mcp', token: 'static' });
    const initsBefore = f.log.inits;
    const r = await f.mgr.call('docs', 'read_mail', {});
    A.eq(r.content[0].text, 'ok:static', 'an expired session recovers transparently (re-initialize + retry)');
    A.eq(f.log.inits - initsBefore, 1, 'exactly one re-initialize for the 404');
    A.eq(f.mgr.status('docs').state, 'up', 'a session expiry never counts toward "unreachable"');
    // three more expiries in a row, each recovered on its own call — still up, still zero failures counted
    for (let i = 0; i < 3; i++) { expired = true; await f.mgr.call('docs', 'read_mail', {}); }
    A.eq(f.mgr.status('docs').state, 'up', 'repeated idle expiries across separate calls never flip status');
    await f.mgr.close();
  }
  // (b2) a server that 404s EVERY request (a real miss): the retry's 404 falls through to normal failure accounting
  {
    const spec = { onCall: () => new Error('connector HTTP 404 — not_found') };
    const f = makeFake(spec);
    await f.mgr.configure('gone', { url: 'https://gone.example/mcp', token: 'static' });
    const errs = [];
    for (let i = 0; i < 3; i++) { try { await f.mgr.call('gone', 'read_mail', {}); } catch (e) { errs.push(e.message); } }
    A.eq(errs.length, 3, 'a persistent 404 is a failure the caller sees');
    A.ok(errs.every(m => /HTTP 404/.test(m)), 'the model sees the honest 404, not a reauth prompt');
    A.eq(f.mgr.status('gone').authRequired, false, 'a 404 is never auth');
    A.eq(f.mgr.status('gone').state, 'error', 'three consecutive real misses take the normal unreachable path');
    A.ok(/unreachable/.test(f.mgr.status('gone').detail), 'detail says unreachable');
    await f.mgr.close();
  }
  // (b3) concurrent 404s share the one re-initialize
  {
    let stale = 2;   // the first TWO requests (both in flight on the expired session) 404; the new session serves
    const spec = { onCall: () => { if (stale > 0) { stale--; return new Error('connector HTTP 404 — session_not_found'); } return null; } };
    const f = makeFake(spec);
    await f.mgr.configure('docs', { url: 'https://docs.example/mcp', token: 'static' });
    const initsBefore = f.log.inits;
    const pA = f.mgr.call('docs', 'read_mail', {}), pB = f.mgr.call('docs', 'read_mail', {});
    const [rA, rB] = await Promise.all([pA.catch(e => e), pB.catch(e => e)]);
    A.ok(rA.content && rB.content, 'both concurrent callers recover from the expired session');
    A.eq(f.log.inits - initsBefore, 1, 'one shared re-initialize for two concurrent 404s');
    A.eq(f.mgr.status('docs').state, 'up', 'still up');
    await f.mgr.close();
  }

  // ── (c) typed refresh outcome ──
  {
    // invalid_grant: the authorization server says the GRANT is dead -> honest reauth, no backoff
    const spec = { onCall: () => new Error('connector HTTP 401 — invalid_token') };
    const f = makeFake(spec);
    await f.mgr.configure('gmail', { url: 'https://gmail.example/mcp', oauth: true,
      tokenProvider: async (force) => force ? { token: 'old', refreshError: { kind: 'invalid_grant', message: 'token refresh HTTP 400 — invalid_grant' } } : 'old' });
    let threw = null;
    try { await f.mgr.call('gmail', 'read_mail', {}); } catch (e) { threw = e; }
    A.ok(threw && /needs reauthentication/.test(threw.message), 'invalid_grant -> the model is told to reauth');
    A.eq(f.mgr.status('gmail').authRequired, true, 'invalid_grant sets authRequired');
    A.eq(f.timers.length, 0, 'invalid_grant arms no backoff (retrying cannot mint a grant)');
    await f.mgr.close();
  }
  {
    // network: the token endpoint could not be reached -> old token kept, NOT authRequired, backoff recorded
    const spec = { onCall: () => new Error('connector HTTP 401 — invalid_token') };
    const f = makeFake(spec);
    let mode = 'network';
    await f.mgr.configure('gmail', { url: 'https://gmail.example/mcp', oauth: true,
      tokenProvider: async (force) => (force && mode === 'network') ? { token: 'old', refreshError: { kind: 'network', message: 'token refresh failed: fetch failed' } } : (mode === 'network' ? 'old' : 'fresh') });
    A.eq(f.log.tokens[0], 'old', 'connected with the old bearer');
    let threw = null;
    try { await f.mgr.call('gmail', 'read_mail', {}); } catch (e) { threw = e; }
    A.ok(threw && /could not refresh its sign-in \(network\)/.test(threw.message), 'the model sees an outage, not a reauth prompt: ' + (threw && threw.message));
    const s = f.mgr.status('gmail');
    A.eq(s.authRequired, false, 'a network refresh miss NEVER sets authRequired');
    A.eq(s.state, 'error', 'honest error state while the refresh is unreachable');
    A.ok(/sign-in refresh failed \(network\)/.test(s.detail), 'detail names the refresh outage');
    A.eq(f.timers.length, 1, 'bounded reconnect backoff recorded');
    // the backoff fires once the network is back: the provider now hands a fresh token and the connector recovers
    mode = 'ok'; spec.onCall = () => null;
    f.timers[0].fn();
    await new Promise(r => setTimeout(r, 5));
    A.eq(f.mgr.status('gmail').state, 'up', 'the backoff reconnect recovers once the refresh succeeds');
    A.eq(f.log.tokens[f.log.tokens.length - 1], 'fresh', 'the recovered connection carries the fresh bearer');
    await f.mgr.close();
  }
  {
    // legacy string provider + a THROW (host without the typed shape) still degrades to the old behaviour
    const spec = { onCall: () => new Error('connector HTTP 401 — invalid_token') };
    const f = makeFake(spec);
    await f.mgr.configure('hf', { url: 'https://hf.example/mcp', oauth: true, tokenProvider: async (force) => { if (force) throw new Error('boom'); return 'old'; } });
    let threw = null;
    try { await f.mgr.call('hf', 'read_mail', {}); } catch (e) { threw = e; }
    A.ok(threw && /could not refresh its sign-in \(other\)/.test(threw.message), 'an untyped provider throw is an outage (other), not a dead grant');
    A.eq(f.mgr.status('hf').authRequired, false, 'an untyped throw never claims the grant is dead');
    await f.mgr.close();
  }

  A.report('mcp.manager-auth-race');
})().catch(e => { console.error(e); process.exit(1); });
