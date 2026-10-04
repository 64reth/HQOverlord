#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STABLE_TAG = /^v\d+\.\d+\.\d+$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/i;

function fail(message) {
  throw new Error(`source-release-mirror: ${message}`);
}

function normalizeRelease(release) {
  if (!release || typeof release !== 'object' || Array.isArray(release)) {
    fail('release metadata must be a JSON object');
  }
  return {
    tag: release.tag_name || release.tagName || '',
    name: release.name || '',
    body: typeof release.body === 'string' ? release.body : '',
    draft: release.draft ?? release.isDraft ?? false,
    prerelease: release.prerelease ?? release.isPrerelease ?? false,
    assets: Array.isArray(release.assets) ? release.assets : []
  };
}

function normalizeAsset(asset) {
  return {
    name: asset?.name || '',
    size: Number(asset?.size || 0),
    state: asset?.state || '',
    digest: asset?.digest || '',
    downloadUrl: asset?.browser_download_url || asset?.url || ''
  };
}

function isInstaller(name) {
  return /-setup\.exe$/i.test(name)
    || /\.dmg$/i.test(name)
    || /\.AppImage$/i.test(name)
    || /\.deb$/i.test(name);
}

function platformLabel(name) {
  if (/-setup\.exe$/i.test(name)) return 'Windows (x64)';
  if (/aarch64.*\.dmg$/i.test(name)) return 'macOS (Apple Silicon)';
  if (/x64.*\.dmg$/i.test(name)) return 'macOS (Intel)';
  if (/\.AppImage$/i.test(name)) return 'Linux (AppImage)';
  if (/\.deb$/i.test(name)) return 'Linux (Debian/Ubuntu)';
  return 'Download';
}

function assetOrder(asset) {
  const label = platformLabel(asset.name);
  return ['Windows (x64)', 'macOS (Apple Silicon)', 'macOS (Intel)', 'Linux (AppImage)', 'Linux (Debian/Ubuntu)', 'Download'].indexOf(label);
}

function validateAssetName(asset) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(asset.name)) {
    fail(`invalid flat release asset name: ${JSON.stringify(asset.name)}`);
  }
}

function validateAsset(asset, { tag, distributionRepo, requireDownloadUrl }) {
  validateAssetName(asset);
  if (asset.state && asset.state !== 'uploaded') fail(`${asset.name} is not fully uploaded (state=${asset.state})`);
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0) fail(`${asset.name} has no positive byte size`);
  if (!SHA256.test(asset.digest)) fail(`${asset.name} has no trustworthy sha256 digest`);
  if (requireDownloadUrl) {
    const prefix = `https://github.com/${distributionRepo}/releases/download/${tag}/`;
    if (!asset.downloadUrl.startsWith(prefix)) {
      fail(`${asset.name} download URL is not pinned to ${distributionRepo}@${tag}`);
    }
  }
}

export function buildMirrorPlan(rawRelease, options = {}) {
  const distributionRepo = options.distributionRepo || 'androoAGI/starnet-releases';
  const release = normalizeRelease(rawRelease);
  if (release.draft) fail('the distribution release is still a draft');
  if (release.prerelease) fail('pre-releases must never become the source repository latest release');
  if (!STABLE_TAG.test(release.tag)) fail(`distribution tag is not stable v<major>.<minor>.<patch> SemVer: ${release.tag}`);
  if (!release.body.trim()) fail(`${release.tag} has empty release notes`);

  const seen = new Set();
  const assets = release.assets.map(normalizeAsset);
  for (const asset of assets) {
    validateAssetName(asset);
    if (seen.has(asset.name)) fail(`duplicate distribution asset name: ${asset.name}`);
    seen.add(asset.name);
  }

  const manifest = assets.find(asset => asset.name === 'latest.json');
  if (!manifest) fail(`${release.tag} has no latest.json; it is not a complete updater release`);
  validateAsset(manifest, { tag: release.tag, distributionRepo, requireDownloadUrl: true });

  const installers = assets.filter(asset => isInstaller(asset.name)).sort((a, b) => {
    const byPlatform = assetOrder(a) - assetOrder(b);
    return byPlatform || a.name.localeCompare(b.name);
  });
  if (!installers.length) fail(`${release.tag} has no user-facing installer assets`);
  for (const asset of installers) {
    validateAsset(asset, { tag: release.tag, distributionRepo, requireDownloadUrl: true });
  }

  const lines = [
    '## Download',
    '',
    '| Platform | Installer |',
    '|---|---|',
    ...installers.map(asset => `| **${platformLabel(asset.name)}** | [${asset.name}](${asset.downloadUrl}) |`),
    '',
    'These downloads are mirrored byte-for-byte from the validated StarNet distribution release. Already running StarNet? Update from inside the app; your crew, sessions, keys, and station remain in place.',
    '',
    '---',
    '',
    release.body.trim(),
    ''
  ];

  return {
    tag: release.tag,
    title: `StarNet ${release.tag}`,
    body: lines.join('\n'),
    distributionRepo,
    assets: installers.map(({ name, size, digest, downloadUrl }) => ({ name, size, digest: digest.toLowerCase(), downloadUrl }))
  };
}

