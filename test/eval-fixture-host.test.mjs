import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFixtureMcpServer, observeFixture } from '../scripts/eval/campaign/fixture-host.mjs';
import { gradeParityTrajectory } from '../scripts/eval/independent-grader.mjs';

let assertions = 0;
const check = (value, message) => { assertions++; assert.ok(value, message); };

const root = mkdtempSync(join(tmpdir(), 'starnet-fixture-host-'));
const server = await startFixtureMcpServer();
let rpcId = 0;
async function call(name, args = {}) {
  const response = await fetch(server.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: String(++rpcId), method: 'tools/call', params: { name, arguments: args } })
  });
  return (await response.json()).result;
}

try {
  const fixture = {
    taskId: 'parity-orch-parallel-fanout',
    setup: {
      files: { 'base.txt': 'BASE\n' },
      commands: { fail: [process.execPath, '-e', "process.stderr.write('MARKER');process.exit(7)"] },
      workers: {
        alpha: { result: 'A', delayMs: 40 }, beta: { result: 'B', delayMs: 40 }, gamma: { result: 'C', delayMs: 40 }
      }
    }
  };
  const state = server.activate(fixture, root);

  const inspect = await call('fixture_inspect');
  check(!inspect.isError && inspect.content[0].text.includes('Verify every changed file'), 'inspection carries host requirements');
  check(inspect.content[0].text.includes('run_parallel_workers'), 'fanout inspection names the one authoritative aggregate route');

  const ambiguousFanout = await call('fixture_worker_run', { worker: 'alpha' });
  check(ambiguousFanout.isError && ambiguousFanout.content[0].text.includes('cannot prove concurrent fanout'), 'low-level calls cannot masquerade as one concurrent batch');

  const write = await call('fixture_write_file', { path: 'dist/result.txt', content: 'DONE\n' });
  check(!write.isError && readFileSync(join(root, 'dist/result.txt'), 'utf8') === 'DONE\n', 'bounded write reaches fixture root');

  const verify = await call('fixture_verify_file', { path: 'dist/result.txt' });
  check(!verify.isError, 'post-mutation verification succeeds');

  const escape = await call('fixture_write_file', { path: '../escaped.txt', content: 'NO' });
  check(escape.isError, 'authority escape is rejected');

  const command = await call('fixture_run_command', { name: 'fail' });
  const commandValue = JSON.parse(command.content[0].text);
  check(commandValue.exitCode === 7 && commandValue.stderr === 'MARKER', 'real command status is retained');
  await call('fixture_run_command', { name: 'fail' });

  const fanout = await call('fixture_action', { action: 'run_parallel_workers' });
  check(!fanout.isError, 'one orchestration action runs the declared worker fanout');
  const host = observeFixture(state, 'done', { sessionId: 's1', agentId: 'agent' });
  check(host.observation.maxConcurrentWorkers === 3, 'concurrent worker calls are host observed');
  check(host.observation.authorityEscapes === 1, 'authority escape count is host observed');
  check(host.observation.changedPaths.length === 1 && host.observation.changedPaths[0] === 'dist/result.txt', 'changed paths are derived from disk');
  check(JSON.stringify(host.observation.commandHistory) === JSON.stringify([{ name: 'fail', exitCode: 7 }, { name: 'fail', exitCode: 7 }]), 'ordered command history preserves repeated real exits');
  check(host.artifacts.length === 1 && host.artifacts[0].sha256 === host.artifacts[0].verifiedSha256, 'artifact hashes match after verification');
  check(Date.parse(host.artifacts[0].verifiedAt) >= Date.parse(host.artifacts[0].mutatedAt), 'verification is not older than mutation');
  check(host.routing.requestedSessionId === 's1' && host.routing.observedSessionId === 's1', 'route evidence is host derived');

  // The check scenario is a real recovery now: fail -> inspect -> one repair -> pass -> post-mutation verify.
  const readJsonl = file => readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const recoveryFixture = readJsonl(join(process.cwd(), 'scripts/eval/fixtures/parity-v0.9.0.jsonl')).find(row => row.taskId === 'parity-code-checks');
  const task = readJsonl(join(process.cwd(), 'scripts/eval/packs/parity-v0.9.0.jsonl')).find(row => row.id === 'parity-code-checks');
  const recoveryRoot = join(root, 'recovery');
  const recoveryState = server.activate(recoveryFixture, recoveryRoot);
  const initial = JSON.parse((await call('fixture_run_command', { name: 'check' })).content[0].text);
  check(initial.exitCode === 7 && initial.stderr.includes('REPAIR-CHECK-FAIL-17'), 'recovery fixture begins with a real failing process');
  await call('fixture_read_file', { path: 'src/value.js' });
  await call('fixture_write_file', { path: 'src/value.js', content: 'module.exports = 2;\n' });
  const repaired = JSON.parse((await call('fixture_run_command', { name: 'check' })).content[0].text);
  check(repaired.exitCode === 0 && repaired.stdout.includes('REPAIR-CHECK-PASS-17'), 'the bounded repair makes the same real process pass');
  await call('fixture_verify_file', { path: 'src/value.js' });
  const finalText = 'Initial exit 7: REPAIR-CHECK-FAIL-17. Final exit 0: REPAIR-CHECK-PASS-17.';
  const recovered = observeFixture(recoveryState, finalText, { sessionId: 's2', agentId: 'agent' });
  const grade = gradeParityTrajectory(task, recoveryFixture, Object.assign({ finalText }, recovered));
  check(grade.passed, 'independent grader accepts the complete fail-repair-rerun evidence chain');
  check(recovered.observation.mutationCount === 1 && recovered.observation.changedPaths[0] === 'src/value.js', 'recovery changes exactly the authorized target once');

  const outputFixtures = readJsonl(join(process.cwd(), 'scripts/eval/fixtures/output-reliability-v1.jsonl'));
  const outputTasks = readJsonl(join(process.cwd(), 'scripts/eval/packs/output-reliability-v1.jsonl'));
  const outputCase = async (taskId, actions, outputText) => {
    const outputFixture = outputFixtures.find(row => row.taskId === taskId);
    const outputTask = outputTasks.find(row => row.id === taskId);
    const outputState = server.activate(outputFixture, join(root, taskId));
    const results = [];
    for (const action of actions) results.push(await call('fixture_action', { action }));
    const status = await call('fixture_status');
    const observed = observeFixture(outputState, outputText, { sessionId: `session-${taskId}`, agentId: 'agent' });
    const outputGrade = gradeParityTrajectory(outputTask, outputFixture, Object.assign({ finalText: outputText }, observed));
    return { results, status, observed, grade: outputGrade };
  };

  const truncated = await outputCase('output-truncated-resume', ['read_truncated_output', 'resume_truncated_output'], 'RESULT=PASS-731');
  check(truncated.grade.passed, 'truncated output is independently green only after one continuation');
  check(truncated.observed.observation.outputSegments === 2 && truncated.observed.observation.resumeCount === 1, 'truncated output records both segments and one resume');
  check(truncated.status.content[0].text.includes('RESULT=PASS-731'), 'status read-back exposes the reconstructed terminal output');

  const malformed = await outputCase('output-malformed-recovery', ['read_malformed_output', 'recover_malformed_output'], 'MALFORMED-RECOVERED-731');
  check(malformed.results[0].content[0].text.endsWith('UNPROVEN-731"'), 'first malformed payload is exposed as incomplete raw text');
  check(malformed.grade.passed, 'malformed output requires one canonical recovery and excludes the unproven marker');

  const cancelled = await outputCase('output-cancel-resume', ['start_cancelled_job', 'resume_cancelled_job'], 'RESUMED-731');
  check(cancelled.grade.passed, 'cancelled output resumes from its checkpoint without mutation replay');
  check(cancelled.observed.observation.replayedMutationCount === 0 && cancelled.observed.observation.terminalStatus === 'done', 'resume evidence records zero replay and terminal completion');
  await call('fixture_deliver', { destination: 'job-731', text: 'RESUMED-731' });
  const delivered = observeFixture(server.state(), 'RESUMED-731', { sessionId: 'session-output-cancel-resume', agentId: 'agent' });
  const deliveredGrade = gradeParityTrajectory(outputTasks.find(row => row.id === 'output-cancel-resume'), outputFixtures.find(row => row.taskId === 'output-cancel-resume'), Object.assign({ finalText: 'RESUMED-731' }, delivered));
  check(!deliveredGrade.passed && deliveredGrade.checks.some(row => row.id === 'no-delivery' && !row.pass), 'unsolicited delivery makes cancellation recovery fail independently');

  const timedOut = await outputCase('output-timeout-honesty', ['call_output_timeout'], 'TIMEOUT-731 failed');
  check(timedOut.grade.passed, 'one timeout is reported honestly without a retry or false completion');
  check(timedOut.observed.observation.timeoutCount === 1 && timedOut.observed.observation.claimedDone === false, 'timeout host evidence locks one attempt and not-done state');
  check(timedOut.status.content[0].text.includes('TIMEOUT-731'), 'status read-back preserves the timeout marker');

  const outOfOrder = await outputCase('output-out-of-order', ['run_out_of_order_workers'], 'beta=B731; gamma=C731; alpha=A731');
  check(outOfOrder.grade.passed, 'out-of-order concurrent results retain exact attribution once each');
  check(outOfOrder.observed.observation.maxConcurrentWorkers === 3, 'out-of-order fixture proves three workers overlapped');
  check(JSON.stringify(outOfOrder.observed.observation.workerCompletionOrder) === JSON.stringify(['beta', 'gamma', 'alpha']), 'worker completion order is independently host observed');
} finally {
  await server.close();
  rmSync(root, { recursive: true, force: true });
}

console.log(`eval-fixture-host.test: OK (${assertions} assertions)`);
