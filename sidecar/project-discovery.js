/* sidecar/project-discovery.js — bounded candidate discovery for the Projects rail.

   Discovery is NOT authority. It reads directory entries and project-marker names under a small set
   of owner-conventional roots, returns candidates, and never calls the path-grant store. The user must
   still select a result and POST /api/projects/bless; that existing route canonicalizes the path and
   records the durable owner grant.

   All I/O and search roots are injected. The walk is breadth-first, does not follow symlinks, stops at
   project roots, skips dependency/build/system trees, and has hard directory/result ceilings. */
'use strict';

const DEFAULT_MAX_DIRS = 1200;
const DEFAULT_MAX_PROJECTS = 80;
const DEFAULT_MAX_DEPTH = 3;
const MARKERS = Object.freeze([
  ['.git', 'git'], ['package.json', 'node'], ['pyproject.toml', 'python'], ['requirements.txt', 'python'],
  ['Cargo.toml', 'rust'], ['go.mod', 'go'], ['pom.xml', 'java'], ['build.gradle', 'java'],
  ['composer.json', 'php'], ['Gemfile', 'ruby'], ['mix.exs', 'elixir'], ['*.sln', 'dotnet']
]);
const SKIP = /^(?:\.git|\.svn|\.hg|node_modules|vendor|dist|build|target|coverage|\.next|\.nuxt|\.cache|\.npm|\.cargo|\.rustup|AppData|Library|Windows|Program Files(?: \(x86\))?|\$Recycle\.Bin)$/i;

function clampInt(v, dflt, lo, hi) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.floor(n))) : dflt;
}
function pathKey(P, value) {
  const s = P.resolve(String(value || ''));
  return P.sep === '\\' ? s.toLowerCase() : s;
}
function markerOf(entries) {
  const names = new Set((entries || []).map(e => String(e && e.name || '')));
  for (const pair of MARKERS) {
    if (pair[0] === '*.sln') {
      if ([...names].some(n => /\.sln$/i.test(n))) return pair[1];
    } else if (names.has(pair[0])) return pair[1];
  }
  return '';
}

function makeProjectDiscovery(deps) {
  deps = deps || {};
  const fsp = deps.fsp, P = deps.pathMod;
  if (!fsp || !P) throw new Error('project discovery requires { fsp, pathMod }');
  const rootsFn = typeof deps.roots === 'function' ? deps.roots : (() => []);
  const isBlessed = typeof deps.isBlessed === 'function' ? deps.isBlessed : (() => false);

  async function existingDirectory(raw) {
    try {
      const st = await fsp.lstat(raw);
      if (!st.isDirectory() || st.isSymbolicLink()) return null;
      return await fsp.realpath(raw);
    } catch (_) { return null; }
  }

  async function discover(opts) {
    opts = opts || {};
    const maxDirs = clampInt(opts.maxDirs, DEFAULT_MAX_DIRS, 1, 5000);
    const maxProjects = clampInt(opts.maxProjects, DEFAULT_MAX_PROJECTS, 1, 250);
    const maxDepth = clampInt(opts.maxDepth, DEFAULT_MAX_DEPTH, 0, 6);
    const roots = [], rootSeen = new Set();
    for (const raw of (rootsFn() || [])) {
      const real = await existingDirectory(String(raw || ''));
      if (!real) continue;
      const key = pathKey(P, real);
      if (!rootSeen.has(key)) { rootSeen.add(key); roots.push(real); }
    }

    const queue = roots.map(root => ({ dir: root, depth: 0 }));
    const seen = new Set(), candidates = [];
    let dirsScanned = 0, truncated = false;
    while (queue.length && dirsScanned < maxDirs && candidates.length < maxProjects) {
      const item = queue.shift();
      const key = pathKey(P, item.dir);
      if (seen.has(key)) continue;
      seen.add(key); dirsScanned++;
      let entries;
      try { entries = await fsp.readdir(item.dir, { withFileTypes: true }); }
      catch (_) { continue; }
      const kind = markerOf(entries);
      if (kind) {
        candidates.push({
          root: item.dir, name: P.basename(item.dir) || item.dir, kind,
          blessed: !!isBlessed(item.dir)
        });
        continue; // a project boundary owns its subtree; do not flood the list with dependencies/nested builds
      }
      if (item.depth >= maxDepth) continue;
      for (const ent of entries) {
        if (!ent || !ent.name || !ent.isDirectory || !ent.isDirectory()) continue;
        if ((ent.isSymbolicLink && ent.isSymbolicLink()) || SKIP.test(ent.name)) continue;
        // Hidden directories are configuration by default, not candidate project shelves.
        if (ent.name[0] === '.') continue;
        queue.push({ dir: P.join(item.dir, ent.name), depth: item.depth + 1 });
      }
    }
    if (queue.length || dirsScanned >= maxDirs || candidates.length >= maxProjects) truncated = true;
    candidates.sort((a, b) => Number(a.blessed) - Number(b.blessed) || a.name.localeCompare(b.name) || a.root.localeCompare(b.root));
    return { ok: true, roots, candidates, dirsScanned, truncated, grantsChanged: false };
  }

  return { discover, _internals: { markerOf, pathKey } };
}

module.exports = { makeProjectDiscovery, DEFAULT_MAX_DIRS, DEFAULT_MAX_PROJECTS, DEFAULT_MAX_DEPTH };
