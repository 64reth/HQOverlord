#!/usr/bin/env node
// uiresidue.mjs — transition-residue auditor. Drives mode transitions and flags when
// two features coexist (overlap) or a mode fails to tear down. This is the "no overlapping
// BETWEEN features" guarantee: opening B must close A; closing must leave no residue.
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const PORT = process.env.SKYNET_SHOT_PORT || '8921';
const URL = `http://127.0.0.1:${PORT}/`;
const CDP = Number(process.env.SKYNET_CDP_PORT || 9333);
const OUT = process.env.SKYNET_SHOT_DIR || join(process.cwd(), '.uiresidue');
const CH = ['C:/Users/andro/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const sleep = ms => new Promise(r => setTimeout(r, ms));
class C { constructor(w){this.w=w;this.i=0;this.p=new Map();w.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&this.p.has(m.id)){const{res,rej}=this.p.get(m.id);this.p.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}});} s(me,pa={}){const id=++this.i;return new Promise((res,rej)=>{this.p.set(id,{res,rej});this.w.send(JSON.stringify({id,method:me,params:pa}));setTimeout(()=>rej(new Error('to '+me)),30000);});}}
async function conn(){for(let i=0;i<40;i++){try{const r=await fetch(`http://127.0.0.1:${CDP}/json/list`);const t=await r.json();const pg=t.find(x=>x.type==='page');if(pg?.webSocketDebuggerUrl){const w=new WebSocket(pg.webSocketDebuggerUrl);await new Promise((a,b)=>{w.addEventListener('open',a,{once:1});w.addEventListener('error',b,{once:1});});return new C(w);}}catch{}await sleep(250);}throw new Error('no cdp');}
async function ev(c,x){const r=await c.s('Runtime.evaluate',{expression:x,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result?.value;}
const clickBB = t => `(()=>{const e=[...document.querySelectorAll('.bb')].find(x=>(x.textContent||'').includes(${JSON.stringify(t)}));if(e){e.click();return 1}return 0})()`;
const clickAny = t => `(()=>{const e=[...document.querySelectorAll('button,.bb,.bb-grp,.rb-card,.recruit-card,[role=button]')].find(x=>(x.textContent||'').includes(${JSON.stringify(t)}));if(e){e.click();return (e.textContent||'').trim().slice(0,20)}return 'NF'})()`;
// snapshot the set of mutually-exclusive "modes" currently mounted
const STATE = `(()=>{
  const q=s=>document.querySelectorAll(s).length;
  const refit = q('.refit-overlay')>0 || document.body.classList.contains('refit-on');
  const recruit = !!document.querySelector('.recruit, .recruitment, .rb, [class*=recruit]');
  const terms = q('#terms .term');
  const scrim = q('#term-scrim');
  const onboard = !!document.querySelector('.onboard, .awaken, [class*=onboard]');
  const fullscreen = (refit?1:0)+(recruit?1:0)+(onboard?1:0);
  return { refit, recruit, onboard, terms, scrim, fullscreenModes: fullscreen };
})()`;

async function main(){
  mkdirSync(OUT,{recursive:true});
  const proc=spawn(CH,['--headless=new','--disable-gpu','--no-first-run','--hide-scrollbars',`--remote-debugging-port=${CDP}`,'--window-size=1440,900','--user-data-dir='+join(OUT,'_p'),'about:blank'],{stdio:'ignore'});
  const findings=[]; let c;
  try{
    c=await conn(); await c.s('Page.enable'); await c.s('Runtime.enable');
    await c.s('Page.navigate',{url:URL}); await sleep(9000);
    const shot = async n => { const r=await c.s('Page.captureScreenshot',{format:'png'}); writeFileSync(join(OUT,n+'.png'),Buffer.from(r.data,'base64')); };
    const step = async (label, action) => {
      if (action) await ev(c, action); await sleep(1300);
      const st = await ev(c, STATE);
      const bad = st.fullscreenModes>1 || (st.refit && st.terms>0) || (st.recruit && st.terms>0);
      if (bad) findings.push({ label, ...st });
      console.log(`${bad?'⚠ OVERLAP':'  ok    '} | ${label.padEnd(34)} refit=${st.refit?1:0} recruit=${st.recruit?1:0} terms=${st.terms} scrim=${st.scrim} fsModes=${st.fullscreenModes}`);
      return st;
    };

    console.log('--- transition matrix (each row = state AFTER the action) ---');
    await step('baseline ingame', null);
    // T1: dock panel -> another dock panel (intended cascade; >1 term is by-design but note it)
    await step('open SETTINGS', clickBB('SETTINGS'));
    await step('open LOGBOOK (2nd panel)', clickBB('LOGBOOK'));
    await ev(c, `document.querySelectorAll('.term-x').forEach(b=>{try{b.click()}catch{}})`); await step('close all panels', null);
    // T2: enter refit, then open a dock panel WITHOUT exiting refit  (the suspected overlap)
    await step('enter BUILD/refit', clickBB('REFIT STATION'));
    await shot('refit');
    await step('open SETTINGS while in refit', clickBB('SETTINGS'));
    await shot('refit-plus-panel');
    // recover
    await ev(c, `document.getElementById('refit-done')?.click(); document.querySelectorAll('.term-x').forEach(b=>{try{b.click()}catch{}})`);
    await step('exit refit + panels', null);
    // T3: open recruitment (summon), then a dock panel
    await step('open RECRUIT/recruitment', clickBB('RECRUIT'));
    await shot('recruit');
    await step('open SETTINGS while recruiting', clickBB('SETTINGS'));
    await shot('recruit-plus-panel');
    await ev(c, `document.querySelectorAll('.term-x,.rb-close,.recruit-close').forEach(b=>{try{b.click()}catch{}}); ['keydown'].forEach(t=>document.dispatchEvent(new KeyboardEvent(t,{key:'Escape',keyCode:27,bubbles:true})))`);
    await step('close recruitment', null);
    // T4: enter refit, then open recruitment (two full-screen modes?)
    await step('enter BUILD/refit again', clickBB('REFIT STATION'));
    await step('open RECRUIT while in refit', clickBB('RECRUIT'));
    await shot('refit-plus-recruit');

    writeFileSync(join(OUT,'residue.json'), JSON.stringify({findings},null,2));
    console.log(`\n=== RESIDUE FINDINGS: ${findings.length} ===`);
    findings.forEach(f=>console.log(`  ⚠ ${f.label}: refit=${f.refit} recruit=${f.recruit} terms=${f.terms} fsModes=${f.fullscreenModes}`));
    console.log(`frames+json → ${OUT}`);
  } finally { try{c?.w.close()}catch{} proc.kill('SIGKILL'); }
}
main().catch(e=>{console.error('FATAL',e);process.exit(1);});
