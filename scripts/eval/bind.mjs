import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const sha256File = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const gitBlob = buf => createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
const cleanPath = value => resolve(value).split(sep).join('/');

function executable(file) {
  const path = resolve(file), stat = statSync(path);
  return { path, bytes: stat.size, sha256: sha256File(path) };
}

function sourceIdentity(sourceDir, expectedCommit = '') {
  const dir = resolve(sourceDir);
  const head = git(dir, ['rev-parse', 'HEAD']);
  const commit = expectedCommit || head;
  git(dir, ['cat-file', '-e', `${commit}^{commit}`]);
  const tree = git(dir, ['rev-parse', `${commit}^{tree}`]);
  return { dir, head, commit, tree, clean: git(dir, ['status', '--porcelain']) === '' };
}

function normalizeCrlf(buf) {
  if (buf.includes(0) || !buf.includes('\r\n')) return null;
  return Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

export function verifyRuntimeTree(source, runtimeRoot, paths) {
  const rows = git(source.dir, ['ls-tree', '-r', source.commit, '--', ...paths]).split(/\r?\n/).filter(Boolean);
  const manifest = [], missing = [], mismatched = [], normalized = [];
  for (const row of rows) {
    const match = row.match(/^\d+ blob ([0-9a-f]{40})\t(.+)$/);
    if (!match) continue;
    const rel = match[2], file = join(resolve(runtimeRoot), rel);
    let buf;
    try { buf = readFileSync(file); } catch (_) { missing.push(rel); continue; }
    const actual = gitBlob(buf);
    if (actual !== match[1]) {
      const lf = normalizeCrlf(buf);
      if (lf && gitBlob(lf) === match[1]) normalized.push(rel);
      else mismatched.push(rel);
    }
    manifest.push(`${rel}\0${match[1]}`);
  }
  if (missing.length || mismatched.length) throw new Error(`runtime tree mismatch: ${missing.length} missing, ${mismatched.length} changed`);
  return { root: resolve(runtimeRoot), paths, trackedFiles: manifest.length,
    normalization: { kind: 'crlf-to-lf', files: normalized.length },
    manifestSha256: createHash('sha256').update(manifest.join('\n')).digest('hex') };
}

function binaryContains(file, needles) {
  const data = readFileSync(resolve(file)).toString('latin1');
  const absent = needles.filter(value => value && !data.includes(value));
  if (absent.length) throw new Error('executable is missing embedded provenance: ' + absent.join(', '));
}

export function probeStarNetRuntimeNode(runtimeRoot, runtimeNode = '') {
  const executablePath = resolve(runtimeNode || join(runtimeRoot, process.platform === 'win32' ? 'node.exe' : 'node'));
  const run = spawnSync(executablePath, ['--version'], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  const output = (String(run.stdout || '') + String(run.stderr || '')).trim();
  if (run.status !== 0 || !/^v\d+\.\d+\.\d+(?:[-+].*)?$/.test(output)) {
    throw new Error(`installed StarNet runtime Node probe failed (${executablePath}): ${output || run.error?.message || `exit ${run.status}`}`);
  }
  return { path: executablePath, version: output };
}

async function healthProbe(url, expected) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`health probe returned HTTP ${response.status}`);
  const body = await response.json();
  if (String(body.version || '') !== expected) throw new Error(`health version ${body.version || '(missing)'} != ${expected}`);
  return { url, status: response.status, version: body.version };
}

export async function bindStarNet(opts) {
  const source = sourceIdentity(opts.sourceDir, opts.commit);
  const describe = String(opts.describe || '');
  if (source.tree !== opts.tree) throw new Error(`source tree ${source.tree} != ${opts.tree}`);
  binaryContains(opts.executable, [source.commit, source.tree, describe]);
  const runtime = verifyRuntimeTree(source, opts.runtimeRoot, opts.runtimePaths || ['frontend', 'sidecar', 'shared']);
  const runtimeNode = probeStarNetRuntimeNode(opts.runtimeRoot, opts.runtimeNode);
  const probe = await healthProbe(opts.healthUrl, describe);
  return { schemaVersion: 'starnet.eval.candidate-manifest.v1', subject: {
    name: 'StarNet', version: opts.version, commit: source.commit,
    sourceTree: { algorithm: 'git-tree', value: source.tree }, executable: executable(opts.executable),
    platform: { platform: process.platform, arch: process.arch, node: runtimeNode.version }, dirty: false,
    provenance: { verified: true, kind: 'embedded-build-and-runtime-tree', describe, runtime, runtimeNode, probe,
      checks: ['commit object exists', 'tree matches commit', 'executable embeds commit/tree/describe', 'all shipped runtime blobs match commit exactly or after CRLF-to-LF normalization', 'installed runtime Node reports its version', 'live health matches describe'] }
  } };
}

export function bindHermes(opts) {
  const source = sourceIdentity(opts.sourceDir, opts.commit);
  if (source.head !== source.commit || !source.clean) throw new Error('Hermes comparator checkout must be clean and detached at the frozen commit');
  if (source.tree !== opts.tree) throw new Error(`source tree ${source.tree} != ${opts.tree}`);
  const env = Object.assign({}, process.env, { HERMES_HOME: resolve(opts.homeDir) });
  const args = ['-m', 'hermes_cli.main', '--version'];
  const run = spawnSync(resolve(opts.executable), args, { cwd: source.dir, env, encoding: 'utf8', timeout: 30000 });
  const output = String(run.stdout || '') + String(run.stderr || '');
  if (run.status !== 0 || !output.includes(`Hermes Agent v${opts.version}`)) throw new Error('Hermes version probe failed: ' + output.trim().slice(0, 300));
  return { schemaVersion: 'starnet.eval.candidate-manifest.v1', subject: {
    name: 'Hermes Agent', version: opts.version, commit: source.commit,
    sourceTree: { algorithm: 'git-tree', value: source.tree }, executable: executable(opts.executable),
    platform: { platform: process.platform, arch: process.arch, python: output.match(/Python:\s*([^\r\n]+)/)?.[1] || '' }, dirty: false,
    provenance: { verified: true, kind: 'clean-git-checkout-runtime', tag: opts.tag, tagObject: opts.tagObject,
      execution: { cwd: source.dir, executable: resolve(opts.executable), args },
      checks: ['HEAD equals frozen commit', 'checkout clean', 'tree matches contract', `version probe reports ${opts.version}`] }
  } };
}

export function validateManifest(manifest) {
  const subject = manifest && manifest.subject;
  if (!subject || !subject.provenance || subject.provenance.verified !== true) throw new Error('candidate manifest lacks verified provenance');
  if (!subject.executable || sha256File(subject.executable.path) !== subject.executable.sha256) throw new Error('candidate executable hash no longer matches manifest');
  return manifest;
}

export function manifestEvidence(file) { return { path: cleanPath(file), sha256: sha256File(resolve(file)) }; }
