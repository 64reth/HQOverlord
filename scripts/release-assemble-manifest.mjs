#!/usr/bin/env node
/*
 * release-assemble-manifest.mjs — assemble ONE multi-platform Tauri updater
 * latest.json from a directory of built release artifacts + their .sig files.
 *
 * Replaces the stale single-platform scripts/starnet-release-manifest.mjs. The
 * old script only ever emitted windows-x86_64 and pointed at a dead
 * (updates.starnet.app) example URL, which is exactly the P0 the update-pipeline
 * audit (docs/UPDATE_PIPELINE_AUDIT_2026-07-06.md) flags: Mac/Linux users were
 * permanently stranded because nothing assembled their artifacts into the feed.
 *
 * This scans a --dist tree, maps each updater artifact to its Tauri platform
 * key, pairs it with the sibling .sig, CRYPTOGRAPHICALLY verifies each signature
 * against the pubkey baked into src-tauri/tauri.conf.json (the exact check every
 * installed app runs), and emits a single manifest whose per-platform url points
 * at the versioned GitHub Releases asset. It HARD-FAILS if any of the five
 * platforms is missing (unless explicitly waived), on a signed artifact whose
 * .sig is absent/empty/INVALID, on two artifacts fighting for the same platform,
 * or on a non-SemVer version — so a broken/partial feed can never be assembled
 * silently.
 *
 * Migrated validations from starnet-release-manifest.mjs:
 *   - --version must be SemVer.
 *   - every emitted url is https:// (guaranteed by the fixed github.com base).
 *   - every signature is non-empty AND verifies against the baked public key.
 *
 * USAGE:
 *   node scripts/release-assemble-manifest.mjs \
 *     --dist <dir> --version <X.Y.Z> --repo <owner/repo> --tag v<X.Y.Z> \
 *     [--notes-file RELEASE_NOTES.md] [--out release/latest.json] \
 *     [--allow-missing <plat,plat>] [--pubkey <base64-or-path>] [--skip-sig-verify] \
 *     [--asset-base <url>]   # override the per-platform url base (default: the GitHub
 *                            # Releases /download/<tag>/ URL). The local update canary
 *                            # (scripts/update-canary.mjs) points this at 127.0.0.1 so the
 *                            # EXACT production manifest builder — including the crypto
 *                            # verification — is what feeds the offline proof.
 *
 * Artifact → platform mapping (recursive scan of --dist):
 *   *-setup.exe   + .sig                                  → windows-x86_64
 *   *.app.tar.gz  + .sig, path/name has aarch64|arm64     → darwin-aarch64
 *   *.app.tar.gz  + .sig, path/name has x64|x86_64        → darwin-x86_64
 *   *.AppImage    + .sig                                  → linux-x86_64
 *   *.deb         + .sig                                  → linux-x86_64-deb
 *
 * linux-x86_64-deb exists because tauri-plugin-updater resolves the target
 * {os}-{arch}-{installer} FIRST and falls back to {os}-{arch}: a .deb-installed
 * app that only finds the generic linux-x86_64 key downloads the AppImage and
 * then hard-fails `infer::archive::is_deb` at install time. Publishing .deb
 * downloads without this manifest key breaks self-update for every .deb user.
 */

import {
  existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { resolvePubkeyText, verifySignature } from './minisign-verify.mjs';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ALL_PLATFORMS = ['windows-x86_64', 'darwin-aarch64', 'darwin-x86_64', 'linux-x86_64', 'linux-x86_64-deb'];

const args = process.argv.slice(2);
const argSet = new Set(args);
function argVal(name, dflt) {
  const eq = args.find(a => a.startsWith(name + '='));
  if (eq) return eq.slice(name.length + 1);
  const idx = args.indexOf(name);
  if (idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return dflt;
}

function log(msg) { process.stdout.write(msg + '\n'); }
function fail(msg) { process.stderr.write('release-assemble-manifest: ' + msg + '\n'); process.exit(1); }
function readText(f) { return readFileSync(f, 'utf8').replace(/^﻿/, ''); }
function sha256(file) { return createHash('sha256').update(readFileSync(file)).digest('hex'); }

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch (e) { fail('cannot read --dist directory ' + dir + ': ' + e.message); }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (ent.isFile()) out.push(full);
  }
  return out;
}

// Classify one artifact file path to a Tauri updater platform key, or null if
// it is not an updater artifact (e.g. a .sig, .dmg, .msi, or stray file).
function classify(file) {
  const name = file.split(/[\\/]/).pop();
  const lowerPath = file.toLowerCase();
  if (/-setup\.exe$/i.test(name)) return 'windows-x86_64';
  if (/\.AppImage$/i.test(name)) return 'linux-x86_64';
  if (/\.deb$/i.test(name)) return 'linux-x86_64-deb';
  if (/\.app\.tar\.gz$/i.test(name)) {
    if (/aarch64|arm64/.test(lowerPath)) return 'darwin-aarch64';
    if (/x64|x86_64/.test(lowerPath)) return 'darwin-x86_64';
    fail('mac updater artifact has no arch marker (need aarch64/arm64 or x64/x86_64 in path/name): ' + file);
  }
  return null;
}

