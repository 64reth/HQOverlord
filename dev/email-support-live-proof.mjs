// Run against an isolated node dev/seed.js --keep station. Never use a customer workspace.
// First run: create/readback/refusal checks. After restarting that sidecar, run with --restart.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { launchChrome, connectCDP, evalJS, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
const base = process.env.EMAIL_PROOF_URL || 'http://127.0.0.1:18864';
const port = Number(process.env.EMAIL_PROOF_CDP || 19866);
mkdirSync('.tmp', { recursive: true });
const { proc } = launchChrome({ cdpPort: port, profileDir: mkdtempSync(process.cwd() + '/.tmp/email-proof-') });
let cdp;
try {
  cdp = await connectCDP(port);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  const diagnostics = collectDiagnostics(cdp);
  await cdp.send('Page.navigate', { url: base });
  for (let i=0;i<100;i++) {
    if (await evalJS(cdp, "typeof Build !== 'undefined' && !!Build.__test__ && typeof Harness !== 'undefined' && !!document.querySelector('#stage') && !!Build.__test__.station()").catch(()=>false)) break;
    await sleep(100);
  }
  if (process.argv.includes('--restart')) {
    const result = await evalJS(cdp, `(async()=>{
      const state=await Harness.api.get('/api/cron');
      StationUI.openTerm('automation','routines');
      await new Promise(r=>setTimeout(r,900));
      return { jobs:state.jobs.filter(j=>j.name==='EMAIL ONCE PERSISTENCE').map(j=>({id:j.id,runsLine:j.runsLine,kind:j.schedule.kind})),text:document.querySelector('#rt-list').innerText };
    })()`);
    assert.equal(result.jobs.length,1); assert.equal(result.jobs[0].runsLine,true); assert.equal(result.jobs[0].kind,'once');
    assert.match(result.text,/EMAIL ONCE PERSISTENCE/);
    console.log('RESTART PASS',JSON.stringify(result.jobs));
  } else {
    await evalJS(cdp, `(async()=>{
      await Harness.api.post('/api/cron/arm',{enabled:false});
      Build.open(); document.querySelector('#refit-guide-go')?.click();
      const st=Build.__test__.station();
      if(!st.props().some(p=>p.t==='intake')) {
        const b=st.bounds(); let made=false;
        outer: for(const blueprint of ['research_line','front_desk']) for(let y=b.minTy-2;y<=b.maxTy+2;y++) for(let x=b.minTx-2;x<=b.maxTx+2;x++) {
          if(st.canPlaceBlueprint(blueprint,x,y).ok) { st.stampBlueprint(blueprint,x,y); made=true; break outer; }
        }
        if(!made) throw Error('no room for fixture line');
      }
      st.assignPropAgent(st.props().find(p=>p.t==='bay').id,'agent');
    })()`);
    await sleep(700);
    for(const mode of ['off','stale-arm','lost-ack','missing-row','duplicate']) {
      const result=await evalJS(cdp, `(async()=>{
        const mode=${JSON.stringify(mode)};
        await Harness.api.post('/api/cron/arm',{enabled:mode==='stale-arm'});
        Build.open();
        Build.openAssign(Build.__test__.station().props().find(p=>p.t==='intake').id);
        await new Promise(r=>setTimeout(r,500));
        document.querySelector('#trg-new').click();
        document.querySelector('#trg-when [data-mode="once"]').click();
        const prompt=(mode==='off'||mode==='duplicate')?'EMAIL ONCE PERSISTENCE':crypto.randomUUID();
        document.querySelector('#trg-prompt').value=prompt;
        document.querySelector('#trg-sched').value='in 2h';
        if(mode==='stale-arm') await Harness.api.post('/api/cron/arm',{enabled:false});
        const original=window.fetch; let createdId=null,posted=false;
        window.fetch=async function(url,init){
          const r=await original.apply(this,arguments);
          if(String(url)==='/api/cron' && init?.method==='POST') {
            posted=true; createdId=(await r.clone().json()).job?.id;
            if(mode==='lost-ack') throw new TypeError('fixture: response lost after durable save');
          } else if(String(url)==='/api/cron' && posted && mode==='missing-row') {
            const j=await r.json(); j.jobs=j.jobs.filter(j=>j.id!==createdId);
            return new Response(JSON.stringify(j),{status:200,headers:{'content-type':'application/json'}});
          }
          return r;
        };
        try {
          document.querySelector('#trg-create').click();
          for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,30));if(!document.querySelector('#trg-create').disabled)break;}
          const message=document.querySelector('#trg-msg').textContent, draft=document.querySelector('#trg-prompt').value;
          const state=await (await original('/api/cron',{cache:'no-store'})).json();
          return {mode,message,draft,createdId,persisted:state.jobs.some(j=>j.id===createdId),enabled:state.enabled};
        } finally {window.fetch=original; await Harness.api.post('/api/cron/arm',{enabled:false});}
      })()`);
      if(mode==='off'||mode==='stale-arm') {assert.equal(result.persisted,true);assert.equal(result.enabled,false);assert.match(result.message,/scheduling is OFF or STOPPED/);assert.equal(result.draft,'');}
      else if(mode==='duplicate') {assert.match(result.message,/similar routine already exists/);assert.equal(result.draft,'EMAIL ONCE PERSISTENCE');}
      else {assert.equal(result.persisted,true);assert.match(result.message,/save not confirmed/);assert.ok(result.draft);assert.doesNotMatch(result.message,/nothing was created|routine scheduled/);}
      console.log('PASS',JSON.stringify(result));
    }
    assert.deepEqual(diagnostics.exceptions,[]);
  }
} finally { if(cdp)cdp.ws.close();proc.kill(); }
process.exit(0);
