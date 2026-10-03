import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ids} from '@hqoverlord/core';
import {correlationId,eventId} from '@hqoverlord/events';
import {commandId,DurableRuntime,emptyDurableState,ToolRegistry,type DurableState,type McpTransport} from '@hqoverlord/runtime';
import {startMcpHosts} from '../src/mcp-hosts.ts';
import {createControlCentre} from '../src/server.ts';
test('the Station installs only configured owned HTTP connectors once and restores their real catalog after restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hq-mcp-catalog-')),file=join(root,'profiles.json'),businessId=ids.business('b'),now='2026-10-03T12:00:00Z';let n=0;
 let state:DurableState={...emptyDurableState(),authority:{businesses:[{id:businessId,name:'Owned',status:'active',createdAt:now,updatedAt:now}],agents:[],jobs:[]}};
 const store={async load(){return structuredClone(state);},async save(s:DurableState){state=structuredClone(s);}},clock={now:()=>now},identities={agent:()=>ids.agent('a'+ ++n),job:()=>ids.job('j'+ ++n),event:()=>eventId('e'+ ++n)},context=()=>({businessId,commandId:commandId('operator-'+ ++n),principal:{kind:'human' as const,id:'operator'},correlationId:correlationId('connector')}),runtime=await DurableRuntime.open(store,clock,identities);
 let connections=0,calls=0,closed=0;const makeTransport=({url}:{url:string}):McpTransport=>{connections++;assert.equal(url,'https://configured.invalid/mcp');let receive!:(message:unknown)=>void;return {onMessage(cb){receive=cb;},close(){closed++;},async send(raw){const m=raw as {id?:number;method:string};if(m.id===undefined)return;calls++;receive({jsonrpc:'2.0',id:m.id,result:m.method==='initialize'?{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'actual-fixture',version:'1'}}:{tools:[{name:'read',description:'Actual configured lookup',inputSchema:{type:'object'}}]}});}};};
 await writeFile(file,JSON.stringify([{id:'records',url:'https://configured.invalid/mcp',enabled:false}]));const registry=new ToolRegistry(),host=await startMcpHosts(runtime,context(),registry,{profilesPath:file,makeTransport}),app=createControlCentre({runtime,businessIds:[businessId],context,connectorCatalog:()=>host.catalog(),installConnector:host.install,assetRoot:new URL('../public/',import.meta.url)});
 try{assert.equal(connections,0);assert.equal(host.catalog()[0]!.state,'not connected');await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));const address=app.server.address() as import('node:net').AddressInfo,base='http://127.0.0.1:'+address.port,page=await fetch(base),cookie=page.headers.get('set-cookie')!.split(';')[0]!;
 const post=(id:string)=>fetch(base+'/api/connector-install?business=b',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({id,url:'https://attacker.invalid',tokenEnv:'OPENAI_API_KEY'})});assert.equal((await post('unknown')).status,409);assert.equal(connections,0);const results=await Promise.all([post('records'),post('records')]);assert.ok(results.every(r=>r.status===200));assert.equal(connections,1);assert.equal(calls,2);assert.equal(registry.list().length,1);assert.equal(host.catalog()[0]!.state,'connected');assert.equal(runtime.station(context()).connectors![0]!.id,'records');await assert.rejects(host.install({...context(),businessId:ids.business('foreign')},'records'),/Owned/);assert.equal(connections,1);
 host.close();const reopened=await DurableRuntime.open(store,clock,identities),restored=await startMcpHosts(reopened,context(),new ToolRegistry(),{profilesPath:file,makeTransport});assert.equal(connections,2);assert.equal(restored.catalog()[0]!.state,'connected');restored.close();assert.ok(closed>=2);
 }finally{host.close();await app.close();await rm(root,{recursive:true,force:true});}
});
