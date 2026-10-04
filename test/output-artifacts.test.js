/* node test/output-artifacts.test.js - exclusive, durable, byte-verified output recovery artifacts. */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { makeOutputArtifacts } = require('../sidecar/output-artifacts.js');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-output-artifacts-'));
  try {
    const store = makeOutputArtifacts({ fsp, fs, pathMod: path, root, crypto });
    const full = 'head\n' + 'λ'.repeat(5000) + '\ntail';
    const first = await store.park('a1', 'shell.exec-run-0', full);
    A.ok(first && first.path === '.output/shell.exec-run-0.txt', 'first park uses the exact workspace-relative retrieval path');
    A.eq(first.chars, full.length, 'park receipt reports exact pre-truncation characters');
    A.eq(first.bytes, Buffer.byteLength(full), 'park receipt reports exact UTF-8 bytes');
    A.eq(first.sha256, crypto.createHash('sha256').update(Buffer.from(full)).digest('hex'), 'park receipt binds the exact bytes');
    A.eq(await fsp.readFile(path.join(root, 'a1', first.path), 'utf8'), full, 'parked bytes read back exactly');

    const second = await store.park('a1', 'shell.exec-run-0', 'second');
    A.ok(second.path !== first.path && /-1\.txt$/.test(second.path), 'a repeated stem creates a second exclusive artifact instead of overwriting evidence');
    A.eq(await fsp.readFile(path.join(root, 'a1', first.path), 'utf8'), full, 'the first artifact remains byte-identical');

    const a = store.append({ agentId: 'a1', kind: 'terminal', id: 'term_1', text: 'one\n' });
    const b = store.append({ agentId: 'a1', kind: 'terminal', id: 'term_1', text: 'two λ\n' });
    A.eq(a.path, b.path, 'process chunks append to one stable recovery artifact');
    A.eq(b.bytes, Buffer.byteLength('one\ntwo λ\n'), 'append receipt reports the exact complete byte count');
    A.eq(await fsp.readFile(path.join(root, 'a1', b.path), 'utf8'), 'one\ntwo λ\n', 'every process chunk is recoverable in order without duplication');

    const corruptFsp = new Proxy(fsp, { get(target, prop) {
      if (prop === 'readFile') return async () => Buffer.from('corrupt');
      const value = target[prop]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const corruptStore = makeOutputArtifacts({ fsp: corruptFsp, fs, pathMod: path, root, crypto });
    A.eq(await corruptStore.park('a1', 'unverified', 'intended'), null, 'a failed read-back never yields a recovery path claim');

    const shortFs = new Proxy(fs, { get(target, prop) {
      if (prop === 'writeSync') return () => 0;
      const value = target[prop]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const shortStore = makeOutputArtifacts({ fsp, fs: shortFs, pathMod: path, root, crypto });
    A.throws(() => shortStore.append({ agentId: 'a1', kind: 'terminal', id: 'short', text: 'lost' }), 'zero-progress output append fails instead of claiming durable bytes');

    const shortReadFs = new Proxy(fs, { get(target, prop) {
      if (prop === 'readSync') return (fd, buffer, offset, length, position) => target.readSync(fd, buffer, offset, Math.min(2, length), position);
      const value = target[prop]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const shortReadStore = makeOutputArtifacts({ fsp, fs: shortReadFs, pathMod: path, root, crypto });
    const shortRead = shortReadStore.append({ agentId: 'a1', kind: 'terminal', id: 'short-read', text: 'durable-bytes' });
    A.eq(await fsp.readFile(path.join(root, 'a1', shortRead.path), 'utf8'), 'durable-bytes', 'short read-back calls are completed before durable append is claimed');

    let corruptOnce = true;
    const corruptWriteFs = new Proxy(fs, { get(target, prop) {
      if (prop === 'writeSync') return (fd, buffer, offset, length) => {
        if (!corruptOnce) return target.writeSync(fd, buffer, offset, length);
        corruptOnce = false;
        const damaged = Buffer.from(buffer.subarray(offset, offset + length));
        damaged[0] = damaged[0] ^ 0xff;
        target.writeSync(fd, damaged, 0, damaged.length);
        return length;
      };
      const value = target[prop]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const transactionalStore = makeOutputArtifacts({ fsp, fs: corruptWriteFs, pathMod: path, root, crypto });
    A.throws(() => transactionalStore.append({ agentId: 'a1', kind: 'terminal', id: 'rollback', text: 'damaged\n' }),
      'a write that fails exact read-back is rejected');
    const afterRejected = transactionalStore.append({ agentId: 'a1', kind: 'terminal', id: 'rollback', text: 'valid\n' });
    A.eq(await fsp.readFile(path.join(root, 'a1', afterRejected.path), 'utf8'), 'valid\n',
      'a rejected append is rolled back so the next receipt cannot bless corrupt history');

    A.throws(() => store.append({ agentId: '../escape', kind: 'x', id: 'y', text: 'z' }), 'artifact paths cannot escape the agent workspace');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  A.report('output-artifacts.test');
})().catch(e => { console.error(e); process.exit(1); });
