#!/usr/bin/env node
/*
 * verify-update-host.mjs — prove the desktop updater path end-to-end.
 *
 * Two modes:
 *
 *   LIVE (default): fetch the updater endpoint from src-tauri/tauri.conf.json (the GitHub
 *     Releases latest.json), validate the manifest schema + signature fields for EVERY
 *     platform, check that the manifest version is >= the shipped tauri version, confirm each
 *     platform's asset URL is reachable, and confirm each URL is pinned to /download/v<version>/.
 *     Run this AFTER a release publishes — one command that turns "should work" into "does work".
 *
 *   MANIFEST (--manifest <file>): validate a LOCAL latest.json (schema, required platform set,
 *     signature shape, and that every platform url contains /download/v<version>/). This is what
 *     CI runs against the DRAFT before any publish. URL reachability is skipped unless --check-urls.
 *
 * Exit 0 = the updater path is live and coherent; non-zero = something a user's app would choke on.
 *
 * USAGE:
 *   node scripts/verify-update-host.mjs [--endpoint URL] [--expect-version X.Y.Z]
 *       [--require-platforms windows-x86_64,darwin-aarch64,darwin-x86_64]
 *   node scripts/verify-update-host.mjs --manifest release/latest.json [--check-urls]
 *       [--expect-version X.Y.Z] [--require-platforms ...]
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function argVal(name, dflt) {
  const eq = args.find(a => a.startsWith(name + '='));
  if (eq) return eq.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return dflt;
}
function argFlag(name) { return args.includes(name); }
function readText(f) { return readFileSync(f, 'utf8').replace(/^﻿/, ''); }
function readJson(f) { return JSON.parse(readText(f)); }

// The public release train supports Windows plus both macOS architectures. Internal/manual
// Linux packages remain opt-in through --require-platforms; if .deb is ever public again,
// require both linux-x86_64 and linux-x86_64-deb because Tauri resolves the installer-specific
// key first and an AppImage fallback cannot upgrade a .deb installation.
const DEFAULT_REQUIRE = 'windows-x86_64,darwin-aarch64,darwin-x86_64';
const REQUIRE_PLATFORMS = argVal('--require-platforms', DEFAULT_REQUIRE)
  .split(',').map(s => s.trim()).filter(Boolean);
const EXPECT_VERSION = argVal('--expect-version', '');
const MANIFEST_FILE = argVal('--manifest', '');
const CHECK_URLS = argFlag('--check-urls');

// Shipped tauri version — read best-effort so --manifest mode still gets a coherence check
// but does not hard-require the desktop config to exist.
let CONF_VERSION = '';
let CONF_ENDPOINT = '';
try {
  const conf = readJson(join(ROOT, 'src-tauri', 'tauri.conf.json'));
  CONF_VERSION = conf.version || '';
  CONF_ENDPOINT = conf.plugins && conf.plugins.updater && conf.plugins.updater.endpoints
    && conf.plugins.updater.endpoints[0];
} catch (_e) { /* absent in --manifest-only contexts; handled below */ }

const ENDPOINT = argVal('--endpoint', CONF_ENDPOINT);

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail || '' });
  process.stdout.write((ok ? '  PASS ' : '  FAIL ') + name + (detail ? '  — ' + detail : '') + '\n');
}

function semverGte(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return true;
}

async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 20000);
  try { return await fetch(url, Object.assign({ signal: ctrl.signal, redirect: 'follow' }, opts || {})); }
  finally { clearTimeout(t); }
}

