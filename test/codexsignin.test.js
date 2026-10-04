/* test/codexsignin.test.js — the shared ChatGPT device-code sign-in engine (frontend/app/codexsignin.js),
   extracted from app.js so Settings→PROVIDERS RE-SIGN-IN drives the SAME flow instead of duplicating it.
   Stubbed global fetch; proves:
     · start → onRequesting → onCode with the sidecar's user_code + verification_uri
     · a pending poll keeps polling; a 'connected' poll fires onConnected (the marker-clearing moment)
     · an 'error' poll fires onError with the sidecar's message
     · a failed /start fires onError and never polls
     · cancel() silences an in-flight flow (no late callbacks after screen change / disconnect)
     · logout() posts to /api/auth/codex/logout and cancels first
   Poll timers have a 2s floor, so this file spends a few real seconds — still fast-gate material. */
'use strict';
const A = require('./_assert.js');
const CodexSignIn = require('../frontend/app/codexsignin.js');

const calls = [];
let pollScript = [];   // queued poll responses, shifted per /poll call
global.fetch = async (url, opts) => {
  calls.push({ url, method: (opts && opts.method) || 'GET', body: opts && opts.body });
  if (url === '/api/auth/codex/start') {
    if (pollScript._startFail) return { ok: false, status: 502, json: async () => ({ error: 'device endpoint unreachable' }) };
    return { ok: true, json: async () => ({ user_code: 'ABCD-1234', verification_uri: 'https://auth.openai.com/codex/device', device_auth_id: 'dev-1', interval: 0.001, expires_in: 900 }) };
  }
  if (url === '/api/auth/codex/poll') {
    const next = pollScript.length ? pollScript.shift() : { status: 'pending' };
    return { ok: true, json: async () => next };
  }
  if (url === '/api/auth/codex/logout') return { ok: true, json: async () => ({ connected: false }) };
  throw new Error('unexpected fetch ' + url);
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // ---- happy path: start → code → pending → connected ----
  pollScript = [{ status: 'pending' }, { status: 'connected' }];
  const seen = [];
  CodexSignIn.start({
    onRequesting: () => seen.push('requesting'),
    onCode: c => seen.push('code:' + c.user_code + ':' + c.verification_uri),
    onConnected: () => seen.push('connected'),
    onError: m => seen.push('error:' + m),
    onTimeout: () => seen.push('timeout')
  });
  await sleep(80);
  A.eq(seen[0], 'requesting', 'onRequesting fires while /start is in flight');
  A.eq(seen[1], 'code:ABCD-1234:https://auth.openai.com/codex/device', 'onCode delivers the sidecar user_code + verification URL');
  A.ok(CodexSignIn.active(), 'the flow is active while polling');
  await sleep(4600);   // two poll ticks at the 2s floor
  A.eq(seen[2], 'connected', 'a connected poll fires onConnected (and nothing else)');
  A.eq(seen.length, 3, 'no stray callbacks after the terminal state');
  A.ok(!CodexSignIn.active(), 'the flow is idle after connecting');
  const polls = calls.filter(c => c.url === '/api/auth/codex/poll');
  A.eq(polls.length, 2, 'exactly two poll ticks were sent');
  A.ok(/dev-1/.test(polls[0].body) && /ABCD-1234/.test(polls[0].body), 'the poll carries device_auth_id + user_code');

  // ---- error poll ----
  pollScript = [{ status: 'error', error: 'access was denied' }];
  const seen2 = [];
  CodexSignIn.start({ onError: m => seen2.push(m), onConnected: () => seen2.push('connected') });
  await sleep(2300);
  A.eq(seen2, ['sign-in failed: access was denied'], "an 'error' poll surfaces the sidecar's message via onError");
  A.ok(!CodexSignIn.active(), 'the flow is idle after a hard error');

  // ---- failed /start ----
  pollScript = []; pollScript._startFail = true;
  const seen3 = [];
  const pollsBefore = calls.filter(c => c.url === '/api/auth/codex/poll').length;
  await CodexSignIn.start({ onError: m => seen3.push(m), onCode: () => seen3.push('code') });
  A.eq(seen3, ['could not start sign-in: device endpoint unreachable'], 'a failed /start reports onError');
  await sleep(2300);
  A.eq(calls.filter(c => c.url === '/api/auth/codex/poll').length, pollsBefore, 'a failed /start never polls');
  delete pollScript._startFail;

  // ---- cancel() silences an in-flight flow ----
  pollScript = [{ status: 'connected' }];
  const seen4 = [];
  CodexSignIn.start({ onCode: () => seen4.push('code'), onConnected: () => seen4.push('connected') });
  await sleep(80);
  A.eq(seen4, ['code'], 'the flow reached the code stage');
  CodexSignIn.cancel();
  A.ok(!CodexSignIn.active(), 'cancel() drops the flow');
  await sleep(2300);
  A.eq(seen4, ['code'], 'no callbacks land after cancel() (screen change / disconnect)');

  // ---- logout ----
  await CodexSignIn.logout();
  const lo = calls.filter(c => c.url === '/api/auth/codex/logout');
  A.eq(lo.length, 1, 'logout posts to /api/auth/codex/logout');
  A.eq(lo[0].method, 'POST', 'logout is a POST');

  A.report('codexsignin.test');
})().catch(e => { console.error(e); process.exit(1); });
