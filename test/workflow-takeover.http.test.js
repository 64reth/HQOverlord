'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');
const DAY = 86400000;
(async () => {
  const f = SidecarFixture.create({prefix:'workflow-takeover-', timeoutMs:20000, env:{SKYNET_OPENROUTER_KEY:'',OPENROUTER_KEY:''}});
  const now=Date.now();
  const prompts=['Please compile the weekly client update from client notes','Could you assemble weekly client update from the client notes','Prepare the weekly client update from client notes'];
  fs.writeFileSync(path.join(f.workspace,'task-briefs.json'), JSON.stringify({briefs:prompts.map((text,i)=>({
    id:'b'+i,key:'session-'+i,runId:'r'+i,agentId:'agent',source:'interactive',originalDirective:text,
    status:'done',createdAt:now-(3-i)*DAY,completedAt:now-(3-i)*DAY,updatedAt:now-(3-i)*DAY}))}));
  fs.writeFileSync(path.join(f.workspace,'runs.jsonl'),prompts.map((_,i)=>JSON.stringify({runId:'r'+i,agentId:'agent',reason:'done',toolsOk:1,ts:now-(3-i)*DAY})).join('\n')+'\n');
  const j=(m,p,b)=>f.json(m,p,b);
  const get=async()=> (await j('GET','/api/workflow-takeovers')).body.candidates;
  try {
    await f.start();
    assert.equal((await fetch(f.baseUrl+'/api/workflow-takeovers')).status,403);
    let c=(await get())[0]; assert.ok(c); assert.equal(c.count,3);
    assert.equal((await j('POST','/api/workflow-takeovers',{id:c.id,action:'shown'})).body.ok,true);
    assert.equal((await get()).length,0);
    const review=await j('POST','/api/workflow-takeovers',{id:c.id,action:'review'});
    assert.equal(review.body.candidate.agentId,'agent');
    assert.equal((await j('GET','/api/cron')).body.jobs.length,0,'review creates no routine');
    await f.restart(); assert.equal((await get()).length,0,'offer cooldown survives restart');
    const spec={name:'Client update takeover',prompt:review.body.candidate.prompt,schedule:'every 24h',agentId:'agent',enabled:true,
      meta:{workflowTakeoverId:c.id}};
    const [a,b]=await Promise.all([j('POST','/api/cron',spec),j('POST','/api/cron',spec)]);
    assert.equal(a.body.ok,true); assert.equal(b.body.ok,true);
    assert.equal((await j('GET','/api/cron')).body.jobs.length,1,'concurrent confirmation creates one job');
    await f.restart();
    const jobs=(await j('GET','/api/cron')).body.jobs;
    assert.equal(jobs.length,1); assert.equal(jobs[0].meta.workflowTakeoverId,c.id);
    assert.equal(jobs[0].prompt,review.body.candidate.prompt); assert.equal((await get()).length,0);
    assert.equal((await j('POST','/api/workflow-takeovers',{id:c.id,action:'review'})).status,409,'scheduled candidate cannot be reopened');
    assert.equal((await j('POST','/api/workflow-takeovers',{id:'bad',action:'create'})).status,400);
    await j('POST','/api/cron/remove',{id:jobs[0].id});
    await j('POST','/api/personalization',{enabled:false}); assert.equal((await get()).length,0);
    assert.equal((await j('POST','/api/workflow-takeovers',{id:c.id,action:'review'})).status,409);
    await j('POST','/api/personalization',{enabled:true});
    await j('DELETE','/api/personalization'); await f.restart();
    assert.equal((await get()).length,0,'forget remains effective against preserved history');
    console.log('workflow-takeover.http: authenticated evidence, review, concurrent create, pause, forget and restart passed');
  } finally { await f.dispose(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
