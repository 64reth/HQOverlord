/* node test/mcp.stdio.test.js - MCP stdio transport:
   real newline-framed child process, command allowlist, env redaction/minimal
   inheritance, manager wiring, consent flags, and close cleanup. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('./_assert.js');
const { makeMcpClient } = require('../sidecar/mcp/client.js');
const { makeConnectorManager } = require('../sidecar/mcp/manager.js');
const { makeStdioTransport, _internals: T } = require('../sidecar/mcp/transport.stdio.js');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await sleep(10);
  return predicate();
}
function writeServer(dir) {
  const file = path.join(dir, 'stdio-server.js');
  fs.writeFileSync(file, [
    "'use strict';",
    "const readline = require('readline');",
    "const rl = readline.createInterface({ input: process.stdin });",
    "function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n'); }",
    "rl.on('line', line => {",
    "  let msg; try { msg = JSON.parse(line); } catch (_) { return; }",
    "  if (!msg || msg.id == null) return;",
    "  if (msg.method === 'initialize') return reply(msg.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'stdio-test', explicit: process.env.SECRET_TOKEN || '', ambient: process.env.OPENROUTER_KEY || '' } });",
    "  if (msg.method === 'tools/list') return reply(msg.id, { tools: [",
    "    { name: 'create_issue', inputSchema: { type: 'object', properties: { title: { type: 'string' } } } },",
    "    { name: 'read_note', annotations: { readOnlyHint: true }, inputSchema: { type: 'object' } }",
    "  ] });",
    "  if (msg.method === 'tools/call') return reply(msg.id, { content: [{ type: 'text', text: 'called ' + msg.params.name + ' ' + JSON.stringify(msg.params.arguments || {}) }] });",
    "  return reply(msg.id, {});",
    "});",
    "process.on('SIGTERM', () => process.exit(0));"
  ].join('\n'));
  return file;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-mcp-stdio-'));
  const server = writeServer(tmp);
  const nodeBase = path.basename(process.execPath);
  try {
    // allowlist + env hygiene
    A.notThrows(() => T.assertAllowedCommand(process.execPath, [nodeBase]), 'the current node executable can be explicitly allowlisted');
    A.throws(() => makeStdioTransport({ command: 'cmd.exe', allowedCommands: [nodeBase] }), 'non-allowlisted command is refused before spawn');
    const childEnv = T.buildChildEnv({ SECRET_TOKEN: 'explicit-secret' }, { PATH: 'safe-path', OPENROUTER_KEY: 'ambient-secret' });
    A.eq(childEnv.SECRET_TOKEN, 'explicit-secret', 'explicit stdio env is passed through');
    A.eq(childEnv.OPENROUTER_KEY, undefined, 'ambient secret env is not inherited by default');
    A.eq(childEnv.STARNET_COMPUTER_DRIVER, '0', 'connector env cannot enable the physical-input driver');
    A.eq(childEnv.STARNET_BROWSER_HEADLESS, '1', 'connector env is pinned headless');
    A.throws(() => makeStdioTransport({ command: process.execPath, allowedCommands: [nodeBase], processEnv: {} }), 'stdio defaults to denied without an isolated process broker');
    A.throws(() => makeStdioTransport({ command: process.execPath, allowedCommands: [nodeBase], processEnv: { STARNET_USER_CONTROL_MODE: 'preserve', STARNET_MCP_STDIO: '0' } }), 'installed preserve mode refuses stdio before spawn');
    const redacted = T.redactEnv({ SECRET_TOKEN: 'explicit-secret', MODE: 'test' });
    A.eq(redacted.SECRET_TOKEN, '<redacted>', 'secret-like env keys redact their value');
    A.eq(redacted.MODE, '<set>', 'non-secret env keys still avoid exposing values');
    A.eq(T.safeLedgerCommand('npx', ['--token', 'secret-value', '@scope/server@1']).indexOf('secret-value'), -1, 'orphan receipt command redacts secret argv');

    // real child process, newline-framed JSON-RPC
    {
      const errors = [];
      const ledgered = [], released = [];
      const tp = makeStdioTransport({
        userControlIsolated: true,
        command: process.execPath,
        args: [server],
        env: { SECRET_TOKEN: 'explicit-secret' },
        processEnv: { PATH: process.env.PATH || '', OPENROUTER_KEY: 'ambient-secret' },
        allowedCommands: [nodeBase],
        timeoutMs: 1000,
        onError: e => errors.push((e && e.message) || String(e)),
        ledger: { record: row => ledgered.push(row), release: pid => released.push(pid) }
      });
      const client = makeMcpClient({ transport: tp, timeoutMs: 1000 });
      const init = await client.initialize();
      A.eq(ledgered.length, 1, 'stdio child is recorded in the durable process ownership ledger at spawn');
      A.eq(ledgered[0].kind, 'mcp.stdio', 'ledger receipt identifies the MCP child kind');
      A.eq(init.serverInfo.explicit, 'explicit-secret', 'stdio child sees explicit connector env');
      A.eq(init.serverInfo.ambient, '', 'stdio child does not inherit ambient secrets');
      const tools = await client.listTools();
      A.eq(tools.map(t => t.name).sort(), ['create_issue', 'read_note'], 'tools/list arrives over newline-framed stdio');
      const called = await client.callTool('create_issue', { title: 'hi' });
      A.ok(called.content[0].text.indexOf('called create_issue') >= 0, 'tools/call round-trips through the child process');
      client.close('test cleanup');
      await waitFor(() => released.length === 1);
      A.eq(tp.isClosed(), true, 'transport close marks the stdio child closed');
      A.eq(errors.length, 0, 'happy-path stdio child produced no transport errors');
      A.eq(released.length, 1, 'clean stdio child exit releases its ownership receipt');
    }

    // manager wiring + sanitized summaries + MCP consent posture
    {
      const mgr = makeConnectorManager({
        makeTransport: cfg => {
          A.eq(cfg.transport, 'stdio', 'manager passes the stdio transport kind to the transport factory');
          A.eq(cfg.agentId, 'safe-agent', 'manager passes the durable Safe Cell owner to the transport factory');
          return makeStdioTransport(Object.assign({}, cfg, {
            userControlIsolated: true,
            processEnv: { PATH: process.env.PATH || '', OPENROUTER_KEY: 'ambient-secret' },
            allowedCommands: [nodeBase],
            timeoutMs: 1000
          }));
        },
        clock: { now: () => 123 },
        timeoutMs: 1000
      });
      const r = await mgr.configure('local', {
        transport: 'stdio',
        command: process.execPath,
        args: [server, '--token', 'synthetic-arg-secret', '--api-key=synthetic-inline-secret', 'https://local.invalid/mcp?password=synthetic-query-secret'],
        cwd: os.tmpdir(),
        env: { SECRET_TOKEN: 'explicit-secret' },
        agentId: 'safe-agent',
        label: 'Local'
      });
      A.eq(r.ok, true, 'stdio connector configured through manager');
      A.eq(r.state, 'up', 'stdio connector reaches up state');
      const status = mgr.status('local');
      A.eq(status.transport, 'stdio', 'status records stdio transport');
      A.eq(status.agentId, 'safe-agent', 'status names the Safe Cell agent that owns the stdio child');
      A.eq(status.url, undefined, 'stdio status does not pretend to have an HTTP URL');
      A.eq(status.env.SECRET_TOKEN, '<redacted>', 'manager summary redacts stdio env values');
      A.eq(JSON.stringify(status).indexOf('explicit-secret'), -1, 'manager summary never leaks the env secret');
      A.eq(JSON.stringify(status).indexOf('synthetic-arg-secret'), -1, 'manager summary redacts a following secret argument');
      A.eq(JSON.stringify(status).indexOf('synthetic-inline-secret'), -1, 'manager summary redacts an inline secret argument');
      A.eq(JSON.stringify(status).indexOf('synthetic-query-secret'), -1, 'manager summary redacts URL arguments');
      A.eq(status.hasCwd, true, 'manager summary reports that a custom cwd exists');
      A.eq('cwd' in status, false, 'manager summary does not expose the workspace path');
      const defs = mgr.toolDefsFor('local');
      A.eq(defs.find(d => d.name === 'mcp__local__create_issue').requiresConsent, true, 'mutating MCP stdio tools still require consent');
      A.eq(defs.find(d => d.name === 'mcp__local__read_note').requiresConsent, true, 'stdio MCP annotations cannot suppress live consent');
      A.eq(defs.find(d => d.name === 'mcp__local__read_note').impact, 'external-unknown', 'stdio MCP tools are classified as untrusted local effects');
      const out = await defs.find(d => d.name === 'mcp__local__create_issue').run({ title: 'ship' }, {});
      A.ok(out.content.indexOf('called create_issue') >= 0, 'projected stdio MCP tool dispatches through the warm client');
      await mgr.close();
    }

    // CLEAN IDLE SELF-EXIT IS STILL A TRANSPORT DEATH. The exit hook used to skip onError for a code-0
    // exit with nothing pending, so the manager kept state 'up' over a dead child: ensureLive short-
    // circuits on 'up', the stdio call path has no CALL_FAIL_LIMIT net, and per-call lastUsedAt bumps
    // held off the idle recycle — the connector answered -32000 forever while the panel said up.
    {
      const quitFile = path.join(tmp, 'stdio-quitter.js');
      fs.writeFileSync(quitFile, [
        "'use strict';",
        "const readline = require('readline');",
        "const rl = readline.createInterface({ input: process.stdin });",
        "rl.on('line', line => {",
        "  let msg; try { msg = JSON.parse(line); } catch (_) { return; }",
        "  if (!msg || msg.id == null) return;",
        "  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'quitter' } } }) + '\\n');",
        "  setTimeout(() => process.exit(0), 50);"
      ].concat(["});"]).join('\n'));
      const deaths = [];
      const tp2 = makeStdioTransport({
        userControlIsolated: true, command: process.execPath, args: [quitFile],
        env: {}, processEnv: { PATH: process.env.PATH || '' }, allowedCommands: [nodeBase], timeoutMs: 1000,
        onError: e => deaths.push((e && e.message) || String(e))
      });
      const cl2 = makeMcpClient({ transport: tp2, timeoutMs: 1000 });
      await cl2.initialize();
      A.ok(await waitFor(() => deaths.length > 0, 2000), 'a clean idle code-0 self-exit still reports transport death (never a wedged "up")');
      tp2.close();
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  A.report('mcp.stdio.test');
})();
