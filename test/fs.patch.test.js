/* node test/fs.patch.test.js - fs.patch V4A parser + fuzzy atomic apply.
   Uses real temp files so rollback and jail behavior are proven against the
   same filesystem edge as the rest of fs.js. */
'use strict';
const A = require('./_assert.js');
const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { makeFsTools } = require('../sidecar/tools/builtin/fs.js');
const { parsePatch } = require('../sidecar/tools/builtin/patchparse.js');
const { fuzzyFindAndReplace } = require('../sidecar/tools/builtin/fuzzymatch.js');

const ROOT = path.join(os.tmpdir(), 'starnet-fs-patch-' + process.pid);
const tools = makeFsTools({ fsp, pathMod: path, root: ROOT, limits: { writeBytes: 4096, readReturn: 4096 } });
const { writeTool, readTool, patchTool } = tools;
const ctx = { agentId: 'ag' };

async function rejects(promise, pattern, msg) {
  try {
    await promise;
    A.ok(false, msg + ' - did NOT reject');
  } catch (e) {
    A.ok(pattern.test((e && e.message) || String(e)), msg + ' - ' + ((e && e.message) || e));
  }
}
async function rejectedError(promise) {
  try { await promise; return null; } catch (e) { return e; }
}
function patch(body) {
  return '*** Begin Patch\n' + body + '\n*** End Patch';
}

