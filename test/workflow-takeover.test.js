'use strict';
const assert = require('node:assert/strict');
const W = require('../sidecar/workflow-takeover.js');
const DAY = 86400000, now = 70 * DAY;
const prompts = ['Please compile the weekly client update from client notes',
  'Could you assemble weekly client update from the client notes', 'Prepare the weekly client update from client notes'];
function input() {
  return { now, briefs: prompts.map((text, i) => ({ id:'b'+i, runId:'r'+i, agentId:'agent', source:'interactive',
    originalDirective:text, status:'done', completedAt:now-(3-i)*DAY,
    settled:{ sources:['client-notes.md'], success:'Include every active client' },
    questions:[{text:'Which format?',answer:'Use a table'}] })),
    runs: prompts.map((_, i) => ({runId:'r'+i,agentId:'agent',reason:'done',toolsOk:1,projectRoot:''})), jobs:[] };
}
let x = input(), c = W.candidates(x)[0];
assert.ok(c); assert.equal(c.count, 3); assert.equal(c.evidence.length, 3);
assert.match(c.prompt, /client-notes.md/); assert.match(c.prompt, /Use a table/);
assert.equal(W.signature(prompts[0]),W.signature(prompts[1]));
assert.notEqual(W.signature('Send report from Alice to Bob'), W.signature('Send report from Bob to Alice'));
assert.notEqual(W.signature('Prepare the report for Acme'),W.signature('Prepare the report for Beta'));
assert.notEqual(W.signature('Send the weekly client report'),W.signature('Do not send the weekly client report'));
assert.equal(W.signature('Try again and prepare the weekly report'), '');
assert.equal(W.signature('Summarize the attached client document'), '');
x = input(); x.briefs.pop(); assert.equal(W.candidates(x).length,0);
x = input(); x.briefs.forEach((b,i)=>b.completedAt=now-i*1000); assert.equal(W.candidates(x).length,0);
x = input(); x.briefs.push(x.briefs[0]); assert.equal(W.candidates(x)[0].count,3,'duplicate brief/run is not another occasion');
x = input(); x.runs[1].reason='error'; assert.equal(W.candidates(x).length,0,'failure resets successful occasions');
for (const verdict of ['ok', 'miss']) {
  x = input(); x.ratings=[{runId:'r2',verdict}];
  assert.equal(W.candidates(x).length,0,'user correction overrides technical completion');
}
x = input(); x.ratings=[{runId:'r2',verdict:'great'}]; assert.equal(W.candidates(x).length,1);
x = input(); x.runs[2].toolsOk=0; assert.equal(W.candidates(x).length,0,'chat-only completion is not proven workflow work');
x = input(); x.runs[2].internal=true; assert.equal(W.candidates(x).length,0);
x = input(); x.runs[2].streamId='cron-test'; assert.equal(W.candidates(x).length,0);
x = input(); x.runs[2].completionEvidence={completionVerdict:'verification_required'}; assert.equal(W.candidates(x).length,0);
x = input(); x.runs[2].uncertainMutations=[{}]; assert.equal(W.candidates(x).length,0);
x = input(); x.runs[2].projectRoot='different-project'; assert.equal(W.candidates(x).length,0);
x = input(); x.briefs[2].source='autonomous'; assert.equal(W.candidates(x).length,0);
x = input(); x.enabled=false; assert.equal(W.candidates(x).length,0);
x = input(); x.redact=s=>s+'[redacted]'; assert.equal(W.candidates(x).length,0);
x = input(); x.state={forgottenAt:now-DAY}; assert.equal(W.candidates(x).length,0,'forget must not relearn old task history');
x = input(); x.state={decisions:[{id:c.id,until:now+DAY}]}; assert.equal(W.candidates(x).length,0);
x.state.decisions[0].until=now-1; assert.equal(W.candidates(x).length,1,'defer expires');
x.state.decisions[0].never=true; assert.equal(W.candidates(x).length,0);
x = input(); x.jobs=[{meta:{workflowTakeoverId:c.id},enabled:false}]; assert.equal(W.candidates(x).length,0,'paused routine is still an existing workflow');
x = input(); x.jobs=[{agentId:'agent',prompt:prompts[2]}]; assert.equal(W.candidates(x).length,0);
console.log('workflow-takeover: evidence, repetition, scope, outcomes, privacy, defer and duplicate scenarios passed');
