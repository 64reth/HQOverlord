#!/usr/bin/env node
/*
 * release-bump.mjs — one-command version bumper for a StarNet desktop release cut.
 *
 * Bumps the version in lockstep across every file the release train reads, scaffolds
 * fresh release notes, then commits + tags so a `v<version>` tag push can trigger the
 * train. It is the human-run first step of the release train (see
 * docs/RELEASE_TRAIN_BUILD_PLAN_2026-07-06.md, contract C1).
 *
 * WHAT IT TOUCHES (and ONLY these — commit uses explicit pathspecs, never `git add -A`):
 *   1. package.json               — public project metadata version
 *   2. package-lock.json          — root package version pins
 *   3. src-tauri/tauri.conf.json  — .version
 *   4. src-tauri/Cargo.toml       — [package] version = "..."
 *   5. src-tauri/Cargo.lock       — the app package's version pin (textual patch, no network)
 *   6. RELEASE_NOTES.md           — overwritten with a fresh header + TODO bullet
 *
 * WHY A TEXTUAL Cargo.lock PATCH: `release-cut.mjs` preflight fails if Cargo.toml and
 * tauri.conf.json disagree, and a stale lockfile pin trips `cargo build --locked` in CI.
 * We rewrite ONLY the app package's own `version = "..."` line inside its `[[package]]`
 * block (matched by `name = "skynet-desktop"`), which needs no registry access — the
 * package is local, so no checksum changes. We never run cargo (no network dependency).
 *
 * VALIDATION: <version> must be SemVer and STRICTLY GREATER THAN two floors:
 *   1. the current in-tree tauri.conf.json version (always enforced, offline-safe), AND
 *   2. the HIGHEST version PUBLISHED to the updater's releases repo, when reachable.
 * Floor (2) exists because the in-tree file can lag the fleet (in-tree 0.2.2 while the fleet
 * runs 0.2.4) and GitHub's releases/latest is the MOST-RECENTLY-published release, not the
 * highest semver — so publishing a lower version than the fleet already runs would flip every
 * user's update feed BACKWARDS. We query it with `gh release list` against the repo read from
 * tauri.conf.json's updater endpoint. If we can't reach it (offline / no `gh` / no auth / a
 * private-repo 404), we WARN LOUDLY and fall back to floor (1) — never a silent backwards pass,
 * never a hard-fail on an offline dev box.
 *
 * SAFETY: never pushes. `--no-tag` skips the tag. `--dry-run` prints every change and
 * touches nothing (no writes, no git).
 *
 * USAGE:
 *   node scripts/release-bump.mjs <version> [--dry-run] [--no-tag]
 *
 * Env overrides (used by the unit test to run against a throwaway fixture repo):
 *   STARNET_BUMP_ROOT   default: repo root (parent of scripts/)
 *   STARNET_BUMP_GH     default: 'gh' — the GitHub CLI used for the published-floor query
 *                       (the unit test injects a fake `gh` here to exercise every branch offline)
 */

import {
  existsSync, readFileSync, writeFileSync
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.STARNET_BUMP_ROOT
  ? resolve(process.env.STARNET_BUMP_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The Cargo package name of the desktop app — the only [[package]] block we rewrite.
const APP_CRATE = 'skynet-desktop';

const args = process.argv.slice(2);
const argSet = new Set(args);
const DRY_RUN = argSet.has('--dry-run');
const NO_TAG = argSet.has('--no-tag');
const positional = args.filter(a => !a.startsWith('--'));

function log(msg) { process.stdout.write(msg + '\n'); }
function fail(msg) { process.stderr.write('release-bump: ' + msg + '\n'); process.exit(1); }
// Strip a UTF-8 BOM so JSON.parse / regex matching never chokes on it.
function readText(f) { return readFileSync(f, 'utf8').replace(/^﻿/, ''); }
function readJson(f) { return JSON.parse(readText(f)); }

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?/.exec(v);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || '' };
}

// Returns >0 if a>b, <0 if a<b, 0 if equal. A release (no -pre) outranks its own prerelease.
function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (const k of ['major', 'minor', 'patch']) {
    if (pa[k] !== pb[k]) return pa[k] - pb[k];
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;   // release > prerelease of same core
  if (!pb.pre) return -1;
  return pa.pre < pb.pre ? -1 : 1; // lexical is enough for the strictly-greater gate
}

