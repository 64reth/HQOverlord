/* Optional attended proof against an already-installed language server. Not in test:fast: it is a live
   machine receipt and honestly SKIPs when neither clangd nor rust-analyzer is installed. */
'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { makeLspManager, DEFAULT_SERVERS } = require('../sidecar/lsp-manager.js');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-lsp-live-'));
  const manager = makeLspManager({ spawn, fs, fsp, pathMod: path, env: process.env,
    limits: { requestTimeoutMs: 15000, diagnosticTimeoutMs: 15000, idleMs: 30000 } });
  try {
    const clang = DEFAULT_SERVERS.find(s => s.id === 'clangd');
    const rust = DEFAULT_SERVERS.find(s => s.id === 'rust-analyzer');
    let descriptor = null, rel = '', before = '', after = '';
    if (manager._internals.locateExecutable(clang)) {
      descriptor = clang; rel = 'main.cpp';
      before = 'int main() { int x = 1; return x; }\n';
      after = 'int main() { int x = "not an int"; return x; }\n';
    } else if (manager._internals.locateExecutable(rust)) {
      descriptor = rust; rel = 'src/main.rs';
      fs.writeFileSync(path.join(root, 'Cargo.toml'), '[package]\nname="lsp_live"\nversion="0.1.0"\nedition="2021"\n');
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      before = 'fn main() { let x: i32 = 1; println!("{}", x); }\n';
      after = 'fn main() { let x: i32 = "not an int"; println!("{}", x); }\n';
    } else {
      console.log('lsp-live-installed.test: SKIP (no supported language server installed on PATH)');
      return;
    }
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, before, 'utf8');
    const ticket = await manager.beginEdit({ files: [{ abs, base: root, rel, text: before }] });
    fs.writeFileSync(abs, after, 'utf8');
    const delta = await manager.finishEdit(ticket);
    if (delta.status !== 'available' || delta.addedCount < 1) {
      throw new Error(descriptor.id + ' did not confirm the planted diagnostic: ' + JSON.stringify(delta));
    }
    console.log('lsp-live-installed.test: PASS server=' + descriptor.id + ' added=' + delta.addedCount
      + ' first=' + delta.added[0].file + ':' + delta.added[0].line + ' ' + delta.added[0].message);
  } finally {
    await manager.closeAll();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(e => { console.log('FAIL: lsp-live-installed.test threw — ' + (e && e.stack || e)); process.exit(1); });
