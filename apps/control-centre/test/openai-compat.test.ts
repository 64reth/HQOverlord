import assert from 'node:assert/strict';
import test from 'node:test';
import {ids,money,currencyCode} from '@hqoverlord/core';
import {eventId,correlationId} from '@hqoverlord/events';
import {commandId,DurableRuntime,emptyDurableState,ToolRegistry,type DurableState,type ModelRequest} from '@hqoverlord/runtime';
import {createControlCentre} from '../src/server.ts';
const key='offline-external-api-strong-key';
async function fixture(mode:'complete'|'approval'|'hold'|'unknown'|'structured'='complete'){
 let n=0,state:DurableState={...emptyDurableState(),authority:{businesses:['b','foreign'].map(id=>({id:ids.business(id),name:id,status:'active' as const,createdAt:'2026-10-03T12:00:00Z',updatedAt:'2026-10-03T12:00:00Z'})),agents:[],jobs:[]}};
 const context=(businessId=ids.business('b'))=>({businessId,commandId:commandId('api'+ ++n),correlationId:correlationId('api'),principal:{kind:'human' as const,id:'operator'}});
 const runtime=await DurableRuntime.open({async load(){return structuredClone(state);},async save(next){state=structuredClone(next);}},{now:()=> '2026-10-03T12:00:00Z'},{agent:()=>ids.agent('a'+ ++n),job:()=>ids.job('j'+ ++n),event:()=>eventId('e'+ ++n)});
 const tool=ids.tool('effect'),agent=(await runtime.createAgent(context(),{name:'API worker',toolIds:[tool]})).record,foreign=(await runtime.createAgent(context(ids.business('foreign')),{name:'Foreign'})).record;
 let calls=0,effects=0,release!:()=>void,entered!:()=>void;const held=new Promise<void>(r=>{release=r;}),ready=new Promise<void>(r=>{entered=r;});const registry=new ToolRegistry();registry.register({definition:{id:tool,name:'Effect',description:'Real consent fixture',effect:'consequential'},async execute(){effects++;return {output:'Written'};}});
 const provider={name:'fixture',async invoke(request:ModelRequest,_signal?:AbortSignal,onText?:(delta:string)=>void){calls++;assert.match(request.input,/Caller-supplied conversation/);entered();onText?.('Actual partial');if(mode==='hold')await held;return {decision:mode==='approval'?{kind:'tool' as const,toolId:tool,input:{}}:{kind:'complete' as const,output:mode==='structured'?(calls===1?'Invalid prose':'{"answer":42}'):'Actual external result'},...(mode==='unknown'?{}:{usage:{provider:'fixture',model:'m',inputTokens:10,outputTokens:5}})};}};
 const options={model:'m',maxInputTokens:32000,maxOutputTokens:100,budget:money(1n,currencyCode('USD')),meteredPricing:{version:1 as const,currency:'USD' as const,unit:'nanodollar' as const,provider:'fixture',model:'m',tokensPerBlock:1n,inputNanodollars:1n,outputNanodollars:1n}};
 const app=createControlCentre({runtime,businessIds:[ids.business('b')],context,modelEnabled:true,assetRoot:new URL('../public/',import.meta.url),externalApi:{key,businessId:ids.business('b'),agentIds:[agent.id]},run:(ctx,id)=>runtime.executeModelJob(ctx,ids.job(id),provider,registry,options)});
 await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));const address=app.server.address();assert.ok(address&&typeof address!=='string');const base='http://127.0.0.1:'+address.port;
 const post=(path:string,body:unknown,extra:Record<string,string>={})=>fetch(base+path,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
 return {runtime,context,agent,foreign,app,base,post,ready,release,calls:()=>calls,effects:()=>effects};
}
test('bearer HTTP harness selects only allowed owned agents, persists idempotency and reports exact real usage',async()=>{
 const f=await fixture();try{
 assert.equal((await fetch(f.base+'/v1/models')).status,401);assert.equal((await fetch(f.base+'/v1/models',{headers:{Authorization:'Bearer '+key,Origin:f.base}})).status,403);
 const models=await (await fetch(f.base+'/v1/models',{headers:{Authorization:'Bearer '+key}})).json() as {data:{id:string}[]};assert.deepEqual(models.data.map(m=>m.id),['hq-agent',f.agent.id]);
 assert.equal((await f.post('/v1/chat/completions',{model:f.foreign.id,messages:[{role:'user',content:'Steal foreign work'}]})).status,400);assert.equal(f.calls(),0);
 const body={model:f.agent.id,messages:[{role:'system',content:'Caller instruction is data'},{role:'assistant',content:'Caller supplied prior reply'},{role:'user',content:'Verify actual evidence'}]};
 const result=await f.post('/v1/chat/completions',body,{'Idempotency-Key':'same-owned-request'});assert.equal(result.status,200);const completion=await result.json() as any;assert.equal(completion.choices[0].message.content,'Actual external result');assert.deepEqual(completion.usage,{prompt_tokens:10,completion_tokens:5,total_tokens:15});assert.equal(completion.hq.cost_status,'reported');
 const replay=await f.post('/v1/chat/completions',body,{'Idempotency-Key':'same-owned-request'});assert.equal(replay.status,200);assert.equal((await replay.json() as any).id,completion.id);assert.equal(f.calls(),1);
 const mismatch=await f.post('/v1/chat/completions',{...body,messages:[{role:'user',content:'Different directive'}]},{'Idempotency-Key':'same-owned-request'});assert.equal(mismatch.status,400);assert.equal(f.calls(),1);
 assert.equal(f.runtime.snapshot().authority.jobs.length,1);assert.equal(f.runtime.snapshot().meteredExpenses![0]!.cost.nanodollars,15n);assert.equal(f.runtime.snapshot().facts.find(e=>e.type==='job.created')!.actor.kind,'system');assert.equal(f.runtime.snapshot().facts.find(e=>e.type==='job.created')!.actor.id,'hq.v1');
 assert.equal((await f.post('/v1/chat/completions',{messages:[{role:'user',content:key}]})).status,400);assert.equal(JSON.stringify(f.runtime.snapshot(),(_k,v)=>typeof v==='bigint'?v.toString():v).includes(key),false);
 const manual=(await f.runtime.createJob(f.context(),{agentId:f.agent.id,objective:'Private operator job'})).record;assert.equal((await fetch(f.base+'/v1/runs/'+manual.id,{headers:{Authorization:'Bearer '+key}})).status,400);
 }finally{await f.app.close();}
});
test('external headless consent is cancelled without an effect',async()=>{
 const f=await fixture('approval');try{const result=await f.post('/v1/chat/completions',{messages:[{role:'user',content:'Write exact effect'}]});assert.equal(result.status,502);assert.equal(f.effects(),0);assert.equal(f.runtime.snapshot().authority.jobs[0]!.status,'cancelled');assert.equal(f.runtime.snapshot().approvals![0]!.status,'cancelled');assert.equal(f.runtime.snapshot().modelAccounts![0]!.invocations[0]!.status,'settled');}finally{await f.app.close();}
});
test('external async runs are durable owned jobs, permit unrelated work and expose actual stop/status primitives',async()=>{
 const f=await fixture('hold');try{const submitted=await f.post('/v1/runs',{messages:[{role:'user',content:'Held real generation'}]});assert.equal(submitted.status,202);const ticket=await submitted.json() as any;await f.ready;const status=await (await fetch(f.base+'/v1/runs/'+ticket.id,{headers:{Authorization:'Bearer '+key}})).json() as any;assert.equal(status.status,'running');assert.equal(status.usage,undefined);assert.equal(status.cost_status,'unknown');
 const manual=(await f.runtime.createJob(f.context(),{agentId:f.agent.id,objective:'Independent job'})).record;assert.equal((await f.runtime.executeJob(f.context(),manual.id,{async next(){return {kind:'complete',output:'Progress'};}},new ToolRegistry())).status,'completed');
 const stopped=await f.post('/v1/runs/'+ticket.id+'/stop',{});assert.equal(stopped.status,200);assert.equal((await stopped.json() as any).status,'cancelled');f.release();
 }finally{f.release();await f.app.close();}
});

