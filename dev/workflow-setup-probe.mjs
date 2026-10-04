// Live UI proof on a disposable station; the custom demo save and scheduler are never changed.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {findChrome,connectCDP,evalJS,sleep,capture} from '../scripts/lib/cdp.mjs';
const out='.worldshots/workflow-setup';mkdirSync(out,{recursive:true});let proc,cdp;
const report={checks:[],exceptions:[]};
const run=src=>evalJS(cdp,src);
async function check(name,src){assert.ok(await run(src),name);report.checks.push(name);}
async function until(src){for(let i=0;i<100;i++){if(await run(src))return;await sleep(120);}throw Error('Timed out: '+src);}
async function shot(name){await run(`document.activeElement?.blur()`);await sleep(180);await capture(cdp,out,name);}
async function open(id){await run(`Build.openAssign(window.__ids.${id})`);await sleep(100);}
try{
  proc=spawn(findChrome(),['--headless=new','--enable-gpu','--no-first-run','--no-default-browser-check','--hide-scrollbars','--mute-audio','--remote-debugging-port=9364','--window-size=1440,1000','--user-data-dir='+out+'/profile','about:blank'],{stdio:'ignore',windowsHide:true});
  cdp=await connectCDP(9364);await cdp.send('Runtime.enable');await cdp.send('Page.enable');
  cdp.on('Runtime.exceptionThrown',e=>report.exceptions.push(e.exceptionDetails.exception?.description||e.exceptionDetails.text));
  await cdp.send('Page.navigate',{url:'http://127.0.0.1:9177/'});
  await until(`typeof Build!=='undefined'&&Build.__test__&&typeof App!=='undefined'&&App.agents().length>2`);
  await run(`(()=>{
    const s=WorldModel.create();window.__fixture=s;window.__ids={};const names=App.agents();
    function ok(r){if(!r?.ok)throw Error('Fixture: '+JSON.stringify(r));return r.id;}
    ok(s.addRoom({kind:'hab',rect:{x1:30,y1:0,x2:82,y2:27}}));
    function prop(id,t,x,y,extra={}){const sp=PropSprites.spec(t);window.__ids[id]=ok(s.addProp({t,x,y,w:sp.w,h:sp.h,block:sp.blocks!==false,...extra}));}
    prop('inbox','intake',32,4);prop('bay','bay',38,4,{agentId:names[0].id});prop('review','bay',50,4,{agentId:names[1].id});prop('outbox','outbox',58,4);
    for(let x=34;x<=57;x++)ok(s.setBelt(x,6,'E'));
    ok(s.setBelt(44,7,'S'));ok(s.setBelt(44,8,'W'));for(let x=43;x>=39;x--)ok(s.setBelt(x,8,'W'));ok(s.setBelt(38,8,'N'));ok(s.setBelt(38,7,'N'));
    prop('loop','loop',44,6);prop('joiner','joiner',60,12);prop('merger','merger',61,12);prop('splitter','splitter',62,12);
    prop('filter','filter',64,16);for(let x=62;x<=69;x++)ok(s.setBelt(x,16,'E'));ok(s.setBelt(64,17,'S'));ok(s.setBelt(64,18,'S'));ok(s.setBelt(64,19,'S'));
    prop('filterBay','bay',64,20,{agentId:names[2].id});prop('filterOut','outbox',70,14);
    Build.init({getStation:()=>s,persist:()=>{},world:World,agents:()=>App.agents()});Build.open();document.querySelector('#refit-guide-go')?.click();document.querySelector('.fl-x')?.click();document.querySelector('#refit-fit').click();
  })()`);
  await sleep(700);
  await open('bay');
  await check('Bay opens a wide dialog with two clear setup choices and no generic diagram',`(()=>{const c=document.querySelector('.refit-step-card .refit-guide-card');return c.getBoundingClientRect().width>=900&&c.getAttribute('role')==='dialog'&&c.textContent.includes('Choose an agent')&&c.textContent.includes('What should they do?')&&!document.querySelector('.refit-flowstrip')})()`);
  await check('Connections are beside the settings on a wide screen',`document.querySelector('.workflow-aside').getBoundingClientRect().left>=document.querySelector('.workflow-main').getBoundingClientRect().right-1`);
  await run(`document.querySelector('#step-done').focus()`);
  await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await check('Keyboard focus stays inside the setup dialog',`document.activeElement.hasAttribute('data-workflow-close')`);
  await shot('01-bay');
  await run(`const q=document.querySelector('#step-agent-search');q.value=App.agents()[1].name;q.dispatchEvent(new Event('input'));document.querySelector('#step-brief').value='Check the draft for mistakes and return a corrected version.'`);
  await check('Agent search narrows the roster without changing assignment',`[...document.querySelectorAll('.bay-agent')].filter(b=>!b.hidden).length===1&&window.__fixture.propById(window.__ids.bay).agentId===App.agents()[0].id`);
  await run(`document.querySelector('.bay-agent:not([hidden])').click()`);
  await check('Choosing an agent updates the model and keeps the instruction draft',`window.__fixture.propById(window.__ids.bay).agentId===App.agents()[1].id&&document.querySelector('#step-bound').textContent.includes(App.agents()[1].name)&&document.querySelector('#step-brief').value.startsWith('Check the draft')`);
  await run(`document.querySelector('#step-agent-search').value='nothing-matches';document.querySelector('#step-agent-search').dispatchEvent(new Event('input'))`);
  await check('Unmatched agent search explains how to recover',`!document.querySelector('#step-agent-empty').hidden`);
  await run(`document.querySelector('[data-workflow-close]').click()`);
  await check('Closing the Bay saves the instruction draft',`!document.querySelector('.refit-step-card')&&window.__fixture.propById(window.__ids.bay).brief.startsWith('Check the draft')`);
  await open('bay');
  await run(`document.querySelector('#step-pc')?.click()`);
  await check('Add workstation still places a real desk assigned to the selected agent',`window.__fixture.props().some(p=>p.t==='desk'&&p.agentId===App.agents()[1].id)&&document.querySelector('#step-compute').textContent.includes('has a workstation')`);
  await check('Placement coaching cannot cover an open workflow editor',`[...document.querySelectorAll('.tut-coach:not(.kit)')].every(e=>getComputedStyle(e).visibility==='hidden')`);
  await run(`window.__fixture.assignPropAgent(window.__ids.bay,App.agents()[0].id)`);
  await sleep(250);await open('inbox');
  await check('Inbox leads with a name and two understandable start options',`document.querySelector('#workflow-title').textContent==='Start this workflow'&&document.querySelector('#line-name')&&document.querySelector('#trg-new b').textContent==='On a schedule'&&document.querySelector('#trg-chan b').textContent==='From a channel'`);
  await check('Advanced limits and manual schedule form start collapsed',`!document.querySelector('.refit-workflow-advanced').open&&getComputedStyle(document.querySelector('#trg-form')).display==='none'`);
  await check('Actual connected steps remain editable in the overview',`document.querySelectorAll('[data-workflow-step]').length===2&&document.querySelector('.refit-workflow').textContent.includes(App.agents()[0].name)`);
  await shot('02-inbox');
  await run(`const input=document.querySelector('#line-name');input.value='Weekly news summary';input.dispatchEvent(new Event('blur'));document.querySelector('#trg-new').click()`);
  await until(`document.querySelector('#trg-preview').textContent.includes('next:')`);
  await check('Schedule uses the existing picker and server-confirmed next run',`document.querySelector('#trg-sched').value&&document.querySelector('#trg-preview').textContent.includes('next:')&&document.querySelector('#trg-create').textContent.includes('SAVE SCHEDULE')`);
  await check('The selected schedule choice stays visible above its form',`document.querySelector('#trg-new').classList.contains('active')&&document.querySelector('#trg-new').getBoundingClientRect().height>0`);
  await check('Workflow name saves to the existing station model',`window.__fixture.propById(window.__ids.inbox).label==='Weekly news summary'`);
  await shot('03-schedule');
  await run(`document.querySelector('#trg-cancel').click()`);
  await check('Cancelling the schedule form returns to the two start choices',`getComputedStyle(document.querySelector('#trg-form')).display==='none'&&getComputedStyle(document.querySelector('#trg-new')).display!=='none'`);
  await run(`document.querySelector('[data-workflow-step]').click()`);
  await check('Clicking a connected step opens only that Bay setup',`document.querySelector('.refit-step-card')&&!document.querySelector('.refit-flow-card')&&document.querySelectorAll('.refit-workflow-editor [role="dialog"]').length===1`);
  await open('filter');
  await check('Filter uses destination names rather than arrow-only choices',`[...document.querySelectorAll('.lane-btn')].some(b=>b.textContent.includes('OUTBOX'))&&document.querySelectorAll('.refit-filter-rows .refit-route-row').length===3&&!document.querySelector('.refit-flowstrip')`);
  await shot('04-filter');
  await run(`document.querySelector('.lane-btn[data-tag="code"][data-dir="E"]').click();document.querySelector('.lane-btn[data-tag="research"][data-dir="S"]').click();document.querySelector('.lane-btn[data-tag="__def__"][data-dir="E"]').click();document.querySelector('#j-ok').click()`);
  await check('Save routes persists the same validated filter configuration',`(()=>{const p=window.__fixture.propById(window.__ids.filter);return p.routes.code==='E'&&p.routes.research==='S'&&p.def==='E'&&!document.querySelector('.refit-junction-editor')})()`);
  await open('filter');await run(`document.querySelector('.lane-btn[data-tag="code"][data-dir="S"]').click();document.querySelector('[data-workflow-close]').click()`);
  await check('Closing Filter without saving retains the previous routes',`window.__fixture.propById(window.__ids.filter).routes.code==='E'`);
  await open('loop');
  await check('Loop shows three concrete choices and real destinations',`document.querySelectorAll('.workflow-main h4').length===3&&document.querySelectorAll('.loop-exit').length===2&&!document.querySelector('.workflow-extra').open`);
  await run(`document.querySelector('#loop-max').value='3';document.querySelector('#loop-max').dispatchEvent(new Event('blur'));document.querySelector('.loop-verdict[data-tag="approved"]').click()`);
  await check('Loop conditions save through the original gate configuration',`window.__fixture.propById(window.__ids.loop).maxIter===3&&window.__fixture.propById(window.__ids.loop).when==='approved'`);
  await shot('05-loop');await open('loop');
  await check('Reopened Loop describes the saved limit, not a default',`document.querySelector('#loop-note').textContent.includes('3 passes')`);
  await open('joiner');await run(`document.querySelector('#jn-timeout').value='20';document.querySelector('[data-workflow-close]').click()`);
  await check('Joiner saves its wait limit when closed',`window.__fixture.propById(window.__ids.joiner).timeoutMin===20`);
  for(const id of ['outbox','merger','splitter']){await open(id);await check(id+' has a clear explanation and no unnecessary settings',`document.querySelector('.workflow-no-settings').textContent.includes('No extra settings needed')&&!document.querySelector('.refit-flowstrip')&&document.querySelector('.refit-guide-card').getBoundingClientRect().width>=900`);}
  await shot('06-outbox-and-paths');
  for(const [width,height] of [[1049,912],[698,912],[390,740],[640,568]]){
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    for(const id of ['bay','inbox','filter','loop']){await open(id);if(id==='inbox')await run(`document.querySelector('#trg-new').click()`);
      await check(id+' stays usable at '+width+'×'+height,`(()=>{const c=document.querySelector('.refit-workflow-editor .refit-guide-card'),r=c.getBoundingClientRect(),f=c.querySelector('.workflow-footer').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&f.bottom<=innerHeight+1&&c.scrollWidth<=c.clientWidth+1&&c.querySelector('.workflow-body').clientHeight>40})()`);
    }
    if(width===698)await shot('07-narrow');
  }
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await run(`document.body.style.zoom='1.45';document.body.style.setProperty('--sn-unzoom',String(1/1.45))`);await open('inbox');
  await check('Enlarged text keeps setup inside the screen and stacks its columns',`(()=>{const c=document.querySelector('.refit-workflow-editor .refit-guide-card').getBoundingClientRect(),a=document.querySelector('.workflow-aside').getBoundingClientRect(),m=document.querySelector('.workflow-main').getBoundingClientRect();return c.width<=961&&c.bottom<=innerHeight&&a.top>=m.bottom-1})()`);
  await run(`document.body.style.zoom='';document.body.style.removeProperty('--sn-unzoom')`);await open('bay');
  await check('Controls use station styling without native white paint',`[...document.querySelectorAll('.refit-workflow-editor button,.refit-workflow-editor input,.refit-workflow-editor textarea')].every(e=>!['rgb(255, 255, 255)','rgb(239, 239, 239)'].includes(getComputedStyle(e).backgroundColor))`);
  await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await check('Escape closes setup while leaving Build mode open',`!document.querySelector('.refit-workflow-editor')&&Build.isOpen()`);
  assert.equal(report.exceptions.length,0,JSON.stringify(report.exceptions));writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(e){if(cdp)await capture(cdp,out,'failure').catch(()=>{});throw e;}finally{try{cdp?.ws.close()}catch{}try{proc?.kill()}catch{}}
process.exit(0);
