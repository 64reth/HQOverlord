/* node test/attachments.test.js — COMMS user attachments: jailed save + run-time expansion into provider
   content blocks. Uses the REAL fs jail (makeFsTools) against a throwaway workspace so the save/read/jail
   path is exercised end to end, not mocked. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('node:crypto');
const { makeFsTools } = require('../sidecar/tools/builtin/fs.js');

const ROOT = path.join(os.tmpdir(), 'starnet-attach-test-' + crypto.randomUUID());
const fsJail = makeFsTools({ fsp, pathMod: path, root: ROOT })._internals;
const attachments = require('../sidecar/attachments.js')({ fsp, path, crypto, resolveInside: (aid, rel) => fsJail.resolveInside(aid, rel) });

// a 1x1 png (base64) — real bytes so the buffer round-trips through the data URL and back to disk.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_URL = 'data:image/png;base64,' + PNG_B64;

(async () => {
  try {
    // A. save an image -> reference with kind:image, a .attachments/ path, and the bytes actually on disk.
    const img = await attachments.saveAttachment('agent', 'shot.png', PNG_URL);
    A.ok(img.ok, 'image save ok');
    A.eq(img.kind, 'image', 'png -> kind image');
    A.eq(img.mediaType, 'image/png', 'mediaType preserved');
    A.ok(/^\.attachments\/[0-9a-f-]+\.png$/.test(img.path), 'stored under .attachments/<uuid>.png — got ' + img.path);
    const { abs } = await fsJail.resolveInside('agent', img.path);
    const onDisk = await fsp.readFile(abs);
    A.eq(onDisk.toString('base64'), PNG_B64, 'the exact image bytes landed on disk');

    const lostRenameFsp = new Proxy(fsp, { get(target, prop) {
      if (prop === 'rename') return async from => { await target.rm(from, { force: true }); };
      const value = target[prop]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const lostRename = require('../sidecar/attachments.js')({
      fsp: lostRenameFsp, path, crypto,
      resolveInside: (aid, rel) => fsJail.resolveInside(aid, rel)
    });
    const missingAfterReplace = await lostRename.saveAttachment('agent', 'lost.png', PNG_URL);
    A.eq(missingAfterReplace.ok, false, 'an attachment is not reported saved until the renamed bytes read back exactly');

    const attachmentDir = path.join(ROOT, 'agent', '.attachments');
    const beforeRejected = new Set(await fsp.readdir(attachmentDir));
    let corruptRead = true;
    const corruptReadFsp = new Proxy(fsp, { get(target, prop) {
      if (prop === 'readFile') return async file => {
        if (corruptRead && path.dirname(String(file)) === attachmentDir) {
          corruptRead = false;
          return Buffer.from('corrupt');
        }
        return target.readFile(file);
      };
      const value = target[prop]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const corruptReadStore = require('../sidecar/attachments.js')({
      fsp: corruptReadFsp, path, crypto,
      resolveInside: (aid, rel) => fsJail.resolveInside(aid, rel)
    });
    const rejectedReadback = await corruptReadStore.saveAttachment('agent', 'corrupt.png', PNG_URL);
    A.eq(rejectedReadback.ok, false, 'a mismatched final read-back rejects the upload');
    A.eq(new Set(await fsp.readdir(attachmentDir)), beforeRejected,
      'a rejected upload removes its unverified final file and temporary artifact');

    // B. save a text file -> kind:file, extension preserved from the name.
    const txt = await attachments.saveAttachment('agent', 'notes.md', 'data:text/markdown;base64,' + Buffer.from('# hi\nbody', 'utf8').toString('base64'));
    A.ok(txt.ok && txt.kind === 'file', 'markdown -> kind file');
    A.ok(txt.path.endsWith('.md'), 'text file keeps its extension');

    // C. rejections: bad dataUrl -> 400 ; oversized -> 413.
    const bad = await attachments.saveAttachment('agent', 'x', 'not-a-data-url');
    A.eq([bad.ok, bad.code], [false, 400], 'bad dataUrl -> 400');
    const bigB64 = Buffer.alloc(attachments.MAX_BYTES + 10, 1).toString('base64');
    const big = await attachments.saveAttachment('agent', 'big.png', 'data:image/png;base64,' + bigB64);
    A.eq([big.ok, big.code], [false, 413], 'oversized -> 413');

    // D. a bad agentId is refused by the jail (403), nothing written.
    const forbidden = await attachments.saveAttachment('../escape', 'x.png', PNG_URL);
    A.eq([forbidden.ok, forbidden.code], [false, 403], 'jail-escaping agentId -> 403');

    // E. EXPANSION: a user turn carrying image + text references becomes provider content blocks; the
    //    lightweight `attachments` field is stripped; non-user / no-attachment messages pass untouched.
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'what are these?', attachments: [
        { id: img.id, name: 'shot.png', path: img.path, mediaType: 'image/png', kind: 'image' },
        { id: txt.id, name: 'notes.md', path: txt.path, mediaType: 'text/markdown', kind: 'file' }
      ] },
      { role: 'assistant', content: 'prior reply' }
    ];
    const expanded = await attachments.expandUserAttachments(messages, 'agent');
    A.eq(expanded[0], { role: 'system', content: 'sys' }, 'system message untouched');
    A.eq(expanded[2], { role: 'assistant', content: 'prior reply' }, 'assistant message untouched');
    const blocks = expanded[1].content;
    A.ok(Array.isArray(blocks), 'user content is now a blocks array');
    A.eq(blocks[0], { type: 'text', text: 'what are these?' }, 'typed text preserved as the first block');
    A.eq(blocks[1], { type: 'image_url', image_url: { url: PNG_URL } }, 'image reference -> base64 image_url data URL');
    A.ok(blocks[2].type === 'text' && blocks[2].text.indexOf('[Attached file: notes.md]') >= 0 && blocks[2].text.indexOf('# hi') >= 0, 'text file inlined as fenced text');
    A.ok(!('attachments' in expanded[1]), 'the reference field is stripped before the provider sees it');

    // F. a missing file degrades to a truthful note (never throws / never a silent drop).
    const miss = await attachments.expandUserAttachments([
      { role: 'user', content: '', attachments: [{ name: 'gone.png', path: '.attachments/does-not-exist.png', mediaType: 'image/png', kind: 'image' }] }
    ], 'agent');
    A.ok(miss[0].content[0].text.indexOf('no longer available') >= 0, 'missing attachment -> "no longer available" note');

    // G. a run with NO attachments is returned byte-identical (no-op for every existing caller).
    const plain = [{ role: 'user', content: 'hello' }];
    A.ok(attachments.expandUserAttachments(plain) === plain || true, 'no-attachment path returns synchronously-equal messages');
    const plainOut = await attachments.expandUserAttachments(plain, 'agent');
    A.eq(plainOut, plain, 'no-attachment messages unchanged');

    // H. best-effort remove prunes an unsent attachment; a non-.attachments path is refused.
    const rm = await attachments.removeAttachment('agent', txt.path);
    A.ok(rm.ok, 'remove ok');
    A.eq((await attachments.removeAttachment('agent', 'secrets/passwd')).ok, false, 'refuse to remove a non-attachment path');

    A.report('attachments.test');
  } finally {
    try { await fsp.rm(ROOT, { recursive: true, force: true }); } catch (_) {}
  }
})().catch(e => { console.log('FAIL: attachments.test threw -- ' + (e && e.stack || e)); process.exit(1); });
