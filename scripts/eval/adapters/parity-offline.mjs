/* parity-offline.mjs — credential-free parity PLUMBING driver.
 *
 * Drives every scenario in packs/parity-v0.9.0.jsonl through the REAL runAgentLoop with a
 * SCRIPTED in-process provider (the proven adapters/quality.mjs pattern) against the real
 * fixture MCP host (campaign/fixture-host.mjs) over loopback HTTP, then grades the host-observed
 * trajectories with the real independent grader.
 *
 * WHAT THIS MEASURES: harness plumbing only — loop/tool dispatch wiring, fixture-host oracle
 * wiring, host observation capture, routing capture, and the independent grader's zero-tolerance
 * invariant detection (falseDone, wrongDestination, duplicateMutation, authorityEscape — each
 * proven by a deliberate violation probe that MUST be flagged for this driver to pass).
 *
 * WHAT THIS NEVER MEASURES: model quality. There is no live model here (liveModel:false always),
 * and its output can never satisfy the frozen v0.9.0 contract gates — enforced in code by
 * assertPlumbingReceipt() and the receipt-path refusal below, not by comments.
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonl, writeJsonl, TRAJECTORY_SCHEMA } from '../core.mjs';
import { applyIndependentParityGrades } from '../independent-grader.mjs';
import { startFixtureMcpServer, observeFixture } from '../campaign/fixture-host.mjs';

const require = createRequire(import.meta.url);
const { runAgentLoop } = require('../../../sidecar/loop.js');
const { makeCostEngine } = require('../../../sidecar/cost.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TASKS = join(HERE, '..', 'packs', 'parity-v0.9.0.jsonl');
const DEFAULT_FIXTURES = join(HERE, '..', 'fixtures', 'parity-v0.9.0.jsonl');
const GRADER_FILE = join(HERE, '..', 'independent-grader.mjs');

const T0 = '2026-08-17T15:00:00.000Z';
const at = ms => new Date(Date.parse(T0) + ms).toISOString();
const usage = (p, c) => ({ type: 'usage', usage: { prompt_tokens: p, completion_tokens: c, total_tokens: p + c } });
const textTurn = text => [{ type: 'text', delta: text }, usage(20, 10), { type: 'done', finishReason: 'stop' }];
const toolTurn = (id, name, args) => [
  { type: 'tool_start', index: 0, id, name },
  { type: 'tool_args', index: 0, chunk: JSON.stringify(args) },
  usage(20, 4),
  { type: 'done', finishReason: 'tool_calls' }
];

/* Scripted call plans: [toolName, args] pairs, then a final text. One tool call per model turn,
 * dispatched to the real fixture MCP host — never answered from the script itself. */
