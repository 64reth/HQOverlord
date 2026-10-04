#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { startFixtureMcpServer, observeFixture } from './campaign/fixture-host.mjs';
import { startHermesDriver, startStarNetDriver } from './campaign/drivers.mjs';
import { validateManifest } from './bind.mjs';

function argsOf(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[String(argv[i] || '').replace(/^--/, '')] = argv[i + 1];
  return out;
}
function readJson(file) { return JSON.parse(readFileSync(resolve(file), 'utf8').replace(/^\uFEFF/, '')); }
function readJsonl(file) { return readFileSync(resolve(file), 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse); }

const opts = argsOf(process.argv.slice(2));
for (const name of ['harness', 'fixtures', 'manifest', 'output', 'output-dir']) if (!opts[name]) throw new Error(`missing --${name}`);
if (!['starnet', 'hermes'].includes(opts.harness)) throw new Error('--harness must be starnet or hermes');
const attempts = Number(opts.attempts || 3);
if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3) throw new Error('--attempts must be 1-3');
const timeoutMs = Number(opts['timeout-ms'] || 300000);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 1800000) throw new Error('--timeout-ms must be 1000-1800000');
validateManifest(readJson(opts.manifest));

let fixtures = readJsonl(opts.fixtures);
if (opts.tasks) {
  const selected = new Set(opts.tasks.split(',').map(value => value.trim()).filter(Boolean));
  fixtures = fixtures.filter(row => selected.has(row.taskId));
  const missing = [...selected].filter(id => !fixtures.some(row => row.taskId === id));
  if (missing.length) throw new Error('unknown selected task(s): ' + missing.join(', '));
}
if (!fixtures.length) throw new Error('no fixtures selected');

const output = resolve(opts.output), outputDir = resolve(opts['output-dir']);
mkdirSync(dirname(output), { recursive: true }); mkdirSync(outputDir, { recursive: true });
const existingRows = existsSync(output) ? readJsonl(output) : [];
const completed = new Set(existingRows.map(row => `${row.taskId}:${row.attempt}`));
const fixtureServer = await startFixtureMcpServer();
let driver = null, exitCode = 0;
async function openDriver() {
  if (opts.harness === 'starnet') {
    for (const name of ['runtime-root', 'workspaces']) if (!opts[name]) throw new Error(`StarNet requires --${name}`);
    return startStarNetDriver({ root: opts['runtime-root'], workspaces: opts.workspaces, fixtureUrl: fixtureServer.url, outputDir, port: opts.port, timeoutMs });
  }
  for (const name of ['source', 'python', 'home']) if (!opts[name]) throw new Error(`Hermes requires --${name}`);
  return startHermesDriver({ source: opts.source, python: opts.python, home: opts.home, fixtureUrl: fixtureServer.url, timeoutMs });
}
try {
  driver = await openDriver();
  console.log(`[agent-eval] CAMPAIGN ${opts.harness} ready ${driver.identity.provider}/${driver.identity.model} fixtures=${fixtures.length} attempts=${attempts}`);
  for (const fixture of fixtures) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const key = `${fixture.taskId}:${attempt}`;
      if (completed.has(key)) { console.log(`[agent-eval] SKIP ${key} already captured`); continue; }
      const root = mkdtempSync(join(outputDir, `${opts.harness}-${fixture.taskId}-a${attempt}-`));
      const state = fixtureServer.activate(fixture, root);
      let row, restartDriver = false;
      const runStartedAt = new Date().toISOString();
      try {
        row = await driver.run({ fixture, state, root, attempt });
      } catch (error) {
        exitCode = 1; restartDriver = true;
        const endedAt = new Date().toISOString(), host = observeFixture(state, '', { sessionId: `${opts.harness}-${fixture.taskId}-${attempt}`, agentId: 'agent' });
        row = {
          schemaVersion: 'starnet.eval.trajectory.v1', taskId: fixture.taskId, attempt,
          runId: `${opts.harness}-${fixture.taskId}-${attempt}`, startedAt: runStartedAt, endedAt, finalText: '',
          events: [{ seq: 1, at: endedAt, type: 'campaign.driver.error', data: { message: String(error.message || error).slice(0, 1000) } }],
          observation: Object.assign({}, host.observation, { claimedDone: false }), routing: host.routing, artifacts: host.artifacts,
          metrics: { model: 'gpt-5.6-luna', provider: 'openai-codex', driverError: true }, hostEvidence: { fixtureCalls: host.calls }
        };
      }
      appendFileSync(output, JSON.stringify(row) + '\n', 'utf8'); completed.add(key);
      const calls = row.hostEvidence?.fixtureCalls?.length || 0;
      console.log(`[agent-eval] CAPTURE ${opts.harness} ${key} calls=${calls} text=${row.finalText.length} error=${!!row.metrics?.driverError}`);
      if (opts['keep-workspaces'] !== '1') rmSync(root, { recursive: true, force: true });
      if (restartDriver) { await driver.close(); driver = await openDriver(); }
    }
  }
} finally {
  if (driver) await driver.close();
  await fixtureServer.close();
}
console.log(`[agent-eval] CAMPAIGN ${opts.harness} rows=${completed.size} output=${output}`);
process.exitCode = exitCode;
