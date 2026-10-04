/* A task-local conversation card. Rendered words come from the pending brief; no inferred progress meter. */
'use strict';
const TaskConversation = (() => {
  function mount(host,q,send) {
    const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text)n.textContent=text;return n;};
    const card=el('section','task-conversation'); card.setAttribute('aria-label','Shape this task');
    card.appendChild(el('div','tc-caption','LET’S SHAPE THIS'));
    card.appendChild(el('h4','tc-question',q.question));
    if(q.reason) card.appendChild(el('p','tc-reason',q.reason));
    const cx=q.context;
    if(cx && ((cx.facts||[]).length || (cx.assumptions||[]).length || (cx.unknowns||[]).length)) {
      const details=el('details','tc-understanding');
      details.appendChild(el('summary','','My understanding so far · open to correct me'));
      for(const f of cx.facts||[]) {
        const item=el('div','tc-fact');item.appendChild(el('span','tc-dimension',f.dimension));
        item.appendChild(el('p','',f.text));
        item.appendChild(el('blockquote','tc-quote','You said: “'+f.quote+'”'));details.appendChild(item);
      }
      for(const [field,label] of [['assumptions','I’m assuming'],['unknowns','Still unclear']]) {
        if(!(cx[field]||[]).length)continue;
        details.appendChild(el('div','tc-dimension',label));
        const list=el('ul','');for(const text of cx[field])list.appendChild(el('li','',text));details.appendChild(list);
      }
      if(cx.nextStep) details.appendChild(el('p','tc-next','Next useful step: '+cx.nextStep));
      card.appendChild(details);
    }
    if(q.sample) {
      const sample=el('div','tc-sample');sample.appendChild(el('div','tc-dimension','A starting point · draft'));
      sample.appendChild(el('div','tc-sample-text',q.sample));card.appendChild(sample);
    }
    const label=el('label','tc-answer-label','Your context');
    const input=el('textarea','tc-answer');input.rows=3;input.maxLength=3800;
    input.setAttribute('aria-label','Your context');input.placeholder='Describe it in your own words. Rough notes are fine.';
    label.appendChild(input);card.appendChild(label);
    const options=el('div','tc-shortcuts');
    for(const option of (q.options||[]).slice(0,6)) {
      const b=el('button','consent-btn tc-shortcut',option);b.type='button';
      b.onclick=()=>{
        const next=input.value.trim() ? input.value.trim()+'\n'+option : option;
        if(next.length>input.maxLength){feedback.textContent='Your reply is full. Edit it before adding another starting point.';return;}
        input.value=next;refresh();input.focus();
      };
      options.appendChild(b);
    }
    if(options.children.length) {card.appendChild(el('div','tc-hint','Optional starting points — add anything else that matters'));card.appendChild(options);}
    const actions=el('div','tc-actions'), submit=el('button','consent-btn primary','Send context'), skip=el('button','consent-btn tc-skip','Use your judgment');
    submit.type=skip.type='button';actions.appendChild(submit);actions.appendChild(skip);card.appendChild(actions);
    const feedback=el('div','tc-feedback');feedback.setAttribute('role','status');card.appendChild(feedback);
    card.appendChild(el('div','tc-hint','Ctrl + Enter to send · Enter adds a line'));
    let busy=false,done=false;
    function refresh(){submit.disabled=busy||done||!input.value.trim();skip.disabled=busy||done;input.disabled=busy||done;for(const b of options.children)b.disabled=busy||done;}
    async function answer(delegated) {
      if(busy||done)return;
      const typed=input.value.trim();
      const text=delegated ? (typed ? typed+'\nUse your judgment for the remaining choices.' : 'use your judgment') : typed;
      if(!text)return;
      busy=true;feedback.textContent='Sending…';refresh();
      try {
        const accepted=await send(text);
        if(accepted===false)throw Error('This question is no longer waiting. Your text is kept here; send it in COMMS to continue.');
        done=true;feedback.textContent='Context sent';
        label.remove();options.remove();actions.remove();
        card.classList.add('tc-answered');card.setAttribute('aria-label','Shared task context');
        const receipt=el('details','tc-receipt');receipt.appendChild(el('summary','','You shared: '+text.slice(0,100)+(text.length>100?'…':'')));
        receipt.appendChild(el('p','tc-answer-sent',text));card.appendChild(receipt);
      }catch(e){feedback.textContent=e.message||'Could not send. Your text is kept here; try again.';}
      finally{busy=false;refresh();}
    }
    input.addEventListener('input',refresh);
    input.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();answer(false);}});
    submit.onclick=()=>answer(false);skip.onclick=()=>answer(true);
    refresh();host.appendChild(card);return {card,input};
  }
  return {mount};
})();
if(typeof module!=='undefined'&&module.exports)module.exports={TaskConversation};