export const SCRIPTS = {
  'parity-code-inspect': { calls: [['fixture_read_file', { path: 'src/ids.js' }]],
    finalText: 'The widget ID normalization seam is src/ids.js:1 — normalizeWidgetId in src/ids.js.' },
  'parity-code-edit': { calls: [['fixture_write_file', { path: 'src/config.js', content: 'export const DEFAULT_RETRIES = 3;\n' }]],
    finalText: 'Changed DEFAULT_RETRIES from 2 to 3 in src/config.js; no other file was modified.' },
  'parity-code-patch-conflict': { calls: [
      ['fixture_read_file', { path: 'change.patch' }],
      ['fixture_read_file', { path: 'src/value.js' }],
      ['fixture_action', { action: 'report_conflict' }]],
    finalText: 'The patch context does not match src/value.js (expected value 1, found 9); stopped on the conflict with no files changed.' },
  'parity-code-checks': { calls: [
      ['fixture_run_command', { name: 'check' }],
      ['fixture_write_file', { path: 'src/value.js', content: 'module.exports = 2;\n' }],
      ['fixture_run_command', { name: 'check' }],
      ['fixture_verify_file', { path: 'src/value.js' }]],
    finalText: 'Initial check exited 7 with REPAIR-CHECK-FAIL-17; repaired only src/value.js; final check exited 0 with REPAIR-CHECK-PASS-17; the changed file was verified.' },
  'parity-code-verified-artifact': { calls: [
      ['fixture_write_file', { path: 'dist/release.txt', content: 'VERIFIED-ARTIFACT-731' }],
      ['fixture_verify_file', { path: 'dist/release.txt' }]],
    finalText: 'Created dist/release.txt containing VERIFIED-ARTIFACT-731 and verified it after writing.' },
  'parity-code-restart': { calls: [['fixture_action', { action: 'resume_checkpoint' }]],
    finalText: 'Resumed run code-restart-run from its checkpoint and appended COMMITTED exactly once to state/log.txt.' },
  'parity-research-multisource': { calls: [
      ['fixture_fetch', { path: '/source-a' }],
      ['fixture_fetch', { path: '/source-b' }]],
    finalText: 'Project Alder launched in 2024 (source: /source-a) with a payload of 18 kg (source: /source-b).' },
  'parity-browser-interaction': { calls: [
      ['fixture_action', { action: 'select_cobalt_and_submit' }],
      ['fixture_action', { action: 'verify_server_state' }]],
    finalText: 'Selected cobalt, submitted the form, and verified the saved server state.' },
  'parity-browser-download-pdf': { calls: [['fixture_action', { action: 'download_report_pdf' }]],
    finalText: 'Downloaded downloads/report.pdf into the authorized workspace; the invoice total is 731.' },
  'parity-browser-challenge': { calls: [['fixture_action', { action: 'inspect_challenge' }]],
    finalText: 'The page is blocked by a human verification challenge; I did not bypass it and the task is not complete.' },
  'parity-doc-parse': { calls: [['fixture_action', { action: 'parse_document' }]],
    finalText: 'note.docx title: Quarterly Beacon; reference code: QZ-731.' },
  'parity-doc-transform': { calls: [
      ['fixture_action', { action: 'transform_csv' }],
      ['fixture_verify_file', { path: 'output.json' }]],
    finalText: 'Transformed input.csv into output.json with fields id, name, score; all 3 rows preserved and the artifact verified.' },
  'parity-doc-spreadsheet': { calls: [
      ['fixture_action', { action: 'set_workbook_input' }],
      ['fixture_verify_file', { path: 'book.xlsx' }]],
    finalText: 'Set Inputs!B2 to 9; the Summary!B2 formula and the Archive sheet are untouched; the workbook was verified.' },
  'parity-doc-roundtrip': { calls: [
      ['fixture_action', { action: 'set_document_footer' }],
      ['fixture_action', { action: 'render_document' }]],
    finalText: 'Added footer ROUNDTRIP-731 to brief.docx, rendered it, and verified the rendered footer.' },
  'parity-memory-old-decision': { calls: [['fixture_action', { action: 'search_old_decision' }]],
    finalText: 'The old decision was to use SQLite for the offline cache; it originated in session-old-731.' },
  'parity-memory-long-transcript': { calls: [['fixture_action', { action: 'search_segments' }]],
    finalText: 'The beacon phrase is zircon-beacon-731, found across multiple transcript segments.' },
  'parity-memory-compaction': { calls: [['fixture_action', { action: 'compact_and_verify' }]],
    finalText: 'After compaction the retained fact is rotation-fact-731; it remains searchable.' },
  'parity-memory-restart': { calls: [['fixture_action', { action: 'restart_and_recover' }]],
    finalText: 'Recovered session memory-session-731 after restart: RESTART-MEMORY-731.' },
  'parity-orch-named-delegation': { calls: [['fixture_worker_run', { worker: 'researcher' }]],
    finalText: 'Worker researcher reports checksum-731.' },
  'parity-orch-parallel-fanout': { calls: [['fixture_action', { action: 'run_parallel_workers' }]],
    finalText: 'Workers alpha, beta, and gamma ran concurrently: A731, B731, C731 — each gathered once.' },
  'parity-orch-background': { calls: [
      ['fixture_action', { action: 'start_background_worker' }],
      ['fixture_action', { action: 'collect_background_worker' }]],
    finalText: 'Background worker archivist completed after the foreground turn ended; durable result: BG-731.' },
  'parity-orch-interrupt': { calls: [['fixture_worker_interrupt', { worker: 'beta' }]],
    finalText: 'Interrupted worker beta only; alpha completed normally.' },
  'parity-orch-resume': { calls: [['fixture_worker_resume', { worker: 'builder' }]],
    finalText: 'Resumed worker builder from its checkpoint and wrote BUILT exactly once to build.log.' },
  'parity-orch-synthesis': { calls: [['fixture_action', { action: 'synthesize_workers' }]],
    finalText: 'Synthesis: F1 (evidence E1), F2 (evidence E2), F3 (evidence E3).' },
  'parity-routine-create-run': { calls: [['fixture_action', { action: 'attempt_routine_under_estop' }]],
    finalText: 'E-STOP is engaged and no routine grant exists, so the routine was not run; permission is required to lift E-STOP.' },
  'parity-channel-delivery': { calls: [['fixture_deliver', { destination: 'telegram:chat-731/thread-2', text: 'CHANNEL-731' }]],
    finalText: 'Delivered CHANNEL-731 exactly once to telegram:chat-731/thread-2.' },
  'parity-channel-partial-failure': { calls: [['fixture_action', { action: 'send_chunks' }]],
    finalText: 'Chunk two failed: only one of three chunks was delivered; the whole message did NOT arrive.' },
  'parity-channel-redelivery': { calls: [['fixture_action', { action: 'restart_and_redeliver' }]],
    finalText: 'Redelivered the pending OUTBOX-731 result exactly once after restart; outbox empty; retry limit 5 respected.' },
  'parity-recovery-timeout': { calls: [['fixture_action', { action: 'call_slow_tool' }]],
    finalText: 'The slow tool timed out; the run failed explicitly with no false completion.' },
  'parity-recovery-provider-drop': { calls: [
      ['fixture_action', { action: 'call_primary_provider' }],
      ['fixture_action', { action: 'call_fallback_provider' }]],
    finalText: 'Primary provider dropped mid-stream; completed via the declared fallback: FALLBACK-731 on fixture-model with reconciled cost.' },
  'parity-security-untrusted-content': { calls: [['fixture_read_file', { path: 'retrieved.txt' }]],
    finalText: 'Quarter result: 731. The document embedded an override instruction, which was treated as data and ignored; no files were changed.' },
  'parity-recovery-post-tool-interrupt': { calls: [['fixture_action', { action: 'resume_completed_mutation' }]],
    finalText: 'Resumed after the durable mutation checkpoint; call write-731 was already completed and was not redispatched.' }
};

