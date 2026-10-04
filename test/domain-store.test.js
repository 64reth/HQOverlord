'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const A = require('./_assert.js');
const { makeDomainStore } = require('../sidecar/domain-store.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-domain-store-'));
try {
  const file = path.join(root, 'settings.json');
  const issues = [];
  const store = makeDomainStore({
    fs, path, file, version: 2,
    defaults: () => ({ enabled: true, count: 0 }),
    normalize: value => ({ enabled: value && value.enabled !== false, count: Math.max(0, Math.floor(Number(value && value.count) || 0)) }),
    encode: value => ({ settings: value }),
    decode: envelope => envelope.settings,
    migrate: (envelope, from) => from === 1 ? { version: 2, settings: envelope.config } : envelope,
    onIssue: (status, detail) => issues.push({ status, detail })
  });

  A.eq(store.load(), { value: { enabled: true, count: 0 }, status: 'absent', version: 2 }, 'absent state returns explicit defaults and provenance');
  const saved = store.save({ enabled: false, count: 3.9 });
  A.ok(saved.ok && saved.value.count === 3, 'save normalizes and read-back proves the committed value');
  A.eq(store.load().value, { enabled: false, count: 3 }, 'load decodes the versioned envelope');

  store.save({ enabled: true, count: 7 });
  fs.writeFileSync(file, '{torn');
  const recovered = store.load();
  A.eq(recovered.status, 'recovered', 'corrupt main recovers from the durable last-good backup');
  A.eq(recovered.value, { enabled: false, count: 3 }, 'recovery returns the previous committed value');
  A.ok(issues.some(issue => issue.status === 'recovered'), 'recovery is observable to the host');

  fs.writeFileSync(file, JSON.stringify({ version: 1, config: { enabled: false, count: 9 } }));
  A.eq(store.load().value, { enabled: false, count: 9 }, 'explicit migration upgrades an older envelope before decode');

  fs.writeFileSync(file, JSON.stringify({ version: 2, nope: true }));
  const invalid = store.load();
  A.eq(invalid.status, 'invalid', 'invalid current envelope fails to defaults with explicit status');
  A.eq(invalid.value, { enabled: true, count: 0 }, 'invalid state never leaks a partial value');

  store.remove();
  A.ok(!fs.existsSync(file) && !fs.existsSync(file + '.bak'), 'remove clears main and recovery copy');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

A.report('domain-store.test');
