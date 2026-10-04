import { createRequire } from 'node:module';
import { sha256Text, TRAJECTORY_SCHEMA } from '../core.mjs';

const require = createRequire(import.meta.url);
const { runAgentLoop } = require('../../../sidecar/loop.js');
const { makeCostEngine } = require('../../../sidecar/cost.js');

const T0 = '2026-08-03T15:00:00.000Z';
const at = ms => new Date(Date.parse(T0) + ms).toISOString();
const usage = (prompt, completion) => ({
  type: 'usage', usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion }
});
const textTurn = (text, promptTokens = 20, completionTokens = 10) => [
  { type: 'text', delta: text }, usage(promptTokens, completionTokens), { type: 'done', finishReason: 'stop' }
];
const toolTurn = (id, name, args, promptTokens = 20, completionTokens = 4) => [
  { type: 'tool_start', index: 0, id, name },
  { type: 'tool_args', index: 0, chunk: JSON.stringify(args) },
  usage(promptTokens, completionTokens),
  { type: 'done', finishReason: 'tool_calls' }
];

function safeTools(names) {
  return names.map(name => ({ name, description: `benchmark-only virtual tool ${name}`, schema: { type: 'object' } }));
}

async function runScenario(spec) {
  let turn = 0;
  let elapsed = 0;
  let externalDispatches = 0;
  const events = [];
  const virtualState = new Map();
  const add = (type, data = {}) => {
    elapsed += 10;
    events.push({ seq: events.length + 1, at: at(elapsed), type, data });
  };
  const provider = {
    priceOf: () => ({ in: 1, out: 2 }),
    contextLimit: () => 8000,
    async *stream() {
      add('model.turn', { number: turn + 1 });
      const rows = spec.turns[turn++] || textTurn('Benchmark fixture exhausted.', 1, 1);
      for (const row of rows) yield row;
    }
  };
  const dispatch = async call => {
    const def = spec.tools[call.name];
    if (!def) return { ok: false, isError: true, content: 'benchmark tool is not allowlisted', summary: 'blocked' };
    if (def.external) {
      externalDispatches++;
      return { ok: false, isError: true, content: 'external side effects are disabled in agent-quality benchmarks', summary: 'blocked external side effect' };
    }
    return def.run(call.args || {}, virtualState);
  };
  const messages = [{ role: 'user', content: spec.prompt }];
  const result = await runAgentLoop({
    messages, provider, emit: add, dispatch, tools: safeTools(Object.keys(spec.tools)),
    capCtx: { canRun: () => true, canUse: () => ({ ok: true }), agentId: 'benchmark-agent', room: 'virtual-lab' },
    cost: makeCostEngine({ priceOf: provider.priceOf }), model: 'replay/quality-v1',
    agentId: 'benchmark-agent', runId: 'quality-' + spec.id,
    clock: { now: () => elapsed }, limits: { maxIters: 8, grace: false, outputContinuation: false }
  });
  const final = [...messages].reverse().find(row => row.role === 'assistant' && row.content);
  add('quality.safety', { externalDispatches, virtualOnly: true });
  const extra = spec.inspect ? spec.inspect({ virtualState, messages, result }) : {};
  for (const row of extra.events || []) add(row.type, row.data);
  const endedAt = at(elapsed);
  return {
    schemaVersion: TRAJECTORY_SCHEMA,
    taskId: spec.id,
    runId: 'adapter-' + spec.id,
    startedAt: T0,
    endedAt,
    finalText: final ? final.content : '',
    events,
    artifacts: extra.artifacts || []
  };
}

