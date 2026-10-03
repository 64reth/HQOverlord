import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url);

test("the carried cron parser executes once, interval and timezone/DST calendar semantics",()=>{
  const cron=require('../vendor/starnet/sidecar/cron.js'),now=Date.UTC(2026,2,7,13,58);
  const once=cron.parseSchedule('in 2h',now);assert.equal(cron.nextFireAt(once,null,now),now+7200000);
  assert.equal(cron.nextFireAt(once,new Date(now+7200000).toISOString(),now+7200000),null);
  const interval=cron.parseSchedule('every 30m',now);assert.equal(cron.nextFireAt(interval,null,now),now+1800000);
  const calendar=cron.parseSchedule('0 9 * * *',now,{tz:'America/New_York'});
  const first=cron.nextFireAt(calendar,null,now),second=cron.nextFireAt(calendar,new Date(first).toISOString(),first);
  assert.equal(first,Date.UTC(2026,2,7,14));assert.equal(second,Date.UTC(2026,2,8,13));assert.equal(second-first,23*3600000);
  assert.equal(cron.parseSchedule('0 9 * * *',now,{tz:'Invalid/Zone'}),null);
});

for(const kind of ['telegram','discord','signal'] as const)test(`${kind} uses the actual REST send transport and reports the platform acknowledgement`,async()=>{
  const factory=require(`../vendor/starnet/sidecar/channels/${kind}.transport.js`),calls:{url:string;body:any}[]=[];
  const options={token:'fixture-token',account:'+15550000001',endpoint:'http://127.0.0.1:8080',fetch:async(url:string,init:any)=>{
    calls.push({url,body:JSON.parse(init.body)});
    return Response.json(kind==='telegram'?{ok:true,result:{message_id:99}}:kind==='discord'?{id:'99'}:{timestamp:99});
  }};
  const name=`make${kind[0]!.toUpperCase()+kind.slice(1)}Transport`,transport=factory[name](options);
  const sent=await transport.send('destination','Actual result');assert.equal(sent.ok,true);assert.equal(sent.messageId,'99');assert.equal(calls.length,1);
  assert.match(calls[0]!.url,kind==='telegram'?/sendMessage/:kind==='discord'?/channels\/destination\/messages/:/v2\/send/);
  assert.match(JSON.stringify(calls[0]!.body),/Actual result/);
});

test("Slack reports a real handshake and acknowledges event envelopes only after durable intake",async()=>{
  const {makeSlackTransport}=require("../vendor/starnet/sidecar/channels/slack.transport.js");
  let socket:any;
  class Socket {
    onopen?:()=>void;onmessage?:(event:{data:string})=>void;onclose?:()=>void;sent:string[]=[];
    constructor(){socket=this;}
    send(text:string){this.sent.push(text);}close(){this.onclose?.();}
  }
  const transport=makeSlackTransport({botToken:"fixture-bot",appToken:"fixture-app",WebSocketImpl:Socket,sleep:async()=>{},fetch:async()=>Response.json({ok:true,url:"wss://fixture.invalid"})});
  await transport.connect();
  await assert.rejects(transport.getUpdates({}),/not open yet|socket lost/);
  socket.onopen();
  socket.onmessage({data:JSON.stringify({type:"events_api",envelope_id:"e1",payload:{event:{type:"message",text:"actual input"}}})});
  assert.deepEqual(socket.sent,[]);
  const updates=await transport.getUpdates({});assert.equal(updates.length,1);
  assert.deepEqual(socket.sent,[]);
  await transport.acknowledge(updates[0]);assert.deepEqual(socket.sent,[JSON.stringify({envelope_id:"e1"})]);
  await transport.acknowledge(updates[0]);assert.equal(socket.sent.length,1);
  transport.disconnect();
});

test("Matrix advances a batch cursor only after every input is durably accepted; a failed intake is replayed",async()=>{
  const {makeMatrixTransport}=require("../vendor/starnet/sidecar/channels/matrix.transport.js");
  const urls:string[]=[];
  const transport=makeMatrixTransport({homeserver:"https://matrix.invalid",token:"fixture-token",newId:()=>"txn",fetch:async(url:string)=>{
    urls.push(url);if(url.endsWith("whoami"))return Response.json({user_id:"@bot:test"});
    if(url.endsWith("timeout=0"))return Response.json({next_batch:"initial"});
    return Response.json({next_batch:"advanced",rooms:{join:{"!room:test":{timeline:{events:[{event_id:"one"},{event_id:"two"}]}}}}});
  }});
  assert.deepEqual(await transport.getUpdates({}),[]);
  let updates=await transport.getUpdates({});assert.equal(transport._internals.since,"initial");
  await transport.acknowledge(updates[0]);assert.equal(transport._internals.since,"initial");
  updates=await transport.getUpdates({});assert.match(urls.at(-1)!,/since=initial/);
  await transport.acknowledge(updates[0]);await transport.acknowledge(updates[1]);assert.equal(transport._internals.since,"advanced");
});


