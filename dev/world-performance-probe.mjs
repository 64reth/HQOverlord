// Local renderer benchmark; uses a separate Chromium process and the seeded demo.
// Software-rendered headless results are reported as such, not as desktop GPU FPS.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { launchChrome, findChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
const label=process.argv[2] || 'latest';
let proc,cdp;
try {
  const gpu=process.argv.includes('--gpu');
  if(gpu) proc=spawn(findChrome(),['--headless=new','--enable-gpu','--no-first-run','--no-default-browser-check','--hide-scrollbars','--mute-audio','--remote-debugging-port=9349','--window-size=1440,900','--user-data-dir=.worldshots/perf-gpu-profile','about:blank'],{stdio:'ignore',windowsHide:true});
  else ({proc}=launchChrome({cdpPort:9349,win:'1440,900',profileDir:'.worldshots/perf-profile'}));
  cdp=await connectCDP(9349);
  await cdp.send('Page.enable');
  if(process.argv.includes('--timings') || process.argv.includes('--baseline')){
    cdp.on('Fetch.requestPaused',async p=>{
      const file=new URL(p.request.url).pathname.slice(1),path='frontend/'+file;
      let body=process.argv.includes('--baseline')?execFileSync('git',['show','8edf29f19:'+path],{encoding:'utf8'}):readFileSync(path,'utf8');
      if(process.argv.includes('--timings')&&file==='app/world.js'){
        const names=['drawBackdrop','drawGlows','drawPropLights','drawCurve','drawCRT','watchCanvasLoss','watchStageLoss','drawNavLights','drawPropShadows','paintPropShadows','drawDust','tick'];
        const wrap=names.map(n=>`{const paint=${n};${n}=function(...args){const t=performance.now();try{return paint(...args);}finally{const p=window.__renderProbe;if(p&&p.enabled){const a=(p.parts||={})['${n}']||=[];a.push(performance.now()-t);}}};}`).join('\n');
        body=body.replace('  function frameBody(now) {',wrap+'\n  function frameBody(now) {');
      }
      await cdp.send('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:Buffer.from(body).toString('base64')});
    });
    await cdp.send('Fetch.enable',{patterns:['world.js','propsprites.js','stationbake.js'].map(n=>({urlPattern:'*/app/'+n+'*',requestStage:'Request'}))});
  }
  await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:String.raw`
    (()=>{
      const raf=window.requestAnimationFrame.bind(window), create=Document.prototype.createElement, read=CanvasRenderingContext2D.prototype.getImageData;
      const p=window.__renderProbe={samples:[],reads:0,canvases:0,enabled:false,readSources:{}};
      Document.prototype.createElement=function(tag,...rest){if(p.enabled&&tag==='canvas')p.canvases++;return create.call(this,tag,...rest);};
      CanvasRenderingContext2D.prototype.getImageData=function(...args){if(p.enabled){p.reads++;const stack=new Error().stack.split('\n').slice(2,4).join(' | ');p.readSources[stack]=(p.readSources[stack]||0)+1;}return read.apply(this,args);};
      window.requestAnimationFrame=fn=>raf(t=>{const start=performance.now();try{return fn(t);}finally{if(p.enabled)p.samples.push({t,ms:performance.now()-start});}});
    })();`});
  await cdp.send('Page.navigate',{url:'http://127.0.0.1:9177/'});
  for(let i=0;i<50;i++){if(await evalJS(cdp,"typeof World !== 'undefined' && !!World.cameraDbg().gates.cache"))break;await sleep(200);}
  if(process.argv.includes('--close'))await evalJS(cdp,'World.focusAgent({force:true})');
  await sleep(process.argv.includes('--settled')?10000:3000);
  if(process.argv.includes('--profile')){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
  await evalJS(cdp,'window.__renderProbe.enabled=true');
  await sleep(process.argv.includes('--settled')?20000:10000);
  if(process.argv.includes('--profile')){const {profile}=await cdp.send('Profiler.stop');writeFileSync('.worldshots/cpu-'+label+'.json',JSON.stringify(profile));console.log(JSON.stringify(profile.nodes.filter(n=>n.hitCount).sort((a,b)=>b.hitCount-a.hitCount).slice(0,18).map(n=>({fn:n.callFrame.functionName,url:n.callFrame.url.split('/').at(-1),line:n.callFrame.lineNumber,hits:n.hitCount}))));}
  const result=await evalJS(cdp,`(()=>{
    const p=window.__renderProbe;p.enabled=false;
    const times=[...new Set(p.samples.map(s=>s.t))].sort((a,b)=>a-b), costs=new Map();
    for(const s of p.samples)costs.set(s.t,(costs.get(s.t)||0)+s.ms);
    const ms=[...costs.values()].sort((a,b)=>a-b), gaps=times.slice(1).map((t,i)=>t-times[i]).sort((a,b)=>a-b);
    const q=(a,f)=>+(a[Math.min(a.length-1,Math.floor(a.length*f))]||0).toFixed(2);
    return {frames:times.length, fps:+(1000*(times.length-1)/(times.at(-1)-times[0])).toFixed(1), callbackMs:{median:q(ms,.5),p95:q(ms,.95)}, intervalMs:{median:q(gaps,.5),p95:q(gaps,.95)}, parts:Object.fromEntries(Object.entries(p.parts||{}).map(([k,a])=>[k,{mean:a.reduce((s,v)=>s+v,0)/a.length,p95:q(a.sort((a,b)=>a-b),.95)}])), pixelReadbacks:p.reads,canvasAllocations:p.canvases,jsHeapMB:performance.memory?+(performance.memory.usedJSHeapSize/1048576).toFixed(1):null,viewport:[innerWidth,innerHeight],readSources:p.readSources,renderer:'headless Chromium',camera:World.cameraDbg()};
  })()`);
  result.gpuEnabled=gpu;
  if(gpu)result.gpuRenderer=await evalJS(cdp,`(()=>{const g=document.createElement('canvas').getContext('webgl');const e=g&&g.getExtension('WEBGL_debug_renderer_info');return e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):'unavailable';})()`);
  writeFileSync('.worldshots/perf-'+label+'.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {try{cdp?.ws.close();}catch{}try{proc?.kill();}catch{}}
process.exit(0);
