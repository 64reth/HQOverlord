/** Original HQ station artwork. Static room bake + live entities + camera/selection overlays,
 * following StarNet's world/stationbake separation without copying restricted station art. */
export function stationPositions(count) { return Array.from({ length: count }, (_, i) => ({ x: 190 + (i % 3) * 285, y: 205 + Math.floor(i / 3) * 220 })); }
export function hitStation(positions, x, y) { return positions.findIndex(p => Math.abs(p.x - x) < 90 && y > p.y - 75 && y < p.y + 110); }
export function createWorld(canvas, onSelect) {
  const context = canvas.getContext('2d'), bake = document.createElement('canvas'); bake.width = 960; bake.height = 650;
  const c = bake.getContext('2d'); let model = { agents: [], selected: null }, positions = [], zoom = 1, pan = { x: 0, y: 0 }, drag = null, frame = 0;
  const agentImage = new Image(); agentImage.src = '/assets/agent.svg'; agentImage.onload = draw;
  function rect(x,y,w,h,color) { c.fillStyle=color; c.fillRect(x,y,w,h); }
  function bakeRoom() {
    rect(0,0,960,650,'#090b07');
    c.save();c.beginPath();c.moveTo(78,55);c.lineTo(882,55);c.lineTo(916,89);c.lineTo(916,566);c.lineTo(882,612);c.lineTo(78,612);c.lineTo(44,566);c.lineTo(44,89);c.closePath();c.clip();
    rect(44,55,872,545,'#20231b');
    for(let y=100;y<600;y+=40) for(let x=45;x<915;x+=40){rect(x,y,39,39,(x/40+y/40)%2<1?'#25271d':'#23251b');}
    rect(44,55,872,42,'#383b2c');rect(44,95,872,5,'#777454');rect(44,55,18,545,'#454735');rect(898,55,18,545,'#34372a');rect(44,598,872,14,'#4c4c35');
    for(let x=85;x<880;x+=140){rect(x,68,90,12,'#171d15');rect(x+5,71,80,3,'#92915b');}
    // Original consoles: angled desk lip, screen, keyboard, service cabinet and chair.
    for(const p of positions){rect(p.x-86,p.y-35,175,67,'#121710');rect(p.x-80,p.y-42,160,54,'#4e5141');rect(p.x-80,p.y+12,160,11,'#363b2c');rect(p.x-31,p.y-35,62,35,'#121811');rect(p.x-26,p.y-31,52,24,'#293f2d');rect(p.x-16,p.y+2,33,7,'#a1a27b');rect(p.x+52,p.y-28,17,25,'#222c20');rect(p.x-24,p.y+55,48,48,'#303b2c');rect(p.x-20,p.y+56,40,10,'#677053');}
    rect(85,530,72,48,'#3b4431');rect(90,535,62,5,'#85865c');rect(820,535,45,40,'#2e3827');rect(827,510,32,35,'#59613c');c.restore();
  }
  function camera() { const r=canvas.getBoundingClientRect();const scale=Math.min(r.width/960,r.height/650)*zoom;return {width:r.width,height:r.height,scale,x:r.width/2-480*scale+pan.x,y:r.height/2-325*scale+pan.y}; }
  function draw() {
    const v=camera(),dpr=devicePixelRatio||1;if(canvas.width!==Math.round(v.width*dpr)||canvas.height!==Math.round(v.height*dpr)){canvas.width=Math.round(v.width*dpr);canvas.height=Math.round(v.height*dpr);}
    context.setTransform(dpr,0,0,dpr,0,0);context.fillStyle='#080a06';context.fillRect(0,0,v.width,v.height);context.translate(v.x,v.y);context.scale(v.scale,v.scale);context.imageSmoothingEnabled=false;context.drawImage(bake,0,0);
    model.agents.forEach((agent,i)=>{const p=positions[i],selected=agent.id===model.selected?.id;const active=['working','tool-use'].includes(agent.state);const color=agent.state==='unknown'?'#877b64':agent.state==='interrupted'?'#c27b51':active?'#d7dd96':'#baaf70';
      context.globalAlpha=agent.state==='unknown'?.5:1;context.fillStyle=color;context.fillRect(p.x-24,p.y-29,48,20);context.fillStyle='#122114';context.font='17px VT323';context.textAlign='center';context.fillText(active?'RUN':'HQ',p.x,p.y-13);
      if(selected){context.strokeStyle='#ffaa33';context.lineWidth=2;context.strokeRect(p.x-92,p.y-50,184,152);context.fillStyle='#ffaa33';context.fillRect(p.x-92,p.y-50,5,18);}
      if(agentImage.complete&&agentImage.naturalWidth)context.drawImage(agentImage,p.x-21,p.y+22,42,56);
      context.fillStyle='#090c07df';context.fillRect(p.x-108,p.y+106,216,48);context.fillStyle=selected?'#ffd9a3':'#c9c293';context.font='22px VT323';context.fillText(agent.name,p.x,p.y+127);context.fillStyle=color;context.font='18px VT323';context.fillText(agent.state.replaceAll('-',' ').toUpperCase(),p.x,p.y+147);context.globalAlpha=1;
      if(agent.outcome){context.fillStyle='#92886a';context.font='14px VT323';context.fillText('LAST: '+agent.outcome.toUpperCase(),p.x,p.y+170);}
      if(active){context.fillStyle=matchMedia('(prefers-reduced-motion: reduce)').matches?'#d7dd96':Math.floor(performance.now()/600)%2?'#d7dd96':'#6c794f';context.fillRect(p.x+58,p.y-20,5,5);}
    });
    context.setTransform(dpr,0,0,dpr,0,0);
    if(model.agents.some(a=>['working','tool-use'].includes(a.state))&&!frame) frame=requestAnimationFrame(()=>{frame=0;draw();});
  }
  canvas.addEventListener('pointerdown',event=>{drag={x:event.clientX,y:event.clientY,px:pan.x,py:pan.y,moved:false};canvas.setPointerCapture(event.pointerId);});
  canvas.addEventListener('pointermove',event=>{if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>4)drag.moved=true;if(drag.moved){pan={x:drag.px+dx,y:drag.py+dy};draw();}});
  canvas.addEventListener('pointerup',event=>{if(drag&&!drag.moved){const r=canvas.getBoundingClientRect(),v=camera();const i=hitStation(positions,(event.clientX-r.left-v.x)/v.scale,(event.clientY-r.top-v.y)/v.scale);if(i>=0)onSelect(model.agents[i].id);}drag=null;});
  canvas.addEventListener('pointercancel',()=>{drag=null;});
  function changeZoom(factor,x=canvas.clientWidth/2,y=canvas.clientHeight/2){const v=camera(),next=Math.max(.65,Math.min(3,zoom*factor)),ratio=next/zoom;pan={x:x-canvas.clientWidth/2-(x-canvas.clientWidth/2-pan.x)*ratio,y:y-canvas.clientHeight/2-(y-canvas.clientHeight/2-pan.y)*ratio};zoom=next;draw();}
  canvas.addEventListener('wheel',event=>{event.preventDefault();const r=canvas.getBoundingClientRect();changeZoom(event.deltaY<0?1.1:1/1.1,event.clientX-r.left,event.clientY-r.top);},{passive:false});
  new ResizeObserver(draw).observe(canvas);
  return { update(next){model=next;if(positions.length!==model.agents.length){positions=stationPositions(model.agents.length);bakeRoom();}draw();}, zoom:changeZoom, reset(){zoom=1;pan={x:0,y:0};draw();}, focus(id){const i=model.agents.findIndex(a=>a.id===id);if(i<0)return;const v=camera(),p=positions[i];pan={x:(480-p.x)*v.scale,y:(325-p.y-50)*v.scale};draw();} };
}
