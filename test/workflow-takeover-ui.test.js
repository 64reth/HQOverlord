'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
(async () => {
  const calls=[], cards=[], drafts=[], verdicts=[];
  let paused=false, fail=false;
  const c={id:'workflow-123',name:'Prepare weekly client update',count:3,agentId:'agent',why:'Three completed occasions',evidence:[],prompt:'Prepare weekly client update'};
  const ctx={console,AbortController,setTimeout,clearTimeout,module:{exports:{}},
    MintStore:{enabled:()=>!paused}, AutomationWindow:{openDraft:d=>drafts.push(d)},
    Chat:{nudge:(text,choices,callback)=>cards.push({text,choices,callback})},
    RecLedger:{accepted:k=>verdicts.push(k),declined:(k,defer)=>verdicts.push(defer)},
    StationUI:{notify:message=>calls.push({error:message})},
    fetch:async(url,options)=>{
      const body=options.body?JSON.parse(options.body):null; calls.push(body);
      return {ok:!fail,json:async()=>fail?{ok:false,error:'stale offer'}:{ok:true,candidates:[c],candidate:c}};
    }};
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/app/workflowtakeoverstore.js'),'utf8'),ctx);
  const S=ctx.module.exports.WorkflowTakeoverStore;
  S.init(); await S.refresh();
  assert.equal(S.candidate('other'),null);
  const offer=S.candidate('agent'); assert.equal(offer.kind,'routine'); offer.fire();
  assert.match(cards[0].text,/3 separate occasions/); assert.equal(S.candidate('agent'),null,'one offer per session');
  await cards[0].callback({value:'review'}); await cards[0].callback({value:'review'});
  assert.equal(drafts.length,1,'double click opens one review'); assert.equal(drafts[0].workflowTakeoverId,c.id);
  assert.deepEqual(calls.filter(Boolean).filter(x=>x.action).map(x=>x.action),['shown','review']);
  S.init(); await S.refresh(); S.candidate('agent').fire(); await cards[1].callback({value:'defer'});
  assert.equal(verdicts.at(-1),true,'not now is timing, not dislike');
  S.init(); await S.refresh(); S.candidate('agent').fire(); fail=true; await cards[2].callback({value:'review'});
  assert.equal(drafts.length,1,'stale server refusal cannot open a takeover');
  fail=false; S.init(); await S.refresh(); paused=true; assert.equal(S.candidate('agent'),null);
  paused=false; S.candidate('agent').fire(); S.init(); await cards[3].callback({value:'review'});
  assert.equal(drafts.length,1,'reset invalidates an old card');
  ctx.Chat.nudge=()=>null; await S.refresh(); const before=calls.length;
  S.candidate('agent').fire(); assert.equal(calls.length,before,'refused rendering cannot record an impression');
  assert.ok(S.candidate('agent'),'refused rendering does not spend the session offer');
  const chat=fs.readFileSync(path.join(__dirname,'../frontend/app/chat.js'),'utf8');
  const start=chat.indexOf('  function nudge('), end=chat.indexOf('\n  // ADAPTIVE RECRUITMENT',start);
  const slot={log:{},taskQuestionLive:()=>false,activeNudge:{keepUntilDecision:true},clearNudge:()=>{throw Error('clobbered live takeover');}};
  vm.createContext(slot); vm.runInContext(chat.slice(start,end),slot);
  assert.equal(slot.nudge('A competing notice',[],()=>{}),null,'legacy notice cannot replace a pending takeover');
  console.log('workflow-takeover-ui: one beat, review, defer, double-click, pause, stale refusal and reset passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
