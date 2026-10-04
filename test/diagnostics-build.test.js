/* node test/diagnostics-build.test.js — P1.5 build provenance render seam (frontend/app/diagnostics.js).

   The desktop binary is stamped with its git commit (build.rs) and exposes it via the starnet_build_info Tauri
   command; diagnostics.js turns that into ONE honest line "build <version> @ <commit>[ DIRTY]". This locks:
     · formatBuild() shapes the line correctly (incl. the DIRTY suffix) and returns '' for missing/empty input.
     · buildLine() FAILS SOFT to '' in a plain browser (no window.__TAURI__) — truthful telemetry: never invent a
       commit for a session that wasn't built from any binary — and resolves the line when a Tauri core is present.
   Pure/DOM-free: we stub window.__TAURI__.core.invoke; no real shell needed. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const Diag = require('../frontend/app/diagnostics.js');
const { formatBuild } = Diag._internals;

// The native seam must stamp and expose both fields; fake BuildInfo objects alone cannot prove
// that the running command actually carries them.
{
  const buildRs = fs.readFileSync(require.resolve('../src-tauri/build.rs'), 'utf8');
  const mainRs = fs.readFileSync(require.resolve('../src-tauri/src/main.rs'), 'utf8');
  A.ok(/STARNET_BUILD_TREE/.test(buildRs) && /HEAD\^\{tree\}/.test(buildRs), 'build.rs stamps the exact Git source tree');
  A.ok(/STARNET_BUILD_PROVENANCE_KIND/.test(buildRs), 'build.rs stamps the base provenance kind');
  A.ok(/source_tree:[\s\S]*provenance_kind:/.test(mainRs) && /STARNET_BUILD_TREE/.test(mainRs), 'starnet_build_info exposes sourceTree + provenanceKind');
}

// ---- formatBuild: the pure shaper ----
{
  A.eq(formatBuild({ version: '0.2.2', commit: 'c160d90', dirty: false }), 'build 0.2.2 @ c160d90', 'clean build line');
  A.eq(formatBuild({ version: '0.2.2', commit: 'c160d90', sourceTree: 'b'.repeat(40), provenanceKind: 'reproducible-source', dirty: false }),
    'build 0.2.2 @ c160d90 [reproducible-source tree bbbbbbbbbbbb]', 'source build line names its class and exact-tree prefix');
  A.eq(formatBuild({ version: '0.2.2', commit: 'c160d90', sourceTree: 'b'.repeat(40), provenanceKind: 'custom', dirty: false }),
    'build 0.2.2 @ c160d90 [custom tree bbbbbbbbbbbb]', 'explicit custom build remains visibly custom');
  A.eq(formatBuild({ version: '0.2.2', commit: 'c160d90', sourceTree: 'b'.repeat(40), provenanceKind: 'official', dirty: false }),
    'build 0.2.2 @ c160d90 [custom tree bbbbbbbbbbbb]', 'BuildInfo cannot self-assert official');
  A.eq(formatBuild({ version: '0.2.2', commit: 'c160d90', dirty: true }), 'build 0.2.2 @ c160d90 DIRTY', 'dirty build appends DIRTY');
  A.eq(formatBuild({ version: '0.2.2', commit: 'unknown', dirty: false }), 'build 0.2.2 @ unknown', 'git-missing commit renders "unknown"');
  A.eq(formatBuild(null), '', 'null info => ""');
  A.eq(formatBuild({}), '', 'empty info => ""');
  A.eq(formatBuild({ version: '', commit: '' }), '', 'blank version+commit => ""');
  // a version-only or commit-only object still yields a line (partial but honest), never throws.
  A.eq(formatBuild({ version: '0.2.2', commit: '' }), 'build 0.2.2 @ unknown', 'version-only falls back commit to "unknown"');
}

// ---- buildLine: browser fail-soft (no Tauri) ----
(async () => {
  const hadWindow = typeof global.window !== 'undefined';
  const savedWindow = global.window;
  try {
    // (1) NO Tauri shell → '' (browser mode, nothing to prove)
    global.window = {};
    A.eq(await Diag.buildLine(), '', 'browser mode (no __TAURI__) => "" (fails soft, no fake commit)');

    // (2) Tauri core present, command resolves → the formatted line
    global.window = { __TAURI__: { core: { invoke: (cmd) => {
      A.eq(cmd, 'starnet_build_info', 'buildLine invokes starnet_build_info');
      return Promise.resolve({ version: '0.2.2', commit: 'abc1234', sourceTree: 'b'.repeat(40), provenanceKind: 'dirty-dev', dirty: true });
    } } } };
    A.eq(await Diag.buildLine(), 'build 0.2.2 @ abc1234 [dirty-dev tree bbbbbbbbbbbb] DIRTY', 'Tauri path resolves the honest build line');

    // (3) old shell WITHOUT the command (invoke rejects) → '' (never surface an error/fake line)
    global.window = { __TAURI__: { core: { invoke: () => Promise.reject(new Error('unknown command')) } } };
    A.eq(await Diag.buildLine(), '', 'a shell without starnet_build_info => "" (graceful)');
  } finally {
    if (hadWindow) global.window = savedWindow; else { try { delete global.window; } catch (_) { global.window = undefined; } }
  }
  A.report('diagnostics-build.test');
})().catch(e => { console.error(e); process.exit(1); });
