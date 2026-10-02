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
const server = spawn(process.execPath, ["apps/control-centre/src/main.ts"], { windowsHide: true, env: { ...process.env, HQ_STATE_PATH: join(directory,"state.json"), HQ_ENABLE_MODEL_EXECUTION:"0", HQ_PORT:String(port) }, stdio:"ignore" });
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
    const pages=[];
    for(const page of ["Overview","Businesses","Agents","Jobs","Approvals","Ledger","Activity"]){
      await evaluate(`document.querySelector('[data-page="${page}"]').click()`);
      const dimensions=await evaluate("({width:innerWidth,scroll:document.documentElement.scrollWidth,title:document.getElementById('page-title').textContent,text:document.getElementById('content').textContent})") as {width:number;scroll:number;title:string;text:string};
      if(dimensions.scroll>width||dimensions.title!==page||!dimensions.text)throw new Error(`Bad ${width}px ${page}: ${JSON.stringify(dimensions)}`);pages.push({page,width:dimensions.width,scrollWidth:dimensions.scroll});
    }
    await evaluate("document.querySelector('[data-page=Overview]').click()");
    const shot=await call("Page.captureScreenshot",{format:"png",captureBeyondViewport:true}); await writeFile(join(output,`${width}.png`),Buffer.from(shot.data as string,"base64"));
    reports.push({width,pages,hydrated:true});
  }
  if(errors.length)throw new Error(`Browser errors: ${errors.join(', ')}`);
  await writeFile(join(output,"results.json"),JSON.stringify({reports,browserErrors:errors},null,2));console.log(JSON.stringify({reports,browserErrors:errors},null,2));
} finally {
  socket?.close();browser.kill();server.kill();await sleep(1000);
  // Only the freshly minted smoke directory under the system temporary directory is removed.
  if(resolve(directory).startsWith(resolve(tmpdir())+"\\")&&directory.includes("hq-ui-smoke-"))await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
