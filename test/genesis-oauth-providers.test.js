/* node test/genesis-oauth-providers.test.js — the genesis (CREATE YOUR OVERSEER) screen offers EVERY keyless
   device-code OAuth provider, not just ChatGPT (source-locks).

   THE BUG THIS LOCKS OUT (Andrew's report, 2026-07-20): the sidecar shipped grok/kimi subscription OAuth
   end-to-end (routes, registry profiles, Settings PROVIDERS rows, ModelDock groups) — but the onboarding
   brain picker only wired the Codex path, so a new user could only ever OAuth with ChatGPT. Worse,
   Harness.normalizeProviderId still folded 'grok' into the API-key 'xai' id (and 'kimi' fell through to
   'openrouter'), so even Settings could never actually make the OAuth brains the ACTIVE provider:
   setProv('grok') persisted 'xai' and every run went out on the wrong (keyless) API-key profile. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const harnessSrc = fs.readFileSync(path.join(__dirname, '../frontend/app/harness.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(__dirname, '../frontend/app/app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '../frontend/index.html'), 'utf8');

/* ---------- 1. Harness provider identity: grok/kimi are their OWN ids ---------- */
{
  const start = harnessSrc.indexOf('function normalizeProviderId');
  A.ok(start > 0, 'harness.js still has normalizeProviderId');
  const body = harnessSrc.slice(start, harnessSrc.indexOf('function providerSlot'));
  A.ok(/p === 'grok'[^\n]*return 'grok'/.test(body), "harness normalize keeps 'grok' its own id (not folded into xai)");
  A.ok(/p === 'kimi'[^\n]*return 'kimi'/.test(body), "harness normalize keeps 'kimi' its own id (not falling through to openrouter)");
  A.ok(!/'xai'[^\n]*\|\|\s*p === 'grok'/.test(body) && !/p === 'grok'[^\n]*return 'xai'/.test(body),
    "'grok' never aliases the API-key xai provider");
  A.ok(/'moonshot'/.test(body), "harness normalize accepts the 'moonshot' alias for kimi");
}
// The needle pins the INTENT (grok/kimi are in the keyless set), not the exact length of the list —
// a new keyless provider is a legitimate addition and must not read as this contract breaking.
A.ok(/return p !== 'codex' && p !== 'grok' && p !== 'kimi' && p !== 'ollama' && p !== 'custom'[^;]*;/.test(harnessSrc),
  'harness providerNeedsKey knows grok/kimi are keyless (OAuth tokens live sidecar-side)');

/* ---------- 2. boot-time: init() probes grok/kimi sign-in status like codex ---------- */
{
  const initStart = harnessSrc.indexOf('async function init()');
  const initBody = harnessSrc.slice(initStart, harnessSrc.indexOf('function normalizeProviderId'));
  A.ok(/\['grok',\s*'kimi'\]\.map/.test(initBody) && /\/api\/auth\/' \+ pid \+ '\/status/.test(initBody),
    'init() probes grok/kimi OAuth status at boot (keychain sweep can never report them)');
  A.ok(/_configuredByProvider\[pid\] = true/.test(initBody),
    'a connected grok/kimi marks the desktop configured map at boot');
}

/* ---------- 3. the genesis screen OFFERS grok/kimi (the user-visible half) ----------
   Andrew's layout order (2026-07-22): the ChatGPT hero is the ONLY card up top; grok/kimi are
   STANDARD chips in the one provider grid — their OAuth surface (the shared sign-in block)
   appears when picked, never as extra hero-ish cards stacked under the ChatGPT button. */
A.ok(/class="prov" data-prov="grok"/.test(htmlSrc), 'genesis picker has a GROK chip (standard, not a mini-hero card)');
A.ok(/class="prov" data-prov="kimi"/.test(htmlSrc), 'genesis picker has a KIMI chip (standard, not a mini-hero card)');
A.ok(!/prov-oauth-grid/.test(htmlSrc) && !/class="prov prov-oauth"/.test(htmlSrc),
  'the grok/kimi mini-hero OAuth cards are gone — ChatGPT is the only hero up top');
{
  const grid = htmlSrc.slice(htmlSrc.indexOf('class="prov-grid"'));
  A.ok(grid.indexOf('data-prov="grok"') >= 0 && grid.indexOf('data-prov="kimi"') >= 0,
    'grok/kimi chips live INSIDE the standard provider grid');
}
A.ok(/id="codex-hint"/.test(htmlSrc), 'the shared sign-in block hint is addressable (per-provider copy)');

/* ---------- 4. app.js wires them through the SHARED device-code engine ---------- */
A.ok(/const OAUTH_GENESIS = Object.freeze\(\{[\s\S]{0,400}grok:[\s\S]{0,400}kimi:/.test(appSrc),
  'app.js declares the genesis OAuth provider table (codex + grok + kimi)');
A.ok(/OAuthSignIn\.for\(pid\)\.start\(/.test(appSrc),
  'grok/kimi sign-in drives the SAME shared engine as Settings (OAuthSignIn.for)');
A.ok(/\/api\/auth\/' \+ pid \+ '\/models/.test(appSrc),
  'grok/kimi model catalogs come from the account-discovery endpoint');
A.ok(/refreshOAuthGenesisStatus/.test(appSrc) && /Harness\.setDesktopConfigured\(pid, oauthConnected\[pid\]\)/.test(appSrc),
  'grok/kimi sign-in state feeds Harness.setDesktopConfigured (the wake sees a live brain)');

/* ---------- 5. the wake gate blocks an unsigned OAuth provider, per provider ---------- */
{
  const attemptStart = appSrc.indexOf('async function onWakeAttempt');
  const attemptBody = appSrc.slice(attemptStart, attemptStart + 6000);
  A.ok(/if \(isOAuthProviderId\(pickedProvider\)\) \{[\s\S]{0,300}if \(!oauthConnected\[pickedProvider\]\)/.test(attemptBody),
    'onWakeAttempt gates EVERY OAuth provider on its own connected status (not just codex)');
}

/* ---------- 6. app.js provider vocabulary matches ---------- */
A.ok(/if \(p === 'grok' \|\| p === 'grok-oauth' \|\| p === 'supergrok' \|\| p === 'xai-oauth'\) return 'grok';/.test(appSrc),
  "app.js normalize keeps 'grok' its own id");
A.ok(/return p !== 'codex' && p !== 'grok' && p !== 'kimi' && p !== 'ollama' && p !== 'custom'[^;]*;/.test(appSrc),
  'app.js providerNeedsKey knows grok/kimi are keyless');

A.report('genesis-oauth-providers.test');
