'use strict';
let buffer = Buffer.alloc(0);
function send(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  process.stdout.write(Buffer.concat([Buffer.from('Content-Length: ' + body.length + '\r\n\r\n', 'ascii'), body]));
}
function publish(uri, text) {
  const diagnostics = [];
  String(text).split(/\r?\n/).forEach((line, index) => {
    const add = (code, message) => diagnostics.push({ range: { start: { line: index, character: 0 }, end: { line: index, character: Math.max(1, line.length) } }, severity: 1, code, source: 'eval-lsp', message });
    if (line.includes('OLD')) add('OLD', 'pre-existing problem');
    if (line.includes('BROKEN')) add('BROKEN', 'newly introduced problem');
  });
  if (process.env.STARNET_EVAL_SECRET) diagnostics.push({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 1, code: 'SECRET_LEAK', source: 'eval-lsp', message: 'secret leaked' });
  send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } });
}
function receive(message) {
  if (message.method === 'initialize') return send({ jsonrpc: '2.0', id: message.id, result: { capabilities: { textDocumentSync: 1 } } });
  if (message.method === 'shutdown') return send({ jsonrpc: '2.0', id: message.id, result: null });
  if (message.method === 'exit') return process.exit(0);
  if (message.method === 'textDocument/didOpen') return publish(message.params.textDocument.uri, message.params.textDocument.text);
  if (message.method === 'textDocument/didChange') return publish(message.params.textDocument.uri, message.params.contentChanges[0].text);
}
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const split = buffer.indexOf('\r\n\r\n');
    if (split < 0) break;
    const match = /Content-Length:\s*(\d+)/i.exec(buffer.slice(0, split).toString('ascii'));
    if (!match || buffer.length < split + 4 + Number(match[1])) break;
    const start = split + 4, end = start + Number(match[1]);
    try { receive(JSON.parse(buffer.slice(start, end).toString('utf8'))); } catch (_) {}
    buffer = buffer.slice(end);
  }
});