function warn(msg) { process.stderr.write('release-bump: WARNING: ' + msg + '\n'); }

// ---- Published-release floor (0.5b) ---------------------------------------------------
//
// The in-tree tauri.conf.json version is NOT a safe floor: the file can lag the published
// fleet (e.g. in-tree 0.2.2 while the fleet is on 0.2.4). GitHub's releases/latest = the
// MOST-RECENTLY-PUBLISHED release, not the highest semver — so publishing a lower version
// than the fleet already runs would flip every user's update feed BACKWARDS. Before we let a
// bump proceed we anchor the floor to the HIGHEST version actually published to the updater's
// own releases repo. If we cannot reach it (offline, no auth, private-repo 404), we fall back
// to the in-tree floor with a LOUD warning — never a silent pass, never a hard-fail on a dev
// box with no network.

// Extract the `owner/repo` slug from the updater endpoint in tauri.conf.json. Read-only.
function resolveReleasesRepo() {
  const confPath = join(ROOT, 'src-tauri', 'tauri.conf.json');
  if (!existsSync(confPath)) return null;
  let conf;
  try { conf = readJson(confPath); } catch { return null; }
  const endpoints = conf?.plugins?.updater?.endpoints;
  const url = Array.isArray(endpoints) ? endpoints.find(e => typeof e === 'string') : null;
  if (!url) return null;
  // e.g. https://github.com/androoAGI/starnet-releases/releases/latest/...
  const m = /github\.com\/([^/]+)\/([^/]+)/.exec(url);
  if (!m) return null;
  return m[1] + '/' + m[2];
}

// Query the highest SemVer tag published to `repo`, or a status describing why we couldn't.
// Returns one of:
//   { ok: true,  floor: '0.2.4' }        highest published version (null if repo has 0 releases)
//   { ok: true,  floor: null }           repo reachable but genuinely has no releases
//   { ok: false, reason: '...' }         could-not-check (offline / no gh / auth / 404) -> warn+fallback
//
// The gh binary is overridable via STARNET_BUMP_GH so the unit test can inject a fake gh
// (same seam pattern as STARNET_BUMP_ROOT) and exercise every branch offline.
function queryPublishedFloor(repo) {
  const ghBin = process.env.STARNET_BUMP_GH || 'gh';
  // Drafts have no updater fleet behind them and may already reserve the in-tree version. Counting one as the
  // published floor makes the diagnostic false (and obscures a source-tag/draft mismatch), so query only releases
  // users can actually receive. Pre-releases remain included because an installed pre-release fleet is still a
  // version floor we must never move backwards across.
  const ghArgs = ['release', 'list', '-R', repo, '--exclude-drafts', '--json', 'tagName', '--limit', '200'];
  // Test seam: a fake gh supplied as a .mjs/.cjs/.js script is run with the current node so the
  // unit test can exercise the real spawn+parse path cross-platform (a bare .cmd/.js can't be
  // spawned without a shell on Windows). Real gh is a native binary and takes the plain path.
  let cmd = ghBin, cmdArgs = ghArgs;
  if (/\.(mjs|cjs|js)$/i.test(ghBin)) { cmd = process.execPath; cmdArgs = [ghBin, ...ghArgs]; }
  let res;
  try {
    res = spawnSync(cmd, cmdArgs, { encoding: 'utf8' });
  } catch (e) {
    return { ok: false, reason: 'gh spawn threw: ' + e.message };
  }
  if (res.error) {
    // ENOENT = gh not installed; any spawn error = can't check.
    return { ok: false, reason: 'gh not runnable (' + (res.error.code || res.error.message) + ')' };
  }
  if (res.status !== 0) {
    // Non-zero covers auth failure and the private-repo 404 (unauth'd API 404s on private repos):
    // we must NOT read that as "no releases" (which would let a backwards bump pass).
    const detail = (res.stderr || res.stdout || '').trim().split(/\r?\n/)[0] || ('exit ' + res.status);
    return { ok: false, reason: 'gh release list exited ' + res.status + ': ' + detail };
  }
  let rows;
  try { rows = JSON.parse(res.stdout || '[]'); } catch {
    return { ok: false, reason: 'could not parse gh JSON output' };
  }
  if (!Array.isArray(rows)) return { ok: false, reason: 'unexpected gh JSON shape' };
  let floor = null;
  for (const row of rows) {
    const tag = String(row?.tagName || '').replace(/^v/, '');
    if (!SEMVER_RE.test(tag)) continue;
    if (floor === null || compareSemver(tag, floor) > 0) floor = tag;
  }
  return { ok: true, floor };
}

