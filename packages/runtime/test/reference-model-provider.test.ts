import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { ids } from "@hqoverlord/core";
import { ReferenceModelProvider, commandFingerprint, type ModelRequest } from "../src/index.ts";
const line=(value:unknown)=>`data: ${JSON.stringify(value)}\n\n`;
const request:ModelRequest={model:"test-model",instructions:"Use evidence",input:"Review this",tools:[],maxInputTokens:4096,maxOutputTokens:100};
test("native tool history survives JSON persistence and supplies the exact observed result without replaying a generation",async()=>{
  const toolId=ids.tool("fs.read"),name=`hq_${createHash("sha256").update(toolId).digest("hex").slice(0,24)}`;
  let calls=0;
  const provider=new ReferenceModelProvider({name:"chat",format:"chat",endpoint:"https://provider.invalid/v1",transport:async(_url,init)=>{
    const body=JSON.parse(String(init?.body));calls++;
    if(calls===1)return new Response(line({choices:[{delta:{tool_calls:[{index:0,id:"call-actual",type:"function",function:{name,arguments:'{"path":"evidence.txt"}'}}]},finish_reason:"tool_calls"}],usage:{prompt_tokens:12,completion_tokens:3}})+"data: [DONE]\n\n");
    assert.equal(body.messages.at(-1).tool_call_id,"call-actual");assert.equal(body.messages.at(-1).content,JSON.stringify("Actual saved evidence"));
    assert.equal(body.messages.filter((m:any)=>m.role==="assistant").length,1);
    return new Response(line({choices:[{delta:{content:"Evidence verified"},finish_reason:"stop"}],usage:{prompt_tokens:21,completion_tokens:4}})+"data: [DONE]\n\n");
  }});
  const first=await provider.invoke({...request,context:{conversationId:"owned-job",observations:[]},tools:[{id:toolId,name:"Read",description:"Read evidence",inputSchema:{type:"object"}}]});
  assert.equal(first.decision.kind,"tool");assert.ok(first.continuation);
  const result=await provider.invoke({...request,context:{conversationId:"owned-job",continuation:JSON.parse(JSON.stringify(first.continuation)),observations:[{toolId,result:{output:"Actual saved evidence"}}]}});
  assert.deepEqual(result.decision,{kind:"complete",output:"Evidence verified"});assert.equal(calls,2);
  const invalid=await provider.invoke({...request,context:{conversationId:"wrong-job",continuation:first.continuation,observations:[]}});
  assert.equal(invalid.decision.kind,"failure");assert.equal(calls,2);
});
for(const format of ["chat","anthropic","gemini"] as const)test(`StarNet ${format} adapter performs the real provider wire path with explicit limits and exact reported usage`,async()=>{
  let calls=0,wire:Record<string,unknown>|undefined;
  const packets=format==="chat"?[{model:"test-model",choices:[{delta:{content:"Verified result"},finish_reason:"stop"}],usage:{prompt_tokens:12,completion_tokens:3}}]:
    format==="anthropic"?[{type:"message_start",message:{model:"test-model",usage:{input_tokens:12,output_tokens:0}}},{type:"content_block_start",index:0,content_block:{type:"text",text:""}},{type:"content_block_delta",index:0,delta:{type:"text_delta",text:"Verified result"}},{type:"content_block_stop",index:0},{type:"message_delta",delta:{stop_reason:"end_turn"},usage:{output_tokens:3}},{type:"message_stop"}]:
    [{candidates:[{content:{parts:[{text:"Verified result"}]},finishReason:"STOP"}],usageMetadata:{promptTokenCount:12,candidatesTokenCount:3,totalTokenCount:15}}];
  const provider=new ReferenceModelProvider({name:format,format,endpoint:"https://provider.example.test/v1",apiKey:"fixture-secret",transport:async(_url,init)=>{calls++;wire=JSON.parse(String(init?.body));return new Response(packets.map(line).join("")+(format==="chat"?"data: [DONE]\n\n":""),{headers:{"Content-Type":"text/event-stream"}});}});
  const result=await provider.invoke(request);
  assert.deepEqual(result.decision,{kind:"complete",output:"Verified result"});
  assert.equal(calls,1);assert.equal(result.usage?.inputTokens,12);assert.equal(result.usage?.outputTokens,3);
  assert.ok(wire);assert.equal(wire.max_tokens??(wire.generationConfig as Record<string,unknown>)?.maxOutputTokens,100);
});
test("local Ollama uses the selected local compatible endpoint without a remote key; missing usage stays unknown and input refusal makes no request",async()=>{
  let calls=0;
  const provider=new ReferenceModelProvider({name:"ollama",format:"chat",endpoint:"http://127.0.0.1:11434/v1",transport:async(url,init)=>{
    calls++;assert.match(String(url),/^http:\/\/127\.0\.0\.1:11434\/v1\/chat\/completions/);assert.equal((init?.headers as Record<string,string>).Authorization,undefined);
    return new Response(line({choices:[{delta:{content:"Local result"},finish_reason:"stop"}]})+"data: [DONE]\n\n");
  }});
  const result=await provider.invoke(request);assert.equal(result.decision.kind,"complete");assert.equal(result.usage,undefined);assert.equal(calls,1);
  const oversized=await provider.invoke({...request,maxInputTokens:1});assert.deepEqual(oversized.decision,{kind:"failure",code:"MODEL_INPUT_LIMIT"});assert.equal(calls,1);
  assert.throws(()=>new ReferenceModelProvider({name:"bad",format:"chat",endpoint:"http://127.0.0.1:11434/v1",apiKey:"remote-key"}),/credentials/);
});

