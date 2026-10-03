/* sidecar/tools/builtin/patchparse.js - V4A-style patch parser.
   Parses a conservative subset of the Codex patch format (as used by the reference harness). It is pure
   and returns structured errors instead of throwing so fs.patch can validate
   every operation before touching disk. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; root.SK.tools = root.SK.tools || {}; (root.SK.tools.builtin = root.SK.tools.builtin || {}).patchparse = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function finishOp(out, op, hunk) {
    if (!op) return;
    if (hunk && hunk.lines.length) op.hunks.push(hunk);
    out.push(op);
  }

  function parsePatch(input) {
    const text = String(input == null ? '' : input);
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let start = -1, end = lines.length;
    for (let i = 0; i < lines.length; i++) {
      if (/^\*\*\*\s*Begin Patch\s*$/.test(lines[i])) start = i;
      if (/^\*\*\*\s*End Patch\s*$/.test(lines[i])) { end = i; break; }
    }
    if (start < 0) return { ok: false, operations: [], error: 'patch is missing "*** Begin Patch"' };
    if (end <= start) return { ok: false, operations: [], error: 'patch is missing "*** End Patch"' };

    const operations = [];
    let op = null;
    let hunk = null;

    for (let i = start + 1; i < end; i++) {
      const line = lines[i];
      let m;
      if ((m = line.match(/^\*\*\*\s*Add File:\s*(.+?)\s*$/))) {
        finishOp(operations, op, hunk);
        op = { type: 'add', path: m[1].trim(), hunks: [], newPath: null };
        hunk = { hint: null, lines: [] };
        continue;
      }
      if ((m = line.match(/^\*\*\*\s*Update File:\s*(.+?)\s*$/))) {
        finishOp(operations, op, hunk);
        op = { type: 'update', path: m[1].trim(), hunks: [], newPath: null };
        hunk = null;
        continue;
      }
      if ((m = line.match(/^\*\*\*\s*Delete File:\s*(.+?)\s*$/))) {
        finishOp(operations, op, hunk);
        operations.push({ type: 'delete', path: m[1].trim(), hunks: [], newPath: null });
        op = null;
        hunk = null;
        continue;
      }
      if ((m = line.match(/^\*\*\*\s*Move File:\s*(.+?)\s*->\s*(.+?)\s*$/))) {
        finishOp(operations, op, hunk);
        operations.push({ type: 'move', path: m[1].trim(), newPath: m[2].trim(), hunks: [] });
        op = null;
        hunk = null;
        continue;
      }
      if ((m = line.match(/^\*\*\*\s*Move File:\s*(.+?)\s*$/))) {
        finishOp(operations, op, hunk);
        operations.push({ type: 'move', path: m[1].trim(), newPath: '', hunks: [] });
        op = null;
        hunk = null;
        continue;
      }
      if ((m = line.match(/^\*\*\*\s*Move to:\s*(.+?)\s*$/))) {
        if (!op) return { ok: false, operations: [], error: '"*** Move to:" must follow an update operation' };
        op.newPath = m[1].trim();
        continue;
      }
      if (/^@@/.test(line)) {
        if (!op || (op.type !== 'update' && op.type !== 'add')) return { ok: false, operations: [], error: 'hunk marker appears before a file operation' };
        if (hunk && hunk.lines.length) op.hunks.push(hunk);
        const hint = line.replace(/^@@\s*/, '').replace(/\s*@@$/, '').trim() || null;
        hunk = { hint, lines: [] };
        continue;
      }
      if (!op) {
        if (line.trim()) return { ok: false, operations: [], error: 'patch content appears before a file operation' };
        continue;
      }
      if (!hunk) hunk = { hint: null, lines: [] };
      if (line === '\\ No newline at end of file') continue;
      if (/^[ +\-]/.test(line)) hunk.lines.push({ prefix: line.charAt(0), text: line.slice(1) });
      else if (op.type === 'add') hunk.lines.push({ prefix: '+', text: line });
      else hunk.lines.push({ prefix: ' ', text: line });
    }
    finishOp(operations, op, hunk);

    if (!operations.length) return { ok: false, operations: [], error: 'patch has no file operations' };
    for (const item of operations) {
      if (!item.path) return { ok: false, operations: [], error: 'file operation has an empty path' };
      if (item.type === 'update' && !item.hunks.length) return { ok: false, operations: [], error: 'UPDATE ' + item.path + ': no hunks found' };
      if (item.type === 'add' && !item.hunks.length) return { ok: false, operations: [], error: 'ADD ' + item.path + ': no content found' };
      if (item.type === 'move' && !item.newPath) return { ok: false, operations: [], error: 'MOVE ' + item.path + ': missing destination path' };
    }
    return { ok: true, operations, error: null };
  }

  function hunkOldText(hunk) {
    return hunk.lines.filter(l => l.prefix === ' ' || l.prefix === '-').map(l => l.text).join('\n');
  }
  function hunkNewText(hunk) {
    return hunk.lines.filter(l => l.prefix === ' ' || l.prefix === '+').map(l => l.text).join('\n');
  }
  function addText(op) {
    const out = [];
    for (const h of op.hunks || []) for (const l of h.lines) if (l.prefix === '+') out.push(l.text);
    return out.join('\n');
  }

  return { parsePatch, hunkOldText, hunkNewText, addText };
});
