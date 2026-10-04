/* test/oauthsignin.test.js — the GENERALIZED device-code sign-in engine (frontend/app/codexsignin.js).
   The codex flow was extracted into a factory so grok/kimi (and any future keyless OAuth provider) drive the
   SAME start→code→poll→connected loop against /api/auth/<pid>/* instead of a bespoke copy. Stubbed global fetch;
   proves:
     · OAuthSignIn.for('grok') hits /api/auth/grok/{start,poll} (NOT codex) and delivers the sidecar user_code
     · a pending poll keeps polling; a 'connected' poll fires onConnected
     · cancel() silences an in-flight flow (no late callbacks)
     · logout() posts to /api/auth/grok/logout and cancels first
     · engines are per-provider + cached (for('grok') === for('grok'), !== for('kimi'))
     · single-flight is PER provider: a grok flow and a kimi flow can be live at once
     · CodexSignIn still behaves identically — for('codex') hits /api/auth/codex/* (regression companion). */
'use strict';
const A = require('./_assert.js');
const CodexSignIn = require('../frontend/app/codexsignin.js');
const OAuthSignIn = CodexSignIn.OAuthSignIn;

const calls = [];
const pollScripts = {};   // per-pid queued poll responses
global.fetch = async (url, opts) => {
  calls.push({ url, method: (opts && opts.method) || 'GET', body: opts && opts.body });
  const m = url.match(/^\/api\/auth\/([a-z]+)\/(start|poll|logout)$/);
  if (!m) throw new Error('unexpected fetch ' + url);
  const pid = m[1], kind = m[2];
  if (kind === 'start') {
    const d = { user_code: pid.toUpperCase() + '-9', verification_uri: 'https://auth.' + pid + '.example/device', device_auth_id: 'dev-' + pid, interval: 0.001, expires_in: 900 };
    // kimi is modelled on its REAL wire (live-captured 2026-07-28): the bare verification_uri is a code
    // CONSUMER page and only verification_uri_complete carries ?user_code=. codex publishes NO complete form.
    if (pid === 'kimi') {
      d.verification_uri = 'https://www.kimi.com/code/authorize_device';
      d.verification_uri_complete = 'https://www.kimi.com/code/authorize_device?user_code=KIMI-9';
    } else if (pid !== 'codex') {
      d.verification_uri_complete = 'https://auth.' + pid + '.example/device?code=' + d.user_code;
    }
    return { ok: true, json: async () => d };
  }
  if (kind === 'poll') {
    const q = pollScripts[pid] || [];
    const next = q.length ? q.shift() : { status: 'pending' };
    return { ok: true, json: async () => next };
  }
  return { ok: true, json: async () => ({ connected: false }) };
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // ---- OAuthSignIn.for('grok') is a real engine, cached + distinct per provider ----
  const grok = OAuthSignIn.for('grok');
  A.ok(grok && typeof grok.start === 'function', 'OAuthSignIn.for("grok") returns an engine');
  A.ok(OAuthSignIn.for('grok') === grok, 'the per-provider engine is cached (same instance on re-request)');
  A.ok(OAuthSignIn.for('kimi') !== grok, 'kimi gets its OWN engine, not the grok one');
  A.ok(OAuthSignIn.for('codex') === CodexSignIn, 'for("codex") returns the SAME CodexSignIn driver');

  // ---- happy path: start → code → pending → connected, all against /api/auth/grok/* ----
  pollScripts.grok = [{ status: 'pending' }, { status: 'connected' }];
  const seen = [];
  grok.start({
    onRequesting: () => seen.push('requesting'),
    onCode: c => seen.push('code:' + c.user_code + ':' + c.verification_uri),
    onConnected: () => seen.push('connected'),
    onError: m => seen.push('error:' + m),
    onTimeout: () => seen.push('timeout')
  });
  await sleep(80);
  A.eq(seen[0], 'requesting', 'onRequesting fires while /start is in flight');
  A.eq(seen[1], 'code:GROK-9:https://auth.grok.example/device', 'onCode delivers the grok user_code + verification URL');
  A.ok(grok.active(), 'the grok flow is active while polling');
  const startCall = calls.find(c => c.url === '/api/auth/grok/start');
  A.ok(startCall && startCall.method === 'POST', 'grok start POSTs /api/auth/grok/start (not codex)');
  A.ok(!calls.some(c => /\/api\/auth\/codex\//.test(c.url)), 'a grok sign-in NEVER touches the codex endpoints');
  await sleep(4600);   // two poll ticks at the 2s floor
  A.eq(seen[2], 'connected', 'a connected poll fires onConnected (and nothing else)');
  A.eq(seen.length, 3, 'no stray callbacks after the terminal state');
  A.ok(!grok.active(), 'the grok flow is idle after connecting');
  const polls = calls.filter(c => c.url === '/api/auth/grok/poll');
  A.eq(polls.length, 2, 'exactly two grok poll ticks were sent');
  A.ok(/dev-grok/.test(polls[0].body) && /GROK-9/.test(polls[0].body), 'the grok poll carries device_auth_id + user_code');

  /* ---- open_uri: the engine picks the URL that CARRIES the code ----
     Regression for the reported "Missing user_code parameter" kimi sign-in: the engine used to forward only
     the bare verification_uri, so every caller opened https://www.kimi.com/code/authorize_device with no
     code — a page that can only CONSUME a user_code — and the sign-in was unfinishable while the device and
     poll legs were healthy. onCode must expose the bare URL for DISPLAY and a separate open_uri to OPEN. */
  {
    const shapes = {};
    for (const pid of ['kimi', 'codex']) {
      pollScripts[pid] = [{ status: 'connected' }];
      OAuthSignIn.for(pid).start({ onCode: c => { shapes[pid] = c; } });
    }
    await sleep(80);
    A.eq(shapes.kimi.verification_uri, 'https://www.kimi.com/code/authorize_device', 'kimi still DISPLAYS the bare, typeable verification_uri');
    A.eq(shapes.kimi.open_uri, 'https://www.kimi.com/code/authorize_device?user_code=KIMI-9', 'kimi OPENS verification_uri_complete — the URL carrying ?user_code=');
    A.ok(/[?&]user_code=/.test(shapes.kimi.open_uri), 'the opened kimi URL can never be the bare code-less page again');
    A.eq(shapes.codex.open_uri, 'https://auth.codex.example/device', 'codex publishes no complete form, so open_uri falls back to the bare verification_uri');
    OAuthSignIn.for('kimi').cancel(); OAuthSignIn.for('codex').cancel();
  }

  // ---- single-flight is PER provider: grok + kimi can be mid-flow at the same time ----
  pollScripts.grok = [{ status: 'connected' }];
  pollScripts.kimi = [{ status: 'connected' }];
  const g2 = [], k2 = [];
  OAuthSignIn.for('grok').start({ onCode: () => g2.push('code'), onConnected: () => g2.push('connected') });
  OAuthSignIn.for('kimi').start({ onCode: () => k2.push('code'), onConnected: () => k2.push('connected') });
  await sleep(80);
  A.ok(OAuthSignIn.for('grok').active() && OAuthSignIn.for('kimi').active(), 'both grok and kimi flows are live simultaneously (no shared single-flight)');
  await sleep(2400);
  A.eq(g2, ['code', 'connected'], 'the grok flow completed on its own endpoints');
  A.eq(k2, ['code', 'connected'], 'the kimi flow completed on its own endpoints');
  A.ok(calls.some(c => c.url === '/api/auth/kimi/poll'), 'the kimi flow polled /api/auth/kimi/poll');

  // ---- cancel() silences an in-flight grok flow ----
  pollScripts.grok = [{ status: 'connected' }];
  const seen4 = [];
  const eng = OAuthSignIn.for('grok');
  eng.start({ onCode: () => seen4.push('code'), onConnected: () => seen4.push('connected') });
  await sleep(80);
  A.eq(seen4, ['code'], 'the grok flow reached the code stage');
  eng.cancel();
  A.ok(!eng.active(), 'cancel() drops the grok flow');
  await sleep(2300);
  A.eq(seen4, ['code'], 'no callbacks land after cancel()');

  // ---- logout posts to /api/auth/grok/logout ----
  await OAuthSignIn.for('grok').logout();
  const lo = calls.filter(c => c.url === '/api/auth/grok/logout');
  A.eq(lo.length, 1, 'logout posts to /api/auth/grok/logout');
  A.eq(lo[0].method, 'POST', 'logout is a POST');

  // ---- regression: CodexSignIn still drives /api/auth/codex/* identically ----
  pollScripts.codex = [{ status: 'connected' }];
  const cx = [];
  CodexSignIn.start({ onCode: () => cx.push('code'), onConnected: () => cx.push('connected') });
  await sleep(80);
  A.eq(cx, ['code'], 'CodexSignIn still reaches the code stage');
  await sleep(2400);
  A.eq(cx, ['code', 'connected'], 'CodexSignIn still connects');
  A.ok(calls.some(c => c.url === '/api/auth/codex/start') && calls.some(c => c.url === '/api/auth/codex/poll'), 'CodexSignIn hits the codex endpoints');

  A.report('oauthsignin.test');
})().catch(e => { console.error(e); process.exit(1); });
