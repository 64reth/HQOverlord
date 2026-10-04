#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
let assertions = 0;
function ok(value, message) { assert.ok(value, message); assertions++; }
function eq(actual, expected, message) { assert.equal(actual, expected, message); assertions++; }
function throws(fn, pattern, message) { assert.throws(fn, pattern, message); assertions++; }

function asset(name, n) {
  return {
    name,
    size: 1000 + n,
    state: 'uploaded',
    digest: `sha256:${String(n).repeat(64).slice(0, 64)}`,
    browser_download_url: `https://github.com/androoAGI/starnet-releases/releases/download/v1.2.3/${name}`
  };
}

function distribution(overrides = {}) {
  return {
    tag_name: 'v1.2.3',
    name: 'StarNet 1.2.3',
    body: '# StarNet v1.2.3\n\nA truthful release.',
    draft: false,
    prerelease: false,
    assets: [
      asset('latest.json', 1),
      asset('StarNet_1.2.3_x64-setup.exe', 2),
      asset('StarNet_1.2.3_aarch64.dmg', 3),
      asset('StarNet_1.2.3_x64.dmg', 4),
      asset('StarNet_darwin-arm64.app.tar.gz', 5),
      asset('StarNet_darwin-arm64.app.tar.gz.sig', 6)
    ],
    ...overrides
  };
}

