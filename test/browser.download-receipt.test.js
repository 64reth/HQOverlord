/* node test/browser.download-receipt.test.js -- pure receipt bookkeeping tests. */
'use strict';
const A = require('./_assert.js');
const FS = require('node:fs');
const OS = require('node:os');
const P = require('node:path');
const { _internals: T } = require('../sidecar/tools/builtin/browser.js');

(async () => {
  const dir = FS.mkdtempSync(P.join(OS.tmpdir(), 'starnet-download-receipt-'));
  try {
    const ledger = T.makeDownloadLedger(dir);
    const before = ledger.cursor();
    const begun = ledger.begin({ guid: 'one', suggestedFilename: '../Latest Resume.docx' });
    A.eq(begun.filename, 'Latest Resume.docx', 'download filenames are reduced to a basename');
    A.ok(ledger.startedAfter(before) !== null, 'a new download is visible after the click cursor');

    const bytes = Buffer.from('owned docx fixture bytes');
    FS.writeFileSync(P.join(dir, 'Latest Resume.docx'), bytes);
    ledger.progress({ guid: 'one', state: 'completed', receivedBytes: bytes.length, totalBytes: bytes.length });
    const receipt = await ledger.waitAfter(before, 20);
    A.eq(receipt.status, 'completed', 'a terminal event plus a real file produces a receipt');
    A.eq(receipt.relative, 'downloads/Latest Resume.docx', 'the receipt gives the agent-jail-relative path');
    A.eq(receipt.bytes, bytes.length, 'receipt bytes come from the on-disk stat');

    const missingCursor = ledger.cursor();
    ledger.begin({ guid: 'two', suggestedFilename: 'missing.docx' });
    ledger.progress({ guid: 'two', state: 'completed', receivedBytes: 99, totalBytes: 99 });
    const missing = await ledger.waitAfter(missingCursor, 20);
    A.eq(missing.status, 'unverified', 'a completion event cannot claim a path when no file exists');

    const canceledCursor = ledger.cursor();
    ledger.begin({ guid: 'three', suggestedFilename: 'canceled.docx' });
    ledger.progress({ guid: 'three', state: 'canceled' });
    const canceled = await ledger.waitAfter(canceledCursor, 20);
    A.eq(canceled.status, 'canceled', 'a canceled download is represented honestly');
  } finally {
    FS.rmSync(dir, { recursive: true, force: true });
  }
  A.report('browser.download-receipt');
})().catch(e => { console.error(e && e.stack || e); process.exitCode = 1; });