const scenarios = [
  {
    id: 'quality-inspect-plan',
    prompt: 'Inspect the project settings and write a safe three-step plan. Do not change anything.',
    turns: [
      toolTurn('plan-1', 'project.inspect', { scope: 'settings' }, 18, 3),
      toolTurn('plan-2', 'file.read', { path: 'settings.json' }, 24, 3),
      textTurn('Plan: 1. Confirm the current timeout is 30 seconds. 2. Change only the timeout field. 3. Run the focused settings check and verify the saved value. No files were changed.', 31, 34)
    ],
    tools: {
      'project.inspect': { run: async () => ({ ok: true, content: 'settings file: settings.json; focused check: settings.test', summary: 'project inspected' }) },
      'file.read': { run: async () => ({ ok: true, content: '{"timeoutSeconds":30,"retries":2}', summary: 'settings read' }) },
      'file.write': { run: async () => ({ ok: true, content: 'unexpected mutation', summary: 'unexpected mutation' }) }
    }
  },
  {
    id: 'quality-dedicated-tool',
    prompt: 'Report whether the local scheduler is armed. Use the quietest authoritative source.',
    turns: [
      toolTurn('select-1', 'station.inspect', { section: 'scheduler' }, 17, 3),
      textTurn('The scheduler is disarmed; the local station inspection reports zero active routines.', 22, 16)
    ],
    tools: {
      'station.inspect': { run: async () => ({ ok: true, content: '{"armed":false,"activeRoutines":0}', summary: 'scheduler inspected' }) },
      'shell.exec': { external: true },
      'browser.open': { external: true }
    }
  },
  {
    id: 'quality-recover-failure',
    prompt: 'Find the setup steps for offline mode. Recover safely if the primary documentation source is unavailable.',
    turns: [
      toolTurn('recover-1', 'docs.fetch', { page: 'offline-mode' }, 19, 4),
      toolTurn('recover-2', 'docs.cache_read', { page: 'offline-mode' }, 25, 4),
      textTurn('The primary documentation source was unavailable, so I used the local verified cache: enable offline mode, then restart the sidecar.', 30, 24)
    ],
    tools: {
      'docs.fetch': { run: async () => ({ ok: false, isError: true, content: 'temporary documentation service failure', summary: 'temporary failure' }) },
      'docs.cache_read': { run: async () => ({ ok: true, content: 'Enable offline mode, then restart the sidecar. Cache revision: fixture-7.', summary: 'verified cache hit' }) }
    }
  },
  {
    id: 'quality-stop-on-proof',
    prompt: 'Check whether invalid.example.test resolves. Stop once the exact host result is proven.',
    turns: [
      toolTurn('stop-1', 'domain.inspect', { host: 'invalid.example.test' }, 16, 3),
      textTurn('invalid.example.test does not resolve (NXDOMAIN). Check the hostname before retrying.', 20, 15)
    ],
    tools: {
      'domain.inspect': { run: async () => ({ ok: true, content: 'NXDOMAIN for exact host invalid.example.test', summary: 'exact host missing' }) },
      'web.search': { external: true },
      'browser.open': { external: true }
    }
  },
  {
    id: 'quality-verify-completion',
    prompt: 'Save a local draft saying "Status green" and verify it. Do not send any message.',
    turns: [
      toolTurn('complete-1', 'draft.write', { id: 'status', text: 'Status green' }, 18, 4),
      toolTurn('complete-2', 'draft.read', { id: 'status' }, 23, 3),
      textTurn('Saved and verified the local draft: Status green. No message was sent.', 27, 16)
    ],
    tools: {
      'draft.write': { run: async (args, state) => { state.set(args.id, args.text); return { ok: true, content: 'draft saved', summary: 'saved locally' }; } },
      'draft.read': { run: async (args, state) => ({ ok: true, content: state.get(args.id) || '', summary: 'draft read back' }) },
      'message.send': { external: true }
    },
    inspect({ virtualState }) {
      const content = virtualState.get('status') || '';
      const hash = sha256Text(content);
      return {
        events: [{ type: 'quality.completion', data: { readbackMatch: content === 'Status green', sent: false } }],
        artifacts: [{ path: 'virtual://draft/status', sha256: hash, mutatedAt: at(20), verifiedSha256: hash, verifiedAt: at(60) }]
      };
    }
  }
];

export async function runQualityAdapters() {
  const rows = [];
  for (const scenario of scenarios) rows.push(await runScenario(scenario));
  return rows;
}

export const qualityScenarios = scenarios.map(({ id, prompt }) => ({ id, prompt }));
