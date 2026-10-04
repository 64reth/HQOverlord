/* Bounded, local-only source adapter. Selecting a source does not grant execution authority.
   Every read rechecks the existing project grant and canonical path; no model calls here. */
'use strict';
const Discovery = require('./discovery.js');
const { note: failNote } = require('./failopen.js');
const POLICY = Object.freeze({ lookbackDays: 7, maxFiles: 48, maxEntries: 600, maxDepth: 3,
  maxFileBytes: 65536, maxTotalBytes: 524288, maxEvidence: 6, extensions: ['.md', '.txt', '.csv'] });
const PRIVATE_NAME = /(^\.|(?:^|[-_. ])(?:secrets?|credentials?|passwords?|tokens?|private|keys?|keychains?|backups?)(?:[-_. ]|$))/i;
const SECRET_TEXT = /-----BEGIN [^-]*PRIVATE KEY-----|\b(?:api[_ -]?key|access[_ -]?token|password|secret|aws_access_key_id|aws_secret_access_key|authorization)["']?\s*[:=]\s*\S+|\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16})/i;
const RELEVANT = /\b(?:completed?|delivered?|milestone|blocker|blocked|next steps?|deadline|decision|action item|progress|status)\b/i;

function makeDocumentDiscovery({ fsp, path, hash, isBlessed, canScan = () => true }) {
  const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  async function canonicalRoot(input) {
    if (typeof input !== 'string' || !input.trim() || !path.isAbsolute(input)) throw new Error('Select an approved absolute folder path.');
    const resolved = path.resolve(input);
    const info = await fsp.lstat(resolved);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Select a real folder, not a link.');
    const real = await fsp.realpath(resolved);
    if (!isBlessed(real)) throw new Error('Approve this project folder before selecting it as a discovery source.');
    return real;
  }
  async function scan(source, now) {
    if (!source || !source.enabled) return { ok: false, reason: 'source-paused', findings: [] };
    let root;
    try { root = await canonicalRoot(source.root); } catch (_) { return { ok: false, reason: 'source-unavailable-or-revoked', findings: [] }; }
    if (!same(root, source.root)) return { ok: false, reason: 'source-moved', findings: [] };
    const evidence = [], queue = [{ dir: root, depth: 0 }];
    let entries = 0, files = 0, bytes = 0, limited = false;
    const since = now - POLICY.lookbackDays * 86400000;
    while (queue.length && entries < POLICY.maxEntries && files < POLICY.maxFiles && bytes < POLICY.maxTotalBytes) {
      const { dir, depth } = queue.shift();
      if (!isBlessed(root) || !canScan(root)) return { ok: false, reason: 'source-unavailable-or-revoked', findings: [] };
      let handle;
      try {
        // Recheck a queued directory at use, not merely when it was discovered.
        if ((await fsp.lstat(dir)).isSymbolicLink() || !same(await fsp.realpath(dir), dir)) continue;
        handle = await fsp.opendir(dir);
        for await (const entry of handle) {
          if (++entries > POLICY.maxEntries) { limited = true; break; }
          if (PRIVATE_NAME.test(entry.name) || entry.isSymbolicLink()) continue;
          const target = path.join(dir, entry.name);
          const rel = path.relative(root, target);
          if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
          if (entry.isDirectory()) {
            if (depth < POLICY.maxDepth && !['node_modules', 'vendor', 'dist', 'build'].includes(entry.name.toLowerCase())) queue.push({ dir: target, depth: depth + 1 });
            continue;
          }
          if (!entry.isFile() || !POLICY.extensions.includes(path.extname(entry.name).toLowerCase())) continue;
          if (files >= POLICY.maxFiles || bytes >= POLICY.maxTotalBytes) { limited = true; break; }
          let file;
          try {
            const stat = await fsp.lstat(target);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > POLICY.maxFileBytes || stat.mtimeMs < since || stat.mtimeMs > now + 60000) continue;
            if (bytes + stat.size > POLICY.maxTotalBytes) { limited = true; continue; }
            if (!isBlessed(root) || !canScan(root) || !same(await fsp.realpath(target), target)) continue;
            file = await fsp.open(target, 'r');
            const opened = await file.stat();
            if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size > POLICY.maxFileBytes) continue;
            // Fixed-size read remains bounded even if a writer grows the file after stat.
            const buffer = Buffer.alloc(Math.min(POLICY.maxFileBytes, POLICY.maxTotalBytes - bytes));
            const read = await file.read(buffer, 0, buffer.length, 0);
            files++; bytes += read.bytesRead;
            const text = buffer.subarray(0, read.bytesRead).toString('utf8');
            if (text.includes('\0') || text.includes('\ufffd') || SECRET_TEXT.test(text)) continue;
            const lines = text.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
              const quote = lines[i].trim().replace(/\s+/g, ' ').slice(0, 200);
              if (!quote || /^#{1,6}\s/.test(quote) || !RELEVANT.test(quote)) continue;
              if (i === 0 && path.extname(entry.name).toLowerCase() === '.csv' && /^(?:status|owner|date|client|project)(?:\s*,\s*(?:status|owner|date|client|project))+$/i.test(quote)) continue;
              evidence.push({ path: rel.replace(/\\/g, '/'), line: i + 1, quote, modifiedAt: Math.floor(stat.mtimeMs) });
              break; // one excerpt per document, so one long note cannot crowd out the others
            }
          } catch (_) {
            limited = true;
            // Files can disappear/become unreadable during a scan. Record the omission without paths,
            // excerpts, or OS error messages (which can contain private filenames).
            failNote('discovery.documents.file-read', 'A document became unavailable and was omitted from this scan.');
          }
          finally { if (file) await file.close(); }
        }
      } catch (_) {
        limited = true;
        failNote('discovery.documents.directory-read', 'A directory became unavailable; this document scan is partial.');
      }
    }
    limited = limited || queue.length > 0 || entries >= POLICY.maxEntries || files >= POLICY.maxFiles || bytes >= POLICY.maxTotalBytes;
    if (!isBlessed(root) || !canScan(root)) return { ok: false, reason: 'source-unavailable-or-revoked', findings: [] };
    evidence.sort((a, b) => b.modifiedAt - a.modifiedAt || a.path.localeCompare(b.path));
    const selected = evidence.slice(0, POLICY.maxEvidence);
    if (!selected.length) return { ok: true, reason: 'no-recent-client-update-evidence', findings: [], files, bytes, limited };
    // Stable content identity: unchanged evidence stays declined/resolved across rescans and restarts.
    const identity = hash(JSON.stringify(selected.slice().sort((a, b) => a.path.localeCompare(b.path)).map(e => [e.path, e.line, e.quote])));
    const fingerprint = 'client-update:' + hash(root) + ':' + identity;
    const quote = selected[0].path + ':' + selected[0].line + ': ' + selected[0].quote;
    return { ok: true, files, bytes, limited, findings: [{
      id: fingerprint, fingerprint, root, displayPath: root, sourceId: source.id,
      kind: 'client-update', title: 'Draft a weekly client update from ' + Discovery.baseName(root),
      quote, evidence: selected, at: now
    }] };
  }
  return { canonicalRoot, scan };
}
module.exports = { POLICY, makeDocumentDiscovery };
