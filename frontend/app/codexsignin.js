/* STARNET — codexsignin.js : the ONE device-code OAuth sign-in driver for keyless subscription providers.

   Originally the ChatGPT (Codex) device-code flow extracted from app.js's connect-screen (start → show code →
   open page → poll → connected) so the Settings→PROVIDERS panel can offer RE-SIGN-IN without duplicating the
   poll loop. Now GENERALIZED: the same engine drives any /api/auth/<pid>/* device flow (codex, grok, kimi, …).
   `CodexSignIn` is the codex-bound instance and is UNCHANGED in API + behavior (test/codexsignin.test.js pins
   it). `OAuthSignIn.for(pid)` returns a per-provider engine (cached, single-flight PER provider).

   DOM-free by design: callers pass callbacks and render into their own surface (the brain screen's #codex-*
   block, or a settings row's inline box). Tokens never touch this module — it only sees the sidecar's public
   device-flow endpoints (user_code / verification_uri / status strings).

   Callbacks (all optional):
     onRequesting()                                — the start call is in flight
     onCode({ user_code, verification_uri, open_uri })
                                                   — show the code + verification_uri; OPEN open_uri.
       Two URLs, deliberately: `verification_uri` is the bare, human-typeable address to DISPLAY, while
       `open_uri` is RFC 8628's verification_uri_complete (the same page with ?user_code=… pre-filled),
       falling back to the bare one when the issuer doesn't publish a complete form (codex). Never open the
       bare URL blind: kimi's page is a pure code CONSUMER — landing on
       https://www.kimi.com/code/authorize_device with no user_code renders "Missing user_code parameter"
       and the sign-in is unfinishable, even though the device + poll legs are perfectly healthy.
     onConnected()                                 — the sidecar exchanged + persisted tokens
     onError(message)                              — start failed or the poll reported a hard error
     onTimeout()                                   — the device code expired before the user finished

   Single-flight: start() cancels any in-flight flow first; cancel() aborts silently (screen change /
   disconnect). Matches the app.js behavior it replaces exactly, including the transient-network
   keep-polling rule. */
'use strict';

// The internal engine factory — one closure (its own flow/timer) per provider, so two providers can be
// mid-sign-in independently. `paths` holds the three device-flow endpoints for this provider.
function makeOAuthSignIn(paths) {
  let flow = null;    // { device_auth_id, user_code, deadline } — the in-flight device-code login
  let timer = null;   // the poll setTimeout handle

  function cancel() {
    if (timer) { clearTimeout(timer); timer = null; }
    flow = null;
  }

  // Kick off the device-code flow: request a code, hand it to the caller, then poll until done.
  async function start(cb) {
    cb = cb || {};
    cancel();
    if (cb.onRequesting) cb.onRequesting();
    let d;
    try {
      const r = await fetch(paths.start, { method: 'POST' });
      d = await r.json();
      if (!r.ok) throw new Error(d.error || ('start failed (' + r.status + ')'));
    } catch (e) {
      if (cb.onError) cb.onError('could not start sign-in: ' + ((e && e.message) || e));
      return;
    }
    const my = flow = {
      device_auth_id: d.device_auth_id,
      user_code: d.user_code,
      deadline: Date.now() + ((d.expires_in || 900) * 1000)
    };
    // ONE place computes "which URL do we actually open" so no call site can get it wrong.
    if (cb.onCode) cb.onCode({ user_code: d.user_code, verification_uri: d.verification_uri, open_uri: d.verification_uri_complete || d.verification_uri });
    poll(my, d.interval || 5, cb);
  }

  // One poll tick on a timer; the sidecar reports pending until the user finishes, then connects + persists.
  function poll(my, intervalS, cb) {
    timer = setTimeout(async () => {
      if (flow !== my) return;   // superseded / cancelled while waiting
      if (Date.now() > my.deadline) { flow = null; if (cb.onTimeout) cb.onTimeout(); return; }
      let j;
      try {
        const r = await fetch(paths.poll, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device_auth_id: my.device_auth_id, user_code: my.user_code }) });
        j = await r.json();
      } catch (e) { j = { status: 'pending' }; }   // transient network blip — keep polling
      if (flow !== my) return;                       // bailed out (back/disconnect) while awaiting
      if (j.status === 'connected') { flow = null; if (cb.onConnected) cb.onConnected(); return; }
      if (j.status === 'error') { flow = null; if (cb.onError) cb.onError('sign-in failed: ' + (j.error || 'try again')); return; }
      poll(my, intervalS, cb);                       // pending — schedule the next tick
    }, Math.max(2, intervalS) * 1000);
  }

  // Forget the stored credentials (the sidecar clears tokens AND any recorded dead-sign-in state).
  async function logout() {
    cancel();
    try { await fetch(paths.logout, { method: 'POST' }); } catch (_) {}
  }

  return { start, cancel, logout, active: () => !!flow };
}

// build the three endpoints for a provider id. Codex is spelled out literally so the codex device-flow
// endpoints (start/poll/logout) stay greppable in source (the source-lock tests pin /api/auth/codex/poll).
function oauthPathsFor(pid) { const b = '/api/auth/' + pid; return { start: b + '/start', poll: b + '/poll', logout: b + '/logout' }; }

// The codex-bound engine — UNCHANGED public surface (start/cancel/logout/active), so every existing caller and
// test/codexsignin.test.js keep working verbatim. Its endpoints are the literal /api/auth/codex/{start,poll,logout}.
const CodexSignIn = makeOAuthSignIn({ start: '/api/auth/codex/start', poll: '/api/auth/codex/poll', logout: '/api/auth/codex/logout' });

// The generalized registry: one cached engine per provider id, single-flight per provider (each has its own
// closure). CodexSignIn is registered as the codex engine so `OAuthSignIn.for('codex')` returns the SAME driver.
const _oauthEngines = { codex: CodexSignIn };
const OAuthSignIn = {
  for(pid) {
    pid = String(pid || '').trim().toLowerCase();
    if (!pid) return CodexSignIn;
    if (!_oauthEngines[pid]) _oauthEngines[pid] = makeOAuthSignIn(oauthPathsFor(pid));
    return _oauthEngines[pid];
  }
};

if (typeof module !== 'undefined' && module.exports) { module.exports = CodexSignIn; module.exports.OAuthSignIn = OAuthSignIn; }
if (typeof window !== 'undefined') { window.CodexSignIn = CodexSignIn; window.OAuthSignIn = OAuthSignIn; }
