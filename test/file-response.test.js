'use strict';

const path = require('node:path');
const A = require('./_assert.js');
const F = require('../sidecar/file-response.js');

A.eq(F.mimeForPath('report.HTML'), 'text/html', 'known MIME is case-insensitive and strips charset for multipart uploads');
A.eq(F.mimeForPath('unknown.bin'), 'application/octet-stream', 'unknown extension fails to safe binary MIME');
A.eq(F.safeDownloadName(path.join('drop', 'a bad;name.html')), 'a_bad_name.html', 'download filename removes header-active punctuation');
A.ok(F.isActiveDeliverable('demo.svg') && F.isActiveDeliverable('code.mjs'), 'active browser formats are download-only');
A.ok(!F.isActiveDeliverable('photo.png'), 'passive media may render inline');
A.eq(F.parseRange('', 100), null, 'missing range requests the full file');
A.eq(F.parseRange('bytes=10-19', 100), { start: 10, end: 19 }, 'explicit range is inclusive');
A.eq(F.parseRange('bytes=90-', 100), { start: 90, end: 99 }, 'open range ends at the file boundary');
A.eq(F.parseRange('bytes=-10', 100), { start: 90, end: 99 }, 'suffix range returns the requested tail');
A.eq(F.parseRange('bytes=90-999', 100), { start: 90, end: 99 }, 'end is clamped to the file boundary');
A.eq(F.parseRange('bytes=100-101', 100), { unsatisfiable: true }, 'range beginning at EOF is rejected');
A.eq(F.parseRange('bytes=20-10', 100), { unsatisfiable: true }, 'backwards range is rejected');
A.eq(F.parseRange('bytes=1-2,4-5', 100), { unsatisfiable: true }, 'multi-range input is rejected explicitly');
A.eq(F.CHANNEL_UPLOAD_MAX_BYTES, 20 * 1024 * 1024, 'channel upload ceiling remains 20 MiB');

A.report('file-response.test');
