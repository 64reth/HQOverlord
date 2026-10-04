#!/usr/bin/env node
// uisummon.mjs — drive the summon/recruitment flow (matrix layer 7) and audit it.
// Opens the recruitment bay, recruits a candidate, then checks: bay closes cleanly,
// a guidance beat appears (not dogpiled), the new body exists + is positioned (not frozen
// at center / not vanished), no console errors, no stacking. Captures a frame sequence.
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const PORT = process.env.SKYNET_SHOT_PORT || '8921';
const URL = `http://127.0.0.1:${PORT}/`;
const CDP = Number(process.env.SKYNET_CDP_PORT || 9335);
const OUT = process.env.SKYNET_SHOT_DIR || join(process.cwd(), '.uisummon');
const CH = ['C:/Users/andro/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const sleep = ms => new Promise(r => setTimeout(r, ms));
class C { constructor(w){this.w=w;this.i=0;this.p=new Map();this.h=new Map();w.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const{res,rej}=this.p.get(m.id);this.p.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}else if(m.method)(this.h.get(m.method)||[]).forEach(f=>f(m.params));});} s(me,pa={}){const id=++this.i;return new Promise((res,rej)=>{this.p.set(id,{res,rej});this.w.send(JSON.stringify({id,method:me,params:pa}));setTimeout(()=>rej(new Error('to '+me)),30000);});} on(m,f){if(!this.h.has(m))this.h.set(m,[]);this.h.get(m).push(f);}}
async function conn(){for(let i=0;i<40;i++){try{const r=await fetch(`http://127.0.0.1:${CDP}/json/list`);const t=await r.json();const pg=t.find(x=>x.type==='page');if(pg?.webSocketDebuggerUrl){const w=new WebSocket(pg.webSocketDebuggerUrl);await new Promise((a,b)=>{w.addEventListener('open',a,{once:1});w.addEventListener('error',b,{once:1});});return new C(w);}}catch{}await sleep(250);}throw new Error('no cdp');}
async function ev(c,x){const r=await c.s('Runtime.evaluate',{expression:x,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result?.value;}

// crew + beat snapshot. Tries a few likely World accessors without assuming one.
const PROBE = `(()=>{
  const W = window.World||{};
  let crew = null;
  try { crew = (W.crew && (Array.isArray(W.crew)?W.crew:W.crew())) || (W.getCrew&&W.getCrew()) || null; } catch {}
  const crewCount = Array.isArray(crew) ? crew.length : (typeof W.crewCount==='function'?W.crewCount():null);
  const positions = Array.isArray(crew) ? crew.map(b=>({id:b.id||b.agentId||'?', x:Math.round(b.x??b.px??-1), y:Math.round(b.y??b.py??-1), act:b.activity||b.act||''})) : null;
  const bay = !!document.querySelector('[class*=mkt],[class*=recruit],[class*=bay]') || [...document.querySelectorAll('.term-title,h2,h3')].some(e=>/recruit/i.test(e.textContent||''));
  const beats = [...document.querySelectorAll('#chat-log .beat, #chat-log .card, #chat-log [class*=beat], #chat-log [class*=guid]')].map(e=>(e.textContent||'').trim().replace(/\\s+/g,' ').slice(0,40));
  return { crewCount, positions, bayOpen: bay, beats, beatCount: beats.length };
})()`;

async function main(){
  mkdirSync(OUT,{recursive:true});
  const proc=spawn(CH,['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars',`--remote-debugging-port=${CDP}`,'--window-size=1440,900','--user-data-dir='+join(OUT,'_p'),'about:blank'],{stdio:'ignore'});
  const errs=[]; let c;
  try{
    c=await conn();
    c.on('Runtime.consoleAPICalled',p=>{if(p.type==='error'||p.type==='warning')errs.push((p.args||[]).map(a=>a.value??a.description??'').join(' ').slice(0,160));});
    c.on('Runtime.exceptionThrown',p=>errs.push('EXC '+((p.exceptionDetails?.exception?.description||p.exceptionDetails?.text||'')+'').slice(0,160)));
    await c.s('Page.enable');await c.s('Runtime.enable');
    await c.s('Page.navigate',{url:URL});await sleep(9000);
    const shot=async n=>{const r=await c.s('Page.captureScreenshot',{format:'png'});writeFileSync(join(OUT,n+'.png'),Buffer.from(r.data,'base64'));};

    const before=await ev(c,PROBE); console.log('before:',JSON.stringify(before));
    await shot('0-before');
    // open bay
    await ev(c,`[...document.querySelectorAll('.bb')].find(e=>(e.textContent||'').includes('SUMMON'))?.click()`); await sleep(1500);
    await shot('1-bay'); const bay=await ev(c,PROBE); console.log('bay open:',JSON.stringify(bay));
    // recruit the first candidate
    const rec=await ev(c,`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/RECRUIT/.test(x.textContent||'')&&x.offsetParent!==null);if(b){b.click();return (b.textContent||'').trim()}return 'NF'})()`);
    console.log('recruit click →',rec);
    // watch the result
    for(let t=1;t<=6;t++){ await sleep(1500); await shot(`2-after-${t}`); const s=await ev(c,PROBE);
      console.log(`  t${t}: crew=${s.crewCount} bayOpen=${s.bayOpen} beats=${s.beatCount} pos=${JSON.stringify(s.positions)}`); }
    const after=await ev(c,PROBE);

    const report={ before, after, recruitClicked:rec, consoleErrors:errs };
    writeFileSync(join(OUT,'summon.json'),JSON.stringify(report,null,2));
    console.log(`\n=== SUMMON AUDIT ===`);
    console.log(`crew: ${before.crewCount} -> ${after.crewCount}  | bay closed after recruit: ${!after.bayOpen}`);
    console.log(`guidance beats after: ${after.beatCount}`, after.beats);
    console.log(`console errors/exceptions: ${errs.length}`); errs.slice(0,10).forEach(e=>console.log('  '+e));
    console.log(`frames+json → ${OUT}`);
  } finally { try{c?.w.close()}catch{} proc.kill('SIGKILL'); }
}
main().catch(e=>{console.error('FATAL',e);process.exit(1);});
