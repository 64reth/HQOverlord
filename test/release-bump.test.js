#!/usr/bin/env node
'use strict';

// Fast, fixture-based unit test for scripts/release-bump.mjs.
// No network. No git side effects on THIS repo — the real-commit path runs inside a
// throwaway temp git repo created and torn down here.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'release-bump.mjs');

let assertions = 0;
function check(cond, msg) { assert.ok(cond, msg); assertions++; }
function eq(a, b, msg) { assert.equal(a, b, msg); assertions++; }

check(/\['release', 'list', '-R', repo, '--exclude-drafts'/.test(fs.readFileSync(script, 'utf8')),
  'published-floor query excludes draft releases — a draft is not an updater fleet floor');

// Build a fixture "repo root": just the files release-bump reads/writes.
function makeFixture(dir, version, opts) {
  opts = opts || {};
  fs.mkdirSync(path.join(dir, 'src-tauri'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'starnet-harness', version, private: true, license: 'MIT'
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({
    name: 'starnet-harness', version, lockfileVersion: 3, requires: true,
    packages: { '': { name: 'starnet-harness', version } }
  }, null, 2) + '\n');
  const conf = {
    $schema: 'x', productName: 'StarNet', version, identifier: 'ai.skynet.harness',
    // The published-floor check reads the releases repo slug from the updater endpoint.
    plugins: { updater: { endpoints: [
      'https://github.com/acme/starnet-releases/releases/latest/download/latest.json'
    ] } }
  };
  fs.writeFileSync(
    path.join(dir, 'src-tauri', 'tauri.conf.json'),
    (opts.bom ? '﻿' : '') + JSON.stringify(conf, null, 2) + '\n'
  );
  fs.writeFileSync(
    path.join(dir, 'src-tauri', 'Cargo.toml'),
    '[package]\nname = "skynet-desktop"\nversion = "' + version + '"\nedition = "2021"\n\n' +
    '[dependencies]\nserde = "1"\n'
  );
  fs.writeFileSync(
    path.join(dir, 'src-tauri', 'Cargo.lock'),
    '# auto-generated\nversion = 3\n\n' +
    '[[package]]\nname = "serde"\nversion = "1.0.0"\n\n' +
    '[[package]]\nname = "skynet-desktop"\nversion = "' + version + '"\ndependencies = [\n "serde",\n]\n'
  );
  if (opts.notes) fs.writeFileSync(path.join(dir, 'RELEASE_NOTES.md'), opts.notes);
}

// Write a fake `gh` as a .mjs script. release-bump runs a .mjs STARNET_BUMP_GH via node, so
// this exercises the real spawn+parse path offline and cross-platform (a bare exe/.cmd can't
// be spawned without a shell on Windows). `mode` picks the behavior:
//   'tags:v0.2.4,v0.2.3' -> prints that release list as gh --json tagName JSON, exit 0
//   'empty'              -> prints [] (repo reachable, zero releases), exit 0
//   'fail404'            -> writes a 404 to stderr, exit 1 (private-repo / auth failure)
function writeFakeGh(dir, name, mode) {
  const p = path.join(dir, name + '.mjs');
  let body;
  if (mode.startsWith('tags:')) {
    const tags = mode.slice(5).split(',').filter(Boolean).map(t => ({ tagName: t }));
    body = 'console.log(' + JSON.stringify(JSON.stringify(tags)) + ');\n';
  } else if (mode === 'empty') {
    body = 'console.log("[]");\n';
  } else if (mode === 'fail404') {
    body = 'process.stderr.write("GraphQL: Could not resolve to a Repository (HTTP 404)\\n");\n' +
      'process.exit(1);\n';
  } else {
    throw new Error('unknown fake-gh mode ' + mode);
  }
  fs.writeFileSync(p, body);
  return p;
}

function run(args, root, extraEnv) {
  return spawnSync(process.execPath, [script].concat(args), {
    cwd: ROOT,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { STARNET_BUMP_ROOT: root }, extraEnv || {})
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-bump-'));
try {
  // ---- 1. --dry-run: prints changes, writes nothing ----
  {
    const dir = path.join(tmp, 'dry');
    makeFixture(dir, '0.1.9');
    // Hermetic published-floor: pretend the releases repo has no releases yet so the in-tree
    // floor governs and no real network `gh` is invoked on CI machines that happen to have one.
    const gh = writeFakeGh(dir, 'gh', 'empty');
    const res = run(['0.2.0', '--dry-run'], dir, { STARNET_BUMP_GH: gh });
    eq(res.status, 0, res.stderr || res.stdout);
    check(/0\.1\.9 -> 0\.2\.0/.test(res.stdout), 'dry-run shows version delta');
    check(/no files written/.test(res.stdout), 'dry-run says nothing written');
    // Files untouched.
    const conf = JSON.parse(fs.readFileSync(path.join(dir, 'src-tauri', 'tauri.conf.json'), 'utf8'));
    eq(conf.version, '0.1.9', 'dry-run left tauri.conf.json version alone');
    check(!fs.existsSync(path.join(dir, 'RELEASE_NOTES.md')), 'dry-run did not scaffold notes');
  }

  // ---- 2. Rejects non-SemVer ----
  {
    const dir = path.join(tmp, 'bad-semver');
    makeFixture(dir, '0.1.9');
    const res = run(['v1.2', '--dry-run'], dir);
    eq(res.status, 1, 'non-semver should fail');
    check(/not a valid SemVer/.test(res.stderr), 'reports semver error');
  }

  // ---- 3. Rejects non-strictly-greater (equal and lower) ----
  {
    const dir = path.join(tmp, 'not-greater');
    makeFixture(dir, '0.2.0');
    const same = run(['0.2.0', '--dry-run'], dir);
    eq(same.status, 1, 'equal version rejected');
    check(/not strictly greater/.test(same.stderr), 'reports not-greater (equal)');
    const lower = run(['0.1.5', '--dry-run'], dir);
    eq(lower.status, 1, 'lower version rejected');
    check(/not strictly greater/.test(lower.stderr), 'reports not-greater (lower)');
  }

  // ---- 4. Real bump inside a throwaway git repo: files edited, committed, tagged, no push ----
  {
    const dir = path.join(tmp, 'realgit');
    makeFixture(dir, '0.1.9', { notes: '# StarNet v0.1.9\n\n- old notes\n', bom: true });
    // init a self-contained repo (no remote -> a push would fail loudly if attempted)
    const gitEnv = {
      GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 't@t'
    };
    function g(a) {
      const r = spawnSync('git', a, { cwd: dir, encoding: 'utf8', env: Object.assign({}, process.env, gitEnv) });
      assert.equal(r.status, 0, 'git ' + a.join(' ') + ': ' + (r.stderr || r.stdout));
      return r.stdout;
    }
    g(['init', '-q']);
    g(['add', '-A']);
    g(['commit', '-qm', 'seed']);
    // An untracked stray file that must NOT be swept into the release commit.
    fs.writeFileSync(path.join(dir, 'stray.txt'), 'do not commit me');
    // Fake gh (kept OUTSIDE the git repo so it can't pollute the commit) reporting no releases,
    // so the in-tree floor governs and no real network gh is invoked.
    const gh = writeFakeGh(tmp, 'gh-realgit', 'empty');

    const res = run(['0.2.0'], dir, Object.assign({}, gitEnv, { STARNET_BUMP_GH: gh }));
    eq(res.status, 0, res.stderr || res.stdout);

    // Files actually updated in lockstep.
    const conf = JSON.parse(fs.readFileSync(path.join(dir, 'src-tauri', 'tauri.conf.json'), 'utf8'));
    eq(conf.version, '0.2.0', 'tauri.conf.json bumped');
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    eq(pkg.version, '0.2.0', 'package.json bumped');
    const packageLock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
    eq(packageLock.version, '0.2.0', 'package-lock.json top-level version bumped');
    eq(packageLock.packages[''].version, '0.2.0', 'package-lock.json root package bumped');
    const cargo = fs.readFileSync(path.join(dir, 'src-tauri', 'Cargo.toml'), 'utf8');
    check(/^version = "0\.2\.0"$/m.test(cargo), 'Cargo.toml bumped');
    const lock = fs.readFileSync(path.join(dir, 'src-tauri', 'Cargo.lock'), 'utf8');
    check(/name = "skynet-desktop"\nversion = "0\.2\.0"/.test(lock), 'Cargo.lock app pin bumped');
    check(/name = "serde"\nversion = "1\.0\.0"/.test(lock), 'Cargo.lock other pins untouched');
    const notes = fs.readFileSync(path.join(dir, 'RELEASE_NOTES.md'), 'utf8');
    check(/^# StarNet v0\.2\.0/.test(notes), 'RELEASE_NOTES.md overwritten with new header');
    check(/TODO/.test(notes), 'RELEASE_NOTES.md has TODO bullet');

    // Commit exists with the right message.
    const subject = spawnSync('git', ['log', '-1', '--pretty=%s'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
    eq(subject, 'release: v0.2.0', 'commit subject');

    // ONLY the 6 release files are in the release commit — the stray file is NOT.
    const files = spawnSync('git', ['show', '--name-only', '--pretty=format:', 'HEAD'], { cwd: dir, encoding: 'utf8' })
      .stdout.split(/\r?\n/).filter(Boolean).sort();
    assert.deepEqual(files, [
      'RELEASE_NOTES.md', 'package-lock.json', 'package.json', 'src-tauri/Cargo.lock',
      'src-tauri/Cargo.toml', 'src-tauri/tauri.conf.json'
    ], 'exactly the 6 pinned files committed'); assertions++;
    const straySt = spawnSync('git', ['status', '--porcelain', 'stray.txt'], { cwd: dir, encoding: 'utf8' }).stdout;
    check(/^\?\? stray\.txt/.test(straySt), 'stray file left untracked (pathspec commit, not -A)');

    // Tag created, pointing at HEAD.
    const tags = spawnSync('git', ['tag'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
    eq(tags, 'v0.2.0', 'tag v0.2.0 created');
  }

  // ---- 5. --no-tag: commits but creates no tag ----
  {
    const dir = path.join(tmp, 'notag');
    makeFixture(dir, '0.1.9');
    const gitEnv = {
      GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 't@t'
    };
    spawnSync('git', ['init', '-q'], { cwd: dir, env: Object.assign({}, process.env, gitEnv) });
    spawnSync('git', ['add', '-A'], { cwd: dir });
    spawnSync('git', ['commit', '-qm', 'seed'], { cwd: dir, env: Object.assign({}, process.env, gitEnv) });
    const gh = writeFakeGh(tmp, 'gh-notag', 'empty');
    const res = run(['0.3.0', '--no-tag'], dir, Object.assign({}, gitEnv, { STARNET_BUMP_GH: gh }));
    eq(res.status, 0, res.stderr || res.stdout);
    const subject = spawnSync('git', ['log', '-1', '--pretty=%s'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
    eq(subject, 'release: v0.3.0', '--no-tag still commits');
    const tags = spawnSync('git', ['tag'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
    eq(tags, '', '--no-tag created no tag');
  }

  // ---- 6. Published-floor: refuses a bump that is > in-tree but <= highest PUBLISHED ----
  // In-tree 0.2.2, fleet published 0.2.4. 0.2.3 passes the in-tree floor but would flip the
  // update feed BACKWARDS — the published floor must catch it and hard-fail.
  {
    const dir = path.join(tmp, 'backwards-vs-published');
    makeFixture(dir, '0.2.2');
    const gh = writeFakeGh(dir, 'gh', 'tags:v0.2.4,v0.2.3,v0.2.2');
    const res = run(['0.2.3', '--dry-run'], dir, { STARNET_BUMP_GH: gh });
    eq(res.status, 1, 'bump below highest published is rejected: ' + (res.stdout || ''));
    check(/highest PUBLISHED release 0\.2\.4/.test(res.stderr), 'names the published floor 0.2.4');
    check(/BACKWARDS/.test(res.stderr), 'explains it would flip the feed backwards');
    // And it never wrote anything (dry-run + hard fail before writes).
    const conf = JSON.parse(fs.readFileSync(path.join(dir, 'src-tauri', 'tauri.conf.json'), 'utf8'));
    eq(conf.version, '0.2.2', 'refused bump left tauri.conf.json untouched');
  }

  // ---- 7. Published-floor: equal-to-highest-published also refused ----
  {
    const dir = path.join(tmp, 'equal-vs-published');
    makeFixture(dir, '0.2.2');
    const gh = writeFakeGh(dir, 'gh', 'tags:v0.2.4');
    const res = run(['0.2.4', '--dry-run'], dir, { STARNET_BUMP_GH: gh });
    eq(res.status, 1, 'bump equal to highest published is rejected');
    check(/highest PUBLISHED release 0\.2\.4/.test(res.stderr), 'equal case names 0.2.4');
  }

  // ---- 8. Offline / can't-check (gh missing): LOUD warn, fall back to in-tree floor, still bumps ----
  {
    const dir = path.join(tmp, 'offline-warn');
    makeFixture(dir, '0.2.2');
    // Point at a gh binary that does not exist -> spawn ENOENT -> "could not check".
    const missing = path.join(dir, 'no-such-gh-binary');
    const res = run(['0.2.3', '--dry-run'], dir, { STARNET_BUMP_GH: missing });
    eq(res.status, 0, 'offline bump is not hard-failed: ' + (res.stderr || ''));
    check(/WARNING: could not check the published release floor/.test(res.stderr),
      'offline path warns loudly that the floor was not checked');
    check(/only the in-tree floor \(0\.2\.2\) was enforced/i.test(res.stderr),
      'offline warning states the in-tree floor was used as fallback');
    check(/0\.2\.2 -> 0\.2\.3/.test(res.stdout), 'offline bump still proceeds against the in-tree floor');
  }

  // ---- 9. Private-repo 404 / auth failure is treated as can't-check (warn), NOT "no releases" ----
  // A non-zero gh exit must fall back with a warning — never be read as an empty release list
  // (which would silently let a backwards bump through).
  {
    const dir = path.join(tmp, 'private-404');
    makeFixture(dir, '0.2.2');
    const gh = writeFakeGh(dir, 'gh', 'fail404');
    const res = run(['0.2.3', '--dry-run'], dir, { STARNET_BUMP_GH: gh });
    eq(res.status, 0, '404 does not hard-fail (falls back to in-tree floor)');
    check(/WARNING: could not check the published release floor/.test(res.stderr),
      '404/auth-fail warns it could not check');
    check(/gh release list exited 1/.test(res.stderr), 'warning surfaces the non-zero gh exit');
  }

  // ---- 10. Forward bump above the published floor passes and reports the floor ----
  {
    const dir = path.join(tmp, 'forward-vs-published');
    makeFixture(dir, '0.2.2');
    const gh = writeFakeGh(dir, 'gh', 'tags:v0.2.4,v0.2.3');
    const res = run(['0.2.5', '--dry-run'], dir, { STARNET_BUMP_GH: gh });
    eq(res.status, 0, 'forward bump above published floor passes: ' + (res.stderr || ''));
    check(/published floor : 0\.2\.4/.test(res.stdout), 'reports the resolved published floor');
    check(/0\.2\.2 -> 0\.2\.5/.test(res.stdout), 'shows the version delta');
    check(!/WARNING/.test(res.stderr), 'no warning when the floor was checked cleanly');
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('release-bump.test: OK (' + assertions + ' assertions)');
