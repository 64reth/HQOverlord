// Live PL-03/PL-08 adversarial journey. Uses the repository's sanctioned CDP harness.
// Run against a seeded station for reload mode, and a fresh onboard sidecar for custom mode:
//   STARNET_URL=http://127.0.0.1:9132 node scripts/qa/boot-onboarding-truth-journey.mjs reload
//   STARNET_URL=http://127.0.0.1:9133 node scripts/qa/boot-onboarding-truth-journey.mjs custom
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, collectDiagnostics, sleep } from '../lib/cdp.mjs';

const mode = process.argv[2] || 'reload';
const url = process.env.STARNET_URL || 'http://127.0.0.1:9132';
const cdpPort = Number(process.env.STARNET_CDP_PORT || 9812);
const profileDir = mkdtempSync(join(tmpdir(), 'starnet-boot-truth-'));
const { proc } = launchChrome({ cdpPort, win: '1440,900', profileDir });
let cdp;
const receipts = [], failures = [];
const check = (name, ok, detail) => { (ok ? receipts : failures).push({ name, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : '')); };
async function waitFor(expr, label, attempts = 200) { for (let i=0;i<attempts;i++) { if (await evalJS(cdp, expr).catch(() => false)) return; await sleep(50); } throw new Error('timeout ' + label); }
async function bootState() {
  return evalJS(cdp, `(() => { const ls=World.linkState(); return {ls,chat:document.querySelector('#chat-status')?.textContent,pill:document.querySelector('#status-pill')?.textContent,sig:document.querySelector('#sig')?.textContent.replace(/\\s+/g,' ').trim(),empty:document.querySelector('.cmsg-empty-line')?.textContent||''}; })()`);
}
function coherentConnecting(s) {
  return s.chat === 'connecting…' && s.pill === 'CONNECTING' && /^CONNECTING\b/.test(s.sig) && (!s.empty || /^COMMS connecting…/.test(s.empty));
}

try {
  cdp = await connectCDP(cdpPort); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const diag = collectDiagnostics(cdp);
  await cdp.send('Page.navigate', { url });
  if (mode === 'reload') {
    await waitFor(`!!document.querySelector('#screen-game.active') && typeof World==='object'`, 'seeded station');
    for (let n=1;n<=10;n++) {
      await cdp.send('Page.reload', { ignoreCache: true }); await sleep(120);
      await waitFor(`document.readyState==='complete' && !!document.querySelector('#screen-game.active') && typeof World==='object'`, 'reload '+n);
      const timeline=[];
      for (let i=0;i<160;i++) {
        const s=await bootState(); timeline.push(s);
        if (s.ls && s.ls.bridged && !s.ls.paused && !s.ls.down) break;
        if (!coherentConnecting(s)) break;
        await sleep(50);
      }
      const pre=timeline.filter(s=>!(s.ls&&s.ls.bridged&&!s.ls.paused&&!s.ls.down));
      check(`reload ${n} has one pre-authority claim`, pre.every(coherentConnecting), JSON.stringify(pre.find(s=>!coherentConnecting(s))||pre.at(-1)||{}));
      check(`reload ${n} proves bridge`, timeline.some(s=>s.ls&&s.ls.bridged&&!s.ls.paused&&!s.ls.down), JSON.stringify(timeline.at(-1)));
      await sleep(180); const settled=await bootState();
      check(`reload ${n} settles coherently online`, settled.chat==='online'&&settled.pill==='ONLINE'&&/^UPLINK\b/.test(settled.sig)&&(!settled.empty||/^COMMS online\./.test(settled.empty)), JSON.stringify(settled));
    }
  } else if (mode === 'custom') {
    await waitFor(`!!document.querySelector('#screen-splash.active') || !!document.querySelector('#screen-connect.active')`, 'fresh entry');
    if (await evalJS(cdp, `!!document.querySelector('#screen-splash.active')`)) {
      const p=await evalJS(cdp, `(() => {const r=document.querySelector('#sp-press').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
      await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',buttons:1,clickCount:1});
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',buttons:0,clickCount:1});
    }
    await waitFor(`!!document.querySelector('#screen-connect.active') && !!document.querySelector('.prov[data-prov="custom"]')`, 'create screen');
    await evalJS(cdp, `if(document.querySelector('#prov-more').getAttribute('aria-expanded')!=='true')document.querySelector('#prov-more').click()`);
    for (let n=1;n<=10;n++) {
      const result=await evalJS(cdp, `(() => { const codex=document.querySelector('.prov[data-prov="codex"]'),custom=document.querySelector('.prov[data-prov="custom"]'),wake=document.querySelector('#btn-wake'),base=document.querySelector('#in-base-url'); codex.click(); base.value=''; custom.click(); wake.click(); return {selected:custom.getAttribute('aria-pressed'),baseVisible:!document.querySelector('#base-url-block').classList.contains('hidden'),msg:document.querySelector('#connect-msg').textContent,model:document.querySelector('#in-model').value}; })()`);
      check(`rapid CUSTOM→WAKE ${n} validates endpoint first`, result.selected==='true'&&result.baseVisible&&result.msg==='enter your Custom /v1 base URL.'&&!/gpt-5\.5/i.test(result.msg), JSON.stringify(result));
      await sleep(40);
    }
  } else throw new Error('unknown mode: '+mode);
  check('no uncaught page exceptions', diag.exceptions.length===0, diag.exceptions.join(' ; '));
} catch (e) { failures.push({name:'harness',detail:String(e&&e.stack||e)}); console.log('FAIL harness :: '+(e&&e.stack||e)); }
finally { try{cdp?.ws.close()}catch{} try{proc.kill()}catch{} try{rmSync(profileDir,{recursive:true,force:true})}catch{} }
console.log(JSON.stringify({ok:!failures.length,mode,url,receipts,failures},null,2));
process.exit(failures.length?1:0);
