#!/usr/bin/env node
// timeout.mjs - run one command with a hard process-tree timeout.

import { runBoundedCommand, coerceTimeoutMs } from './lib/run-command.mjs';

const raw = process.argv.slice(2);
let timeoutMs = coerceTimeoutMs(process.env.STARNET_TIMEOUT_MS || 600000);
let label = '';
const cmdArgs = [];

for (let i = 0; i < raw.length; i++) {
  const arg = raw[i];
  if (arg === '--') {
    cmdArgs.push(...raw.slice(i + 1));
    break;
  }
  if (arg === '--timeout') {
    timeoutMs = coerceTimeoutMs(raw[++i], timeoutMs);
    continue;
  }
  if (arg.startsWith('--timeout=')) {
    timeoutMs = coerceTimeoutMs(arg.slice('--timeout='.length), timeoutMs);
    continue;
  }
  if (arg === '--label') {
    label = raw[++i] || label;
    continue;
  }
  if (arg.startsWith('--label=')) {
    label = arg.slice('--label='.length);
    continue;
  }
  cmdArgs.push(...raw.slice(i));
  break;
}

if (!cmdArgs.length) {
  console.error('usage: node scripts/timeout.mjs --timeout=600000 -- <command> [args...]');
  process.exit(2);
}

const [cmd, ...args] = cmdArgs;
const result = await runBoundedCommand({
  cmd,
  args,
  cwd: process.cwd(),
  env: process.env,
  timeoutMs,
  label: label || cmdArgs.join(' '),
  inherit: true
});
process.exit(result.exitCode);
