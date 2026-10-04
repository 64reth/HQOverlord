import { spawn } from 'node:child_process';

export function spawnAcpClient({ command, args = [], cwd, env = {}, permission = () => null, timeoutMs = 600000 }) {
  const child = spawn(command, args, {
    cwd, env: Object.assign({}, process.env, env), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
  });
  let nextId = 0, buffer = '', stderr = '', exited = null;
  const pending = new Map(), notifications = [];
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let boundary;
    while ((boundary = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, boundary).replace(/\r$/, '');
      buffer = buffer.slice(boundary + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); }
      catch (_) { stderr += `\n[non-json stdout] ${line.slice(0, 500)}`; continue; }
      if (message.method && message.id !== undefined) {
        Promise.resolve(permission(message.method, message.params || {})).then(optionId => {
          const outcome = optionId
            ? { outcome: { outcome: 'selected', optionId: String(optionId) } }
            : { outcome: { outcome: 'cancelled' } };
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: outcome }) + '\n');
        }).catch(() => {
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { outcome: { outcome: 'cancelled' } } }) + '\n');
        });
        continue;
      }
      if (message.method) { notifications.push(message); continue; }
      const waiter = pending.get(String(message.id));
      if (waiter) { pending.delete(String(message.id)); waiter.resolve(message); }
    }
  });
  child.once('exit', code => {
    exited = code;
    for (const waiter of pending.values()) waiter.reject(new Error(`ACP process exited ${code}\n${stderr.slice(-2000)}`));
    pending.clear();
  });
  child.once('error', error => {
    exited = -1;
    stderr += `\n[spawn error] ${error.message || error}`;
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });

  function request(method, params = {}, requestTimeoutMs = timeoutMs) {
    const id = String(++nextId);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out after ${requestTimeoutMs}ms\n${stderr.slice(-3000)}`));
      }, requestTimeoutMs);
      pending.set(id, {
        resolve: message => { clearTimeout(timer); message.error ? reject(new Error(`${method}: ${message.error.message || JSON.stringify(message.error)}`)) : resolve(message.result); },
        reject: error => { clearTimeout(timer); reject(error); }
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  return {
    child, request, notifications,
    stderr: () => stderr,
    exited: () => exited,
    clearNotifications() { notifications.length = 0; },
    updates(sessionId) {
      return notifications.filter(row => row.method === 'session/update' && (!sessionId || row.params?.sessionId === sessionId))
        .map(row => row.params.update);
    },
    text(sessionId) {
      return this.updates(sessionId).filter(row => row.sessionUpdate === 'agent_message_chunk')
        .map(row => row.content?.text || '').join('');
    },
    async initialize(clientName = 'starnet-parity-campaign') {
      return request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } }, clientInfo: { name: clientName, version: '0.9.0' } }, 30000);
    },
    async newSession(projectRoot, mcpServers = []) {
      const result = await request('session/new', { cwd: projectRoot, mcpServers }, 120000);
      if (!result?.sessionId) throw new Error('ACP session/new returned no sessionId');
      return result;
    },
    async setModel(sessionId, modelId) {
      return request('session/set_model', { sessionId, modelId }, 120000);
    },
    async prompt(sessionId, text, promptTimeoutMs = timeoutMs) {
      this.clearNotifications();
      const started = performance.now();
      const result = await request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, promptTimeoutMs);
      return { result, text: this.text(sessionId).trim(), updates: this.updates(sessionId), totalMs: performance.now() - started };
    },
    async close() {
      if (exited == null) { try { child.kill(); } catch (_) {} }
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
    }
  };
}
