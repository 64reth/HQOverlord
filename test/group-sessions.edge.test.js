'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeGroupSessions } = require('../sidecar/group-sessions.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'group-edges-'));
let sequence = 0, execute, api;
const seen = [];
const finish = content => ({ reason: 'done', messages: [{ role: 'assistant', content }] });
const deps = { fs, path, root, now: () => Date.now(), id: () => 'edge' + (++sequence), log: () => {},
  roster: () => [{ id: 'agent', name: 'Lead' }, { id: 'peer', name: 'Peer' }, { id: 'other', name: 'Peer' }],
  execute: async o => { seen.push(o); o.emit('agent.run.start', { runId: o.runId }); return execute(o); },
  uploadFile: (name, content) => ({ name, content, hash: 'fixture' }), decodeFile: f => ({ text: f.content }) };
async function waitFor(fn) { for (let n=0;n<150;n++) { if(await fn()) return; await new Promise(r=>setTimeout(r,10)); } throw Error('timed out'); }
(async()=>{
 try {
  api=makeGroupSessions(deps); await api.ready;
  execute=async()=>finish('ready');
  const a=await api.create({members:['agent','peer','other']});
  await assert.rejects(api.send(a.id,{key:'ambiguous',text:'@Peer hello'}),/ambiguous/);
  await api.send(a.id,{key:'explicit',text:'hello',recipients:['peer']}); await api.idle(a.id);
  assert.equal(seen.at(-1).t.agentId,'peer');
  await api.send(a.id,{key:'stable-id',text:'@peer use the autocomplete ID'}); await api.idle(a.id);
  assert.equal(seen.at(-1).t.agentId,'peer');
  const b=await api.create({members:['agent','peer']});
  await api.attach(a.id,{name:'a.txt',content:'ONLY_GROUP_A'});
  const artifact=(await api.get(a.id)).artifacts[0];
  await assert.rejects(api.file(b.id,artifact.id),/not found/);
  // A deliberate Retry after a persisted interruption must actually start work.
  api.close();
  const file=path.join(root,'group-sessions.json');const state=JSON.parse(fs.readFileSync(file,'utf8'));
  state.groups[a.id].turns[0].state='running';fs.writeFileSync(file,JSON.stringify(state));
  api=makeGroupSessions(deps);await api.ready;
  assert.equal((await api.get(a.id)).paused,true);
  const interrupted=(await api.get(a.id)).turns[0];
  await api.control(a.id,{action:'retry',turnId:interrupted.id});await api.idle(a.id);
  assert.equal((await api.get(a.id)).turns.at(-1).state,'completed','Retry must resume a restart-paused group');
  // Removing a participant cancels their open question and prevents a late answer.
  execute=async o=>{const answer=await o.askCommander({question:'Choose one',options:['A','B']});return finish(answer.text||'canceled');};
  await api.send(b.id,{key:'ask',text:'@peer ask'});
  await waitFor(async()=>(await api.get(b.id)).questions.some(q=>q.state==='pending'));
  const current=await api.get(b.id),q=current.questions.at(-1);
  await assert.rejects(api.answerQuestion(a.id,{questionId:q.id,text:'A'}),/not found/);
  await api.configure(b.id,{revision:current.revision,members:['agent']});await api.idle(b.id);
  assert.equal((await api.get(b.id)).questions.at(-1).state,'canceled');
  await assert.rejects(api.answerQuestion(b.id,{questionId:q.id,text:'A'}),/no longer/);
  // Explicit @all is user-selected work: every selected participant responds once.
  execute=async o=>finish(o.t.agentId);
  await api.send(b.id,{key:'after-cancel',text:'Hello again'}); await api.idle(b.id);
  assert.match(seen.at(-1).ctx.messages[0].content, /canceled questions no longer need an answer/);
  assert.match(seen.at(-1).ctx.messages[0].content, /\"state\":\"canceled\"/);
  await api.send(a.id,{key:'all',text:'@all reply'});await api.idle(a.id);
  const all=(await api.get(a.id)).turns.slice(-3);
  assert.deepEqual(all.map(t=>t.agentId),['agent','peer','other']);assert.ok(all.every(t=>t.state==='completed'));
  console.log('group edges: restart retry, membership cancellation, question/file isolation, ambiguous names and all recipients PASS');
 } finally {api?.close();fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
