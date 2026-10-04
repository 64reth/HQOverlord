'use strict';

const A = require('./_assert.js');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { SidecarFixture, allocatePort, processAlive } = require('./helpers/sidecar-fixture.js');

(async () => {
  const firstPort = await allocatePort();
  const secondPort = await allocatePort();
  A.ok(firstPort > 0 && secondPort > 0, 'port allocation asks the OS for valid ephemeral ports');

  const blocker = net.createServer();
  await new Promise((resolve, reject) => { blocker.once('error', reject); blocker.listen(0, '127.0.0.1', resolve); });
  const occupiedPort = blocker.address().port;
  let allocationCalls = 0;
  const retrying = SidecarFixture.create({
    prefix: 'starnet-fixture-bind-retry-',
    timeoutMs: 9000,
    portAllocator: async () => (++allocationCalls === 1 ? occupiedPort : allocatePort())
  });
  try {
    await retrying.start({ OPENROUTER_KEY: '', STARNET_OPENROUTER_KEY: '', SKYNET_OPENROUTER_KEY: '' });
    A.eq(allocationCalls, 2, 'fixture retries with a fresh OS port when the reserved port loses the bind race');
    A.ok(retrying.port !== occupiedPort, 'bind retry does not reuse the occupied port');
  } finally {
    await retrying.dispose();
    if (typeof blocker.closeAllConnections === 'function') blocker.closeAllConnections();
    blocker.close();
  }

  const healthy = SidecarFixture.create({ prefix: 'starnet-fixture-self-' });
  const healthyWorkspace = healthy.workspace;
  await healthy.start({ OPENROUTER_KEY: '', STARNET_OPENROUTER_KEY: '', SKYNET_OPENROUTER_KEY: '' });
  const healthyPid = healthy.child.pid;
  A.ok(healthy.token.length >= 32, 'fixture waits for health and acquires the browser boot token');
  A.eq((await healthy.json('GET', '/api/health')).status, 200, 'authenticated JSON helper reaches the running sidecar');
  await healthy.dispose();
  A.ok(!processAlive(healthyPid), 'dispose waits for the sidecar process to exit');
  A.ok(!fs.existsSync(healthyWorkspace), 'dispose removes the owned temporary workspace');

  const failing = SidecarFixture.create({ prefix: 'starnet-fixture-fail-', timeoutMs: 150, acquireToken: false });
  const failingWorkspace = failing.workspace;
  const neverReady = path.join(failing.workspace, 'never-ready.js');
  fs.writeFileSync(neverReady, 'setInterval(() => {}, 1000);\n');
  failing.entry = neverReady;
  let failed = false;
  let failingPid = 0;
  try {
    const pending = failing.start();
    while (!failing.child) await new Promise(resolve => setTimeout(resolve, 5));
    failingPid = failing.child.pid;
    await pending;
  } catch (error) {
    failed = /readiness timed out/.test(String(error && error.message));
  }
  A.ok(failed, 'a child that never becomes healthy fails with a readiness timeout');
  A.ok(!processAlive(failingPid), 'readiness failure terminates the child process');
  A.ok(!fs.existsSync(failingWorkspace), 'readiness failure removes the temporary workspace');

  A.report('sidecar-fixture.test');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
