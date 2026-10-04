/* sidecar/domain-store.js — versioned, normalized domain state over the crash-safe JSON primitive.

   This is for ordinary non-secret single-document state. Credential stores keep their stricter bespoke proof
   predicates, and append-only/transactional stores keep their own formats. Each read reports provenance; each
   write normalizes, writes durably, then reads back and verifies the decoded value before returning success. */
'use strict';

const { readJsonResilient, writeJsonResilient } = require('./durable-store.js');

function clone(value) {
  if (value == null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

function sameValue(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return false; }
}

function makeDomainStore(options) {
  const opts = options || {};
  if (!opts.fs || typeof opts.fs.readFileSync !== 'function') throw new Error('domain-store: fs is required');
  if (!opts.path || typeof opts.path.dirname !== 'function') throw new Error('domain-store: path is required');
  if (!opts.file) throw new Error('domain-store: file is required');
  const fs = opts.fs;
  const path = opts.path;
  const file = opts.file;
  const version = Math.max(1, Number(opts.version) || 1);
  const defaults = typeof opts.defaults === 'function' ? opts.defaults : () => clone(opts.defaults);
  const normalize = typeof opts.normalize === 'function' ? opts.normalize : value => value;
  const decode = typeof opts.decode === 'function' ? opts.decode : envelope => envelope && envelope.value;
  const encode = typeof opts.encode === 'function' ? opts.encode : value => ({ value });
  const migrate = typeof opts.migrate === 'function' ? opts.migrate : envelope => envelope;
  const onIssue = typeof opts.onIssue === 'function' ? opts.onIssue : () => {};

  function defaultValue() { return normalize(defaults()); }

  function decodeEnvelope(envelope) {
    const fromVersion = Math.max(0, Number(envelope && envelope.version) || 0);
    const migrated = fromVersion === version ? envelope : migrate(envelope, fromVersion, version);
    const decoded = decode(migrated, version);
    if (decoded === undefined) throw new Error('domain-store: decoded value is undefined');
    return normalize(decoded);
  }

  function load() {
    const read = readJsonResilient({ fs }, file);
    if (read.status === 'absent') return { value: defaultValue(), status: 'absent', version };
    if (read.status !== 'ok' && read.status !== 'recovered') {
      onIssue(read.status, { file, read });
      return { value: defaultValue(), status: read.status, version, error: read.err };
    }
    try {
      const value = decodeEnvelope(read.value);
      if (read.status === 'recovered') onIssue('recovered', { file, read });
      return { value, status: read.status, version };
    } catch (error) {
      onIssue('invalid', { file, read, error });
      return { value: defaultValue(), status: 'invalid', version, error };
    }
  }

  function save(value) {
    const normalized = normalize(value);
    const body = encode(normalized, version);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('domain-store: encode must return an object envelope');
    const envelope = Object.assign({}, body, { version });
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch (_) {}
    writeJsonResilient({ fs, path, writeDurable: opts.writeDurable }, file, envelope);
    const readBack = readJsonResilient({ fs }, file);
    if (readBack.status !== 'ok' && readBack.status !== 'recovered') {
      const error = new Error('domain-store: read-back failed for ' + file + ' (' + readBack.status + ')');
      error.code = 'EDOMAIN_READBACK';
      throw error;
    }
    let proven;
    try { proven = decodeEnvelope(readBack.value); } catch (_) { proven = undefined; }
    if (!sameValue(proven, normalized)) {
      const error = new Error('domain-store: read-back did not prove normalized value for ' + file);
      error.code = 'EDOMAIN_UNPROVEN';
      throw error;
    }
    return { ok: true, value: normalized, version };
  }

  function remove() {
    for (const target of [file, file + '.bak']) {
      try { fs.unlinkSync(target); } catch (error) { if (!error || error.code !== 'ENOENT') throw error; }
    }
  }

  return { file, version, load, save, remove };
}

module.exports = { makeDomainStore };