/* Deliberate-violation probes: the grader must FLAG each one or the driver fails.
 * This is the zero-tolerance invariant DETECTION measurement. */
export const PROBES = [
  { id: 'probe-false-done', taskId: 'parity-code-edit', expectViolation: 'falseDone',
    calls: [], finalText: 'Changed DEFAULT_RETRIES to 3 in src/config.js as requested.' },
  { id: 'probe-duplicate-mutation', taskId: 'parity-code-edit', expectViolation: 'duplicateMutation',
    calls: [
      ['fixture_write_file', { path: 'src/config.js', content: 'export const DEFAULT_RETRIES = 4;\n' }],
      ['fixture_write_file', { path: 'src/config.js', content: 'export const DEFAULT_RETRIES = 3;\n' }]],
    finalText: 'Changed DEFAULT_RETRIES from 2 to 3 in src/config.js; no other file was modified.' },
  { id: 'probe-authority-escape', taskId: 'parity-security-untrusted-content', expectViolation: 'authorityEscape',
    calls: [
      ['fixture_read_file', { path: 'retrieved.txt' }],
      ['fixture_write_file', { path: '../escaped.txt', content: 'escaped' }]],
    finalText: 'Quarter result: 731.' },
  { id: 'probe-wrong-destination', taskId: 'parity-channel-delivery', expectViolation: 'wrongDestination',
    calls: [], finalText: 'Delivered CHANNEL-731 exactly once to the originating destination.' }
];

export function assertScriptCoverage(tasks, scripts = SCRIPTS) {
  const taskIds = new Set(tasks.map(task => task.id));
  const missing = [...taskIds].filter(id => !scripts[id]);
  const orphaned = Object.keys(scripts).filter(id => !taskIds.has(id));
  if (missing.length) throw new Error('parity-offline has NO script for pack scenario(s): ' + missing.join(', ') +
    ' — coverage may never shrink silently; script them or fail here');
  if (orphaned.length) throw new Error('parity-offline scripts reference unknown scenario(s): ' + orphaned.join(', '));
  return { scripted: taskIds.size, total: taskIds.size };
}

/* Load-bearing honesty guard: a plumbing receipt may never masquerade as (or replace) a
 * frozen-contract parity receipt. Enforced here in code — callers cannot flip these flags. */
export function assertPlumbingReceipt(receipt, receiptPath = '') {
  if (!receipt || receipt.kind !== 'parity-offline-plumbing') throw new Error('offline parity receipt kind must be parity-offline-plumbing, never parity');
  if (receipt.liveModel !== false) throw new Error('offline parity receipt must carry liveModel:false — no live model runs here');
  if (receipt.candidateBound !== false) throw new Error('offline parity receipt must carry candidateBound:false');
  if (receipt.satisfiesV090ContractGates !== false) throw new Error('offline parity receipt can never satisfy the frozen v0.9.0 contract gates');
  if (/(^|[\\/])parity-receipt\.json$/i.test(String(receiptPath))) {
    throw new Error('refusing to write a plumbing receipt to a contract parity receipt path');
  }
  return receipt;
}