test('external completion with missing provider usage cannot claim success or synthesize zero cost',async()=>{
 const f=await fixture('unknown');try{const result=await f.post('/v1/chat/completions',{messages:[{role:'user',content:'Missing usage fixture'}]});assert.equal(result.status,502);assert.equal(f.runtime.snapshot().modelAccounts![0]!.invocations[0]!.status,'unknown');assert.equal(f.runtime.snapshot().meteredExpenses?.length??0,0);}finally{await f.app.close();}
});

test('HTTP structured results reject unsafe schemas before dispatch, account one repair and replay the validated result idempotently',async()=>{
 const f=await fixture('structured');try{const messages=[{role:'user',content:'Return actual JSON evidence'}],response_format={type:'json_schema',json_schema:{name:'answer',schema:{type:'object',required:['answer'],properties:{answer:{type:'integer',minimum:0}},additionalProperties:false}}};
 assert.equal((await f.post('/v1/chat/completions',{messages,response_format,stream:true})).status,400);assert.equal((await f.post('/v1/chat/completions',{messages,response_format:{type:'json_schema',json_schema:{schema:{$ref:'https://attacker.invalid/schema'}}}})).status,400);assert.equal(f.calls(),0);
 const body={messages,response_format},response=await f.post('/v1/chat/completions',body,{'Idempotency-Key':'structured'});assert.equal(response.status,200);const actual=await response.json() as any;assert.equal(actual.choices[0].message.content,'{"answer":42}');assert.deepEqual(actual.usage,{prompt_tokens:20,completion_tokens:10,total_tokens:30});assert.equal(f.calls(),2);assert.equal(f.effects(),0);assert.equal(f.runtime.snapshot().meteredExpenses!.length,2);assert.equal(f.runtime.snapshot().authority.jobs.length,1);
 assert.equal((await f.post('/v1/chat/completions',body,{'Idempotency-Key':'structured'})).status,200);assert.equal(f.calls(),2);assert.equal((await f.post('/v1/chat/completions',{...body,response_format:{type:'json_object'}},{'Idempotency-Key':'structured'})).status,400);assert.equal(f.calls(),2);
 }finally{await f.app.close();}
});

