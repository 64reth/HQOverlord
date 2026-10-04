'use strict';
// Disposable local-only probes. All credentials are fake audit markers.
const http = require('node:http');
const fs = require('node:fs');
const base = 'http://127.0.0.1:18964';
const evidence = {};
const received = [];
async function mock(label) {
  const s = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    received.push({server: label, path: req.url, authorization: req.headers.authorization || '', apiKey: req.headers['x-api-key'] || ''});
    if (label === 'redirect') { res.writeHead(307, {location: target.url}); return res.end(); }
    let m; try {m = JSON.parse(body);} catch {m = {};}
    if (m.id == null) {res.writeHead(202); return res.end();}
    const result = m.method === 'initialize' ? {protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:label,version:'1'}} : {tools:[]};
    res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
  });
  await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
  return {s, url:'http://127.0.0.1:'+s.address().port+'/mcp'};
}
let target;
(async () => {
  const original = await mock('original'); target = await mock('replacement'); const redirect = await mock('redirect');
  try {
    const page = await fetch(base); const html = await page.text();
    const token = JSON.parse(html.match(/window\.__STARNET_API_TOKEN__=("[^"]+")/)[1]);
    const api = async (route, body, method='POST') => {const r = await fetch(base+route,{method,headers:{'content-type':'application/json','x-starnet-token':token},body:method==='GET'?undefined:JSON.stringify(body)}); return {status:r.status,body:await r.json()};};
    evidence.pageHeaders = Object.fromEntries(page.headers);
    evidence.initialConnector = await api('/api/connectors',{id:'audit-import',transport:'http',url:original.url,token:'AUDIT_FAKE_BEARER',headers:{'X-Api-Key':'AUDIT_FAKE_HEADER'}});
    const marker = received.length;
    evidence.retargetImport = await api('/api/config/import',{envelope:{starnetExport:1,sections:{connectors:[{id:'audit-import',transport:'http',url:target.url}]}}});
    evidence.retargetRefresh = await api('/api/connectors/refresh',{id:'audit-import'});
    evidence.retargetRequests = received.slice(marker);
    const mark2 = received.length;
    evidence.redirectConnector = await api('/api/connectors',{id:'audit-redirect',transport:'http',url:redirect.url,headers:{'X-Api-Key':'AUDIT_REDIRECT_HEADER'}});
    evidence.redirectRequests = received.slice(mark2);
    evidence.disabledStdio = await api('/api/connectors',{id:'audit-stdio',transport:'stdio',command:'node',args:['--api-token=AUDIT_ARG_SECRET'],agentId:'audit-owner',enabled:false,env:{ACCESS:'AUDIT_ENV_SECRET'}});
    evidence.disabledHttp = await api('/api/connectors',{id:'audit-disabled',transport:'http',url:original.url,enabled:false});
    evidence.oauthSaved = await api('/api/connectors',{id:'audit-oauth',transport:'http',url:'https://example.invalid/mcp',oauth:true,enabled:false});
    evidence.export = await api('/api/config/export',{only:['connectors']});
    const own = evidence.export.body.sections.connectors.filter(c=>c.id==='audit-disabled'||c.id==='audit-oauth');
    evidence.roundtripImport = await api('/api/config/import',{envelope:{starnetExport:1,sections:{connectors:own}}});
    evidence.disabledAfterImport = await api('/api/connectors/refresh',{id:'audit-disabled'});
    evidence.connectorsAfterImport = await api('/api/connectors',undefined,'GET');
    const retargetLeak = evidence.retargetRequests.some(r => r.authorization || r.apiKey);
    const redirected = evidence.redirectRequests.some(r => r.server === 'replacement');
    const exportBytes = JSON.stringify(evidence.export.body);
    const rowsAfter = evidence.connectorsAfterImport.body.connectors || [];
    evidence.verdicts = {
      replacementCredentialsBlocked: !retargetLeak,
      crossOriginRedirectBlocked: !redirected && evidence.redirectConnector.body.connected === false,
      exportSecretsExcluded: !exportBytes.includes('AUDIT_ARG_SECRET') && !exportBytes.includes('AUDIT_ENV_SECRET'),
      disabledStatePreserved: rowsAfter.some(r => r.id === 'audit-disabled' && r.enabled === false),
      oauthModePreserved: rowsAfter.some(r => r.id === 'audit-oauth' && r.oauth === true)
    };
    if (Object.values(evidence.verdicts).some(v => v !== true)) throw new Error('live security verification failed: ' + JSON.stringify(evidence.verdicts));
    for(const id of ['audit-import','audit-redirect','audit-stdio','audit-disabled','audit-oauth']) await api('/api/connectors/remove',{id});
    fs.writeFileSync('dev/audit-security-0904-evidence.json',JSON.stringify(evidence,null,2));
    console.log(JSON.stringify(evidence,null,2));
  } finally { for(const server of [original,target,redirect]) {server.s.closeAllConnections();server.s.close();} }
})().catch(e=>{console.error(e);process.exitCode=1;});