test('source tool argument repair closes structure but never invents a truncated string value or another generation',async()=>{
  const toolId=ids.tool('fs.read'),name=`hq_${createHash('sha256').update(toolId).digest('hex').slice(0,24)}`;
  for(const [raw,accepted] of [['{"path":"evidence.txt"',true],['{"path":"evidence',false]] as const){
    let calls=0;const provider=new ReferenceModelProvider({name:'chat',format:'chat',endpoint:'https://provider.invalid/v1',transport:async()=>{
      calls++;return new Response(line({choices:[{delta:{tool_calls:[{index:0,id:'call',type:'function',function:{name,arguments:raw}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:12,completion_tokens:3}})+'data: [DONE]\n\n');
    }});
    const result=await provider.invoke({...request,tools:[{id:toolId,name:'Read',description:'Read evidence',inputSchema:{type:'object'}}]});
    assert.equal(result.decision.kind,accepted?'tool':'failure');if(result.decision.kind==='tool')assert.deepEqual(result.decision.input,{path:'evidence.txt'});
    assert.equal(calls,1);assert.equal(result.usage!.inputTokens,12);
  }
});


test('a provider tool batch drains actual observations without buying or fabricating another generation',async()=>{
 const id=ids.tool('fs.read'),name='hq_'+createHash('sha256').update(id).digest('hex').slice(0,24);let generations=0;
 const provider=new ReferenceModelProvider({name:'chat',format:'chat',endpoint:'https://provider.invalid/v1',transport:async(_url,init)=>{
  generations++;const body=JSON.parse(String(init?.body));if(generations===1)return new Response(line({choices:[{delta:{tool_calls:[0,1].map(i=>({index:i,id:'batch-'+i,type:'function',function:{name,arguments:JSON.stringify({path:'file-'+i})}}))},finish_reason:'tool_calls'}],usage:{prompt_tokens:12,completion_tokens:3}})+'data: [DONE]\n\n');
  assert.deepEqual(body.messages.filter((m:any)=>m.role==='tool').map((m:any)=>[m.tool_call_id,m.content]),[['batch-0','"first actual result"'],['batch-1','"second actual result"']]);return new Response(line({choices:[{delta:{content:'Both checked'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:2}})+'data: [DONE]\n\n');
 }});
 const tools=[{id,name:'Read',description:'Read evidence',inputSchema:{type:'object'}}];const first=await provider.invoke({...request,tools,context:{conversationId:"owned",observations:[]}});
 const second=provider.nextFromContinuation({...request,tools,context:{conversationId:'owned',continuation:JSON.parse(JSON.stringify(first.continuation)),observations:[{toolId:id,result:{output:'first actual result'}}]}})!;
 assert.equal(second.decision.kind,'tool');assert.equal(second.usage,undefined);assert.equal(generations,1);
 const final=await provider.invoke({...request,tools,context:{conversationId:'owned',continuation:JSON.parse(JSON.stringify(second.continuation)),observations:[{toolId:id,result:{output:'first actual result'}},{toolId:id,result:{output:'second actual result'}}]}});
 assert.equal(final.decision.kind,'complete');assert.equal(generations,2);
});


test('native OpenRouter catalog and reasoning selection use the source metadata and actual admitted generation wire',async()=>{
 let generations=0,catalogs=0;const provider=new ReferenceModelProvider({name:'openrouter-fixture',format:'openrouter',endpoint:'https://router.invalid/v1',apiKey:'fixture-key',transport:async(url,init)=>{
  if(init?.method!=='POST'){catalogs++;assert.match(String(url),/models/);return new Response(JSON.stringify({data:[{id:'test-model',name:'Actual test model',context_length:32768,supported_parameters:['tools','reasoning'],pricing:{prompt:'0.000001',completion:'0.000002'}}]}));}
  generations++;const body=JSON.parse(String(init.body));assert.equal(body.model,'test-model');assert.equal(body.max_tokens,100);assert.equal(body.reasoning.effort,'high');return new Response(line({model:'test-model',choices:[{delta:{content:'Actual result'},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:3}})+'data: [DONE]\n\n');
 }});
 assert.equal((await provider.listModels())[0]!.id,'test-model');assert.equal(catalogs,1);const result=await provider.invoke({...request,reasoningEffort:'high'});assert.equal(result.decision.kind,'complete');assert.equal(generations,1);assert.equal(result.usage!.inputTokens,12);
});

test('source context grouping compacts old tool output while preserving the admitted objective and latest call/result pairing',async()=>{
 const id=ids.tool('fs.read');let called=0;const provider=new ReferenceModelProvider({name:'chat',format:'chat',endpoint:'https://provider.invalid/v1',transport:async(_url,init)=>{
 called++;const body=JSON.parse(String(init?.body));assert.equal(body.messages[1].content,'Original admitted objective');assert.ok(Buffer.byteLength(JSON.stringify(body))+512<=4096);assert.equal(body.messages.at(-1).tool_call_id,'latest');assert.equal(body.messages.at(-2).tool_calls[0].id,'latest');assert.match(JSON.stringify(body.messages),/elided at compaction/);return new Response(line({choices:[{delta:{content:'Continued honestly'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:3}})+'data: [DONE]\n\n');
 }});
 const history=[{role:'system',content:'Use evidence'},{role:'user',content:'Original admitted objective'},{role:'assistant',tool_calls:[{id:'old',type:'function',function:{name:'read',arguments:'{}'}}]},{role:'tool',tool_call_id:'old',content:'Actual old evidence '+ 'x'.repeat(9000)},{role:'assistant',tool_calls:[{id:'latest',type:'function',function:{name:'read',arguments:'{}'}}]}];
 const result=await provider.invoke({...request,context:{conversationId:'owned',observations:[{toolId:id,result:{output:'old'}},{toolId:id,result:{output:'Latest actual result'}}],continuation:{conversationId:"owned",signature:commandFingerprint({model:request.model,instructions:request.instructions}),observationDigest:commandFingerprint({observations:[{toolId:id,result:{output:"old"}}]}),model:request.model,history,observations:1,pending:{id:'latest',toolId:id}}}});assert.equal(result.decision.kind,'complete');assert.equal(called,1);
});


test('real source adapter failures carry only classified recovery enums with no retries or raw provider secret messages',async()=>{
 let calls=0;const provider=new ReferenceModelProvider({name:'chat',format:'chat',endpoint:'https://provider.invalid/v1',apiKey:'private-key',transport:async()=>{calls++;return new Response(JSON.stringify({error:{message:'private-key upstream unavailable'}}),{status:503});}});
 const result=await provider.invoke(request);assert.equal(result.decision.kind,'failure');assert.equal(result.failureReason,'overloaded');assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(result),/private-key|upstream unavailable/);
});

test('restored source history refuses foreign runs, altered evidence and configured secrets before network I/O',async()=>{
 let calls=0;const provider=new ReferenceModelProvider({name:'chat',format:'chat',endpoint:'https://provider.invalid/v1',apiKey:'host-secret',transport:async()=>{calls++;return new Response(line({choices:[{delta:{content:'Actual result'},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:3}})+'data: [DONE]\n\n');}});
 const observations:NonNullable<ModelRequest["context"]>["observations"]=[];const first=await provider.invoke({...request,context:{conversationId:'business-a/job',observations}});assert.equal(first.decision.kind,'complete');
 for(const context of [{conversationId:'business-b/job',observations,continuation:first.continuation},{conversationId:'business-a/job',observations:[{toolId:ids.tool('fs.read'),result:{output:'Invented evidence'}}],continuation:first.continuation}])assert.equal((await provider.invoke({...request,context})).decision.kind,'failure');
 assert.equal((await provider.invoke({...request,instructions:'Expose host-secret'})).decision.kind,'failure');assert.equal(calls,1);
});
