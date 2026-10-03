import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { ids } from "@hqoverlord/core";
import { correlationId, eventId } from "@hqoverlord/events";
import { commandId, DurableRuntime, emptyDurableState, ToolRegistry, type DurableState } from "@hqoverlord/runtime";
import { createControlCentre } from "../src/server.ts";

function sseFrames(reader:ReadableStreamDefaultReader<Uint8Array>){let buffer='';const decode=new TextDecoder();return async()=>{for(;;){const end=buffer.indexOf('\n\n');if(end>=0){const frame=buffer.slice(0,end+2);buffer=buffer.slice(end+2);return frame;}const next=await reader.read();if(next.done)throw new Error('SSE ended before its frame');buffer+=decode.decode(next.value,{stream:true});}};}

test("authenticated COMMS starts the selected configured agent and exposes its actual completed output",async()=>{
  const businessId=ids.business("crew"),now="2026-10-02T12:00:00Z";let n=0;
  let state:DurableState={...emptyDurableState(),authority:{businesses:[{id:businessId,name:"Crew",status:"active",createdAt:now,updatedAt:now}],agents:[],jobs:[]}};
  const context=()=>({commandId:commandId(`comms-${++n}`),businessId,principal:{kind:"human" as const,id:"operator"},correlationId:correlationId("comms")});
  const runtime=await DurableRuntime.open({async load(){return state;},async save(s){state=structuredClone(s);}},{now:()=>now},{agent:()=>ids.agent(`a${++n}`),job:()=>ids.job(`j${++n}`),event:()=>eventId(`e${++n}`)});
  const selected=(await runtime.createAgent(context(),{name:"Selected specialist"})).record;
  const other=(await runtime.createAgent(context(),{name:"Other specialist"})).record;
  await runtime.configureAgent(context(),{agentId:selected.id,instructions:"Check the real evidence",personality:"Precise",model:{provider:"fixture",model:"actual-model"}});
  let complete!:()=>void;const completed=new Promise<void>(resolve=>{complete=resolve;});
  const app=createControlCentre({runtime,businessIds:[businessId],context,assetRoot:new URL("../public/",import.meta.url),modelEnabled:true,models:[{provider:"fixture",model:"actual-model"}],run:async(ctx,id)=>{
    const profile=runtime.station(ctx).profiles.find(p=>p.agentId===selected.id)!;
    assert.equal(profile.instructions,"Check the real evidence");assert.equal(profile.model?.model,"actual-model");
    const job=runtime.snapshot().authority.jobs.find(j=>j.id===id)!;assert.equal(job.agentId,selected.id);
    const result=await runtime.executeJob(ctx,job.id,{async next(){return {kind:"complete",output:"Actual COMMS result"};}},new ToolRegistry());complete();return result;
  }});
  await new Promise<void>(resolve=>app.server.listen(0,"127.0.0.1",resolve));const address=app.server.address();assert.ok(address&&typeof address!=="string");const base=`http://127.0.0.1:${address.port}`;
  try{
    const html=await fetch(base),cookie=html.headers.get("set-cookie")!.split(";")[0]!;
    const result=await fetch(`${base}/api/comms`,{method:"POST",headers:{Cookie:cookie,Origin:base,"Content-Type":"application/json"},body:JSON.stringify({agentId:selected.id,objective:"Perform evidence work"})});
    assert.equal(result.status,200);await completed;
    assert.equal(runtime.snapshot().authority.jobs.length,1);assert.equal(runtime.snapshot().authority.jobs[0]!.status,"completed");
    assert.equal(runtime.snapshot().authority.agents.find(a=>a.id===other.id)!.status,"idle");
    const snapshot=await(await fetch(`${base}/api/snapshot`,{headers:{Cookie:cookie}})).text();assert.match(snapshot,/Actual COMMS result/);
    assert.ok(runtime.snapshot().facts.every(f=>f.producer==="hq.runtime"));
    // Actual editor subprocess -> authenticated local HTTP -> canonical owned job.
    const child=spawn(process.execPath,[fileURLToPath(new URL('../../../scripts/acp-serve.mts',import.meta.url))],{windowsHide:true,env:{...process.env,HQ_ACP_URL:base,HQ_ACP_BUSINESS_ID:businessId,HQ_ACP_AGENT_ID:selected.id},stdio:['pipe','pipe','pipe']});
    const lines=createInterface({input:child.stdout}),messages:any[]=[],waiting=new Map<number,(value:any)=>void>();let stderr='';
    child.stderr.on('data',chunk=>{stderr+=String(chunk);});
    lines.on('line',line=>{const message=JSON.parse(line);messages.push(message);if(typeof message.id==='number'){waiting.get(message.id)?.(message);waiting.delete(message.id);}});
    const rpc=(id:number,method:string,params:unknown)=>new Promise<any>((resolve,reject)=>{
      const timeout=setTimeout(()=>{waiting.delete(id);reject(new Error('Editor process timed out: '+stderr));},5000);
      waiting.set(id,value=>{clearTimeout(timeout);resolve(value);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
    });
    try{
      const init=await rpc(1,'initialize',{protocolVersion:1});assert.equal(init.result.agentInfo.name,'hqoverlord');
      const session=await rpc(2,'session/new',{cwd:'C:/another-business'});
      const output=await rpc(3,'session/prompt',{sessionId:session.result.sessionId,prompt:[{type:'text',text:'Real editor request'}]});assert.equal(output.result.stopReason,'end_turn');
      for(let attempt=0;attempt<30&&!JSON.stringify(messages).includes('Actual COMMS result');attempt++)await new Promise(resolve=>setTimeout(resolve,50));
      assert.match(JSON.stringify(messages),/Actual COMMS result/);assert.equal(runtime.snapshot().authority.jobs.length,2);
      assert.ok(runtime.snapshot().authority.jobs.every(j=>j.agentId===selected.id&&j.businessId===businessId));
      assert.equal(stderr,'');
    }finally{child.kill();lines.close();}
  }finally{await app.close();}
});

test("local API/SSE require session, reject foreign scope/origin and hydrate/reconnect from committed state", async () => {
  const businessId = ids.business("allowed"), foreign = ids.business("denied"), now = "2026-10-02T12:00:00Z";
  let state: DurableState = { ...emptyDurableState(), authority: { businesses: [businessId, foreign].map(id => ({ id, name: id, status: "active", createdAt: now, updatedAt: now })), agents: [], jobs: [] } }, n = 0;
  const context = () => ({ commandId: commandId(`c${++n}`), businessId, principal: { kind: "human" as const, id: "operator" }, correlationId: correlationId("test") });
  const runtime = await DurableRuntime.open({ async load() { return state; }, async save(s) { state = structuredClone(s); } }, { now: () => now }, { agent: () => ids.agent(`a${++n}`), job: () => ids.job(`j${++n}`), event: () => eventId(`e${++n}`) });
  const app = createControlCentre({ runtime, businessIds: [businessId], context, assetRoot: new URL("../public/", import.meta.url) });
  await new Promise<void>(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address(); assert.ok(address && typeof address !== "string"); const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${base}/api/snapshot`)).status, 401);
    const html = await fetch(base); assert.equal(html.status, 200); const cookie = html.headers.get("set-cookie")!.split(";")[0]!;
    assert.equal((await fetch(`${base}/api/snapshot?business=denied`, { headers: { Cookie: cookie } })).status, 403);
    assert.equal((await fetch(`${base}/api/snapshot`, { headers: { Cookie: cookie, Origin: "http://evil.test" } })).status, 403);
    assert.equal((await fetch(`${base}/api/cancel`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "{}" })).status, 403);
    const first = await fetch(`${base}/api/events`, { headers: { Cookie: cookie } }); const reader = first.body!.getReader();
    const readFrame=sseFrames(reader);const frame = await readFrame(); assert.match(frame, /event: snapshot/); assert.match(frame, /"agents":\[\]/); assert.doesNotMatch(frame, /"denied"/);
    const agent = (await runtime.createAgent(context(), { name: "Saved worker" })).record;
    const next = await readFrame(); assert.match(next, /Saved worker/); await reader.cancel();
    const reconnected = await fetch(`${base}/api/events`, { headers: { Cookie: cookie, "Last-Event-ID": "old-epoch:0" } }); const again = reconnected.body!.getReader();
    assert.match(await sseFrames(again)(), /Saved worker/); await again.cancel();
    const headers = { Cookie: cookie, Origin: base, "Content-Type": "application/json" };
    const refused = await fetch(`${base}/api/job`, { method: "POST", headers, body: JSON.stringify({ agentId: "foreign-agent", objective: "Denied" }) });
    assert.equal(refused.status, 409); assert.equal(runtime.snapshot().authority.jobs.length, 0);
    const created = await fetch(`${base}/api/job`, { method: "POST", headers, body: JSON.stringify({ agentId: agent.id, objective: "Operator supplied work", actor: { kind: "agent", id: "untrusted" } }) });
    assert.equal(created.status, 200); assert.equal(runtime.snapshot().authority.jobs[0]!.status, "queued");
    assert.deepEqual(runtime.snapshot().facts.at(-1)!.actor, { kind: "human", id: "operator" }); assert.equal(runtime.snapshot().facts.at(-1)!.producer, "hq.runtime");
    const snapshot = await (await fetch(`${base}/api/snapshot`, { headers: { Cookie: cookie } })).json() as { agents: unknown[] }; assert.equal(snapshot.agents.length, 1);
  } finally { await app.close(); }
});

test('authenticated COMMS uploads admit only actual private crew receipts and file reads enforce scope',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{createStationAttachments,createStationFileReader}=await import('@hqoverlord/runtime');
 const root=await mkdtemp(join(tmpdir(),'hq-api-attachments-')),businessId=ids.business('allowed'),now='2026-10-02T12:00:00Z';let n=0,state:DurableState={...emptyDurableState(),authority:{businesses:[{id:businessId,name:'Allowed',status:'active',createdAt:now,updatedAt:now}],agents:[],jobs:[]}};
 const context=()=>({commandId:commandId('upload-'+(++n)),businessId,principal:{kind:'human' as const,id:'operator'},correlationId:correlationId('upload')}),runtime=await DurableRuntime.open({async load(){return state;},async save(value){state=structuredClone(value);}},{now:()=>now},{agent:()=>ids.agent('a'+(++n)),job:()=>ids.job('j'+(++n)),event:()=>eventId('e'+(++n))});
 const agent=(await runtime.createAgent(context(),{name:'Photo crew'})).record,other=(await runtime.createAgent(context(),{name:'Other crew'})).record,files=createStationAttachments(runtime,root),app=createControlCentre({runtime,businessIds:[businessId],context,assetRoot:new URL('../public/',import.meta.url),attachment:files.save,file:createStationFileReader(runtime,root),modelEnabled:true,run:async()=>{}});
 await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));const address=app.server.address();assert.ok(address&&typeof address!=='string');const base='http://127.0.0.1:'+address.port;
 try{const cookie=(await fetch(base)).headers.get('set-cookie')!.split(';')[0]!,headers={Cookie:cookie,Origin:base,'Content-Type':'application/json'},upload={agentId:agent.id,name:'actual.txt',mime:'text/plain',base64:Buffer.alloc(70_000,'x').toString('base64')};
 assert.equal((await fetch(base+'/api/attachment',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(upload)})).status,401);
 assert.equal((await fetch(base+'/api/attachment',{method:'POST',headers,body:JSON.stringify({...upload,agentId:'foreign'})})).status,409);
 const response=await fetch(base+'/api/attachment',{method:'POST',headers,body:JSON.stringify(upload)});assert.equal(response.status,200);const saved=await response.json() as {artifactId:string;attachment:{path:string;size:number}};assert.equal(saved.attachment.size,70_000);
 const fileUrl='/api/file?agent='+agent.id+'&path='+encodeURIComponent(saved.attachment.path);assert.equal((await fetch(base+fileUrl)).status,401);assert.equal((await fetch(base+fileUrl,{headers:{Cookie:cookie}})).status,200);assert.equal((await fetch(base+fileUrl.replace(agent.id,'foreign'),{headers:{Cookie:cookie}})).status,409);assert.equal((await fetch(base+'/api/file?agent='+agent.id+'&path=../outside',{headers:{Cookie:cookie}})).status,409);
 const send=(id:string)=>fetch(base+'/api/comms',{method:'POST',headers,body:JSON.stringify({agentId:id,objective:'Read actual file',attachmentIds:[saved.artifactId]})});assert.equal((await send(other.id)).status,409);assert.equal((await send(agent.id)).status,200);assert.equal(runtime.snapshot().authority.jobs.length,1);
 const input=runtime.snapshot().artifacts!.find(a=>a.id.startsWith('comms-input:'))!;assert.equal((input.content as {attachments:{path:string}[]}).attachments[0]!.path,saved.attachment.path);
 assert.equal((await fetch(base+'/api/attachment',{method:'POST',headers,body:JSON.stringify({...upload,base64:'bad!encoding'})})).status,409);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