export function decideMirrorAction(plan, rawSourceRelease) {
  if (!rawSourceRelease) return { action: 'create', staleAssets: [] };
  const source = normalizeRelease(rawSourceRelease);
  if (source.tag !== plan.tag) fail(`source release tag ${source.tag} does not match ${plan.tag}`);
  if (source.prerelease) fail(`source release ${plan.tag} is unexpectedly a pre-release`);

  const expected = new Map(plan.assets.map(asset => [asset.name, asset]));
  const actual = source.assets.map(normalizeAsset);
  const staleAssets = actual.filter(asset => !expected.has(asset.name)).map(asset => asset.name).sort();
  if (source.draft) return { action: 'update-draft', staleAssets };

  const problems = [];
  for (const wanted of plan.assets) {
    const got = actual.find(asset => asset.name === wanted.name);
    if (!got) {
      problems.push(`missing ${wanted.name}`);
      continue;
    }
    if (got.state && got.state !== 'uploaded') problems.push(`${wanted.name} state=${got.state}`);
    if (got.size !== wanted.size) problems.push(`${wanted.name} size ${got.size} != ${wanted.size}`);
    if (String(got.digest).toLowerCase() !== wanted.digest) problems.push(`${wanted.name} digest mismatch`);
  }
  if (staleAssets.length) problems.push(`unexpected assets: ${staleAssets.join(', ')}`);
  if (problems.length) {
    fail(`published source release ${plan.tag} differs from the distribution authority (${problems.join('; ')}); refusing to rewrite a published release`);
  }
  return { action: 'noop', staleAssets: [] };
}

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? null : argv[index + 1];
}

export function runCli(argv = process.argv.slice(2)) {
  const releaseJson = valueAfter(argv, '--release-json');
  const sourceReleaseJson = valueAfter(argv, '--source-release-json');
  const outDir = valueAfter(argv, '--out-dir');
  const distributionRepo = valueAfter(argv, '--distribution-repo') || 'androoAGI/starnet-releases';
  if (!releaseJson || !outDir) {
    fail('usage: node scripts/source-release-mirror.mjs --release-json <file> [--source-release-json <file>] --out-dir <dir>');
  }

  const distribution = JSON.parse(fs.readFileSync(releaseJson, 'utf8'));
  const plan = buildMirrorPlan(distribution, { distributionRepo });
  const source = sourceReleaseJson ? JSON.parse(fs.readFileSync(sourceReleaseJson, 'utf8')) : null;
  const decision = decideMirrorAction(plan, source);
  const output = { ...plan, ...decision };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'body.md'), output.body, 'utf8');
  fs.writeFileSync(path.join(outDir, 'plan.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ tag: output.tag, action: output.action, assets: output.assets.map(asset => asset.name) })}\n`);
  return output;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  try {
    runCli();
  } catch (error) {
    console.error(error?.stack || error);
    process.exit(1);
  }
}