test('Matrix restart resumes the durable accepted batch and retries an uncommitted cursor without dropping backlog',async()=>{
  const {makeMatrixTransport}=require('../vendor/starnet/sidecar/channels/matrix.transport.js');let saved='accepted',fail=true;const urls:string[]=[];
  const options={homeserver:'https://matrix.invalid',token:'fixture',newId:()=> 'txn',initialSince:saved,onCursor:async(value:string)=>{if(fail)throw new Error('disk unavailable');saved=value;},fetch:async(url:string)=>{urls.push(url);return Response.json(url.endsWith('whoami')?{user_id:'@bot:test'}:{next_batch:'next',rooms:{join:{'!room:test':{timeline:{events:[{event_id:'actual-unclaimed'}]}}}}});}};
  const first=makeMatrixTransport(options);let updates=await first.getUpdates({});assert.equal(updates.length,1);assert.match(urls.at(-1)!,/since=accepted/);await assert.rejects(first.acknowledge(updates[0]),/disk unavailable/);assert.equal(first._internals.since,'accepted');assert.equal(saved,'accepted');
  fail=false;const restarted=makeMatrixTransport({...options,initialSince:saved});updates=await restarted.getUpdates({});assert.equal(updates[0].event.event_id,'actual-unclaimed');await restarted.acknowledge(updates[0]);assert.equal(saved,'next');assert.equal(restarted._internals.since,'next');
});

test('Discord gateway resumes the actual session and sequence after a drop, rejects self echoes and cancels reconnect timers',async()=>{
 const {makeDiscordGateway}=require('../vendor/starnet/sidecar/channels/discord.gateway.js');const sockets:any[]=[],timers=new Map<number,{fn:()=>void;ms:number}>(),received:any[]=[];let n=0;
 class Socket{readyState=1;sent:any[]=[];onmessage?:Function;onclose?:Function;onopen?:Function;onerror?:Function;url:string;constructor(url:string){this.url=url;sockets.push(this);}send(text:string){this.sent.push(JSON.parse(text));}close(){this.readyState=3;}}
 const client=makeDiscordGateway({token:'fixture',gatewayUrl:'wss://gateway.invalid',WebSocketImpl:Socket,onMessage:(m:any)=>received.push(m),setTimeoutImpl:(fn:()=>void,ms:number)=>{timers.set(++n,{fn,ms});return n;},clearTimeoutImpl:(id:number)=>timers.delete(id),random:()=>0.5});await Promise.resolve();
 const emit=(socket:any,value:any)=>socket.onmessage({data:JSON.stringify(value)});emit(sockets[0],{op:10,d:{heartbeat_interval:10000}});assert.equal(sockets[0].sent[0].op,2);emit(sockets[0],{op:0,t:'READY',s:7,d:{session_id:'actual-session',resume_gateway_url:'wss://resume.invalid',user:{id:'bot'}}});emit(sockets[0],{op:0,t:'MESSAGE_CREATE',s:8,d:{id:'own',author:{id:'bot'}}});emit(sockets[0],{op:0,t:'MESSAGE_CREATE',s:9,d:{id:'human',author:{id:'owner'}}});assert.deepEqual(received.map(m=>m.id),['human']);sockets[0].onclose({code:1006});const retry=[...timers.entries()].find(([,t])=>t.ms===750)!;assert.ok(retry);timers.delete(retry[0]);retry[1].fn();await Promise.resolve();emit(sockets[1],{op:10,d:{heartbeat_interval:10000}});assert.match(sockets[1].url,/resume.invalid/);assert.deepEqual(sockets[1].sent[0],{op:6,d:{token:'fixture',session_id:'actual-session',seq:9}});client.close();assert.equal(timers.size,0);assert.equal(sockets[1].readyState,3);
});

test('Slack keeps unacknowledged buffered input across a socket drop and only reports the actual reopened handshake',async()=>{
 const {makeSlackTransport}=require('../vendor/starnet/sidecar/channels/slack.transport.js');const sockets:any[]=[];let opens=0;
 class Socket{onopen?:Function;onmessage?:Function;onclose?:Function;sent:string[]=[];constructor(){sockets.push(this);}send(text:string){this.sent.push(text);}close(){this.onclose?.();}}
 const transport=makeSlackTransport({botToken:'fixture-bot',appToken:'fixture-app',WebSocketImpl:Socket,sleep:async()=>{},fetch:async()=>{opens++;return Response.json({ok:true,url:'wss://fixture.invalid'});}});await transport.connect();sockets[0].onopen();sockets[0].onmessage({data:JSON.stringify({type:'events_api',envelope_id:'buffered',payload:{event:{type:'message',text:'Actual buffered work'}}})});sockets[0].close();const batch=await transport.getUpdates({});assert.equal(batch[0].text,'Actual buffered work');assert.equal(sockets[0].sent.length,0);await assert.rejects(transport.getUpdates({}),/not open|socket lost/);assert.equal(opens,2);sockets[1].onopen();assert.deepEqual(await transport.getUpdates({}),[]);transport.disconnect();
});
