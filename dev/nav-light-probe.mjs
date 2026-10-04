import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { launchChrome,connectCDP,evalJS,sleep } from '../scripts/lib/cdp.mjs';
let proc,cdp;
try {
  ({proc}=launchChrome({cdpPort:9350,profileDir:'.worldshots/nav-profile'}));cdp=await connectCDP(9350);
  await cdp.send('Page.enable');await cdp.send('Page.navigate',{url:'http://127.0.0.1:9177/'});
  for(let i=0;i<40;i++){if(await evalJS(cdp,"typeof StationBake!=='undefined'&&typeof PropSprites!=='undefined'"))break;await sleep(200);}
  const doc=JSON.parse(readFileSync('dev/.scratch-workspace/agent.save.json','utf8')).doc.station;
  const nav=await evalJS(cdp,`(()=>{
    const geo=WorldModel.create(${JSON.stringify(doc)}).projectGeometry(),b=StationBake.bake(geo),lights=b.navLights;
    const pixels=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    const base=pixels(b.baseCv),inside=pixels(b.interiorCv);
    let invalid=0;
    for(const l of lights)for(let y=l.y-2;y<=l.y+2;y++)for(let x=l.x-2;x<=l.x+2;x++){
      const i=(y*b.baseCv.width+x)*4+3,tx=Math.floor(x/12),ty=Math.floor(y/12);
      if(base[i]<250||inside[i]||(tx>=0&&ty>=0&&tx<geo.COLS&&ty<geo.ROWS&&geo.zoneGrid[geo.idx(tx,ty)]!=null))invalid++;
    }
    const nonFlatMounts=lights.filter(l=>{
      const tx=Math.floor(l.x/12),ty=Math.floor((l.y-25)/12);
      return [-1,0,1].some(dx=>geo.zoneGrid[geo.idx(tx+dx,ty)]==null);
    }).length;
    const panelSeamOverlap=lights.filter(l=>{const offset=((l.x-5)%28+28)%28;return offset<3||offset>24;}).length;
    return {lights:lights.length,invalidHousingPixels:invalid,nonFlatMounts,panelSeamOverlap,oldCornerLights:geo.chamfers.length};
  })()`);
  console.log(JSON.stringify(nav));if(!nav.lights||nav.invalidHousingPixels||nav.nonFlatMounts||nav.panelSeamOverlap)throw Error('Invalid flat hull panel fixture placement');
  const raw=execFileSync('git',['show','8edf29f19:frontend/app/propsprites.js'],{encoding:'utf8'});
  const parity=await evalJS(cdp,`(async()=>{
    await document.fonts.ready;
    const old=new Function(${JSON.stringify(raw)}+';return PropSprites;')();
    let max=0,total=0,n=0,cases=0;
    for(const type of ['bay','desk','desk2','plant'])for(const name of [null,'NOVA','PIXEL'])for(const time of [0,350,700,1200])for(const mirror of [0,1])for(const work of [false,true]){
      const f={t:type,x:3,y:3,w:type==='plant'?1:2,h:type==='bay'?2:1,agentId:name?'test-agent':null,dockName:name,m:mirror};
      const render=p=>{const c=document.createElement('canvas');c.width=100;c.height=100;const g=c.getContext('2d');p.setCtx(g);p.setNow(time);p.draw(f,work);g.clearRect(0,0,100,100);p.draw(f,work);return g.getImageData(0,0,100,100).data;};
      const a=render(old),b=render(PropSprites);
      for(let i=0;i<a.length;i++){const delta=Math.abs(a[i]-b[i]);max=Math.max(max,delta);total+=delta;n++;}
      cases++;
    }
    let shadowTotal=0,shadowN=0,shadowMax=0,shadowCases=0;
    for(const type of ['bay','desk','plant','outbox','chair','tv'])for(const scale of [0.612,1,2,3])for(const r of [0,1,2,3]){
      const f={t:type,x:3,y:3,w:2,h:2,r};
      const render=p=>{const c=document.createElement('canvas');c.width=300;c.height=300;const g=c.getContext('2d');g.fillStyle='#6a706c';g.fillRect(0,0,300,300);g.scale(scale,scale);p.setCtx(g);p.drawShadow(f,null);return g.getImageData(0,0,300,300).data;};
      const a=render(old),b=render(PropSprites);
      for(let i=0;i<a.length;i+=4){if(a[i]===106&&b[i]===106&&a[i+1]===112&&b[i+1]===112)continue;for(let k=0;k<3;k++){const delta=Math.abs(a[i+k]-b[i+k]);shadowMax=Math.max(shadowMax,delta);shadowTotal+=delta;shadowN++;}}
      shadowCases++;
    }
    return {maxChannelDifference:max,meanChannelDifference:total/n,cases,shadows:{max:shadowMax,mean:shadowTotal/shadowN,cases:shadowCases}};
  })()`);
  console.log(JSON.stringify(parity));if(parity.maxChannelDifference>3||parity.meanChannelDifference>0.3)throw Error('Cached prop appearance changed');
  if(parity.shadows.mean>2||parity.shadows.max>36)throw Error('Projected shadow coverage changed beyond the raster tolerance');
  console.log('nav-light-and-prop-cache-probe: OK');
}finally{try{cdp?.ws.close();}catch{}try{proc?.kill();}catch{}}
process.exit(0);
