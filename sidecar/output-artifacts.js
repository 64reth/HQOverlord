/* Durable, workspace-local recovery artifacts for model-visible tool/process output. */
'use strict';
const { note: failNote } = require('./failopen.js');

function makeOutputArtifacts(deps) {
  deps = deps || {};
  const fsp = deps.fsp;
  const fs = deps.fs;
  const P = deps.pathMod;
  const ROOT = deps.root;
  const crypto = deps.crypto || require('node:crypto');
  if (!fsp || !fs || !P || !ROOT) throw new Error('output artifacts require fsp, fs, pathMod, and root');

  function agent(id) {
    id = String(id || 'agent');
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new Error('bad agentId');
    return id;
  }
  function safe(value, max) { return String(value || 'output').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, max); }
  function paths(agentId, name) {
    const aid = agent(agentId);
    const rel = '.output/' + name + '.txt';
    return { rel, dir: P.join(ROOT, aid, '.output'), abs: P.join(ROOT, aid, rel) };
  }
  function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

  async function park(agentId, stem, content) {
    const text = String(content == null ? '' : content);
    const bytes = Buffer.from(text, 'utf8');
    const base = safe(stem, 120);
    let chosen = null, handle = null;
    await fsp.mkdir(P.join(ROOT, agent(agentId), '.output'), { recursive: true });
    for (let suffix = 0; ; suffix++) {
      chosen = paths(agentId, base + (suffix ? '-' + suffix : ''));
      try { handle = await fsp.open(chosen.abs, 'wx'); break; }
      catch (e) { if (e && e.code === 'EEXIST') continue; throw e; }
    }
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally { if (handle) await handle.close(); }
    const actual = await fsp.readFile(chosen.abs);
    if (!Buffer.isBuffer(actual) || !actual.equals(bytes)) return null;
    return { path: chosen.rel, chars: text.length, bytes: bytes.length, sha256: digest(bytes) };
  }

  function append(entry) {
    entry = entry || {};
    const name = safe(entry.kind, 24) + '-' + safe(entry.id, 72);
    const chosen = paths(entry.agentId, name);
    fs.mkdirSync(chosen.dir, { recursive: true });
    const bytes = Buffer.from(String(entry.text == null ? '' : entry.text), 'utf8');
    let originalSize = 0;
    try { originalSize = fs.statSync(chosen.abs).size; }
    catch (e) { if (!e || e.code !== 'ENOENT') throw e; }
    let fd = null, readFd = null;
    try {
      fd = fs.openSync(chosen.abs, 'a');
      let offset = 0;
      while (offset < bytes.length) {
        const wrote = fs.writeSync(fd, bytes, offset, bytes.length - offset);
        if (!Number.isInteger(wrote) || wrote <= 0 || wrote > bytes.length - offset) throw new Error('output append made no valid write progress');
        offset += wrote;
      }
      fs.fsyncSync(fd);
      const total = fs.statSync(chosen.abs).size;
      if (bytes.length) {
        const verify = Buffer.alloc(bytes.length);
        readFd = fs.openSync(chosen.abs, 'r');
        let offset = 0;
        while (offset < verify.length) {
          const read = fs.readSync(readFd, verify, offset, verify.length - offset, total - bytes.length + offset);
          if (!Number.isInteger(read) || read <= 0 || read > verify.length - offset) throw new Error('output append read-back mismatch');
          offset += read;
        }
        if (!verify.equals(bytes)) throw new Error('output append read-back mismatch');
      }
      return { path: chosen.rel, bytes: total };
    } catch (e) {
      // A failed verification must not poison the stable process artifact and let a later successful append
      // bless corrupt history. Roll the file back to the last verified byte boundary before surfacing failure.
      if (readFd != null) { try { fs.closeSync(readFd); } catch (closeErr) { failNote('output.rollback.read-close', closeErr); } readFd = null; }
      if (fd != null) { try { fs.closeSync(fd); } catch (closeErr) { failNote('output.rollback.write-close', closeErr); } fd = null; }
      let rollbackFd = null;
      try {
        // Windows refuses ftruncate on an append-open handle, so close it first and truncate by path.
        fs.truncateSync(chosen.abs, originalSize);
        rollbackFd = fs.openSync(chosen.abs, 'r+');
        fs.fsyncSync(rollbackFd);
      } catch (rollbackErr) { failNote('output.rollback.truncate', rollbackErr); }
      finally { if (rollbackFd != null) try { fs.closeSync(rollbackFd); } catch (closeErr) { failNote('output.rollback.sync-close', closeErr); } }
      throw e;
    } finally {
      if (readFd != null) try { fs.closeSync(readFd); } catch (_) {}
      if (fd != null) try { fs.closeSync(fd); } catch (_) {}
    }
  }

  return { park, append, _internals: { paths, safe, agent } };
}

module.exports = { makeOutputArtifacts };
