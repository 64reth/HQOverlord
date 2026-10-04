// Exercise the real renderer's shadow cache without changing the user's open tab/save.
import { readFileSync } from 'node:fs';
import { launchChrome,connectCDP,evalJS,sleep } from '../scripts/lib/cdp.mjs';
let proc,cdp;
try {
  ({proc}=launchChrome({cdpPort:9351,profileDir:'.worldshots/cache-profile'}));
  cdp=await connectCDP(9351);
  cdp.on('Fetch.requestPaused',async p=>{
    const body=readFileSync('frontend/app/world.js','utf8').replace('  function frameBody(now) {',
      'window.__shadowCacheProbe={get:()=>propShadowLayer,paint:g=>paintPropShadows(g)};\n  function frameBody(now) {');
    await cdp.send('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:Buffer.from(body).toString('base64')});
  });
  await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*/app/world.js*',requestStage:'Request'}]});
  await cdp.send('Page.enable');await cdp.send('Page.navigate',{url:'http://127.0.0.1:9177/'});
  for(let i=0;i<60;i++){if(await evalJS(cdp,'!!window.__shadowCacheProbe?.get()'))break;await sleep(200);}
  const compare=()=>evalJS(cdp,`(()=>{
    const p=window.__shadowCacheProbe,layer=p.get(),c=document.createElement('canvas');
    c.width=layer.image.width;c.height=layer.image.height;p.paint(c.getContext('2d'));
    const a=layer.g.getImageData(0,0,c.width,c.height).data,b=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let changed=0,opaque=0;for(let i=0;i<a.length;i++){if(a[i]!==b[i])changed++;if(i%4===3&&a[i])opaque++;}
    return {changedChannels:changed,shadowPixels:opaque,size:[c.width,c.height],stamp:layer.stamp};
  })()`);
  const wide=await compare();
  await evalJS(cdp,'World.focusAgent({force:true})');await sleep(2000);
  const close=await compare();
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1200,height:800,deviceScaleFactor:1,mobile:false});await sleep(700);
  const resize=await compare();
  await evalJS(cdp,'window.__previousShadowLayer=__shadowCacheProbe.get();__previousShadowLayer.image.dispatchEvent(new Event("contextlost"))');
  await sleep(500);
  const recovered=await evalJS(cdp,'__shadowCacheProbe.get()!==__previousShadowLayer');
  const recovery=await compare();
  const result={wide,close,resize,recovered,recovery};console.log(JSON.stringify(result));
  if([wide,close,resize,recovery].some(r=>r.changedChannels||!r.shadowPixels)||wide.stamp===close.stamp||close.stamp===resize.stamp||!recovered)throw Error('Shadow cache failed redraw/invalidation');
  console.log('world-cache-probe: OK');
}finally{try{cdp?.ws.close();}catch{}try{proc?.kill();}catch{}}
process.exit(0);
