import { initialView, hydrate, disconnected, selectAgent, mutationsAllowed, expireTransport } from './client-state.js';
import { stationModel, exactMoney, revenueText } from './station-model.js';
import { createWorld } from './world.js';
let view=initialView(),model=stationModel(view),stream=null,lastSeen=0,business='',busy=false,panel=null,returnFocus=null,reconnectTimer=null;
const $=id=>document.getElementById(id);
const node=(tag,text,className)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;};
const detail=(label,value)=>{const d=node('details');d.append(node('summary',label),node('pre',JSON.stringify(value,null,2)));return d;};
function button(label,action,mutation=false){const b=node('button',label);b.type='button';b.onclick=action;if(mutation){b.dataset.mutation='';b.disabled=busy||!mutationsAllowed(view);}return b;}
const world=createWorld($('stage'),id=>choose(id,false));
function choose(id,focus=true){view=selectAgent(view,id);render();if(focus)world.focus(id);}
async function command(path,input){if(!mutationsAllowed(view)||busy)return;busy=true;$('notice').textContent='Submitting to HQ runtime…';render();try{const response=await fetch(`/api/${path}?business=${encodeURIComponent(business)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const result=await response.json();if(!response.ok)throw new Error(result.error||'Operation refused');$('notice').textContent=path==='run'?'Run submitted. Awaiting runtime telemetry.':'Saved by HQ runtime.';if(path==='job')$('job-objective').value='';}catch(error){$('notice').textContent=error.message;}finally{busy=false;render();}}
function jobActions(job,target){const snapshot=view.snapshot,agent=model.agents.find(a=>a.id===job.agentId);if(['queued','running'].includes(job.status))target.append(button('CANCEL',()=>command('cancel',{jobId:job.id}),true));
  const pending=model.approvals.some(a=>a.jobId===job.id&&a.status==='pending');const runnable=job.status==='queued'||job.execution?.status==='waiting_for_approval'&&!pending;
  if(runnable&&!job.blockedBy.length&&(snapshot.modelEnabled||agent?.toolIds.includes('artifact.release')))target.append(button(job.status==='queued'?'RUN':'RESUME',()=>command('run',{jobId:job.id}),true));
}
function jobEntry(job,compact=false){const e=node('section',undefined,compact?'entry':'record');e.append(node('h3',job.objective),node('p',view.connection==='connected'?job.visualState.replaceAll('-',' '):'unknown — transport disconnected','status'),node('small',`JOB ${job.id}`));if(job.model)e.append(node('p',`${job.model.provider} / ${job.model.model}`));if(job.execution?.operation)e.append(node('p',`TOOL ${job.execution.operation.toolId} / ${job.execution.operation.dispatched?'dispatched':'not dispatched'}`));if(job.blockedBy.length)e.append(node('p',`Waiting for ${job.blockedBy.join(', ')}`));if(job.execution?.error)e.append(node('p',job.execution.error));e.append(node('small',`${job.outputs.length} recorded outputs · ${job.inputs.length} inputs`));jobActions(job,e);if(!compact)e.append(detail('Execution / inputs / provenance',job));
  for(const approval of model.approvals.filter(a=>a.jobId===job.id&&a.status==='pending')){
    e.append(node('p',`Consent required: ${approval.operation?.toolId??approval.operationId} — ${approval.reason}`),detail('Exact operation awaiting consent',approval),button('APPROVE',()=>command('approval',{approvalId:approval.id,decision:'approve'}),true),button('REJECT',()=>command('approval',{approvalId:approval.id,decision:'reject'}),true));
  }return e;}
function openPanel(name){panel=name;returnFocus=document.activeElement;$('operator-window').hidden=false;$('panel-title').textContent=name.toUpperCase();renderPanel();$('panel-close').focus();document.querySelectorAll('.bb-group').forEach(g=>{g.classList.remove('open');g.querySelector('.bb-grp').setAttribute('aria-expanded','false');g.querySelector('.bb-menu').inert=true;});}
function closePanel(){panel=null;$('operator-window').hidden=true;returnFocus?.focus();}
$('panel-close').onclick=closePanel;
document.addEventListener('keydown',event=>{if(!panel)return;if(event.key==='Escape'){event.preventDefault();closePanel();}if(event.key==='Tab'){const focusable=[...$('operator-window').querySelectorAll('button:not(:disabled),input,select,textarea,summary,a[href]')];const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}});
const groups={CREW:['Agent dossier','Tools'],WORK:['Jobs','Knowledge','Artifacts','Activity','Source-backed work'],SYSTEM:['Approvals','Ledger','Business','Notices']};
for(const [label,items]of Object.entries(groups)){const group=node('div',undefined,'bb-group'),trigger=button(label,()=>{}),menu=node('div',undefined,'bb-menu');trigger.className='bb-grp';trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-expanded','false');menu.setAttribute('role','menu');menu.inert=true;for(const item of items){const b=button(item,()=>openPanel(item));b.className='bb';b.dataset.term=item;b.setAttribute('role','menuitem');menu.append(b);}group.append(trigger,menu);$('dock-groups').append(group);}
await import('./navdock.js');
function record(title,value){const e=node('section',undefined,'record');e.append(node('h3',title),detail('Recorded data',value));return e;}
function renderPanel(){if(!panel||!view.snapshot)return;const content=$('panel-content'),snapshot=view.snapshot; // Preserve unsent source-work drafts across snapshots.
  if(panel==='Source-backed work'&&content.querySelector('form'))return;
  content.replaceChildren();
  if(panel==='Agent dossier'){
    const a=model.selected;if(!a){content.append(node('p','Select a crew member.','empty'));return;}
    const brief=record(a.name,{id:a.id,businessId:a.businessId,status:a.status,model:a.model});
    brief.append(node('p',a.state.toUpperCase(),'status'),node('p',`CAN DO: ${a.capabilities.join(', ')||'No configured capabilities'}`),node('p',`KIT: ${a.toolIds.join(', ')||'No tools assigned'}`));
    if(a.outcome)brief.append(node('p',`Latest recorded outcome: ${a.outcome}`));content.append(brief,node('h3','RECORD'));
    for(const j of a.assigned.toReversed())content.append(jobEntry(j));if(!a.assigned.length)content.append(node('p','No recorded jobs.','empty'));
  }
  else if(panel==='Tools'){
    for(const a of model.agents){const e=record(a.name,{toolIds:a.toolIds,capabilities:a.capabilities});e.append(node('p',a.toolIds.join(' / ')||'No assigned tools'),node('p',`Capability gates: ${a.capabilities.join(', ')||'none'}`));content.append(e);}
    for(const f of model.activity.filter(f=>f.type.startsWith('tool.')).toReversed())content.append(record(f.type,f));
  }
  else if(panel==='Jobs'){for(const j of model.jobs.toReversed())content.append(jobEntry(j));}
  else if(panel==='Knowledge'){
    for(const k of model.knowledge){const e=record(k.statement,k);e.append(node('p',`Verification: ${k.verification} · Evidence: ${k.references.map(r=>r.artifactId).join(', ')||'none'}`));content.append(e);}
    for(const s of model.sources){const e=record(`SOURCE ${s.uri}`,s);e.append(node('p',`Retrieved ${s.retrievedAt} / untrusted reference material`),node('pre',s.content));content.append(e);}
  }
  else if(panel==='Artifacts'){
    for(const a of model.artifacts){const e=record(`${a.category} / ${a.id}`,a);e.append(node('pre',typeof a.content==='string'?a.content:JSON.stringify(a.content,null,2)),node('p',`Sources: ${a.sourceIds.join(', ')||'none'} / References: ${a.references.map(r=>r.artifactId).join(', ')||'none'}`));content.append(e);}
  }
  else if(panel==='Activity'){for(const f of model.activity.toReversed())content.append(record(`${f.occurredAt} / ${f.type}`,f));}
  else if(panel==='Approvals'){
    for(const a of model.approvals){const e=record(`${a.status.toUpperCase()} / ${a.operation?.toolId??a.operationId}`,a);e.append(node('p',a.reason));if(a.operation)e.append(node('pre',JSON.stringify(a.operation.input,null,2)));
      if(a.status==='pending')e.append(button('APPROVE EXACT OPERATION',()=>command('approval',{approvalId:a.id,decision:'approve'}),true),button('REJECT',()=>command('approval',{approvalId:a.id,decision:'reject'}),true));content.append(e);
    }
  }
  else if(panel==='Ledger'){
    content.append(node('h3',`RECORDED REVENUE ${revenueText(snapshot.revenue)}`),node('p',`Recorded model spend: ${snapshot.summary.modelSpend}. Currencies are not converted.`));
    for(const e of model.ledger)content.append(record(`${e.kind.toUpperCase()} ${exactMoney(e.amount)} / ${e.description}`,e));
    for(const e of model.expenses)content.append(record(`METERED MODEL EXPENSE / ${e.cost.nanodollars} nanodollars`,e));
    if(snapshot.summary.unsettledInvocations)content.append(node('p',`${snapshot.summary.unsettledInvocations} unsettled invocations — not represented as zero cost.`));
    const budgets=snapshot.metadata?.budgets;
    if(budgets?.perJobUsdLimit)content.append(node('p',`Configured per-job model limit: ${exactMoney(budgets.perJobUsdLimit)} USD. Not recorded spend.`));
    if(budgets?.internalAllocation)content.append(node('p',`Configured internal allocation: ${exactMoney(budgets.internalAllocation.amount)}. No aggregate cross-currency enforcement.`));
  }
  else if(panel==='Business'){content.append(record(snapshot.business.name,snapshot.business),record('Runtime configuration',snapshot.metadata),node('p',`Transport: ${view.connection}. Jobs and permissions are backend-owned.`));}
  else if(panel==='Notices'){content.append(node('p','Interface layout and grouped navigation reference: StarNet, Copyright (c) 2026 Andrew Sims. HQ station artwork is original.'));for(const [title,path]of [['StarNet MIT licence','STARNET-MIT.txt'],['VT323 font licence','VT323-OFL.txt']]){const a=node('a',title);a.href=`/notices/${path}`;a.target='_blank';a.rel='noopener';content.append(a,node('br'));}}
  else if(panel==='Source-backed work'){const form=node('form',undefined,'form-grid');const fields={};for(const [key,label,type]of [['id','Request identifier','text'],['url','Source URL (optional with supplied material)','url'],['material','Supplied source material','textarea']]){const l=node('label',label),input=node(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.required=key==='id';input.name=key;fields[key]=input;l.append(input);form.append(l);}const submit=node('button','PREPARE DURABLE JOBS');submit.dataset.mutation='';submit.disabled=busy||!mutationsAllowed(view);form.append(submit,node('small','Creates jobs and records supplied evidence. Does not run models, contact customers or record revenue.'));form.onsubmit=event=>{event.preventDefault();command('prepare',Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,input.value])));};content.append(form);}
  if(!content.children.length)content.append(node('p','No recorded data.','empty'));
}
function render(){model=stationModel(view);document.body.classList.toggle('connected',view.connection==='connected');document.body.classList.toggle('disconnected',view.connection!=='connected');$('connection').textContent=view.connection==='connected'?'Live':view.connection==='connecting'?'Connecting':'Disconnected';$('sig').textContent=view.receivedAt?`Last snapshot ${new Date(view.receivedAt).toLocaleTimeString()}`:'Awaiting authoritative state';
  if(!view.snapshot){
    world.update(model);$('crew').replaceChildren();$('workstreams').replaceChildren();$('chat-log').replaceChildren(node('p','Awaiting authoritative state.','empty'));$('comms-agent-select').replaceChildren();$('stage-summary').textContent='Operational activity unknown';$('cam-rec').textContent='UNKNOWN';
    document.querySelectorAll('[data-mutation]').forEach(b=>{b.disabled=true;});$('job-objective').disabled=true;return;
  }const snapshot=view.snapshot;
  if($('business').options.length!==snapshot.businesses.length){$('business').replaceChildren(...snapshot.businesses.map(b=>{const o=node('option',b.name);o.value=b.id;return o;}));}$('business').value=snapshot.business.id;
  $('spend').textContent=snapshot.summary.modelSpend;$('revenue').textContent=revenueText(snapshot.revenue);
  const search=$('crew-search').value.toLowerCase();$('crew').replaceChildren(...model.agents.filter(a=>a.name.toLowerCase().includes(search)).map(a=>{const li=node('li'),b=button('',()=>choose(a.id));b.dataset.agentId=a.id;b.classList.toggle('selected',a.id===view.selectedAgentId);b.append(node('span',a.name,'crew-name'),node('span',a.state.replaceAll('-',' '),'crew-state'));li.append(b);return li;}));
  $('crew-sum').textContent=`${model.agents.length} crew / ${view.connection==='connected'?'live state':'activity unknown'}`;
  $('workstreams').replaceChildren(...model.jobs.slice(-10).toReversed().map(j=>{const li=node('li');li.append(button(`${j.status.toUpperCase()} · ${j.objective}`,()=>{if(j.agentId)choose(j.agentId);openPanel('Jobs');}));return li;}));
  $('comms-agent-select').replaceChildren(...model.agents.map(a=>{const o=node('option',a.name);o.value=a.id;return o;}));if(!model.selected){const o=node('option',view.selectionLost?'Selection unavailable':'Select crew');o.value='';$('comms-agent-select').prepend(o);}$('comms-agent-select').value=model.selected?.id??'';
  $('chat-status').textContent=model.selected?.state.toUpperCase()??'NO SELECTION';$('comms-agent-model').textContent=model.selected?.model?`${model.selected.model.provider} / ${model.selected.model.model}`:'No provider invocation recorded';
  $('chat-log').replaceChildren();if(model.selected?.assigned.length)for(const j of model.selected.assigned.toReversed())$('chat-log').append(jobEntry(j,true));else $('chat-log').append(node('p',model.selected?(view.connection==='connected'?'No recorded jobs. Agent is idle.':'No recorded jobs. Operational activity unknown.'):'Choose a crew member.','empty'));
  $('execution-mode').textContent=snapshot.modelEnabled?'Model execution explicitly enabled. Jobs run only on operator command.':'Paid model execution disabled. Queuing a job does not execute it.';
  $('stage-summary').textContent=model.agents.map(a=>`${a.name}: ${a.state}`).join('; ');$('cam-rec').textContent=view.connection==='connected'?'LINK':'UNKNOWN';$('cam-feed').textContent='STATION / '+(view.connection==='connected'?'LIVE STATE':'LAST KNOWN STATE');
  const latest=model.activity.at(-1);$('world-ticker').textContent=view.connection!=='connected'?'TRANSPORT DISCONNECTED / operational activity unknown':latest?`${latest.occurredAt} / ${latest.type} / ${latest.actor.kind}:${latest.actor.id}`:'No recorded runtime events';world.update(model);renderPanel();
  document.querySelectorAll('[data-mutation]').forEach(b=>{b.disabled=busy||!mutationsAllowed(view);});$('create-job').disabled||=!model.selected;$('job-objective').disabled=busy||!mutationsAllowed(view)||!model.selected;
  const count=model.approvals.filter(a=>a.status==='pending').length;document.querySelector('[data-term="Approvals"]').textContent=count?`Approvals (${count})`:'Approvals';
  document.querySelector('[data-term="Source-backed work"]').hidden=!snapshot.preparationEnabled;
}
$('crew-search').oninput=render;$('comms-agent-select').onchange=()=>choose($('comms-agent-select').value);$('agent-details').onclick=()=>openPanel('Agent dossier');
$('job-composer').onsubmit=e=>{e.preventDefault();if(model.selected)command('job',{agentId:model.selected.id,objective:$('job-objective').value});};
$('crew-hide').onclick=()=>{document.body.classList.add('crew-collapsed');$('crew-show').hidden=false;};$('crew-show').onclick=()=>{document.body.classList.remove('crew-collapsed');$('crew-show').hidden=true;};
$('zoom-in').onclick=()=>world.zoom(1.2);$('zoom-out').onclick=()=>world.zoom(1/1.2);$('camera-reset').onclick=()=>world.reset();$('cinema').onclick=()=>{document.body.classList.toggle('cinema');$('cinema').textContent=document.body.classList.contains('cinema')?'EXIT':'CINEMA';};$('comms-expand').onclick=()=>document.body.classList.toggle('comms-expanded');
function scheduleReconnect(source){
  if(reconnectTimer||source!==stream)return;
  reconnectTimer=setTimeout(async()=>{
    reconnectTimer=null;if(source!==stream)return;
    try{
      // A restarted local host mints a fresh HttpOnly session. No token enters JS.
      const response=await fetch('/',{credentials:'same-origin',signal:AbortSignal.timeout(5000)});
      if(source!==stream)return;
      if(response.ok){connect();return;}
    }catch{}
    scheduleReconnect(source);
  },2000);
}
function connect(){clearTimeout(reconnectTimer);reconnectTimer=null;stream?.close();view=disconnected(view);render();const next=new EventSource(`/api/events${business?`?business=${encodeURIComponent(business)}`:''}`);stream=next;next.addEventListener('snapshot',event=>{if(stream!==next)return;try{const snapshot=JSON.parse(event.data);lastSeen=Date.now();view=hydrate(view,snapshot,lastSeen);business=snapshot.business.id;render();}catch{$('notice').textContent='Invalid snapshot; activity unknown.';view=disconnected(view);render();}});next.addEventListener('heartbeat',()=>{if(stream===next)lastSeen=Date.now();});next.onerror=()=>{if(stream!==next)return;view=disconnected(view);render();scheduleReconnect(next);};}
$('business').onchange=()=>{business=$('business').value;view=initialView();panel=null;$('operator-window').hidden=true;$('panel-content').replaceChildren();$('notice').textContent='';$('job-objective').value='';connect();};
setInterval(()=>{const next=expireTransport(view,lastSeen,Date.now());if(next!==view){view=next;render();scheduleReconnect(stream);}},1000);
connect();
