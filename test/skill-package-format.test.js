'use strict';
const A = require('./_assert.js');
const P = require('../sidecar/skills/package-format.js');

const first = P.canonicalize([
  { path: 'assets/icon.bin', encoding: 'base64', content: Buffer.from([0, 255, 1, 2]).toString('base64') },
  { path: 'SKILL.md', content: '---\nname: x\ndescription: y\n---\n\nDo it.\n' },
  { path: 'references/guide.md', content: 'guide\r\nbytes\n' }
]);
const reordered = P.canonicalize(first.files.slice().reverse());
A.eq(reordered.digest, first.digest, 'package digest ignores manifest ordering');
A.eq(P.fileBuffer(first, 'assets/icon.bin').toString('hex'), '00ff0102', 'binary asset bytes round-trip');
A.eq(P.fromEnvelope(P.toEnvelope(first, { source: 'test' })).digest, first.digest, 'transport envelope round-trips exactly');
A.throws(() => P.canonicalize([{ path: 'SKILL.md', content: 'x' }, { path: '../secret', content: 'x' }]), /unsafe/, 'traversal is refused');
A.throws(() => P.canonicalize([{ path: 'references/x', content: 'x' }]), /missing SKILL/, 'partial package is refused');
const tampered = JSON.parse(P.toEnvelope(first)); tampered.files[0].content += 'AA';
A.throws(() => P.fromEnvelope(tampered), /base64|digest/, 'tampered envelope is refused');
A.throws(() => P.canonicalize([{ path: 'SKILL.md', content: 'x'.repeat(20) }], { maxFileBytes: 10 }), /larger/, 'oversized package files are refused');
A.report('skill-package-format.test.js');
