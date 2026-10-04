'use strict';
// Test-only fault injector: make the durable replace of connectors/state.json fail while leaving every other
// store writable. Loaded only in the connector security E2E child through NODE_OPTIONS.
const fs = require('node:fs');
const path = require('node:path');
const renameSync = fs.renameSync;
fs.renameSync = function (source, destination) {
  const normalized = path.normalize(String(destination));
  if (process.env.STARNET_TEST_FAIL_CONNECTOR_STATE === '1' && /[\\/]connectors[\\/]state\.json$/.test(normalized)) {
    const error = new Error('synthetic connector state write failure');
    error.code = 'EACCES';
    throw error;
  }
  return renameSync.apply(this, arguments);
};
