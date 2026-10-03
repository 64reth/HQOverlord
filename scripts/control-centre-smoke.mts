/** Optional local browser smoke. Uses installed Chrome + native CDP; no npm/browser download. */
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
const directory = await mkdtemp(join(tmpdir(), "hq-ui-smoke-"));
const output = resolve("apps/control-centre/.local/smoke"); await mkdir(output, { recursive: true });
async function freePort() { const s = createServer(); await new Promise<void>(r => s.listen(0,"127.0.0.1",r)); const a = s.address(); if (!a || typeof a === "string") throw new Error("No port"); await new Promise<void>(r => s.close(() => r())); return a.port; }
const port = await freePort(), debugPort = await freePort();
const launchServer = () => spawn(process.execPath, ["apps/control-centre/src/main.ts"], { windowsHide: true, env: { ...process.env, HQ_STATE_PATH: join(directory,"state.json"), HQ_ENABLE_MODEL_EXECUTION:"0", HQ_ENABLE_CHANNELS:"0",HQ_ENABLE_CONNECTORS:"0", HQ_PORT:String(port) }, stdio:"ignore" });
let server = launchServer();
const browser = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-default-apps", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(directory,"chrome")}`, "about:blank"], { windowsHide:true,stdio:"ignore" });
const sleep = (ms:number) => new Promise(r => setTimeout(r,ms));
async function ready(url:string) { for (let i=0;i<100;i++) { try { const r=await fetch(url,{signal:AbortSignal.timeout(500)}); if(r.ok)return; }catch{} await sleep(100); } throw new Error(`Local service did not start: ${url}`); }
let socket: WebSocket | undefined;
try {
  await ready(`http://127.0.0.1:${port}/`); await ready(`http://127.0.0.1:${debugPort}/json/version`);
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json() as { webSocketDebuggerUrl:string;type:string }[];
  socket = new WebSocket(targets.find(t=>t.type==="page")!.webSocketDebuggerUrl);
  await new Promise<void>((r,j)=>{socket!.onopen=()=>r();socket!.onerror=()=>j(new Error("CDP failed"));});
  let id=0;const pending=new Map<number,{resolve:(v:Record<string,unknown>)=>void;reject:(e:Error)=>void}>(); const errors:string[]=[];
  socket.onmessage=event=>{const m=JSON.parse(String(event.data)); if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p?.reject(new Error(m.error.message));else p?.resolve(m.result??{});} else if(m.method==="Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.text);};
  const call=(method:string,params:unknown={})=>new Promise<Record<string,unknown>>((resolve,reject)=>{const requestId=++id;const timeout=setTimeout(()=>{pending.delete(requestId);reject(new Error(`CDP timeout: ${method}`));},15000);pending.set(requestId,{resolve:v=>{clearTimeout(timeout);resolve(v);},reject:e=>{clearTimeout(timeout);reject(e);}});socket!.send(JSON.stringify({id:requestId,method,params}));});
  async function evaluate(expression:string) { const r=await call("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return (r.result as {value:unknown}).value; }
  async function waitFor(expression:string,label:string){for(let i=0;i<50;i++){if(await evaluate(expression))return;await sleep(100);}throw new Error(label);}
  await call("Page.enable");await call("Runtime.enable");
  // Browser page cannot make external HTTP requests during smoke verification.
  await call("Fetch.enable",{patterns:[{urlPattern:"*"}]});
  const handle=socket.onmessage; socket.onmessage=event=>{const m=JSON.parse(String(event.data));if(m.method==="Fetch.requestPaused"){
    const url=String(m.params.request.url);void call(url.startsWith(`http://127.0.0.1:${port}/`)?"Fetch.continueRequest":"Fetch.failRequest",{requestId:m.params.requestId,...(url.startsWith(`http://127.0.0.1:${port}/`)?{}:{errorReason:"BlockedByClient"})});
  }else handle?.call(socket!,event);};
  const reports:unknown[]=[];
  for(const width of [390,1440]){
    await call("Emulation.setDeviceMetricsOverride",{width,height:1000,deviceScaleFactor:1,mobile:width===390});
    await call("Page.navigate",{url:`http://127.0.0.1:${port}/`});
    let connected=false;for(let i=0;i<100;i++){if(await evaluate("document.getElementById('connection')?.textContent === 'Live'")){connected=true;break;}await sleep(100);}if(!connected)throw new Error("UI did not hydrate");
    await evaluate("document.querySelectorAll('.bb-grp')[1].click()");
    if(!await evaluate("document.querySelectorAll('.bb-group')[1].classList.contains('open')"))throw new Error('WORK dock did not open');
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    if(await evaluate("!!document.querySelector('.bb-group.open')"))throw new Error('Escape did not close dock');
    const pages=[];
    const baseDimensions = await evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth,crew:document.querySelectorAll('#crew [data-agent-id]').length,revenue:document.getElementById('revenue').textContent,text:document.body.textContent})") as {width:number;scroll:number;crew:number;revenue:string;text:string};
    if(baseDimensions.scroll>width||baseDimensions.crew!==5||baseDimensions.revenue!=="£0.00"||/First.*Customer|2026-10-04|£10/.test(baseDimensions.text)) throw new Error(`Bad cabinet ${width}: ${JSON.stringify(baseDimensions)}`);
    await evaluate("document.getElementById('camera-reset').click()");
    const hit=await evaluate("(()=>{const r=document.getElementById('stage').getBoundingClientRect(),s=Math.min(r.width/960,r.height/650);return {x:r.left+r.width/2+(475-480)*s,y:r.top+r.height/2+(455-325)*s}})()") as {x:number;y:number};
    await call("Input.dispatchMouseEvent",{type:"mousePressed",...hit,button:"left",clickCount:1});
    await call("Input.dispatchMouseEvent",{type:"mouseReleased",...hit,button:"left",clickCount:1});
    if(!await evaluate("document.getElementById('comms-agent-select').selectedOptions[0].textContent==='Delivery'"))throw new Error('Canvas selection did not reach COMMS');
    await evaluate("document.querySelectorAll('#crew [data-agent-id]')[1].click()");
    const selection=await evaluate("document.querySelector('#crew .selected').dataset.agentId === document.getElementById('comms-agent-select').value");
    if(!selection)throw new Error('Crew/COMMS selection diverged');
    for(const page of ["Agent dossier","Recruit","Configure crew","Notebook","Tools","Place gear","Jobs","Workflows","Recipes","Routines","Night Shift","Channels","Emergency stop","Knowledge","Artifacts","Activity","Approvals","Ledger","Business","Notices","Source-backed work"]){
      await evaluate(`document.querySelector('[data-term="${page}"]').click()`);
      const dimensions=await evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth,title:document.getElementById('panel-title').textContent,text:document.getElementById('panel-content').textContent})") as {width:number;scroll:number;title:string;text:string};
      if(dimensions.scroll>width||dimensions.title!==page.toUpperCase()||!dimensions.text)throw new Error(`Bad ${width}px ${page}: ${JSON.stringify(dimensions)}`);pages.push({page,width:dimensions.width,scrollWidth:dimensions.scroll});
      if(page==='Agent dossier'||page==='Ledger'){const screenshot=await call("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});await writeFile(join(output,`${width}-${page.replaceAll(' ','-')}.png`),Buffer.from(screenshot.data as string,"base64"));}
      await evaluate("document.getElementById('panel-close').click()");
    }
    // Real local durable mutation, no provider or external web I/O.
    const objective = `Inspect supplied material (${width}px)`;
    await evaluate(`document.getElementById('job-objective').value=${JSON.stringify(objective)};document.getElementById('job-composer').requestSubmit()`);
    let queued=false;for(let i=0;i<50;i++){if(await evaluate(`document.getElementById('chat-log').textContent.includes(${JSON.stringify(objective)}) && document.getElementById('job-objective').value === '' && document.getElementById('notice').textContent === 'Saved by HQ runtime.'`)){queued=true;break;}await sleep(100);}if(!queued)throw new Error('Job mutation did not reach authoritative SSE');
    await evaluate("document.getElementById('crew-search').value='';document.getElementById('crew-search').dispatchEvent(new Event('input'))");
    let stationForms=false;
    if(width===1440){
      const open=(panel:string)=>evaluate(`document.querySelector('[data-term="${panel}"]').click()`);
      const submit=(field:string,values:Record<string,string>)=>evaluate(`(()=>{const form=[...document.querySelectorAll('#panel-content form')].find(f=>f.querySelector('[name="${field}"]'));for(const [key,value]of Object.entries(${JSON.stringify(values)}))form.querySelector('[name="'+key+'"]').value=value;form.requestSubmit();})()`);
      await open('Recruit');await submit('specialist',{name:'Smoke specialist',specialist:''});
      await waitFor("[...document.querySelectorAll('#crew [data-agent-id]')].some(e=>e.textContent.includes('Smoke specialist'))",'Recruit did not create a real crew member');
      await evaluate("[...document.querySelectorAll('#crew [data-agent-id]')].find(e=>e.textContent.includes('Smoke specialist')).click()");
      await open('Configure crew');await submit('instructions',{instructions:'Read only supplied evidence',personality:'Precise',budgetCents:'1'});
      await waitFor("fetch('/api/snapshot').then(r=>r.json()).then(s=>s.station.profiles.some(p=>p.instructions==='Read only supplied evidence'&&p.budget.minorUnits==='1'))",'Profile form did not persist exact configuration');
      await submit('x',{x:'780',y:'440'});
      await waitFor("fetch('/api/snapshot').then(r=>r.json()).then(s=>s.station.desks.some(d=>d.x===780&&d.y===440))",'Desk form did not persist');
      await open('Notebook');await submit('key',{key:'smoke-note',text:'Real private notebook record'});
      await waitFor("fetch('/api/snapshot').then(r=>r.json()).then(s=>s.station.notebooks.some(n=>n.key==='smoke-note'))",'Notebook form did not persist');
      await open('Place gear');await submit('kind',{id:'smoke-notebook',kind:'notebook',x:'110',y:'550'});
      await waitFor("fetch('/api/snapshot').then(r=>r.json()).then(s=>s.agents.every(a=>a.toolIds.includes('notebook.read')))",'Placed gear did not grant the actual whole crew');
      await open('Workflows');
      const agentId=await evaluate("document.getElementById('comms-agent-select').value");
      const geometry={props:[{id:'in',t:'intake',x:0,y:0,w:1,h:1},{id:'bay',t:'bay',x:2,y:0,w:2,h:2,agentId},{id:'out',t:'outbox',x:5,y:0,w:1,h:1}],belts:[{x:1,y:0,dir:'E'},{x:4,y:0,dir:'E'}]};
      if(!await evaluate("!!document.querySelector('canvas[aria-label^=\"Conveyor editor\"]')"))throw new Error('Conveyor editor is absent');
      await submit('geometry',{id:'smoke-line',name:'Actual saved floor',geometry:JSON.stringify(geometry)});
      await waitFor("fetch('/api/snapshot').then(r=>r.json()).then(s=>s.station.workflows?.some(w=>w.id==='smoke-line'&&w.geometry.belts.length===2))",'Floor form did not save executable geometry');
      await evaluate("document.getElementById('panel-close').click()");stationForms=true;
    }
    server.kill();
    let stale=false;for(let i=0;i<70;i++){if(await evaluate("document.getElementById('connection').textContent==='Disconnected'")){stale=true;break;}await sleep(100);}
    if(!stale)throw new Error('Lost network did not mark activity unknown');
    if(!await evaluate("[...document.querySelectorAll('[data-mutation]')].every(b=>b.disabled)&&document.getElementById('chat-status').textContent==='UNKNOWN'"))throw new Error('Stale transport did not disable mutations / mark selected agent unknown');
    await sleep(300); server = launchServer(); await ready(`http://127.0.0.1:${port}/`);
    let restored=false;for(let i=0;i<100;i++){if(await evaluate("document.getElementById('connection').textContent==='Live'")){restored=true;break;}await sleep(100);}if(!restored)throw new Error('Reconnect did not hydrate');
    await evaluate("document.getElementById('camera-reset').click()");
    const shot=await call("Page.captureScreenshot",{format:"png",captureBeyondViewport:true}); await writeFile(join(output,`${width}.png`),Buffer.from(shot.data as string,"base64"));
    if(stationForms)await waitFor("fetch('/api/snapshot').then(r=>r.json()).then(s=>s.station.notebooks.some(n=>n.key==='smoke-note')&&s.station.workflows?.some(w=>w.id==='smoke-line')&&s.agents.some(a=>a.name==='Smoke specialist'))",'New station state did not survive actual host restart');
    reports.push({width,pages,hydrated:true,canvasSelection:true,authoritativeMutation:true,stationForms,disconnectUnknown:true,mutationsDisabledOnDisconnect:true,restartHydration:true});
  }
  if(errors.length)throw new Error(`Browser errors: ${errors.join(', ')}`);
  await writeFile(join(output,"results.json"),JSON.stringify({reports,browserErrors:errors},null,2));console.log(JSON.stringify({reports,browserErrors:errors},null,2));
} finally {
  socket?.close();browser.kill();server.kill();await sleep(1000);
  // Only the freshly minted smoke directory under the system temporary directory is removed.
  if(resolve(directory).startsWith(resolve(tmpdir())+"\\")&&directory.includes("hq-ui-smoke-"))await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
