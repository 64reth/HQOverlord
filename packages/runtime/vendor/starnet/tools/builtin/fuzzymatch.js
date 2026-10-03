/* sidecar/tools/builtin/fuzzymatch.js - conservative fuzzy block replacement.
   Strategy ladder: exact -> line_trimmed -> whitespace_normalized ->
   indentation_flexible -> block_anchor. Non-exact replacements are reindented
   against the file's matched region. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; root.SK.tools = root.SK.tools || {}; (root.SK.tools.builtin = root.SK.tools.builtin || {}).fuzzymatch = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function allIndexes(haystack, needle) {
    const out = [];
    if (!needle) return out;
    let at = haystack.indexOf(needle);
    while (at >= 0) {
      out.push([at, at + needle.length]);
      at = haystack.indexOf(needle, at + Math.max(1, needle.length));
    }
    return out;
  }
  function lineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text.charAt(i) === '\n') starts.push(i + 1);
    return starts;
  }
  function findLineBlock(content, oldText, normalizer) {
    const fileLines = content.split('\n');
    const oldLines = oldText.split('\n');
    const width = oldLines.length;
    const wanted = oldLines.map(normalizer).join('\n');
    const starts = lineStarts(content);
    const out = [];
    for (let i = 0; i <= fileLines.length - width; i++) {
      if (fileLines.slice(i, i + width).map(normalizer).join('\n') === wanted) {
        const start = starts[i];
        const endLine = i + width - 1;
        const end = starts[endLine] + fileLines[endLine].length;
        out.push([start, end]);
      }
    }
    return out;
  }
  function leading(s) {
    const m = String(s).match(/^[ \t]*/);
    return m ? m[0] : '';
  }
  function firstMeaningful(text) {
    return String(text).split('\n').find(l => l.trim()) || '';
  }
  function reindent(fileRegion, oldText, newText) {
    if (!newText) return newText;
    const fileLines = String(fileRegion).split('\n');
    const oldLines = String(oldText).split('\n');
    const oldBase = leading(firstMeaningful(oldText));
    const fileBase = leading(firstMeaningful(fileRegion));
    if (oldBase === fileBase && oldLines.every((line, i) => !fileLines[i] || leading(line) === leading(fileLines[i]))) return newText;
    return String(newText).split('\n').map((line, i) => {
      if (!line.trim()) return line;
      const ind = leading(line);
      const oldInd = oldLines[i] != null ? leading(oldLines[i]) : oldBase;
      const fileInd = fileLines[i] != null ? leading(fileLines[i]) : fileBase;
      if (ind.indexOf(oldInd) === 0) return fileInd + line.slice(oldInd.length);
      if (ind.indexOf(oldBase) === 0) return fileBase + line.slice(oldBase.length);
      return fileBase + line.slice(ind.length);
    }).join('\n');
  }
  function replaceMatches(content, matches, newText, oldText, strategy) {
    let out = '';
    let cursor = 0;
    for (const m of matches) {
      const region = content.slice(m[0], m[1]);
      const replacement = strategy === 'exact' ? newText : reindent(region, oldText, newText);
      out += content.slice(cursor, m[0]) + replacement;
      cursor = m[1];
    }
    return out + content.slice(cursor);
  }
  // Anchor a block by its first and last meaningful lines. Matches are NON-OVERLAPPING: the scan resumes
  // after the block it just claimed. Without that, every occurrence of the FIRST anchor before a given last
  // anchor produced its own range ending at the SAME line — so a block occurring exactly once reported
  // "Found 2 matches; provide more context" (e.g. two `if (a) {` lines above one `}`), and with replaceAll
  // the overlapping ranges spliced the replacement in twice.
  function blockAnchor(content, oldText) {
    const oldLines = oldText.split('\n');
    const first = oldLines.find(l => l.trim());
    const last = oldLines.slice().reverse().find(l => l.trim());
    if (!first || !last || first === last) return [];
    const fileLines = content.split('\n');
    const starts = lineStarts(content);
    const out = [];
    for (let i = 0; i < fileLines.length; i++) {
      if (fileLines[i].trim() !== first.trim()) continue;
      for (let j = i; j < fileLines.length; j++) {
        if (fileLines[j].trim() !== last.trim()) continue;
        const start = starts[i];
        const end = starts[j] + fileLines[j].length;
        out.push([start, end]);
        i = j;              // claim the block: the next scan starts AFTER it, never inside it
        break;
      }
    }
    return out;
  }

  function fuzzyFindAndReplace(content, oldText, newText, opts) {
    opts = opts || {};
    content = String(content == null ? '' : content);
    oldText = String(oldText == null ? '' : oldText);
    newText = String(newText == null ? '' : newText);
    if (!oldText) return { ok: false, content, count: 0, strategy: null, error: 'old text cannot be empty' };
    const strategies = [
      ['exact', () => allIndexes(content, oldText)],
      ['line_trimmed', () => findLineBlock(content, oldText, l => l.trim())],
      ['whitespace_normalized', () => findLineBlock(content, oldText, l => l.trim().replace(/\s+/g, ' '))],
      ['indentation_flexible', () => findLineBlock(content, oldText, l => l.replace(/^[ \t]+/, ''))],
      ['block_anchor', () => blockAnchor(content, oldText)]
    ];
    for (const pair of strategies) {
      const strategy = pair[0];
      const matches = pair[1]();
      if (!matches.length) continue;
      if (matches.length > 1 && !opts.replaceAll) {
        return { ok: false, content, count: 0, strategy: null, error: 'Found ' + matches.length + ' matches; provide more context to make it unique.' };
      }
      return { ok: true, content: replaceMatches(content, matches, newText, oldText, strategy), count: matches.length, strategy, error: null };
    }
    return { ok: false, content, count: 0, strategy: null, error: 'Could not find a match for patch hunk' };
  }

  return { fuzzyFindAndReplace, _internals: { findLineBlock, reindent, blockAnchor } };
});
