// Real UI with fixture approvals on an isolated seeded server. No AI runs or consent decisions.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {findChrome,connectCDP,evalJS,capture,sleep} from '../scripts/lib/cdp.mjs';
import {materializeSeedWorkspace,bootSeededSidecar,waitUp,waitDevReady} from '../scripts/lib/seed.mjs';
const out='.worldshots/session-attention', scratch=mkdtempSync(join(tmpdir(),'starnet-attention-'));
mkdirSync(out,{recursive:true});const report={checks:[],exceptions:[]};let side,chrome,cdp;
const mock=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:[{id:'test/model',context_length:32000,pricing:{prompt:'0',completion:'0'},supported_parameters:['tools']}]}));});
await new Promise(r=>mock.listen(0,'127.0.0.1',r));
const run=s=>evalJS(cdp,s);
async function check(name,s){assert.ok(await run(s),name);report.checks.push(name);}
async function shot(name){await run(`document.activeElement?.blur();typeof Hint!=='undefined'&&Hint.hide()`);await sleep(300);await capture(cdp,out,name);}
async function key(key,code){await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:code});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:code});}
try{
  const ws=join(scratch,'ws');materializeSeedWorkspace(ws,'test/model');
  // Borrow only the demo's station and roster, preserving its source save untouched.
  const saved=JSON.parse(readFileSync(join(ws,'agent.save.json'),'utf8'));
  const demo=JSON.parse(readFileSync('dev/.scratch-workspace/agent.save.json','utf8')).doc;
  for(const k of ['station','agents','agent'])saved.doc[k]=demo[k];
  saved.doc.agent.model='test/model';
  for(const a of Object.values(saved.doc.agents||{}))a.model='test/model';
  writeFileSync(join(ws,'agent.save.json'),JSON.stringify(saved));
  const roster=JSON.parse(readFileSync('dev/.scratch-workspace/agent.roster.json','utf8'));
  for(const a of roster.agents||[])a.model='test/model';
  writeFileSync(join(ws,'agent.roster.json'),JSON.stringify(roster));
  const base='http://127.0.0.1:'+mock.address().port+'/api/v1';
  side=bootSeededSidecar({port:9488,model:'test/model',scratchDir:ws,key:'sk-or-ui-fixture',env:{SKYNET_OPENROUTER_BASE:base,STARNET_OPENROUTER_BASE:base}});
  assert.ok(await waitUp('http://127.0.0.1:9488/'),'seeded server starts');
  chrome=spawn(findChrome(),['--headless=new','--enable-gpu','--no-first-run','--no-default-browser-check','--hide-scrollbars','--mute-audio','--remote-debugging-port=9489','--window-size=1440,1000','--user-data-dir='+join(scratch,'chrome'),'about:blank'],{stdio:'ignore',windowsHide:true});
  cdp=await connectCDP(9489);await cdp.send('Runtime.enable');await cdp.send('Page.enable');
  cdp.on('Runtime.exceptionThrown',e=>report.exceptions.push(e.exceptionDetails.exception?.description||e.exceptionDetails.text));
  await cdp.send('Page.navigate',{url:'http://127.0.0.1:9488/'});
  assert.ok(await waitDevReady(cdp,evalJS,{url:'http://127.0.0.1:9488/'}),'app boots');await sleep(1100);
  await check('Crew starts with the roster and a compact search control',`!document.querySelector('#crew-filters')&&document.querySelector('#crew-search-wrap').hidden&&document.querySelectorAll('#crew .crew-row').length===App.agents().length&&App.agents().length>20`);
  await check('Quiet sessions have no attention shortcut',`document.querySelector('#ws-attention').hidden`);await shot('01-clean-crew');
  await check('Session filters offer only All and Automated',`JSON.stringify([...document.querySelectorAll('[data-ws-kind]')].map(e=>e.dataset.wsKind))==='["all","automated"]'`);
  await run(`window.__before={agent:App.currentAgent().id,session:Workstreams.activeId()};document.querySelector('#crew-search-toggle').click();document.querySelector('#crew-search').value='fOrGe';document.querySelector('#crew-search').dispatchEvent(new Event('input'))`);
  await sleep(200);
  await check('Case-insensitive agent search finds the intended row without changing the conversation',`document.querySelectorAll('#crew .crew-row:not([hidden])').length===1&&document.querySelector('#crew .crew-row:not([hidden])').textContent.includes('FORGE')&&App.currentAgent().id===window.__before.agent&&Workstreams.activeId()===window.__before.session`);
  await check('Search results remain visible inside the roster',`document.querySelector('#crew').clientHeight>40`);await shot('02-agent-search');
  await run(`document.querySelector('#crew-search').focus()`);await key('ArrowDown',40);
  await check('Arrow Down moves from search into its first result',`document.activeElement.matches('#crew .crew-row:not([hidden])')`);
  await run(`document.querySelector('#crew-search').value='no-such-agent';document.querySelector('#crew-search').dispatchEvent(new Event('input'))`);
  await check('An unmatched search has a clear recovery message',`!document.querySelector('#crew-search-empty').hidden&&!document.querySelector('#crew .crew-row:not([hidden])')`);
  await run(`document.querySelector('#crew-search').focus()`);await key('Escape',27);
  await check('Escape closes and clears agent search, restores all rows and returns focus',`document.querySelector('#crew-search-wrap').hidden&&document.querySelector('#crew-search').value===''&&[...document.querySelectorAll('#crew .crew-row')].every(r=>!r.hidden)&&document.activeElement.id==='crew-search-toggle'`);
  await run(`document.querySelector('#crew-search-toggle').click();document.querySelector('#crew-search-close').click()`);
  await check('The pointer close control also clears search',`document.querySelector('#crew-search-wrap').hidden&&document.querySelector('#crew-search-toggle').getAttribute('aria-expanded')==='false'`);
  await run(`(()=>{const a=Workstreams.create('Review release notes',{agentId:'agent',activate:false}),b=Workstreams.create('Choose the report audience',{agentId:'agent',activate:false}),c=Workstreams.create('Background research',{agentId:'agent',activate:false});window.__sessions={a:a.id,b:b.id,c:c.id};Workstreams.archive(b.id,true);for(const id of [a.id,b.id]){Channels.begin(id,Date.now());Channels.setRunId(id,'fixture-'+id);}Channels.setPending(a.id,{promptId:'fixture-approval',tool:'fs.write',argsSummary:'release-notes.md'});Channels.setPending(b.id,{promptId:'fixture-question',tool:'brief.ask',argsSummary:'Who should the report be written for?'});Channels.setPending('orphan',{promptId:'orphan',tool:'fs.write'});App.refreshRail();})()`);
  await check('Attention counts two sessions on the same agent and excludes an orphan',`!document.querySelector('#ws-attention').hidden&&document.querySelector('#ws-attention-count').textContent==='2'`);
  await check('Approval and question badges name the action needed on their exact sessions',`document.querySelector('[data-id="'+window.__sessions.a+'"] .ws-meta').textContent==='Approval needed'&&document.querySelector('[data-id="'+window.__sessions.b+'"] .ws-meta').textContent==='Reply needed'`);
  await check('A waiting archived session is visible without opening the archive',`!!document.querySelector('#workstreams [data-id="'+window.__sessions.b+'"]')`);
  await run(`document.querySelector('[data-ws-kind=automated]').click()`);
  await check('Automated hides ordinary sessions even when active or awaiting a response',`!document.querySelector('#workstreams [data-id="'+window.__before.session+'"]')&&!document.querySelector('#workstreams [data-id="'+window.__sessions.a+'"]')&&!document.querySelector('#workstreams [data-id="'+window.__sessions.b+'"]')&&!document.querySelector('#ws-attention').hidden`);
  await run(`for(const id of Object.values(window.__sessions))Workstreams.get(id).automation={kind:'routine',id:'merge-review',name:'Release workflow'};App.refreshRail()`);
  await check('Grouped automated sessions keep both pending requests visible in Automated',`!!document.querySelector('#workstreams [data-id="'+window.__sessions.a+'"]')&&!!document.querySelector('#workstreams [data-id="'+window.__sessions.b+'"]')&&!!document.querySelector('[data-ws-group]')`);
  await run(`document.querySelector('[data-ws-kind=all]').click()`);
  await check('Crew rows do not duplicate session approval labels',`![...document.querySelectorAll('#crew .crew-status')].some(e=>/APPROVAL|NEEDS YOU/.test(e.textContent))`);
  await run(`document.querySelector('#ws-attention').click()`);
  await check('The attention shortcut shows only waiting sessions and offers a clear way back',`document.querySelector('#ws-attention').getAttribute('aria-pressed')==='true'&&document.querySelectorAll('#workstreams .ws-row').length===2&&!document.querySelector('#ws-attention-clear').hidden&&!document.querySelector('.ws-arch-row')`);await shot('03-waiting-sessions');
  await check('Waiting view bypasses collapsed groups and hides competing kind controls',`document.querySelector('#ws-kind-filter').hidden&&!document.querySelector('#workstreams [data-ws-group]')`);
  await check('Waiting session titles retain most of the row width',`[...document.querySelectorAll('#workstreams .ws-row')].every(r=>r.querySelector('.ws-title').getBoundingClientRect().width>r.getBoundingClientRect().width*.7)`);
  await run(`document.querySelector('#workstreams [data-id="'+window.__sessions.a+'"] .ws-title').click()`);await sleep(250);
  await check('Clicking a waiting session opens that conversation and its approval',`Workstreams.activeId()===window.__sessions.a&&!!document.querySelector('#chat-log .consent .consent-btn')&&document.querySelector('#chat-log').textContent.includes('release-notes.md')`);await shot('04-session-approval');
  await run(`document.querySelector('#ws-attention').click()`);
  await check('Toggling the shortcut off restores ordinary sessions',`document.querySelector('#ws-attention').getAttribute('aria-pressed')==='false'&&!!document.querySelector('#workstreams [data-id="'+window.__before.session+'"]')`);
  await run(`document.querySelector('#ws-attention').click();document.querySelector('#ws-search').value='Background research';document.querySelector('#ws-search').dispatchEvent(new Event('input'))`);
  await check('Typing a session search exits the attention filter and searches all conversations',`document.querySelector('#ws-attention').getAttribute('aria-pressed')==='false'&&document.querySelector('#ws-search-results .ws-search-hit').dataset.id===window.__sessions.c`);
  await run(`document.querySelector('#ws-attention').click()`);
  await check('The attention shortcut clears a competing search so its results are visible',`document.querySelector('#ws-search').value===''&&!document.querySelector('#workstreams').hidden&&document.querySelectorAll('#workstreams .ws-row').length===2`);
  await run(`document.querySelector('#ws-tab-projects').click()`);
  await check('Projects hides session attention controls',`document.querySelector('#ws-attention').hidden&&document.querySelector('#workstreams').hidden`);
  await run(`document.querySelector('#ws-tab-sessions').click()`);
  await check('Returning to Sessions preserves the chosen attention view',`!document.querySelector('#ws-attention').hidden&&document.querySelector('#ws-attention').getAttribute('aria-pressed')==='true'`);
  for(const width of [1049,698,475]){
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:912,deviceScaleFactor:1,mobile:false});await sleep(300);
    await check('Attention controls and badges fit at '+width+'px',`(()=>{const b=document.querySelector('#ws-attention'),l=document.querySelector('#left'),h=l.querySelector('h3');return b.scrollWidth<=b.clientWidth+1&&h.scrollWidth<=h.clientWidth+1&&[...document.querySelectorAll('#workstreams .ws-row')].every(r=>r.scrollWidth<=r.clientWidth+1)})()`);
  }
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await run(`document.body.style.zoom='1.45';document.body.style.setProperty('--sn-unzoom',String(1/1.45))`);await sleep(300);
  await check('Enlarged text keeps the attention shortcut inside the rail',`document.querySelector('#ws-attention').scrollWidth<=document.querySelector('#ws-attention').clientWidth+1`);
  await run(`document.body.style.zoom='';document.body.style.removeProperty('--sn-unzoom');Channels.clearPending(window.__sessions.a)`);await sleep(1200);
  await check('Resolving one prompt updates the count and filter on the existing heartbeat',`document.querySelector('#ws-attention-count').textContent==='1'&&document.querySelectorAll('#workstreams .ws-row').length===1&&document.querySelector('#workstreams .ws-row').dataset.id===window.__sessions.b`);
  await run(`document.querySelector('#ws-attention').focus();Channels.clearPending(window.__sessions.b)`);await sleep(1200);
  await check('Resolving the last prompt hides the shortcut, restores ordinary sessions and recovers focus',`document.querySelector('#ws-attention').hidden&&document.querySelector('#ws-attention').getAttribute('aria-pressed')==='false'&&!!document.querySelector('#workstreams [data-id="'+window.__before.session+'"]')&&document.activeElement.id==='ws-search'`);
  await check('Resolved archived sessions return to the archive',`!document.querySelector('#workstreams [data-id="'+window.__sessions.b+'"]')`);
  await check('Controls use station styling instead of native white paint',`[...document.querySelectorAll('#crew-search-toggle,#crew-search,#crew-search-close,#ws-attention')].every(e=>!['rgb(255, 255, 255)','rgb(239, 239, 239)'].includes(getComputedStyle(e).backgroundColor))`);
  await run(`localStorage.setItem('starnet.crewrail.rows','0');localStorage.setItem('skynet.session-view',JSON.stringify({kind:'conversations'}))`);await cdp.send('Page.reload');
  assert.ok(await waitDevReady(cdp,evalJS,{url:'http://127.0.0.1:9488/'}));await sleep(500);
  await check('A deliberately collapsed roster stays collapsed after reload',`document.querySelector('#crew').classList.contains('shut')`);
  await check('A saved retired Chats filter returns to All after reload',`document.querySelector('[data-ws-kind=all]').getAttribute('aria-pressed')==='true'&&!document.querySelector('[data-ws-kind=conversations]')`);
  await run(`document.querySelector('#crew-search-toggle').click();document.querySelector('#crew-search').value='FORGE';document.querySelector('#crew-search').dispatchEvent(new Event('input'))`);await sleep(350);
  await check('Searching opens a collapsed roster so results are actually visible',`document.querySelector('#crew').clientHeight>40&&document.querySelector('#crew .crew-row:not([hidden])').getBoundingClientRect().height>0`);
  await run(`document.querySelector('#crew-search-close').click()`);await sleep(350);
  await check('Closing search restores the saved collapsed roster',`document.querySelector('#crew').classList.contains('shut')`);
  assert.equal(report.exceptions.length,0,JSON.stringify(report.exceptions));writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(e){if(cdp)await capture(cdp,out,'failure').catch(()=>{});throw e;}
finally{try{cdp?.ws.close()}catch{}chrome?.kill();side?.kill();mock.close();}
process.exit(0);
