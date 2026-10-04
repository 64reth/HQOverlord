// Real Chromium painter + movement checks; instrumentation stays in this test tab.
import { readFileSync, writeFileSync } from 'node:fs';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
let proc, cdp;
const hook = `
  window.__doorDepthProbe = {
    ready: () => !!(cache && agent && typeof SPRITES !== 'undefined' && SPRITES.ready),
    current: () => ({ geo, cache }),
    liveWalk: () => {
      const d=cache.doorOccluders.find(d=>d.x>550&&d.y>550)||cache.doorOccluders[0];
      const tx=(d.x+24)/T, ty=Math.round((d.sortY-9.5)/T);
      const p=footOf(tx,ty-2), dest={x:tx,y:ty+2};
      Object.assign(agent,{px:p.x,py:p.y,seated:false,sitting:false,working:false,goal:'wander',pauseUntil:0,idleUntil:0});
      const keep=self;self=agent;
      try { const planned=setPathTo(dest); agent.pauseUntil=0; return {planned,id:agent.id,from:tileOf(p.x,p.y),to:dest}; }
      finally {self=keep;}
    },
    render: (g, bake, position, enabled) => {
      const oldCtx = ctx, oldGeo = geo;
      const image = document.createElement('canvas'); image.width = g.W; image.height = g.H;
      ctx = image.getContext('2d'); geo = g;
      try {
        ctx.drawImage(bake.baseCv, 0, 0);
        const body = position && Object.assign({}, agent, position, { seated: false, sitting: false, lying: false, state: 'walk', wakeAt: 0, levelUpAt: 0, workUntil: 0 });
        const items = [];
        if (body) items.push({ y: body.py, draw: () => drawAgent(200000, body) });
        if (enabled) for (const d of bake.doorOccluders) items.push({ y: d.sortY, draw: () => ctx.drawImage(d.image, d.x, d.y) });
        items.sort((a,b) => a.y-b.y); for (const it of items) it.draw();
        return image;
      } finally { ctx = oldCtx; geo = oldGeo; }
    },
    walk: (g, from, to) => {
      const oldGeo = geo; geo = g;
      try {
        const p = g.path(from.x, from.y, to.x, to.y, new Set());
        if (!p) throw Error('No doorway path');
        const f = footOf(from.x, from.y), b = Object.assign({}, agent, { px:f.x, py:f.y, pathPts:p, pathIdx:0, target:null, sitting:false, seated:false, state:'walk' });
        crewNextWaypoint(b);
        const samples = [{px:b.px,py:b.py}], dest = {tx:to.x,ty:to.y};
        for (let i=0;i<1200 && !b.sitting;i++) {
          stepCrewToSeat(b,dest,1000/60,200000+i*1000/60);
          samples.push({px:b.px,py:b.py});
        }
        return {samples,arrived:b.sitting,path:p};
      } finally { geo = oldGeo; }
    }
  };
`;
try {
  ({ proc } = launchChrome({ cdpPort:9353, profileDir:'.worldshots/door-depth-profile' }));
  cdp = await connectCDP(9353);
  cdp.on('Fetch.requestPaused', async p => {
    const source = readFileSync('frontend/app/world.js','utf8');
    if (!source.includes('  function frameBody(now) {')) throw Error('Probe anchor moved');
    const body = source.replace('  function frameBody(now) {', hook + '  function frameBody(now) {');
    await cdp.send('Fetch.fulfillRequest',{ requestId:p.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:Buffer.from(body).toString('base64') });
  });
  await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*/app/world.js*',requestStage:'Request'}]});
  await cdp.send('Page.enable'); await cdp.send('Page.navigate',{url:'http://127.0.0.1:9177/'});
  for (let i=0;i<80;i++) { if (await evalJS(cdp,'!!window.__doorDepthProbe?.ready()')) break; await sleep(250); }
  const result = await evalJS(cdp, `(() => {
    const probe = window.__doorDepthProbe, read = c => c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    const diff = (a,b) => { let n=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])n++;return n; };
    const matrix=[];
    for (const width of [1,2,3,4]) for (const wallMat of ['bulkhead','viewport']) {
      const doc=WorldModel.starterDoc();doc.rooms[doc.meta.spawnRoomId].wallMat=wallMat;
      const station=WorldModel.create(doc);
      if(!station.placeHallway({rect:{x1:5,y1:-8,x2:4+width,y2:-1}}).ok)throw Error('Fixture failed');
      const geo=station.projectGeometry(), bake=StationBake.bake(geo), d=bake.doorOccluders[0];
      if(!d)throw Error('Missing doorway occluder');
      const r=geo.allRects.find(r=>geo.isCorridor(r.z)), X=r.x1*12, Y=(r.y2+1)*12;
      const empty=read(probe.render(geo,bake,null,false)), emptyNew=read(probe.render(geo,bake,null,true));
      const behind={px:X+4,py:Y-3,dir:'south'}, front={...behind,py:Y+17};
      const old=read(probe.render(geo,bake,behind,false)), fixed=read(probe.render(geo,bake,behind,true));
      const surface=read(d.image);let overlap=0,hidden=0,visible=0,glass=0;
      for(let y=0;y<d.h;y++)for(let x=0;x<d.w;x++) {
        const a=(y*d.w+x)*4+3, i=((d.y+y)*geo.W+d.x+x)*4;
        const changed=old[i]!==empty[i]||old[i+1]!==empty[i+1]||old[i+2]!==empty[i+2];
        const preserved=fixed[i]===old[i]&&fixed[i+1]===old[i+1]&&fixed[i+2]===old[i+2];
        if(surface[a]===255 && changed) {overlap++;if(fixed[i]===empty[i]&&fixed[i+1]===empty[i+1]&&fixed[i+2]===empty[i+2])hidden++;}
        if(!surface[a]&&changed&&preserved)visible++;
        if(!surface[a]&&empty[i+3]<255)glass++;
      }
      const from={x:r.x1,y:r.y2-2},to={x:r.x1+1,y:r.y2+2};
      const walks=[probe.walk(geo,from,to),probe.walk(geo,to,from)];let illegal=0;
      for(const walk of walks)for(let i=1;i<walk.samples.length;i++) {
        const a=walk.samples[i-1],b=walk.samples[i], ax=Math.floor(a.px/12),ay=Math.floor(a.py/12),bx=Math.floor(b.px/12),by=Math.floor(b.py/12);
        if(!geo.walkable(bx,by,new Set()) || (ax!==bx||ay!==by)&&!geo.canStep(ax,ay,bx,by))illegal++;
      }
      matrix.push({width,wallMat,emptyChanges:diff(empty,emptyNew),overlap,hidden,visible,glass,frontChanges:diff(read(probe.render(geo,bake,front,false)),read(probe.render(geo,bake,front,true))),arrived:walks.every(w=>w.arrived),illegal,samples:walks.reduce((n,w)=>n+w.samples.length,0)});
    }
    const {geo,cache:bake}=probe.current(), d=bake.doorOccluders.find(d=>d.x>550&&d.y>550)||bake.doorOccluders[0];
    const body={px:d.x+24+4,py:d.sortY-12,dir:'south'};
    const capture=enabled=>{const src=probe.render(geo,bake,body,enabled), c=document.createElement('canvas');c.width=(d.w+12)*5;c.height=(d.h+24)*5;const g=c.getContext('2d');g.imageSmoothingEnabled=false;g.fillStyle='#0a111a';g.fillRect(0,0,c.width,c.height);g.drawImage(src,d.x-6,d.y-6,d.w+12,d.h+24,0,0,c.width,c.height);return c.toDataURL().split(',')[1];};
    return {matrix,before:capture(false),after:capture(true),occluders:bake.doorOccluders.length};
  })()`);
  for(const key of ['before','after'])writeFileSync('.worldshots/door-depth-'+key+'.png',Buffer.from(result[key],'base64'));
  console.log(JSON.stringify({occluders:result.occluders,matrix:result.matrix}));
  if(result.matrix.some(r=>r.emptyChanges||!r.overlap||r.hidden!==r.overlap||!r.visible||r.frontChanges||!r.arrived||r.illegal||(r.wallMat==='viewport'&&!r.glass)))throw Error('Doorway depth / traversal regression');
  const route=await evalJS(cdp,'__doorDepthProbe.liveWalk()');
  if(!route.planned)throw Error('Live route did not plan');
  const live=[];
  for(let i=0;i<32;i++){
    await sleep(150);
    const b=await evalJS(cdp,`World.bodies().find(b=>b.id===${JSON.stringify(route.id)})`);
    live.push({px:b.px,py:b.py,tile:b.tile});
    if(b.tile.x===route.to.x&&b.tile.y===route.to.y)break;
  }
  const arrived=live.some(b=>b.tile.x===route.to.x&&b.tile.y===route.to.y);
  console.log(JSON.stringify({liveRoute:route,arrived,live}));
  if(!arrived)throw Error('Live agent did not clear the doorway');
  await evalJS(cdp,'window.__oldDoorImage=__doorDepthProbe.current().cache.doorOccluders[0].image;__oldDoorImage.dispatchEvent(new Event("contextlost"))');
  await sleep(600);
  if(!await evalJS(cdp,'__doorDepthProbe.current().cache.doorOccluders[0].image!==__oldDoorImage'))throw Error('Door surface did not recover from context loss');
  console.log('door-depth-probe: OK');
} finally { try { cdp?.ws.close(); } catch {} try { proc?.kill(); } catch {} }
process.exit(0);