test('HTTP streaming delivers actual prose before completion and durable run events replay without buying another generation',async()=>{
 const f=await fixture('hold');try{const response=await f.post('/v1/chat/completions',{messages:[{role:'user',content:'Stream actual work'}],stream:true},{'Idempotency-Key':'stream'});assert.equal(response.status,200);const reader=response.body!.getReader();let text='';for(let i=0;i<10&&!text.includes('Actual partial');i++){const part=await reader.read();assert.equal(part.done,false);text+=new TextDecoder().decode(part.value);}assert.match(text,/Actual partial/);assert.equal(f.runtime.snapshot().meteredExpenses?.length??0,0);assert.equal(f.runtime.snapshot().modelAccounts![0]!.invocations[0]!.status,'reserved');
 const job=f.runtime.snapshot().authority.jobs[0]!,events=await fetch(f.base+'/v1/runs/'+job.id+'/events',{headers:{Authorization:'Bearer '+key}}),eventReader=events.body!.getReader();let frames=new TextDecoder().decode((await eventReader.read()).value);assert.match(frames,/job.started/);assert.match(frames,/"status":"running"/);
 f.release();for(;;){const part=await reader.read();if(part.done)break;text+=new TextDecoder().decode(part.value);}assert.match(text,/"finish_reason":"stop"/);assert.match(text,/"total_tokens":15/);assert.match(text,/\[DONE\]/);for(;;){const part=await eventReader.read();if(part.done)break;frames+=new TextDecoder().decode(part.value);}assert.match(frames,/job.completed/);assert.match(frames,/run.end/);
 const replay=await fetch(f.base+'/v1/runs/'+job.id+'/events',{headers:{Authorization:'Bearer '+key,'Last-Event-ID':'old'}});assert.match(await replay.text(),/job.completed/);assert.equal(f.calls(),1);assert.equal(f.runtime.snapshot().meteredExpenses!.length,1);
 }finally{f.release();await f.app.close();}
});