// ---- Pure file-edit planners (return {path, before, after}); no side effects. ----

function planTauriConf(version) {
  const path = join(ROOT, 'src-tauri', 'tauri.conf.json');
  const before = readText(path);
  const conf = JSON.parse(before);
  const current = conf.version;
  conf.version = version;
  // Re-serialize with 2-space indent + trailing newline to match the file's own style.
  const after = JSON.stringify(conf, null, 2) + '\n';
  return { path, before, after, current, label: 'tauri.conf.json .version' };
}

function planPackageJson(version) {
  const path = join(ROOT, 'package.json');
  const before = readText(path);
  const pkg = JSON.parse(before);
  const current = pkg.version;
  pkg.version = version;
  const after = JSON.stringify(pkg, null, 2) + '\n';
  return { path, before, after, current, label: 'package.json .version' };
}

function planPackageLock(version) {
  const path = join(ROOT, 'package-lock.json');
  if (!existsSync(path)) return null;
  const before = readText(path);
  const lock = JSON.parse(before);
  const current = lock.version;
  lock.version = version;
  if (lock.packages && lock.packages['']) lock.packages[''].version = version;
  const after = JSON.stringify(lock, null, 2) + '\n';
  return { path, before, after, current, label: 'package-lock.json root version' };
}

function planCargoToml(version) {
  const path = join(ROOT, 'src-tauri', 'Cargo.toml');
  const before = readText(path);
  // Only the first `version = "..."` under [package] — it is the first version line in the file.
  const re = /^(\s*version\s*=\s*")([^"]+)(")/m;
  const m = re.exec(before);
  if (!m) fail('Cargo.toml: could not find a package version line');
  const after = before.replace(re, `$1${version}$3`);
  return { path, before, after, current: m[2], label: 'Cargo.toml [package] version' };
}

function planCargoLock(version) {
  const path = join(ROOT, 'src-tauri', 'Cargo.lock');
  if (!existsSync(path)) return null; // lockfile is optional; skip silently if absent
  const before = readText(path);
  // Match the app crate's own [[package]] block and rewrite the version line inside it.
  // Anchor on `name = "skynet-desktop"` then the following `version = "..."`.
  const re = new RegExp(
    '(name = "' + APP_CRATE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"\\r?\\nversion = ")([^"]+)(")'
  );
  const m = re.exec(before);
  if (!m) return { path, before, after: before, current: null, label: 'Cargo.lock (app pin not found — skipped)', skipped: true };
  const after = before.replace(re, `$1${version}$3`);
  return { path, before, after, current: m[2], label: 'Cargo.lock ' + APP_CRATE + ' version' };
}

function planReleaseNotes(version) {
  const path = join(ROOT, 'RELEASE_NOTES.md');
  const before = existsSync(path) ? readText(path) : '';
  const after = '# StarNet v' + version + '\n\n- TODO: summarize what changed in this release.\n';
  return { path, before, after, current: null, label: 'RELEASE_NOTES.md (scaffold)' };
}

function git(gitArgs) {
  const res = spawnSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8' });
  if (res.error) fail('git ' + gitArgs.join(' ') + ' failed to spawn: ' + res.error.message);
  if (res.status !== 0) {
    fail('git ' + gitArgs.join(' ') + ' failed (exit ' + res.status + ')\n' + (res.stderr || res.stdout || '').trim());
  }
  return res.stdout || '';
}

