'use strict';

const path = require('node:path');

// Keep this foundation's Station separate from StarNet and the archived HQ runtime.
if (!process.env.STARNET_WORKSPACES) {
  const stationRoot = path.resolve(__dirname, '..', '.local', 'starnet-foundation');
  process.env.STARNET_WORKSPACES = path.join(stationRoot, 'workspaces');
  // StarNet already provides this guard against automatic legacy Station imports.
  process.env.STARNET_SCRATCH_ROOT = [process.env.STARNET_SCRATCH_ROOT, stationRoot].filter(Boolean).join(path.delimiter);
}
process.env.STARNET_PORT ||= '8789';
require('../sidecar/index.js');
