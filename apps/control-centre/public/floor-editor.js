/** Geometric floor authoring. The backend's StarNet compiler decides whether it runs. */
export function attachFloorEditor(form,agents){
  const source=form.querySelector('[name="geometry"]');if(!source)return;
  const make=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
  const controls=make('div'),mode=make('select'),direction=make('select'),agent=make('select'),tag=make('input'),gate=make('select');
  for(const value of ['belt','intake','bay','outbox','filter','splitter','joiner','merger','loop','move','erase']){const o=make('option',value);o.value=value;mode.append(o);}
  for(const value of ['E','S','W','N']){const o=make('option',value);o.value=value;direction.append(o);}
  for(const crew of agents){const o=make('option',crew.name);o.value=crew.id;agent.append(o);}
  for(const value of ['approved','revise']){const o=make('option',value);o.value=value;gate.append(o);}
  tag.placeholder='Filter tag for selected direction';tag.setAttribute('aria-label','Filter tag');
  for(const [label,input]of [['Place',mode],['Direction / done lane',direction],['Bay agent',agent],['Loop exit verdict',gate]]){const l=make('label',label);l.append(input);controls.append(l);}controls.append(tag);
  const canvas=make('canvas');canvas.width=640;canvas.height=448;canvas.style.width='100%';canvas.style.touchAction='none';canvas.setAttribute('aria-label','Conveyor editor: click to place machinery or a directed belt tile');
  const context=canvas.getContext('2d'),size=32;let moving=null;
  const read=()=>{try{const g=JSON.parse(source.value);return Array.isArray(g.props)&&Array.isArray(g.belts)?g:{props:[],belts:[]};}catch{return {props:[],belts:[]};}};
  function draw(){const g=read();context.fillStyle='#10160c';context.fillRect(0,0,640,448);context.strokeStyle='#303929';context.font='14px VT323';
    for(let x=0;x<=640;x+=size){context.beginPath();context.moveTo(x,0);context.lineTo(x,448);context.stroke();}for(let y=0;y<=448;y+=size){context.beginPath();context.moveTo(0,y);context.lineTo(640,y);context.stroke();}
    for(const b of g.belts){context.fillStyle='#82734b';context.fillRect(b.x*size+2,b.y*size+2,size-4,size-4);context.fillStyle='#fff';context.fillText(b.dir,b.x*size+12,b.y*size+20);}
    for(const p of g.props){context.fillStyle='#465535';context.fillRect(p.x*size+1,p.y*size+1,(p.w??1)*size-2,(p.h??1)*size-2);context.fillStyle='#ffdb9d';context.fillText(p.t,p.x*size+3,p.y*size+14);if(p.agentId)context.fillText(agents.find(a=>a.id===p.agentId)?.name??'unavailable',p.x*size+3,p.y*size+30);}
  }
  function point(event){const r=canvas.getBoundingClientRect();return {x:Math.floor((event.clientX-r.left)/r.width*20),y:Math.floor((event.clientY-r.top)/r.height*14)};}
  const hit=(g,p)=>g.props.find(q=>p.x>=q.x&&p.x<q.x+(q.w??1)&&p.y>=q.y&&p.y<q.y+(q.h??1));
  const save=g=>{source.value=JSON.stringify(g,null,2);source.dispatchEvent(new Event('input',{bubbles:true}));draw();};
  canvas.onpointerdown=event=>{const g=read(),p=point(event),existing=hit(g,p);canvas.setPointerCapture(event.pointerId);
    if(mode.value==='move'){moving=existing?.id??null;return;}
    if(mode.value==='erase'){g.props=g.props.filter(q=>q!==existing);g.belts=g.belts.filter(b=>b.x!==p.x||b.y!==p.y);save(g);return;}
    if(mode.value==='belt'){g.belts=g.belts.filter(b=>b.x!==p.x||b.y!==p.y);g.belts.push({...p,dir:direction.value});save(g);return;}
    if(mode.value==='filter'&&existing?.t==='filter'){existing.routes={...existing.routes,...(tag.value?{[tag.value]:direction.value}:{})};existing.def=direction.value;save(g);return;}
    if(existing)return;
    const used=new Set(g.props.map(q=>q.id));let n=1;while(used.has(`prop-${n}`))n++;
    g.props.push({id:`prop-${n}`,t:mode.value,...p,w:mode.value==='bay'?2:1,h:mode.value==='bay'?2:1,
      ...(mode.value==='bay'?{agentId:agent.value}:{}),...(mode.value==='filter'?{routes:tag.value?{[tag.value]:direction.value}:{},def:direction.value}:{}),
      ...(mode.value==='loop'?{done:direction.value,when:gate.value,maxIter:2}:{})});save(g);
  };
  canvas.onpointerup=event=>{if(moving){const g=read(),p=point(event),prop=g.props.find(q=>q.id===moving);if(prop){prop.x=p.x;prop.y=p.y;save(g);}moving=null;}};
  canvas.onpointercancel=()=>{moving=null;};source.addEventListener('input',draw);
  const clear=make('button','CLEAR DRAFT');clear.type='button';clear.onclick=()=>save({props:[],belts:[]});
  form.prepend(controls,canvas,make('p','Place bays and intake, then connect their perimeter with directed belts. Filters map tags to lanes; a splitter reaching a joiner fans out, otherwise it balances work. Move drags machinery. Save validates the real graph.'),clear);draw();
}
