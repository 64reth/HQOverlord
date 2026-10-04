'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {SidecarFixture}=require('./helpers/sidecar-fixture.js');
const {makeTaskBriefStore}=require('../sidecar/taskbrief-store.js');
(async()=>{
  const fixture=SidecarFixture.create({prefix:'starnet-context-'});
  try {
    const store=makeTaskBriefStore({fs,path,workspaces:fixture.workspace});
    const original='Help me collect client updates';
    await store.prepare({id:'conversation',key:'stream:context',text:original},100);
    await store.ask('conversation',{mode:'conversation',dimension:'sources',question:'How did you prepare the last update?',reason:'Identify the troublesome step.',discoverable:false},101);
    const reply='I check Slack.\n'+'A long contextual note. '.repeat(110)+'Never send without review.';
    await store.answerInTurn('conversation',reply,102);
    await store.updateContext('conversation',{through:'conversation_q1',facts:[{dimension:'safety',text:'Review before sending',quote:'Never send without review.',sourceId:'conversation_q1'}],unknowns:['Presentation'],nextStep:'Draft a table'},103);
    await store.ask('conversation',{mode:'conversation',dimension:'deliverable',question:'Does this table make missing details clear?',reason:'Review a small draft.',sample:'Client | Missing\nAcme | Owner update',discoverable:false},104);
    for(let boot=0;boot<2;boot++) {
      await fixture.start();
      const r=await fixture.json('GET','/api/task-briefs?key=stream:context&limit=1');
      assert.equal(r.status,200);const b=r.body.briefs[0];
      assert.equal(b.status,'clarifying');assert.equal(b.questions[0].answer,reply);
      assert.equal(b.context.facts[0].quote,'Never send without review.');
      assert.equal(b.questions[1].sample,'Client | Missing\nAcme | Owner update');
      assert.deepEqual(b.questions[1].options,[]);
      const stale=await fixture.json('POST','/api/consent/answer',{runId:'gone',promptId:'gone',answer:'Details '.repeat(1500),receipt:true});
      assert.equal(stale.status,200);assert.deepEqual(stale.body,{ok:false},'stale answer is not reported as accepted');
      const legacy=await fixture.json('POST','/api/consent/answer',{runId:'gone',promptId:'gone',answer:'test'});
      assert.equal(legacy.text,'ok');
      await fixture.stop();
    }
    console.log('task-conversation.http: full answer, context, open question, sample, restart and stale receipts passed');
  } finally {await fixture.dispose();}
})().catch(e=>{console.error(e);process.exitCode=1;});