(async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'scripts', 'source-release-mirror.mjs')).href);
  const { buildMirrorPlan, decideMirrorAction, runCli } = mod;

  const plan = buildMirrorPlan(distribution());
  eq(plan.tag, 'v1.2.3', 'stable tag is preserved');
  eq(plan.title, 'StarNet v1.2.3', 'source title uses the source-repo convention');
  eq(plan.assets.map(item => item.name).join(','),
    'StarNet_1.2.3_x64-setup.exe,StarNet_1.2.3_aarch64.dmg,StarNet_1.2.3_x64.dmg',
    'only human installers are mirrored in platform order');
  ok(plan.body.includes('## Download'), 'download section is generated');
  ok(plan.body.includes('macOS (Apple Silicon)'), 'platform labels are human-readable');
  ok(plan.body.includes('mirrored byte-for-byte'), 'copy explains the distribution authority');
  ok(plan.body.endsWith('A truthful release.\n'), 'authoritative distribution notes are preserved');
  eq(decideMirrorAction(plan, null).action, 'create', 'missing source release creates a draft');

  throws(() => buildMirrorPlan(distribution({ draft: true })), /still a draft/, 'draft distribution cannot mirror');
  throws(() => buildMirrorPlan(distribution({ prerelease: true })), /Pre-releases/i, 'pre-release cannot become latest');
  throws(() => buildMirrorPlan(distribution({ tag_name: 'latest' })), /stable v<major>/, 'non-SemVer tag rejected');
  throws(() => buildMirrorPlan(distribution({ body: '  ' })), /empty release notes/, 'empty notes rejected');
  throws(() => buildMirrorPlan(distribution({ assets: distribution().assets.filter(item => item.name !== 'latest.json') })),
    /no latest\.json/, 'release without updater authority rejected');
  {
    const bad = distribution();
    bad.assets[1] = { ...bad.assets[1], digest: null };
    throws(() => buildMirrorPlan(bad), /trustworthy sha256/, 'asset without GitHub digest rejected');
  }
  {
    const bad = distribution();
    bad.assets[1] = { ...bad.assets[1], browser_download_url: bad.assets[1].browser_download_url.replace('v1.2.3', 'v9.9.9') };
    throws(() => buildMirrorPlan(bad), /not pinned/, 'cross-tag asset URL rejected');
  }
  {
    const bad = distribution();
    bad.assets.push({ ...asset('StarNet_1.2.3_x64.dmg', 7) });
    throws(() => buildMirrorPlan(bad), /duplicate distribution asset/, 'duplicate flat asset name rejected');
  }
  {
    const bad = distribution();
    bad.assets[1] = { ...bad.assets[1], name: "bad\nasset.exe" };
    throws(() => buildMirrorPlan(bad), /invalid flat release asset name/, 'control characters in asset names rejected');
  }

  const linuxPlan = buildMirrorPlan(distribution({
    assets: distribution().assets.concat([
      asset('StarNet_1.2.3_amd64.AppImage', 7),
      asset('StarNet_1.2.3_amd64.deb', 8)
    ])
  }));
  ok(linuxPlan.assets.some(item => item.name.endsWith('.AppImage')), 'future supported AppImage is mirrored');
  ok(linuxPlan.assets.some(item => item.name.endsWith('.deb')), 'future supported deb is mirrored');

  const exactSource = {
    tag_name: plan.tag,
    draft: false,
    prerelease: false,
    assets: plan.assets.map(item => ({ name: item.name, size: item.size, state: 'uploaded', digest: item.digest }))
  };
  eq(decideMirrorAction(plan, exactSource).action, 'noop', 'published byte-identical mirror is a no-op');

  const partialDraft = {
    tagName: plan.tag,
    isDraft: true,
    isPrerelease: false,
    assets: [{ name: 'stale-installer.exe', size: 1, state: 'uploaded', digest: `sha256:${'a'.repeat(64)}` }]
  };
  const repair = decideMirrorAction(plan, partialDraft);
  eq(repair.action, 'update-draft', 'partial draft is repaired in place');
  eq(repair.staleAssets.join(','), 'stale-installer.exe', 'draft repair identifies stale assets for removal');

  throws(() => decideMirrorAction(plan, { ...exactSource, assets: exactSource.assets.slice(1) }),
    /refusing to rewrite a published release/, 'published release missing an asset fails closed');
  throws(() => decideMirrorAction(plan, {
    ...exactSource,
    assets: exactSource.assets.concat([{ name: 'surprise.exe', size: 5, state: 'uploaded', digest: `sha256:${'b'.repeat(64)}` }])
  }), /unexpected assets/, 'published release with an extra asset fails closed');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'source-release-mirror-test-'));
  try {
    const distPath = path.join(tmp, 'distribution.json');
    const sourcePath = path.join(tmp, 'source.json');
    const out = path.join(tmp, 'out');
    fs.writeFileSync(distPath, JSON.stringify(distribution()));
    fs.writeFileSync(sourcePath, JSON.stringify(exactSource));
    const cli = runCli(['--release-json', distPath, '--source-release-json', sourcePath, '--out-dir', out]);
    eq(cli.action, 'noop', 'CLI emits the no-op decision');
    ok(fs.existsSync(path.join(out, 'body.md')), 'CLI writes release body');
    eq(JSON.parse(fs.readFileSync(path.join(out, 'plan.json'), 'utf8')).tag, 'v1.2.3', 'CLI writes machine plan');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'sync-source-release.yml'), 'utf8');
  ok(/workflow_dispatch:/.test(workflow) && /schedule:/.test(workflow), 'workflow supports immediate and scheduled sync');
  ok(/contents:\s*write/.test(workflow), 'workflow grants only repository contents write');
  ok(/cancel-in-progress:\s*false/.test(workflow), 'concurrent syncs never cancel a publish mid-copy');
  ok(/releases\/latest/.test(workflow), 'workflow observes only the published distribution latest release');
  ok(/--verify-tag/.test(workflow), 'workflow refuses to invent a source tag');
  ok(/--draft[\s\S]*release upload[\s\S]*--draft=false --latest/.test(workflow),
    'workflow creates draft, uploads assets, then publishes latest');
  ok(/sha256sum/.test(workflow), 'downloaded assets are hashed before source upload');
  ok(/source-release-verified\.json/.test(workflow) && /\.action[\s\S]*noop/.test(workflow),
    'workflow re-reads and proves the published mirror');

  console.log(`source-release-mirror.test: OK (${assertions} assertions)`);
})().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
