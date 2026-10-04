'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createVoiceStream, makeVoiceStreams} = require('../sidecar/voice-stream');
const tick = async () => { for (let i=0;i<20;i++) await Promise.resolve(); };
const pcm = n => Buffer.alloc(n * 4);
const hypothesis = (...text) => ({text: text.join(' '), chunks:text.map((t,i)=>({text:' '+t,timestamp:[i*.2,(i+1)*.2]}))});
(async () => {
  let time=100;const timed=createVoiceStream({now:()=>time,transcribe:async()=>{time+=7;return hypothesis('timed');}});
  timed.push(pcm(8000));await tick();assert.equal(timed.snapshot().metrics.firstPartialMs,7);assert.equal(timed.snapshot().metrics.recognitionMs,7);timed.cancel();
  let calls=0;
  const s=createVoiceStream({transcribe:async()=>++calls===1?hypothesis('turn','write'):hypothesis('turn','right','now')});
  s.push(pcm(8000)); await tick();
  assert.equal(s.snapshot().partial,'turn write');
  s.push(pcm(8000)); await tick();
  assert.equal(s.snapshot().stable,'turn');
  assert.equal(s.snapshot().partial,'right now','provisional words can be corrected');
  const done=await s.finish();
  assert.equal(done.text,'turn right now'); assert.equal(calls,2,'finish reuses recognition of the exact complete audio');
  assert.throws(()=>s.push(pcm(10)),/closed/);
  let signal, resolve;
  const cancel=createVoiceStream({transcribe:(b,o)=>{signal=o.signal;return new Promise(r=>resolve=r);}});
  cancel.push(pcm(8000)); cancel.cancel(); assert.equal(signal.aborted,true);
  resolve(hypothesis('late')); await tick(); assert.equal(cancel.snapshot().text,'');
  const invalid=createVoiceStream({transcribe:async()=>hypothesis('ok')});
  const bad=Buffer.alloc(4);bad.writeFloatLE(NaN);
  assert.throws(()=>invalid.push(bad),/Invalid/);
  assert.throws(()=>invalid.push(pcm(16001)),/Invalid/); invalid.cancel();
  // Longer than one recognition window: keep context at the boundary, never grow decoder input.
  let largest=0;
  const long=createVoiceStream({transcribe:async b=>{
    largest=Math.max(largest,b.length/4);
    const start=b.readFloatLE(0), length=b.length/4/16000;
    const chunks=[];for(let word=Math.ceil(start);word+.5<=start+length;word++) chunks.push({text:' word'+word,timestamp:[word-start,word+.5-start]});
    return {text:chunks.length?'words':'',chunks};
  }});
  for(let sec=0;sec<20;sec++) {const b=pcm(16000);for(let j=0;j<16000;j++)b.writeFloatLE(sec+j/16000,j*4);long.push(b);await tick();}
  const longDone=await long.finish();assert.ok(largest<=128000);assert.equal(longDone.text,Array.from({length:20},(_,i)=>'word'+i).join(' '),'window rollover preserves every word exactly once');
  const shifted=createVoiceStream({transcribe:async b=>{
    const start=b.readFloatLE(0),end=start+b.length/4/16000,chunks=[];
    for(let word=Math.floor(start);word+.5<=end;word++)chunks.push({text:' word'+word,timestamp:[Math.max(0,word-start),word+.5-start+(word<start?.4:0)]});
    return {text:chunks.length?'words':'',chunks};
  }});
  for(let sec=0;sec<20;sec++){const b=pcm(16000);for(let j=0;j<16000;j++)b.writeFloatLE(sec+j/16000,j*4);shifted.push(b);await tick();}
  assert.equal((await shifted.finish()).text,Array.from({length:20},(_,i)=>'word'+i).join(' '),'timestamp expansion of an overlapping word cannot duplicate it');
  const repeated=createVoiceStream({transcribe:async b=>{
    const start=b.readFloatLE(0),end=start+b.length/4/16000,chunks=[];
    for(let word=Math.ceil(start);word+.5<=end;word++)chunks.push({text:' and',timestamp:[word-start,word+.5-start]});
    return {text:chunks.length?'and':'',chunks};
  }});
  for(let sec=0;sec<20;sec++){const b=pcm(16000);for(let j=0;j<16000;j++)b.writeFloatLE(sec+j/16000,j*4);repeated.push(b);await tick();}
  assert.equal((await repeated.finish()).text,Array(20).fill('and').join(' '),'repeated words outside the timestamp overlap must not be deduplicated');
  let clock=0;
  const manager=makeVoiceStreams({localVoice:{status:()=>({available:true}),transcribe:async()=>hypothesis('hello')},now:()=>clock});
  const ids=Array.from({length:4},()=>manager.open().id);assert.throws(()=>manager.open(),/Too many/);
  await manager.action(ids[0],'cancel');manager.open();clock=31000;
  assert.ok(manager.open().id);await assert.rejects(manager.action(ids[1],'audio',pcm(100)),/expired/);manager.close();
  // Browser transport drives the same backend session seam: ordered uploads and no final full re-upload.
  const backend=makeVoiceStreams({localVoice:{status:()=>({available:true}),transcribe:async()=>hypothesis('hello','world')}});
  let timer, uploads=[],updates=[];
  const sandbox={console,AbortController,Float32Array,encodeURIComponent,setTimeout,clearTimeout,setInterval:f=>(timer=f,1),clearInterval(){},
    fetch:async(url,opts)=>{const q=new URL(url,'http://local').searchParams;const a=q.get('action');let result;
      if(a==='open')result=backend.open();else{if(a==='audio')uploads.push(new Float32Array(opts.body).length);result=await backend.action(q.get('id'),a,opts.body?Buffer.from(opts.body):undefined);}
      return {ok:true,json:async()=>result};}};
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../frontend/app/voice-stream.js'),'utf8')+'\nthis.api=VoiceStream;',sandbox);
  const client=sandbox.api.open({rate:16000,onUpdate:v=>updates.push(v)});
  for(let i=0;i<8;i++)client.push(new Float32Array(2000));timer();await tick();
  const result=await client.finish();assert.equal(result.text,'hello world');
  assert.equal(uploads.reduce((a,b)=>a+b,0),16000,'each sample uploaded once');assert.ok(uploads.every(n=>n<=12800));
  assert.ok(updates.some(v=>v.text==='hello world'));backend.close();
  let openResponse, released=false;
  sandbox.fetch=(url)=>url.includes('action=open') ? new Promise(resolve=>{openResponse=resolve;}) : (released=true,Promise.resolve({ok:true,json:async()=>({})}));
  const abandoned=sandbox.api.open({rate:16000});abandoned.cancel();
  openResponse({ok:true,json:async()=>({id:'late-session'})});await tick();
  assert.equal(released,true,'cancelling during open releases the eventual server session');
  let deadline;
  sandbox.setTimeout=f=>(deadline=f,1);sandbox.clearTimeout=()=>{};
  sandbox.fetch=(url,opts)=>new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>reject(new Error('request timed out'))));
  const stalled=sandbox.api.open({rate:16000});deadline();await tick();
  assert.equal(stalled.failed,true,'unresponsive speech connection leaves a recoverable failed state');
  await assert.rejects(stalled.finish(),/failed/);stalled.cancel();
  console.log('voice-stream.test: streaming correction, final reuse, cancellation, bounds, expiry, and browser transport passed');
})().catch(e=>{console.error(e);process.exitCode=1});