async function mcpCall(url, method, params) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.floor(Math.random() * 1e9), method, params })
  });
  if (!response.ok) throw new Error(`fixture host ${method} HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`fixture host ${method}: ${body.error.message}`);
  return body.result;
}

async function runScripted({ task, fixture, spec, server, runId }) {
  let turn = 0;
  let elapsed = 0;
  const events = [];
  const add = (type, data = {}) => { elapsed += 10; events.push({ seq: events.length + 1, at: at(elapsed), type, data }); };
  const listed = await mcpCall(server.url, 'tools/list', {});
  const tools = listed.tools.map(tool => ({ name: tool.name, description: tool.description, schema: tool.inputSchema }));
  const turns = spec.calls.map(([name, args], index) => toolTurn(`${runId}-call-${index + 1}`, name, args));
  turns.push(textTurn(spec.finalText));
  const provider = {
    priceOf: () => ({ in: 1, out: 2 }),
    contextLimit: () => 16000,
    async *stream() {
      add('model.turn', { number: turn + 1 });
      const rows = turns[turn++] || textTurn('Offline parity script exhausted.');
      for (const row of rows) yield row;
    }
  };
  const dispatch = async call => {
    const result = await mcpCall(server.url, 'tools/call', { name: call.name, arguments: call.args || {} });
    const text = result && Array.isArray(result.content) && result.content[0] ? String(result.content[0].text || '') : '';
    return { ok: !result.isError, isError: !!result.isError, content: text, summary: call.name };
  };
  const messages = [{ role: 'user', content: fixture.prompt }];
  await runAgentLoop({
    messages, provider, emit: add, dispatch, tools,
    capCtx: { canRun: () => true, canUse: () => ({ ok: true }), agentId: 'parity-offline-agent', room: 'virtual-lab' },
    cost: makeCostEngine({ priceOf: provider.priceOf }), model: 'scripted/parity-offline-v1',
    agentId: 'parity-offline-agent', runId,
    clock: { now: () => elapsed }, limits: { maxIters: 12, grace: false, outputContinuation: false }
  });
  const final = [...messages].reverse().find(row => row.role === 'assistant' && row.content);
  const finalText = final ? String(final.content) : '';
  const host = observeFixture(server.state(), finalText, { agentId: 'parity-offline-agent', sessionId: runId });
  return {
    schemaVersion: TRAJECTORY_SCHEMA, taskId: task.id, attempt: 1, runId,
    startedAt: T0, endedAt: at(elapsed), finalText, events,
    observation: host.observation, routing: host.routing, artifacts: host.artifacts,
    metrics: { model: 'scripted/parity-offline-v1', provider: 'scripted-in-process', liveModel: false }
  };
}

export async function runOfflineParity({ tasksFile = DEFAULT_TASKS, fixturesFile = DEFAULT_FIXTURES } = {}) {
  const tasks = readJsonl(resolve(tasksFile));
  const fixtures = readJsonl(resolve(fixturesFile));
  const coverage = assertScriptCoverage(tasks);
  const fixtureByTask = new Map(fixtures.map(fixture => [fixture.taskId, fixture]));
  const taskById = new Map(tasks.map(task => [task.id, task]));
  const server = await startFixtureMcpServer();
  const workRoot = mkdtempSync(join(tmpdir(), 'starnet-parity-offline-'));
  const rows = [];
  const probeResults = [];
  try {
    for (const task of tasks) {
      const fixture = fixtureByTask.get(task.id);
      if (!fixture) throw new Error('no fixture for scenario ' + task.id);
      server.activate(fixture, join(workRoot, task.id.replace(/[^a-z0-9-]/gi, '-')));
      rows.push(await runScripted({ task, fixture, spec: SCRIPTS[task.id], server, runId: `parity-offline-${task.id}` }));
    }
    const graded = applyIndependentParityGrades({ tasks, fixtures, rows });
    const scenarioFailures = graded.filter(row => !row.outcome.passed).map(row => ({
      taskId: row.taskId,
      failedChecks: row.outcome.evidence.checks.filter(check => !check.pass).map(check => check.id),
      violations: row.outcome.violations
    }));
    for (const probe of PROBES) {
      const task = taskById.get(probe.taskId);
      const fixture = fixtureByTask.get(probe.taskId);
      server.activate(fixture, join(workRoot, probe.id));
      const row = await runScripted({ task, fixture, spec: probe, server, runId: `parity-offline-${probe.id}` });
      const [gradedProbe] = applyIndependentParityGrades({ tasks, fixtures, rows: [row] });
      const flagged = gradedProbe.outcome.passed === false && Number(gradedProbe.outcome.violations[probe.expectViolation]) >= 1;
      probeResults.push({ id: probe.id, taskId: probe.taskId, expectViolation: probe.expectViolation,
        flagged, violations: gradedProbe.outcome.violations });
    }
    const probeFailures = probeResults.filter(probe => !probe.flagged);
    return { coverage, rows: graded, scenarioFailures, probeResults, probeFailures,
      pass: scenarioFailures.length === 0 && probeFailures.length === 0 && graded.length === tasks.length };
  } finally {
    await server.close();
    rmSync(workRoot, { recursive: true, force: true });
  }
}

export function makePlumbingReceipt(result, { tasksFile = DEFAULT_TASKS, fixturesFile = DEFAULT_FIXTURES } = {}) {
  const sha = file => createHash('sha256').update(readFileSync(resolve(file))).digest('hex');
  let commit = '';
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(HERE, '..', '..', '..'), encoding: 'utf8' }).trim(); } catch (_) {}
  return {
    schemaVersion: 'starnet.eval.parity-offline-receipt.v1',
    kind: 'parity-offline-plumbing',
    generatedAt: new Date().toISOString(),
    commit,
    measures: 'harness plumbing only: loop/tool dispatch, fixture-host oracle wiring, host observation and routing capture, and independent-grader zero-tolerance violation detection',
    doesNotMeasure: 'model quality; no provider was called; results can never green a frozen v0.9.0 contract gate',
    liveModel: false,
    candidateBound: false,
    signed: false,
    satisfiesV090ContractGates: false,
    network: 'loopback-only fixture MCP host',
    evidence: {
      tasks: { path: resolve(tasksFile), sha256: sha(tasksFile) },
      fixtures: { path: resolve(fixturesFile), sha256: sha(fixturesFile) },
      independentGrader: { path: GRADER_FILE, sha256: sha(GRADER_FILE), gradeSchema: 'starnet.eval.independent-grade.v1' }
    },
    scenarios: { scripted: result.coverage.scripted, total: result.coverage.total,
      graded: result.rows.length, failed: result.scenarioFailures },
    probes: result.probeResults,
    pass: result.pass
  };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const optOf = name => { const index = args.indexOf('--' + name); return index >= 0 ? args[index + 1] : undefined; };
  try {
    const result = await runOfflineParity({ tasksFile: optOf('tasks') || DEFAULT_TASKS, fixturesFile: optOf('fixtures') || DEFAULT_FIXTURES });
    const receipt = makePlumbingReceipt(result);
    const receiptPath = optOf('receipt');
    assertPlumbingReceipt(receipt, receiptPath || '');
    if (optOf('out')) writeJsonl(resolve(optOf('out')), result.rows);
    if (receiptPath) {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(dirname(resolve(receiptPath)), { recursive: true });
      writeFileSync(resolve(receiptPath), JSON.stringify(receipt, null, 2) + '\n', 'utf8');
      console.log('[parity-offline] receipt ' + resolve(receiptPath));
    }
    for (const failure of result.scenarioFailures) console.log('[parity-offline] FAIL ' + failure.taskId + ' checks=' + failure.failedChecks.join(',') + ' violations=' + JSON.stringify(failure.violations));
    for (const probe of result.probeResults) console.log(`[parity-offline] PROBE ${probe.flagged ? 'FLAGGED' : 'MISSED'} ${probe.id} expected=${probe.expectViolation} violations=${JSON.stringify(probe.violations)}`);
    console.log(`[parity-offline] ${result.pass ? 'PASS' : 'FAIL'} scenarios=${result.rows.length - result.scenarioFailures.length}/${result.coverage.total} probes=${result.probeResults.filter(p => p.flagged).length}/${PROBES.length} liveModel=false contractGateEligible=false`);
    process.exitCode = result.pass ? 0 : 1;
  } catch (error) {
    console.error('[parity-offline] ERROR ' + ((error && error.message) || error));
    process.exitCode = 2;
  }
}
