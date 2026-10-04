'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeSkillStore } = require('../sidecar/skillstore.js');
const { makePackageStore } = require('../sidecar/skills/package.js');
const { makeSkillTools } = require('../sidecar/tools/builtin/skills.js');
const { deriveReadClient } = require('../sidecar/tools/builtin/browser-workflow.js');
const row = { method: 'GET', type: 'Fetch', status: 200, url: 'https://example.com/api/items?q=one' };
assert.equal(deriveReadClient([row, row]).candidates.length, 1);
for (const patch of [{ method: 'POST' }, { status: 401 }, { status: undefined }, { failure: 'failed' }, { type: 'Image' }, { url: 'https://example.com/api?token=secret' }, { url: 'https://u:p@example.com/api' }, { url: 'file:///secret' }]) {
  assert.equal(deriveReadClient([{ ...row, ...patch }]).candidates.length, 0);
}
assert.equal(deriveReadClient([row]).candidates[0].verified, false);
(async () => {
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests++;
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/items' }); res.end(); return; }
    if (req.url === '/html') { res.setHeader('Content-Type', 'text/html'); res.end('<html>login</html>'); return; }
    if (req.url === '/denied') { res.writeHead(403); res.end(); return; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ count: 2, items: ['one', 'two'] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    const execute = async path => {
      const result = deriveReadClient([{ ...row, url: base + path }]);
      let output;
      await new (Object.getPrototypeOf(async function () {}).constructor)('console', result.candidates[0].source)({ log: x => { output = JSON.parse(x); } });
      return output;
    };
    assert.equal(requests, 0, 'derivation makes no requests');
    assert.deepEqual(await execute('/items'), { count: 2, items: ['one', 'two'] });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-learned-lookup-'));
    try {
      const ledger = path.join(root, 'skills.jsonl');
      const io = { readAll: () => fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [], append: entry => fs.appendFileSync(ledger, JSON.stringify(entry) + '\n') };
      const store = makeSkillStore({ io, packageStore: makePackageStore({ fs, pathMod: path, root }) });
      const manage = makeSkillTools({ store }).manageTool;
      const ctx = { agentId: 'lookup-proof' };
      const source = deriveReadClient([{ ...row, url: base + '/items' }]).candidates[0].source;
      await manage.run({ action: 'create', name: 'Verified item lookup', body: 'GET the observed endpoint. Verified count=2, items=one,two against the browser fixture. Return to browser if the response changes.' }, ctx);
      await manage.run({ action: 'write_file', target: 'Verified item lookup', path: 'scripts/lookup.mjs', content: source }, ctx);
      const child = spawnSync(process.execPath, ['-e', `
        const fs=require('node:fs'), path=require('node:path');
        const {makeSkillStore}=require('./sidecar/skillstore.js');
        const {makePackageStore}=require('./sidecar/skills/package.js');
        const root=process.argv[1];
        const store=makeSkillStore({io:{readAll:()=>fs.readFileSync(path.join(root,'skills.jsonl'),'utf8').trim().split('\\n').map(JSON.parse)},packageStore:makePackageStore({fs,pathMod:path,root})});
        const skill=store.view('lookup-proof','Verified item lookup',{bump:false});
        process.stdout.write(JSON.stringify(skill.files.find(f=>f.path==='scripts/lookup.mjs').content));
      `, root], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
      assert.equal(child.status, 0, child.stderr);
      assert.equal(JSON.parse(child.stdout), source, 'verified client survives a fresh process through real skill.manage/package storage');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
    for (const path of ['/redirect', '/html', '/denied']) await assert.rejects(execute(path));
    assert.equal(requests, 4, 'redirect target was never followed');
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log('browser-workflow: observed GET derivation and real HTTP execution/error checks passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