function main() {
  const version = positional[0];
  if (!version) fail('usage: node scripts/release-bump.mjs <version> [--dry-run] [--no-tag]');
  if (!SEMVER_RE.test(version)) fail('"' + version + '" is not a valid SemVer version (expected X.Y.Z).');

  const confPath = join(ROOT, 'src-tauri', 'tauri.conf.json');
  if (!existsSync(confPath)) fail('cannot find ' + confPath + ' (is STARNET_BUMP_ROOT correct?)');
  const current = readJson(confPath).version;
  if (!current) fail('tauri.conf.json has no current version');
  if (compareSemver(version, current) <= 0) {
    fail('new version ' + version + ' is not strictly greater than current in-tree ' + current + '.');
  }

  // 0.5b — anchor the floor to the highest PUBLISHED release when we can reach it, because the
  // in-tree version can lag the fleet and GitHub's releases/latest is most-recent-not-highest.
  let publishedFloor = null;
  const repo = resolveReleasesRepo();
  if (!repo) {
    warn('could not resolve the releases repo from tauri.conf.json updater endpoint — '
      + 'published-floor check SKIPPED; only the in-tree floor (' + current + ') was enforced.');
  } else {
    const q = queryPublishedFloor(repo);
    if (!q.ok) {
      warn('could not check the published release floor for ' + repo + ' (' + q.reason + ').');
      warn('  A backwards release could NOT be ruled out. Only the in-tree floor (' + current
        + ') was enforced. If ' + repo + ' is private, run `gh auth login` (with read access) '
        + 'and re-run so this bump is verified against what the fleet actually runs.');
    } else if (q.floor === null) {
      log('  published floor  : (none — ' + repo + ' has no releases yet)');
    } else {
      publishedFloor = q.floor;
      if (compareSemver(version, publishedFloor) <= 0) {
        fail('new version ' + version + ' is not strictly greater than the highest PUBLISHED '
          + 'release ' + publishedFloor + ' on ' + repo + '. Publishing it would flip the fleet '
          + 'update feed BACKWARDS (releases/latest is most-recent, not highest semver). '
          + 'Bump above ' + publishedFloor + '.');
      }
    }
  }

  log('== release-bump preflight ==');
  log('  root            : ' + ROOT);
  log('  current version : ' + current);
  log('  new version     : ' + version);
  if (publishedFloor) log('  published floor : ' + publishedFloor + ' (' + repo + ')');
  log('  dry-run         : ' + DRY_RUN);
  log('  tag             : ' + (NO_TAG ? '(skipped, --no-tag)' : 'v' + version));

  const plans = [
    planPackageJson(version),
    planPackageLock(version),
    planTauriConf(version),
    planCargoToml(version),
    planCargoLock(version),
    planReleaseNotes(version)
  ].filter(Boolean);

  log('\n== changes ==');
  const changedPaths = [];
  for (const p of plans) {
    const changed = p.before !== p.after;
    log('  [' + (changed ? 'edit' : 'no-op') + '] ' + p.label
      + (p.current ? ('  (' + p.current + ' -> ' + version + ')') : ''));
    if (changed) changedPaths.push(p.path);
  }

  if (DRY_RUN) {
    log('\n[dry-run] no files written, no git commit, no tag. Nothing was touched.');
    return;
  }

  // Write the edits.
  for (const p of plans) {
    if (p.before !== p.after) writeFileSync(p.path, p.after);
  }
  log('\n== wrote ' + changedPaths.length + ' file(s) ==');

  // Commit ONLY the planned release files, by pathspec (never -A).
  const pathspecs = plans
    .filter(p => p.before !== p.after)
    .map(p => p.path);
  git(['add', '--'].concat(pathspecs));
  git(['commit', '-m', 'release: v' + version, '--'].concat(pathspecs));
  log('committed: release: v' + version);

  if (!NO_TAG) {
    git(['tag', 'v' + version]);
    log('tagged: v' + version);
  } else {
    log('tag skipped (--no-tag).');
  }

  log('\n============================================================');
  log(' BUMPED to v' + version + ' — NOT pushed.');
  log('============================================================');
  log(' Next: push the tag to trigger the release train:');
  log('   git push origin HEAD ' + (NO_TAG ? '' : 'v' + version));
  log(' Nothing ships until the draft is reviewed and Published by a human.');
  log('============================================================');
}

main();
