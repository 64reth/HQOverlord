// Header appearance and real connection/E-STOP wiring on a disposable seeded server.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {findChrome,connectCDP,evalJS,capture,sleep} from '../scripts/lib/cdp.mjs';
import {materializeSeedWorkspace,bootSeededSidecar,waitUp,waitDevReady} from '../scripts/lib/seed.mjs';
const out='.worldshots/header-instruments', scratch=mkdtempSync(join(tmpdir(),'starnet-header-')), ws=join(scratch,'ws');
mkdirSync(out,{recursive:true});materializeSeedWorkspace(ws,'test/model');
const report={checks:[],exceptions:[]};let side,chrome,cdp;
const mock=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:[{id:'test/model',context_length:32000,pricing:{prompt:'0',completion:'0'},supported_parameters:['tools']}]}));});
await new Promise(r=>mock.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+mock.address().port+'/api/v1';
const boot=()=>bootSeededSidecar({port:9490,model:'test/model',scratchDir:ws,key:'sk-or-ui-fixture',env:{SKYNET_OPENROUTER_BASE:base,STARNET_OPENROUTER_BASE:base}});
const run=s=>evalJS(cdp,s);
async function until(s){for(let i=0;i<150;i++){if(await run(s))return;await sleep(200);}throw Error('Timed out: '+s);}
async function check(name,s){assert.ok(await run(s),name);report.checks.push(name);}
async function shot(name){await sleep(200);await capture(cdp,out,name);const clip=await run(`(()=>{const r=document.querySelector('#topbar .tb-stats').getBoundingClientRect();return{x:Math.max(0,r.x-5),y:Math.max(0,r.y-5),width:r.width+10,height:r.height+10,scale:2}})()`);const r=await cdp.send('Page.captureScreenshot',{format:'png',clip,captureBeyondViewport:false});writeFileSync(join(out,name+'-detail.png'),Buffer.from(r.data,'base64'));}
const fits=`(()=>{const bar=document.querySelector('#topbar').getBoundingClientRect();return ['.tb-connection','#tb-station'].every(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return !r.width||(r.left>=bar.left&&r.right<=bar.right+1&&r.top>=bar.top&&r.bottom<=bar.bottom+1&&e.scrollWidth<=e.clientWidth+1)})})()`;
try{
  side=boot();assert.ok(await waitUp('http://127.0.0.1:9490/'));
  chrome=spawn(findChrome(),['--headless=new','--enable-gpu','--no-first-run','--no-default-browser-check','--hide-scrollbars','--mute-audio','--remote-debugging-port=9491','--window-size=1440,1000','--user-data-dir='+join(scratch,'chrome'),'about:blank'],{stdio:'ignore',windowsHide:true});
  cdp=await connectCDP(9491);await cdp.send('Runtime.enable');await cdp.send('Page.enable');await cdp.send('Network.enable');
  let haltRequests=0;cdp.on('Network.requestWillBeSent',e=>{if(e.request.method==='POST'&&e.request.url.endsWith('/api/halt'))haltRequests++;});
  cdp.on('Runtime.exceptionThrown',e=>report.exceptions.push(e.exceptionDetails.exception?.description||e.exceptionDetails.text));
  await cdp.send('Page.navigate',{url:'http://127.0.0.1:9490/'});assert.ok(await waitDevReady(cdp,evalJS,{url:'http://127.0.0.1:9490/'}));
  await until(`document.querySelector('#status-pill').textContent==='ONLINE'&&!World.linkState().down`);
  await until(`document.querySelector('.tb-xp-fill').style.width!==''`);
  await until(`JourneyStore.status()?.progression&&document.querySelector('#gt-station').textContent.startsWith('Lv ')`);
  await check('Commander level and progress match the server-owned Journey snapshot',`(()=>{const g=JourneyStore.status().progression;const pct=Math.max(0,Math.min(100,Math.round(100*(g.points-g.levelStartsAt)/(g.nextLevelAt-g.levelStartsAt))));return document.querySelector('#tb-station .tb-lbl').textContent==='COMMANDER'&&document.querySelector('#gt-station').textContent==='Lv '+g.level&&document.querySelector('.tb-xp-fill').style.width===pct+'%'})()`);
  await check('E-STOP moved out of the header into SYSTEM',`!document.querySelector('#topbar #estop-btn')&&document.querySelector('[data-group=system] #estop-btn small').textContent==='halt all runs · Alt+H'`);
  await check('The connection display replaces the old signal glyph and rounded pill',`getComputedStyle(document.querySelector('#sig b')).display==='none'&&getComputedStyle(document.querySelector('#status-pill')).borderRadius==='0px'&&document.querySelector('.tb-link-mark')`);
  await check('Desktop instruments fit within the top bar',fits);await shot('01-online');
  for(const width of [1150,1049,860,698,600,475,390,320]){
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:912,deviceScaleFactor:1,mobile:false});await sleep(200);
    await check('Header controls fit at '+width+'px',fits);
    await run(`document.querySelector('[data-group=system] .bb-grp').click()`);await sleep(300);
    await check('SYSTEM E-STOP stays reachable at '+width+'px',`(()=>{const r=document.querySelector('#estop-btn').getBoundingClientRect(),e=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return e?.closest('#estop-btn')&&r.height>=43.9&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()`);
    await run(`document.querySelector('[data-group=system] .bb-grp').click()`);
    if(width===698||width===390)await shot('responsive-'+width);
  }
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await run(`document.body.style.zoom='1.45';document.body.style.setProperty('--sn-unzoom',String(1/1.45))`);await sleep(200);
  await check('Header instruments fit with enlarged text',fits);await shot('02-large-text');
  await run(`document.body.style.zoom='';document.body.style.removeProperty('--sn-unzoom')`);
  for(const theme of ['green','blue','purple','red','white','amber']){
    await run(`StationUI.setTheme(${JSON.stringify(theme)})`);await sleep(150);
    await check('Instruments keep theme-derived colors in '+theme,`getComputedStyle(document.querySelector('#status-pill')).color===getComputedStyle(document.querySelector('#gt-station')).color&&getComputedStyle(document.querySelector('#estop-btn')).color!==getComputedStyle(document.querySelector('#status-pill')).color`);
    if(theme==='blue')await shot('03-blue-theme');
  }
  await run(`document.querySelector('[data-group=system] .bb-grp').click()`);await shot('system-menu');
  await run(`document.querySelector('#estop-btn').click()`);
  await check('Choosing E-STOP closes the SYSTEM menu',`!document.querySelector('[data-group=system]').classList.contains('open')`);
  await until(`document.body.textContent.includes('HALT — stopped 0 runs')`);
  await check('Clicking E-STOP reaches the isolated server and halts its loop scheduler',`fetch('/api/loops').then(r=>r.json()).then(j=>j.halted===true)`);
  assert.equal(haltRequests,1);
  await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'h',code:'KeyH',windowsVirtualKeyCode:72,modifiers:1});
  await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'h',code:'KeyH',windowsVirtualKeyCode:72,modifiers:1});
  for(let i=0;i<50&&haltRequests<2;i++)await sleep(100);
  assert.equal(haltRequests,2);report.checks.push('The global Alt+H shortcut sends a second real halt request');
  await run(`World.pauseBridge();Topbar._paintSig()`);await until(`document.querySelector('#status-pill').classList.contains('standby')`);
  await check('Paused connections show standby rather than an online lamp',`document.querySelector('#sig').classList.contains('standby')&&World.linkState().paused`);await shot('04-standby');
  await run(`World.resumeBridge()`);await until(`document.querySelector('#status-pill').textContent==='ONLINE'&&!World.linkState().down`);
  const stopped=side;side=null;const exited=new Promise(r=>stopped.once('exit',r));stopped.kill();await exited;
  await until(`document.querySelector('#sig').classList.contains('down')&&document.querySelector('#status-pill').classList.contains('down')`);
  await check('Stopping the real server produces a visible connection fault',`World.linkState().down&&getComputedStyle(document.querySelector('.tb-link-mark')).stroke===getComputedStyle(document.querySelector('#status-pill')).color`);await shot('05-link-down');
  side=boot();assert.ok(await waitUp('http://127.0.0.1:9490/'));
  // A new sidecar process rotates its launch token; reload through the real bootstrap to receive it.
  await cdp.send('Page.reload');await sleep(1000);assert.ok(await waitDevReady(cdp,evalJS,{url:'http://127.0.0.1:9490/'}));
  await until(`document.querySelector('#status-pill').textContent==='ONLINE'&&!document.querySelector('#sig').classList.contains('down')`);
  await check('The display returns online after reloading against the restarted server',`World.linkState().bridged&&!World.linkState().down`);
  await check('Header controls have no native white paint',`![...document.querySelectorAll('#topbar button')].some(e=>['rgb(255, 255, 255)','rgb(239, 239, 239)'].includes(getComputedStyle(e).backgroundColor))`);
  assert.equal(report.exceptions.length,0,JSON.stringify(report.exceptions));writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(e){if(cdp)await capture(cdp,out,'failure').catch(()=>{});throw e;}
finally{try{cdp?.ws.close()}catch{}chrome?.kill();side?.kill();mock.close();}
process.exit(0);