(async () => {
  // ---- parser-level malformed rejection ----
  {
    const noHeader = parsePatch('*** Begin Patch\n+loose line\n*** End Patch');
    A.ok(!noHeader.ok && /before a file operation|no file operation/.test(noHeader.error), 'parser rejects patch content without a file header');

    const zeroHunk = parsePatch(patch('*** Update File: a.txt'));
    A.ok(!zeroHunk.ok && /no hunks/.test(zeroHunk.error), 'parser rejects update with zero hunks');

    const badMove = parsePatch('*** Begin Patch\n*** Move File: a.txt\n*** End Patch');
    A.ok(!badMove.ok && /missing destination/.test(badMove.error), 'parser rejects move without destination');
  }

  // ---- add + multi-hunk update success ----
  {
    const added = await patchTool.run({ patch: patch('*** Add File: multi.txt\n+alpha\n+beta\n+gamma') }, ctx);
    A.eq(added.mutationReceipt.state, 'read-back-verified', 'patch success requires all planned files to read back exactly');
    A.eq(added.mutationReceipt.files[0].state, 'read-back-verified', 'patch exposes a per-file verification receipt');
    let r = await readTool.run({ path: 'multi.txt' }, ctx);
    A.eq(r.content, 'alpha\nbeta\ngamma', 'add file writes patch content');

    await patchTool.run({ patch: patch([
      '*** Update File: multi.txt',
      '@@ first @@',
      '-alpha',
      '+ALPHA',
      ' beta',
      '@@ second @@',
      ' beta',
      '-gamma',
      '+GAMMA'
    ].join('\n')) }, ctx);
    r = await readTool.run({ path: 'multi.txt' }, ctx);
    A.eq(r.content, 'ALPHA\nbeta\nGAMMA', 'multi-hunk update applies both hunks');
  }

  // ---- atomic rollback: first hunk matches, second fails, no write ----
  {
    await writeTool.run({ path: 'rollback.txt', content: 'one\ntwo\nthree' }, ctx);
    await rejects(patchTool.run({ patch: patch([
      '*** Update File: rollback.txt',
      '@@ h1 @@',
      '-one',
      '+ONE',
      '@@ h2 @@',
      '-missing',
      '+MISSING'
    ].join('\n')) }, ctx), /Could not find|UPDATE rollback/, 'failed second hunk rejects the whole patch');
    const after = await readTool.run({ path: 'rollback.txt' }, ctx);
    A.eq(after.content, 'one\ntwo\nthree', 'failed patch leaves file byte-identical');
  }

  // ---- jail: escaped path rejected before any in-jail file is touched ----
  {
    await writeTool.run({ path: 'safe.txt', content: 'safe' }, ctx);
    await rejects(patchTool.run({ patch: patch('*** Add File: ../escape.txt\n+pwn') }, ctx), /illegal path|escapes/, 'patch rejects escaped add path');
    A.eq((await readTool.run({ path: 'safe.txt' }, ctx)).content, 'safe', 'jail rejection did not touch existing file');
  }

  // ---- fuzzy whitespace/indent tolerance with file indentation preserved ----
  {
    await writeTool.run({ path: 'indent.js', content: 'function x() {\n    if (ready) {\n        return 1;\n    }\n}' }, ctx);
    await patchTool.run({ patch: patch([
      '*** Update File: indent.js',
      '@@ fuzzy indent @@',
      ' if (ready) {',
      '-  return 1;',
      '+  return 2;',
      ' }'
  ].join('\n')) }, ctx);
  const out = await readTool.run({ path: 'indent.js' }, ctx);
  const lines = out.content.split('\n');
  A.ok(lines.indexOf('        return 2;') >= 0, 'fuzzy match preserves the file indentation');
  A.ok(lines.indexOf('  return 2;') < 0, 'patch indentation was not written verbatim');
  }

  // ---- uniqueness guard: ambiguous fuzzy/exact matches fail with more-context hint ----
  {
    await writeTool.run({ path: 'ambiguous.txt', content: 'same\nx\nsame' }, ctx);
    await rejects(patchTool.run({ patch: patch('*** Update File: ambiguous.txt\n-same\n+other') }, ctx), /provide more context/i, 'ambiguous hunk asks for more context');
    A.eq((await readTool.run({ path: 'ambiguous.txt' }, ctx)).content, 'same\nx\nsame', 'ambiguous patch writes nothing');
  }

  // ---- move and delete stay inside the two-phase patch surface ----
  {
    await writeTool.run({ path: 'move-me.txt', content: 'moved' }, ctx);
    await patchTool.run({ patch: patch('*** Move File: move-me.txt -> moved.txt') }, ctx);
    A.eq((await readTool.run({ path: 'moved.txt' }, ctx)).content, 'moved', 'move writes destination content');
    await rejects(readTool.run({ path: 'move-me.txt' }, ctx), /no such file/, 'move removes source');

    await patchTool.run({ patch: patch('*** Delete File: moved.txt') }, ctx);
    await rejects(readTool.run({ path: 'moved.txt' }, ctx), /no such file/, 'delete removes file');
  }

  // ---- pure matcher sanity: non-exact ambiguity is not guessed ----
  {
    const res = fuzzyFindAndReplace('A\nA', ' A ', 'B');
    A.ok(!res.ok && /provide more context/.test(res.error), 'fuzzy matcher uniqueness guard is direct-testable');
  }

  /* ---- blockAnchor must not report a single block as ambiguous ----
     It paired EVERY occurrence of the first anchor with the same last anchor, producing overlapping ranges,
     so a block occurring exactly once answered "Found 2 matches; provide more context" and the hunk was
     refused. (With replaceAll the overlap spliced the replacement in twice.) ---- */
  {
    const { fuzzyFindAndReplace, _internals } = require('../sidecar/tools/builtin/fuzzymatch.js');
    const NL = String.fromCharCode(10);
    const content = ['if (a) {', 'if (a) {', '  body();', '}'].join(NL);
    const oldText = ['if (a) {', '  CHANGED();', '}'].join(NL);
    A.eq(_internals.blockAnchor(content, oldText).length, 1, 'the repeated opening anchor yields ONE block, not two overlapping ones');
    const r = fuzzyFindAndReplace(content, oldText, 'X');
    A.ok(r.ok, 'and the hunk applies instead of being refused as ambiguous');
    A.eq(r.strategy, 'block_anchor', 'via the block_anchor strategy');
    // two genuinely DISTINCT blocks are still ambiguous
    const twice = ['start', '  x', 'end', 'pad', 'start', '  y', 'end'].join(NL);
    A.ok(!fuzzyFindAndReplace(twice, ['start', '  z', 'end'].join(NL), 'X').ok, 'two distinct blocks are still reported ambiguous');
  }

  // ---- mutation receipts: injected storage faults never produce a false success claim ----
  {
    const faultRoot = path.join(ROOT, 'faults');
    let wrote = false;
    const unreadableAfterWrite = new Proxy(fsp, { get(target, prop) {
      if (prop === 'writeFile') return async (...args) => { const out = await target.writeFile(...args); wrote = true; return out; };
      if (prop === 'readFile') return async (...args) => { if (wrote) throw Object.assign(new Error('injected read-back failure'), { code: 'EIO' }); return target.readFile(...args); };
      const value = target[prop]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const unreadable = makeFsTools({ fsp: unreadableAfterWrite, pathMod: path, root: faultRoot, limits: { writeBytes: 4096, readReturn: 4096 } });
    const noReadback = await rejectedError(unreadable.writeTool.run({ path: 'unproved.txt', content: 'intended' }, ctx));
    A.eq(noReadback.mutationReceipt.state, 'failed', 'a resolved write with unavailable read-back is not promoted to success');
    A.ok(noReadback.mutationReceipt.phases.indexOf('written') >= 0, 'the receipt distinguishes written from read-back verified');
    A.ok(!/\bWrote\b/.test(noReadback.message), 'the failed read-back path never emits a Wrote claim');

    const corrupting = new Proxy(fsp, { get(target, prop) {
      if (prop === 'writeFile') return async (file, data, ...rest) => { await target.writeFile(file, data, ...rest); await target.writeFile(file, Buffer.from('CORRUPT')); };
      const value = target[prop]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const corrupt = makeFsTools({ fsp: corrupting, pathMod: path, root: faultRoot, limits: { writeBytes: 4096, readReturn: 4096 } });
    const partial = await rejectedError(corrupt.writeTool.run({ path: 'partial.txt', content: 'intended' }, ctx));
    A.eq(partial.mutationReceipt.state, 'partially-applied', 'wrong bytes after a write are reported partially applied');
    A.ok(partial.mutationReceipt.actualSha256 !== partial.mutationReceipt.sha256, 'partial receipt proves intended and observed digests differ');

    const failBeforeWrite = new Proxy(fsp, { get(target, prop) {
      if (prop === 'writeFile') return async () => { throw new Error('injected write refusal'); };
      const value = target[prop]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const failed = makeFsTools({ fsp: failBeforeWrite, pathMod: path, root: faultRoot, limits: { writeBytes: 4096, readReturn: 4096 } });
    const refused = await rejectedError(failed.writeTool.run({ path: 'never.txt', content: 'intended' }, ctx));
    A.eq(refused.mutationReceipt.state, 'failed', 'a mutation that never changed disk is distinctly failed');
    A.eq(refused.mutationReceipt.phases.join(','), 'attempted,failed', 'attempted and failed phases remain auditable');
  }

  // ---- multi-file patch: a later write fault exposes the already-applied boundary ----
  {
    const partialRoot = path.join(ROOT, 'partial-patch');
    await fsp.mkdir(path.join(partialRoot, 'ag'), { recursive: true });
    await fsp.writeFile(path.join(partialRoot, 'ag', 'one.txt'), 'one');
    await fsp.writeFile(path.join(partialRoot, 'ag', 'two.txt'), 'two');
    let writeCount = 0;
    const partialFsp = new Proxy(fsp, { get(target, prop) {
      if (prop === 'writeFile') return async (file, data, ...rest) => {
        writeCount++;
        if (writeCount === 2) { await target.writeFile(file, Buffer.from('BROKEN')); throw new Error('injected second-file failure'); }
        return target.writeFile(file, data, ...rest);
      };
      const value = target[prop]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const partialTools = makeFsTools({ fsp: partialFsp, pathMod: path, root: partialRoot, limits: { writeBytes: 4096, readReturn: 4096 } });
    const err = await rejectedError(partialTools.patchTool.run({ patch: patch([
      '*** Update File: one.txt', '-one', '+ONE',
      '*** Update File: two.txt', '-two', '+TWO'
    ].join('\n')) }, ctx));
    A.eq(err.mutationReceipt.state, 'partially-applied', 'multi-file patch reports a partial application when the second write faults');
    A.eq(err.mutationReceipt.files[0].state, 'read-back-verified', 'patch receipt preserves the first verified file');
    A.eq(err.mutationReceipt.files[1].state, 'partially-applied', 'patch receipt names the corrupted file boundary');
    A.ok(!/Applied patch/.test(err.message), 'a partial patch never emits the success summary');
  }

  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) {}
  A.report('fs.patch.test');
})();
