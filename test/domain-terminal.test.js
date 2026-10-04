/* node test/domain-terminal.test.js — bounded one-host checks and host-enforced terminal evidence. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const DomainTask = require('../sidecar/domain-task.js');
const { runAgentLoop } = require('../sidecar/loop.js');
const { makeCostEngine } = require('../sidecar/cost.js');

const direct = 'Go ahead, check out starnessos.com and then read the docs.';
const p = DomainTask.classify(direct);
A.ok(p && p.host === 'starnessos.com', 'one explicit host + direct read language is bounded');
A.eq(DomainTask.classify('Review sidecar/index.js before release.'), null, 'a source filename is not classified as a public host');
A.eq(DomainTask.classify('Open README.md and summarize it.'), null, 'a dotted document filename is not classified as a public host');
A.eq(DomainTask.classify('Check with alice@example.com before shipping.'), null, 'an email address is not classified as a public host');
A.ok(DomainTask.classify('Open https://example.com/docs')?.host === 'example.com', 'an explicit URL remains a bounded direct-domain task');
A.eq(DomainTask.classify('Open Cargo.toml and review the package.'), null, 'Cargo.toml is not a public host');
A.eq(DomainTask.classify('Inspect config.ini for the setting.'), null, 'config.ini is not a public host');
A.eq(DomainTask.classify('Review schema.sql before migration.'), null, 'schema.sql is not a public host');
A.ok(DomainTask.classify('Open docs.rs and read the crate docs.')?.host === 'docs.rs', 'a bare domain on a real ccTLD remains supported');
A.ok(DomainTask.classify('Visit example.sh and inspect the site.')?.host === 'example.sh', 'a public suffix that resembles a file extension remains supported');
A.ok(DomainTask.classify('Check starnessos.invalid and read its docs.')?.host === 'starnessos.invalid', 'RFC-reserved invalid host remains classifiable for terminal DNS evidence');
A.eq(DomainTask.classify('Open .env.example and review it.'), null, '.env.example remains a local configuration filename');
A.eq(DomainTask.classify('Inspect widget.test before release.'), null, 'a dotted test filename is not classified as a public host');
A.eq(DomainTask.classify('Review src/docs.rs before release.'), null, 'a path remains local even when its filename ends in a public suffix');
A.eq(DomainTask.classify('Find the correct official site for starnessos.com'), null, 'a requested alternative search stays open-ended');
A.eq(DomainTask.classify('Compare starnessos.com and example.com'), null, 'multiple hosts are not collapsed to one target');
A.ok(DomainTask.isTargetFetch({ name: 'web_fetch', args: { url: 'https://www.starnessos.com/docs' } }, p), 'exact-host web_fetch is recognized');
A.ok(!DomainTask.isTargetFetch({ name: 'web_fetch', args: { url: 'https://starnesos.com' } }, p), 'spelling variants are not silently substituted');
A.ok(DomainTask.isDomainMissing({ summary: 'domain not found', content: 'Domain starnessos.com does not resolve (ENOTFOUND).' }), 'ENOTFOUND/NXDOMAIN result is terminal evidence');

const hostSrc = fs.readFileSync(path.join(__dirname, '../sidecar/index.js'), 'utf8');
A.ok(/directDomainWithheld[\s\S]{0,220}team\\\./.test(hostSrc), 'direct-domain host withholds delegation');
A.ok(/DomainTask\.stopControl\(directDomainTask\)/.test(hostSrc), 'exact fetch missing-domain result receives host stop control');
A.ok(/Number\(o\.maxToolCalls\)/.test(hostSrc), 'run host enforces delegated task-specific tool budgets');

function toolTurn() {
  return [
    { type: 'tool_start', index: 0, id: 'fetch1', name: 'web_fetch' },
    { type: 'tool_args', index: 0, chunk: '{"url":"https://starnessos.com"}' },
    { type: 'tool_start', index: 1, id: 'search1', name: 'web_search' },
    { type: 'tool_args', index: 1, chunk: '{"query":"starnessos"}' },
    { type: 'usage', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
    { type: 'done', finishReason: 'tool_calls' }
  ];
}
function textTurn(text) {
  return [{ type: 'text', delta: text }, { type: 'usage', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }, { type: 'done', finishReason: 'stop' }];
}

(async () => {
  const requests = [];
  let turn = 0;
  const provider = {
    async *stream(req) {
      requests.push(req);
      const events = turn++ === 0 ? toolTurn() : textTurn('The exact host does not resolve; please send the corrected URL.');
      for (const ev of events) yield ev;
    },
    priceOf: () => ({ prompt: '0', completion: '0' }), contextLimit: () => 8000
  };
  const calls = [];
  const stop = DomainTask.stopControl(p);
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: direct }], provider, emit: () => {},
    cost: makeCostEngine({ priceOf: provider.priceOf }), model: 'replay/model', agentId: 'a', runId: 'r',
    tools: [
      { name: 'web_fetch', description: 'fetch', schema: { type: 'object' } },
      { name: 'web_search', description: 'search', schema: { type: 'object' } }
    ],
    dispatch: async c => { calls.push(c.name); return { ok: false, isError: true, summary: 'domain not found', content: 'NXDOMAIN', control: stop }; },
    capCtx: { canRun: () => true, canUse: () => ({ ok: true }), agentId: 'a', room: 'office' },
    parallelSafe: () => false
  });
  A.eq(calls, ['web_fetch'], 'terminal result skips later calls already requested in the same batch');
  A.eq(requests.length, 2, 'terminal evidence buys exactly one synthesis turn');
  A.ok(!requests[1].tools || requests[1].tools.length === 0, 'synthesis turn has no callable tools');
  A.ok(result.messages.some(m => m.role === 'system' && /terminal_domain/.test(String(m.content))), 'terminal evidence is explicit in model context');
  A.eq(result.reason, 'done', 'tool-free synthesis ends cleanly');
  A.report('domain-terminal.test');
})().catch(e => { console.error(e); process.exit(1); });