function main() {
  const dist = argVal('--dist');
  const version = (argVal('--version') || '').replace(/^v/, '');
  const repo = argVal('--repo');
  const tag = argVal('--tag');
  const notesFile = argVal('--notes-file');
  const outFile = argVal('--out', 'release/latest.json');
  const allowMissing = (argVal('--allow-missing', '') || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const skipSigVerify = argSet.has('--skip-sig-verify');

  if (!dist) fail('--dist <dir> is required');
  if (!version) fail('--version <X.Y.Z> is required');
  if (!repo) fail('--repo <owner/repo> is required');
  if (!tag) fail('--tag v<X.Y.Z> is required');
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    fail('--version must be SemVer, for example 0.2.0 (got "' + version + '")');
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) fail('--repo must be owner/repo (got "' + repo + '")');
  for (const p of allowMissing) {
    if (!ALL_PLATFORMS.includes(p)) fail('--allow-missing has unknown platform "' + p + '" (valid: ' + ALL_PLATFORMS.join(', ') + ')');
  }
  if (!existsSync(dist)) fail('--dist directory does not exist: ' + dist);

  // Resolve the public key we verify against — by default the one BAKED into
  // src-tauri/tauri.conf.json, i.e. the key every installed app trusts. If CI signed
  // with a different key, verification fails HERE instead of on every user's machine.
  let pubkeyText = null;
  if (!skipSigVerify) {
    try { pubkeyText = resolvePubkeyText(argVal('--pubkey'), ROOT); }
    catch (e) { fail('cannot resolve updater public key: ' + e.message + '\n  Pass --pubkey <base64-or-path> or (dangerous, tests only) --skip-sig-verify.'); }
  } else {
    log('WARNING: --skip-sig-verify — signatures are NOT cryptographically checked (tests only; never in a release path).');
  }

  const files = walk(dist, []);

  // Map platform -> { artifact, sig, signature, sha256 }.
  const found = {};
  for (const file of files) {
    const plat = classify(file);
    if (!plat) continue;
    if (found[plat]) {
      fail('duplicate artifact for platform ' + plat + ':\n    ' +
        relative(dist, found[plat].artifact) + '\n    ' + relative(dist, file) +
        '\n  Exactly one artifact per platform is allowed.');
    }
    const sigFile = file + '.sig';
    if (!existsSync(sigFile)) {
      fail('artifact without signature: ' + file + '\n  Expected sibling ' + sigFile +
        ' — the updater REQUIRES a .sig. Build with signing enabled.');
    }
    const signature = readText(sigFile).trim();
    if (!signature) fail('signature file is empty: ' + sigFile);
    if (pubkeyText) {
      let res;
      try { res = verifySignature(readFileSync(file), signature, pubkeyText); }
      catch (e) { fail('signature verification errored for ' + file + ': ' + e.message); }
      if (!res.ok) {
        fail('SIGNATURE INVALID for ' + file + '\n  ' + res.reason +
          '\n  This release would pass shape checks and then fail the update on EVERY installed app. Refusing to assemble.');
      }
    }
    found[plat] = { artifact: file, sig: sigFile, signature, sha256: sha256(file), sigVerified: !!pubkeyText };
  }

  // Enforce the five-platform contract.
  const missing = ALL_PLATFORMS.filter(p => !found[p]);
  const unwaived = missing.filter(p => !allowMissing.includes(p));
  if (unwaived.length) {
    fail('missing artifacts for platform(s): ' + unwaived.join(', ') +
      '\n  Every platform must be present unless waived via --allow-missing.' +
      '\n  Found: ' + (Object.keys(found).join(', ') || '(none)'));
  }

  const notes = notesFile && existsSync(notesFile)
    ? readText(notesFile).trim()
    : (notesFile ? '' : 'StarNet desktop ' + version + '. See the release page for details.');

  const platforms = {};
  let assetBase = argVal('--asset-base') || ('https://github.com/' + repo + '/releases/download/' + tag + '/');
  if (!/^https?:\/\//i.test(assetBase)) fail('--asset-base must be an http(s) URL (got "' + assetBase + '")');
  if (!assetBase.endsWith('/')) assetBase += '/';
  for (const plat of ALL_PLATFORMS) {
    const hit = found[plat];
    if (!hit) continue; // waived-missing
    const basename = hit.artifact.split(/[\\/]/).pop();
    platforms[plat] = { signature: hit.signature, url: assetBase + encodeURIComponent(basename) };
  }

  // GitHub release assets are a flat namespace: two platforms whose artifacts share a
  // basename would collide into ONE asset and silently serve the wrong binary to one of
  // them (the mac .app.tar.gz legs are named identically unless the build renames them).
  const byUrl = {};
  for (const [plat, entry] of Object.entries(platforms)) {
    if (byUrl[entry.url]) {
      fail('asset basename collision: ' + plat + ' and ' + byUrl[entry.url] +
        ' both resolve to ' + entry.url +
        '\n  Rename the artifacts so every platform has a unique basename (the release train' +
        '\n  build job renames mac .app.tar.gz bundles per-arch for exactly this reason).');
    }
    byUrl[entry.url] = plat;
  }

  const manifest = { version, notes, pub_date: new Date().toISOString(), platforms };

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(manifest, null, 2) + '\n');

  // Per-platform summary.
  log('============================================================');
  log(' RELEASE MANIFEST ASSEMBLED — v' + version + '  (tag ' + tag + ')');
  log('============================================================');
  log(' repo : ' + repo);
  log(' out  : ' + outFile);
  log('');
  for (const plat of ALL_PLATFORMS) {
    const hit = found[plat];
    if (!hit) { log('  ' + plat.padEnd(18) + ' MISSING (waived via --allow-missing)'); continue; }
    const basename = hit.artifact.split(/[\\/]/).pop();
    log('  ' + plat.padEnd(18) + basename);
    log('  ' + ' '.repeat(18) + 'sha256 ' + hit.sha256.slice(0, 16) + '...  sig ' +
      (hit.sigVerified ? 'VERIFIED against baked pubkey' : Buffer.byteLength(hit.signature) + ' bytes (NOT verified)'));
  }
  log('============================================================');
  log(' Wrote ' + Object.keys(platforms).length + ' platform(s). Nothing is live until this is attached to a published release.');
}

main();