// Validate the shared manifest shape + per-platform fields for either mode.
// `checkUrls` decides whether to HEAD each asset. Returns nothing; pushes checks.
async function validateManifest(manifest, version, checkUrls) {
  // Tauri updater manifest schema.
  check('manifest.version present', typeof manifest.version === 'string' && manifest.version.length > 0, manifest.version);
  check('manifest.pub_date present', typeof manifest.pub_date === 'string' && !isNaN(Date.parse(manifest.pub_date)), manifest.pub_date);
  check('manifest.platforms is an object',
    manifest.platforms && typeof manifest.platforms === 'object' && !Array.isArray(manifest.platforms), '');

  const platforms = (manifest.platforms && typeof manifest.platforms === 'object') ? manifest.platforms : {};
  const present = Object.keys(platforms);

  // Required-platform set: FAIL if any required platform is absent.
  for (const req of REQUIRE_PLATFORMS) {
    check('required platform present: ' + req, Object.prototype.hasOwnProperty.call(platforms, req),
      Object.prototype.hasOwnProperty.call(platforms, req) ? '' : 'missing from manifest.platforms');
  }
  check('manifest lists at least one platform', present.length > 0,
    present.length ? present.join(', ') : 'none');

  // Version coherence.
  if (EXPECT_VERSION) {
    check('manifest.version matches --expect-version', manifest.version === EXPECT_VERSION.replace(/^v/, ''),
      'got ' + manifest.version + ', expected ' + EXPECT_VERSION);
  }
  if (version) {
    check('manifest.version >= shipped tauri version', semverGte(manifest.version, version),
      'manifest ' + manifest.version + ' vs shipped ' + version);
  }

  const urlVersion = String(manifest.version || '').replace(/^v/, '');

  // Per-platform validation — signature shape + URL shape (+ reachability when asked).
  for (const name of present) {
    const plat = platforms[name];
    if (!plat || typeof plat !== 'object') { check('platform["' + name + '"] is an object', false, ''); continue; }
    check('platform["' + name + '"].signature is a non-empty updater signature',
      typeof plat.signature === 'string' && plat.signature.trim().length > 40, '');
    const hasUrl = typeof plat.url === 'string';
    check('platform["' + name + '"].url is https', hasUrl && /^https:\/\//i.test(plat.url), plat.url);
    // Every platform URL must be pinned to /download/v<version>/ so it can't drift to a stale tag.
    if (urlVersion) {
      check('platform["' + name + '"].url pinned to /download/v' + urlVersion + '/',
        hasUrl && plat.url.includes('/download/v' + urlVersion + '/'), plat.url);
    }
    if (checkUrls && hasUrl && /^https:\/\//i.test(plat.url)) {
      try {
        let res = await fetchWithTimeout(plat.url, { method: 'HEAD', headers: { 'User-Agent': 'starnet-verify-update-host' } });
        // Some CDNs reject HEAD; fall back to a ranged GET for 1 byte.
        if (!res.ok && (res.status === 403 || res.status === 405)) {
          res = await fetchWithTimeout(plat.url, { method: 'GET', headers: { 'User-Agent': 'starnet-verify-update-host', Range: 'bytes=0-0' } });
        }
        check('platform["' + name + '"] asset reachable (HTTP ' + res.status + ')', res.ok || res.status === 206,
          res.ok ? '' : 'status ' + res.status);
      } catch (e) {
        check('platform["' + name + '"] asset reachable', false, e.name === 'AbortError' ? 'timeout' : e.message);
      }
    }
  }
}

async function mainManifest() {
  const file = resolve(MANIFEST_FILE);
  process.stdout.write('== verify-update-host (manifest mode) ==\n');
  process.stdout.write('  manifest       : ' + file + '\n');
  process.stdout.write('  require        : ' + REQUIRE_PLATFORMS.join(', ') + '\n');
  process.stdout.write('  check urls     : ' + (CHECK_URLS ? 'yes' : 'no (schema only)') + '\n');
  if (CONF_VERSION) process.stdout.write('  shipped version: ' + CONF_VERSION + '\n');
  process.stdout.write('\n');

  let manifest = null;
  try {
    manifest = readJson(file);
    check('manifest file is valid JSON', true, file);
  } catch (e) {
    check('manifest file is readable JSON', false, e.message);
    return finish();
  }
  await validateManifest(manifest, CONF_VERSION, CHECK_URLS);
  finish();
}

async function mainLive() {
  process.stdout.write('== verify-update-host (live mode) ==\n');
  process.stdout.write('  endpoint       : ' + ENDPOINT + '\n');
  process.stdout.write('  shipped version: ' + CONF_VERSION + '\n');
  process.stdout.write('  require        : ' + REQUIRE_PLATFORMS.join(', ') + '\n\n');

  if (!ENDPOINT) { check('updater endpoint configured', false, 'no endpoint in tauri.conf.json'); return finish(); }
  check('endpoint is https', /^https:\/\//i.test(ENDPOINT), ENDPOINT);
  check('endpoint is a GitHub Releases latest.json',
    /^https:\/\/github\.com\/.+\/releases\/latest\/download\/latest\.json$/.test(ENDPOINT), '');

  let manifest = null;
  try {
    const res = await fetchWithTimeout(ENDPOINT, { headers: { 'User-Agent': 'starnet-verify-update-host' } });
    check('latest.json is reachable (HTTP ' + res.status + ')', res.ok, res.ok ? '' : 'status ' + res.status);
    if (res.ok) {
      const text = await res.text();
      try { manifest = JSON.parse(text.replace(/^﻿/, '')); check('latest.json is valid JSON', true); }
      catch (e) { check('latest.json is valid JSON', false, e.message); }
    }
  } catch (e) {
    check('latest.json is reachable', false, e.name === 'AbortError' ? 'timeout' : e.message);
  }

  if (!manifest) return finish();

  // Live mode always checks reachability of every platform asset.
  await validateManifest(manifest, CONF_VERSION, true);
  finish();
}

function finish() {
  const failed = checks.filter(c => !c.ok);
  process.stdout.write('\n== ' + (failed.length ? failed.length + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED') + ' ==\n');
  if (failed.length) {
    process.stdout.write('The updater path is NOT yet live/coherent. Common causes:\n');
    process.stdout.write('  - release not published yet (draft releases do not resolve latest/download)\n');
    process.stdout.write('  - a required platform is missing from latest.json\n');
    process.stdout.write('  - tag is not exactly v<version>, so the pinned installer URL 404s\n');
    process.stdout.write('  - latest.json / installer / .sig not all attached to the release\n');
    process.exit(1);
  }
  process.exit(0);
}

const main = MANIFEST_FILE ? mainManifest : mainLive;
main().catch(e => { process.stderr.write('verify-update-host: ' + ((e && e.stack) || e) + '\n'); process.exit(1); });
