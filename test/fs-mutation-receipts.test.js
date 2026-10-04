/* node test/fs-mutation-receipts.test.js — G9 verified workspace-mutation receipts.
   Fault-injects the exact boundary ordinary filesystem APIs cannot prove: an acknowledged write/delete
   whose intended state cannot be re-read. The tool must never say "wrote" in those cases, and a multi-file
   patch must identify partial application precisely. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { makeFsTools } = require('../sidecar/tools/builtin/fs.js');
const { makeRegistry } = require('../sidecar/tools/registry.js');

const ROOT = path.join(os.tmpdir(), 'starnet-fs-receipt-' + process.pid);
const ctx = { agentId: 'ag' };
const patchText = body => '*** Begin Patch\n' + body + '\n*** End Patch';
const cloneFsp = overrides => Object.assign({}, fsp, overrides || {});

async function thrown(promise, msg) {
  try { await promise; A.ok(false, msg + ' (did not throw)'); return null; }
  catch (e) { return e; }
}

(async () => {
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_) {}

  // Every successful ordinary mutation returns the same machine-readable state vocabulary.
  {
    const tools = makeFsTools({ fsp, pathMod: path, root: ROOT });
    const w = await tools.writeTool.run({ path: 'ok.txt', content: 'alpha' }, ctx);
    A.eq(w.receipt.state, 'read-back-verified', 'fs.write is verified only after read-back');
    A.ok(w.receipt.phases.includes('written') && w.receipt.phases.includes('read-back-verified'), 'write receipt carries its verified phases');
    A.ok(/read-back-verified/.test(w.content), 'the model-visible success names the proof');

    const a = await tools.appendTool.run({ path: 'ok.txt', content: '+beta' }, ctx);
    const e = await tools.editTool.run({ path: 'ok.txt', find: 'beta', replace: 'gamma' }, ctx);
    const p = await tools.patchTool.run({ patch: patchText('*** Add File: added.txt\n+one') }, ctx);
    for (const [name, result] of [['append', a], ['edit', e], ['patch', p]]) {
      A.eq(result.receipt.operation, name === 'patch' ? 'patch' : name, name + ' exposes its mutation operation');
      A.eq(result.receipt.state, 'read-back-verified', name + ' exposes verified status');
      if (result.receipt.files) A.ok(result.receipt.files.every(o => o.state === 'read-back-verified'), name + ' verifies every file');
    }

    const reg = makeRegistry(); reg.register(tools.writeTool);
    const dispatched = await reg.dispatch({ id: 'ok', name: 'fs.write', args: { path: 'via-reg.txt', content: 'registry' } }, ctx);
    A.eq(dispatched.receipt.state, 'read-back-verified', 'registry preserves a successful machine receipt');
  }

  // The filesystem acknowledges writeFile, but the same filesystem seam re-reads different bytes.
  {
    let poison = '';
    const fake = cloneFsp({
      writeFile: async (target, data) => { await fsp.writeFile(target, data); poison = String(target); },
      readFile: async (target, opts) => {
        if (poison && String(target) === poison) return opts ? 'different' : Buffer.from('different');
        return fsp.readFile(target, opts);
      }
    });
    const tools = makeFsTools({ fsp: fake, pathMod: path, root: path.join(ROOT, 'mismatch') });
    const e = await thrown(tools.writeTool.run({ path: 'bad.txt', content: 'intended' }, ctx), 'read-back mismatch rejects');
    A.eq(e.receipt.state, 'partially-applied', 'acknowledged-but-mismatched write is not called verified');
    A.ok(e.receipt.phases.includes('written'), 'receipt distinguishes written from read-back verified');
    A.ok(!/Wrote bad\.txt/.test(e.message) && /mutation receipt/.test(e.message), 'failure prose never says the file was written successfully');

    const reg = makeRegistry(); reg.register(tools.writeTool);
    const r = await reg.dispatch({ id: 'bad', name: 'fs.write', args: { path: 'bad2.txt', content: 'intended' } }, ctx);
    A.eq(r.isError, true, 'registry returns mismatch as an error');
    A.eq(r.receipt.state, 'partially-applied', 'registry preserves the error receipt');
  }

  // A two-file patch verifies file one, then the filesystem refuses file two: partial is explicit.
  {
    let writes = 0;
    const fake = cloneFsp({
      writeFile: async (target, data) => { writes++; if (writes === 2) { const e = new Error('injected disk fault'); e.code = 'EIO'; throw e; } return fsp.writeFile(target, data); }
    });
    const root = path.join(ROOT, 'partial');
    const tools = makeFsTools({ fsp: fake, pathMod: path, root });
    const e = await thrown(tools.patchTool.run({ patch: patchText('*** Add File: one.txt\n+ONE\n*** Add File: two.txt\n+TWO') }, ctx), 'partial patch rejects');
    A.eq(e.receipt.state, 'partially-applied', 'verified first write plus failed second write is partial');
    A.eq(e.receipt.files[0].state, 'read-back-verified', 'first file is identified as verified');
    A.eq(e.receipt.files[1].state, 'failed', 'second file names the failed boundary');
    A.eq(fs.readFileSync(path.join(root, 'ag', 'one.txt'), 'utf8'), 'ONE', 'receipt agrees with the surviving first mutation');
    A.eq(fs.existsSync(path.join(root, 'ag', 'two.txt')), false, 'failed second mutation is absent');
  }

  // Move safety: destination must verify before the source is deleted.
  {
    const root = path.join(ROOT, 'move');
    const base = makeFsTools({ fsp, pathMod: path, root });
    await base.writeTool.run({ path: 'source.txt', content: 'only-copy' }, ctx);
    const fake = cloneFsp({ writeFile: async (target, data) => {
      if (String(target).endsWith('dest.txt')) throw new Error('destination unavailable');
      return fsp.writeFile(target, data);
    } });
    const tools = makeFsTools({ fsp: fake, pathMod: path, root });
    const e = await thrown(tools.patchTool.run({ patch: patchText('*** Move File: source.txt -> dest.txt') }, ctx), 'failed move rejects');
    A.eq(e.receipt.state, 'failed', 'destination failure before any applied operation is failed, not partial');
    A.eq(fs.readFileSync(path.join(root, 'ag', 'source.txt'), 'utf8'), 'only-copy', 'failed destination never deletes the last source copy');
    A.eq(fs.existsSync(path.join(root, 'ag', 'dest.txt')), false, 'failed destination is absent');
  }

  // An rm implementation that acknowledges but leaves the file readable cannot earn a delete receipt.
  {
    const root = path.join(ROOT, 'delete');
    const base = makeFsTools({ fsp, pathMod: path, root });
    await base.writeTool.run({ path: 'keep.txt', content: 'still-here' }, ctx);
    const fake = cloneFsp({ rm: async () => {} });
    const tools = makeFsTools({ fsp: fake, pathMod: path, root });
    const e = await thrown(tools.patchTool.run({ patch: patchText('*** Delete File: keep.txt') }, ctx), 'unverified delete rejects');
    A.eq(e.receipt.state, 'failed', 'acknowledged delete with readable bytes is unverified');
    A.ok(e.receipt.files[0].phases.includes('failed'), 'delete receipt names the failed verification boundary');
    A.eq(fs.readFileSync(path.join(root, 'ag', 'keep.txt'), 'utf8'), 'still-here', 'receipt agrees that the file remains');
  }

  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_) {}
  A.report('fs-mutation-receipts.test');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
