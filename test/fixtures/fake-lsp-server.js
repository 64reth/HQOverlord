'use strict';

let buffer = Buffer.alloc(0);
const docs = new Map();

function send(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  process.stdout.write(Buffer.concat([Buffer.from('Content-Length: ' + body.length + '\r\n\r\n', 'ascii'), body]));
}

function diagnostic(line, text, code) {
  return {
    range: { start: { line, character: 0 }, end: { line, character: Math.max(1, text.length) } },
    severity: 1, code, source: 'fake-lsp', message: code === 'OLD' ? 'pre-existing problem' : 'newly introduced problem'
  };
}

function publish(uri, text) {
  const rows = [];
  String(text).split(/\r?\n/).forEach((line, i) => {
    if (line.includes('OLD')) rows.push(diagnostic(i, line, 'OLD'));
    if (line.includes('BROKEN')) rows.push(diagnostic(i, line, 'BROKEN'));
  });
  if (process.env.STARNET_TEST_SECRET) rows.push(diagnostic(0, 'secret', 'SECRET_LEAK'));
  send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: rows } });
}

function onMessage(msg) {
  if (msg.method === 'initialize') return send({ jsonrpc: '2.0', id: msg.id, result: { capabilities: { textDocumentSync: 1 } } });
  if (msg.method === 'shutdown') return send({ jsonrpc: '2.0', id: msg.id, result: null });
  if (msg.method === 'exit') return process.exit(0);
  if (msg.method === 'textDocument/didOpen') {
    const doc = msg.params.textDocument; docs.set(doc.uri, doc.text); return publish(doc.uri, doc.text);
  }
  if (msg.method === 'textDocument/didChange') {
    const uri = msg.params.textDocument.uri;
    const text = msg.params.contentChanges[0].text; docs.set(uri, text); return publish(uri, text);
  }
}

process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
  for (;;) {
    const split = buffer.indexOf('\r\n\r\n');
    if (split < 0) break;
    const head = buffer.slice(0, split).toString('ascii');
    const match = /Content-Length:\s*(\d+)/i.exec(head);
    if (!match) { buffer = buffer.slice(split + 4); continue; }
    const len = Number(match[1]);
    if (buffer.length < split + 4 + len) break;
    const raw = buffer.slice(split + 4, split + 4 + len).toString('utf8');
    buffer = buffer.slice(split + 4 + len);
    try { onMessage(JSON.parse(raw)); } catch (_) {}
  }
});
