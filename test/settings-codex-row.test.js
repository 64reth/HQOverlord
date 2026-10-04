/* test/settings-codex-row.test.js — Settings→PROVIDERS must tell the TRUTH about a dead ChatGPT sign-in
   and offer a way out (the 2026-07-08 escape: consumed refresh token, row still said "● SIGNED IN · 1 key",
   zero actions, no recovery path).

   Source-lock guards (mirror settings-p1-ui.test.js) on the render/wiring seam, plus BEHAVIORAL checks on
   the require-able pieces (friendlyerror's door). The honest contract:
     · the panel reads the FULL /api/auth/codex/status truth (connected + expired + reason), not a bool
     · a known-dead sign-in renders SIGN-IN EXPIRED (never SIGNED IN) on both the card and the key row
     · the codex row always carries ⏼ RE-SIGN-IN + ✕ DISCONNECT actions wired to the real endpoints
     · the sign-in flow is the ONE shared engine (codexsignin.js) — no duplicated poll loops
     · the error card's codex-class door reads ⏼ RECONNECT CHATGPT and deep-links Settings→providers */
'use strict';
const A = require('./_assert.js');
const fs = require('fs'); const path = require('path');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const ui = read('frontend', 'app', 'stationui.js');
const appjs = read('frontend', 'app', 'app.js');
const signin = read('frontend', 'app', 'codexsignin.js');
const html = read('frontend', 'index.html');
const css = read('frontend', 'css', 'app.css');

// ---- the panel consumes the full status truth ----
A.ok(/codexStatusKnown\s*=\s*next/.test(ui) && /expired:\s*!!\(j && j\.expired\)/.test(ui), 'stationui stores connected+expired+reason from /api/auth/codex/status (not a lone bool)');
A.ok(/function codexExpired\(\)/.test(ui), 'stationui exposes the codexExpired predicate');

// ---- dead sign-in renders EXPIRED, never SIGNED IN ----
A.ok(/SIGN-IN EXPIRED — RECONNECT/.test(ui), 'the provider card renders SIGN-IN EXPIRED — RECONNECT when known-dead');
A.ok(/codexDead \? 'avail expired'/.test(ui), 'a dead codex card drops the conn styling (never green)');
A.ok(/&& !codexDead/.test(ui), 'a dead sign-in can never satisfy the card\'s connected predicate (SIGNED IN gated on !dead)');
A.ok(/codexConnected\(\) \|\| codexExpired\(\)/.test(ui), 'the API KEYS row still exists while expired (recovery lives there — hiding it was the escape)');
A.ok(/⚠ EXPIRED/.test(ui) && /key-mask-dead/.test(ui), 'the expired key row masks show the fault, not "ChatGPT OAuth"');
A.ok(/\.prov-card\.expired/.test(css) && /\.key-mask\.key-mask-dead/.test(css), 'the expired states have the --bad styling vocabulary');

// ---- the row always carries actions wired to the real endpoints ----
A.ok(/data-act="codex-resign"/.test(ui), 'the codex row renders a ⏼ RE-SIGN-IN action');
A.ok(/data-act="codex-logout"/.test(ui), 'the codex row renders a ✕ DISCONNECT action');
A.ok(/⏼ RE-SIGN-IN/.test(ui) && /✕ DISCONNECT/.test(ui), 'the action labels are the locked vocabulary');
A.ok(/act === 'codex-resign'/.test(ui) && /CodexSignIn\.start\(/.test(ui), 'RE-SIGN-IN drives the shared CodexSignIn engine');
A.ok(/act === 'codex-logout'/.test(ui) && /CodexSignIn(\.logout\(\)|.*logout)/.test(ui), 'DISCONNECT drives the logout endpoint');
A.ok(/id="codex-inline-code"/.test(ui) && /id="codex-inline-status"/.test(ui), 'the inline device-code surface (code + URL status) renders in the settings row');

// ---- ONE sign-in engine — no duplicated poll loops ----
A.ok(/\/api\/auth\/codex\/poll/.test(signin), 'codexsignin.js owns the device-code poll');
A.ok(!/\/api\/auth\/codex\/poll/.test(appjs), 'app.js no longer carries its own poll loop (extracted, not duplicated)');
A.ok(!/\/api\/auth\/codex\/poll/.test(ui), 'stationui.js never grows its own poll loop');
A.ok(/CodexSignIn\.start\(/.test(appjs), 'the brain screen drives the same shared engine');
A.ok(/<script src="app\/codexsignin\.js"><\/script>/.test(html), 'index.html loads the shared engine');
A.ok(html.indexOf('app/codexsignin.js') < html.indexOf('app/stationui.js') && html.indexOf('app/codexsignin.js') < html.indexOf('app/app.js'), 'codexsignin.js loads before both consumers');

// ---- the brain screen tells the expired truth too ----
A.ok(/j\.expired/.test(appjs) && /sign-in expired/i.test(appjs), 'the connect screen renders the expired state honestly (not a generic "not connected")');

// ---- error-card door: codex-class failure → ⏼ RECONNECT CHATGPT → Settings→providers (behavioral) ----
{
  const { friendlyError, actionButton } = require('../frontend/app/friendlyerror.js');
  const dead = friendlyError(new Error('Codex refresh token was already consumed by another client (e.g. the Codex CLI or VS Code extension). Sign in with ChatGPT again.'));
  A.eq(dead.kind, 'oauth', 'the consumed-refresh-token error classifies as the codex sign-in class');
  const btn = actionButton(dead);
  A.ok(btn && btn.label === '⏼ RECONNECT CHATGPT', 'the door reads ⏼ RECONNECT CHATGPT (got ' + (btn && btn.label) + ')');
  // the run() deep-links Settings→providers: openTerm(key, section) when the host supports it
  let opened = null;
  global.StationUI = { openTerm: (key, section) => { opened = { key, section }; } };
  btn.run();
  delete global.StationUI;
  A.eq(opened, { key: 'settings', section: 'providers' }, 'the door deep-links Settings→PROVIDERS');

  // not-signed-in (codex_not_connected) is the same class → same door, even with no stored credential
  const notConn = friendlyError(new Error('Not signed in to ChatGPT — connect a ChatGPT subscription first.'));
  A.eq(notConn.kind, 'oauth', 'codex_not_connected classifies oauth');
  const btn2 = actionButton(notConn);
  A.ok(btn2 && btn2.label === '⏼ RECONNECT CHATGPT', 'the not-signed-in door is the same reconnect door');
}

A.report('settings-codex-row.test');
