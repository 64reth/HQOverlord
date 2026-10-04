import { openSync, closeSync, fsyncSync, writeSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { runAgentLoop } = require('../../../sidecar/loop.js');
const { makeContext } = require('../../../sidecar/context.js');
const { makeTranscriptStore } = require('../../../sidecar/transcriptstore.js');

const output = resolve(process.argv[2] || 'fault-compaction-transcript.jsonl');
const rows = existsSync(output)
  ? readFileSync(output, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
  : [];
const io = {
  readAll: () => rows.slice(),
  appendDurable(entry) {
    const line = JSON.stringify(entry) + '\n';
    const fd = openSync(output, 'a');
    try { writeSync(fd, line, null, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
    rows.push(entry);
    return entry;
  },
  append(entry) { return this.appendDurable(entry); }
};
const store = makeTranscriptStore({ io, clock: { now: () => 3000 } });
const messages = [];
for (let i = 0; i < 40; i++) messages.push({ role: i % 2 ? 'assistant' : 'user', content: (i === 4 ? 'ROTATION-FACT-731 ' : '') + 'prior ' + i + ' ' + 'z'.repeat(200) });
messages.push({ role: 'user', content: 'finish after compaction' });
let turn = 0;
await runAgentLoop({
  messages,
  provider: { priceOf: () => null, contextLimit: () => 2000, stream: async function* () {
    turn++;
    yield { type: 'tool_start', index: 0, id: 'rotate-' + turn, name: 'noop' };
    yield { type: 'tool_args', index: 0, chunk: '{}' };
    yield { type: 'usage', usage: { prompt_tokens: 1900, completion_tokens: 5, total_tokens: 1905 } };
    yield { type: 'done', finishReason: 'tool_calls' };
  } },
  emit() {}, dispatch: async () => ({ ok: true, content: 'tool result' }),
  tools: [{ type: 'function', function: { name: 'noop', parameters: { type: 'object', properties: {} } } }],
  context: makeContext({ contextLimit: 2000, compactAt: 0.65, keepTail: 4 }),
  summarize: async older => {
    store.appendNewStrict('rotation', 'eval-agent', older, { sourceRunId: 'rotation-run' });
    // This is the exact crash window: the soon-to-be-folded slice is fsync'd, but the in-memory replacement and
    // agent.compact checkpoint have not happened. Abrupt termination must leave the fact searchable on restart.
    process.kill(process.pid, 'SIGKILL');
    return { summary: 'unreachable' };
  },
  model: 'm', agentId: 'eval-agent', runId: 'rotation-run', limits: { maxIters: 4 }
});
