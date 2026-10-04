'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const A = require('./_assert.js');

(async () => {
  const root = path.resolve(__dirname, '..');
  const runner = await import(pathToFileURL(path.join(root, 'scripts', 'run-test-list.mjs')).href);
  for (const name of ['fast.list', 'http.list']) {
    const steps = runner.readSteps(path.join(__dirname, name));
    A.ok(steps.length > 0, name + ' contains runnable steps');
    A.eq(new Set(steps).size, steps.length, name + ' contains no duplicate suite');
    A.ok(steps.every(step => fs.existsSync(path.join(root, step))), name + ' references only existing files');
  }
  const http = runner.readSteps(path.join(__dirname, 'http.list'));
  A.eq(http[0], 'test/provider-recovery.e2e.test.js', 'provider production-composition proof is part of the HTTP manifest');
  A.ok(http.includes('test/sidecar.http.test.js') && http.includes('test/openai-compat.e2e.test.js'), 'HTTP manifest retains route coverage');
  A.report('test-list-runner.test');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
