'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.events={};this.value='';this.classList={add:()=>{}};}
  appendChild(child){child.parent=this;this.children.push(child);return child;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
  setAttribute(k,v){this.attrs[k]=v;} addEventListener(k,v){this.events[k]=v;} focus(){}
  set innerHTML(v){throw Error('User content must not enter innerHTML');}
}
(async()=>{
  const ctx={document:{createElement:t=>new Element(t)},module:{exports:{}}};vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(require.resolve('../frontend/app/taskconversation.js'),'utf8'),ctx);
  const root=new Element('root'),sent=[];let accept=false;
  const {card,input}=ctx.module.exports.TaskConversation.mount(root,{question:'Walk me through the last update.',options:['A Google Doc'],context:{facts:[{dimension:'sources',text:'Read Slack',quote:'<script>untrusted words</script>'}],assumptions:['One client'],unknowns:['Timing']}},async t=>{sent.push(t);return accept;});
  const all=()=>{const nodes=[];const visit=n=>{nodes.push(n);n.children.forEach(visit);};visit(card);return nodes;};
  const button=text=>all().find(n=>n.tag==='button'&&n.textContent===text);
  assert.equal(button('Send context').disabled,true);
  input.value='I read Slack.';input.events.input();button('A Google Doc').onclick();
  assert.equal(input.value,'I read Slack.\nA Google Doc');assert.equal(sent.length,0,'shortcuts do not auto-send or replace typed context');
  await button('Send context').onclick();assert.equal(input.value,'I read Slack.\nA Google Doc','failed send preserves text');
  assert.equal(button('Send context').disabled,false);
  accept=true;await button('Use your judgment').onclick();
  assert.match(sent.at(-1),/^I read Slack[\s\S]*Use your judgment for the remaining choices\.$/);
  assert.equal(card.attrs['aria-label'],'Shared task context');
  assert.ok(all().some(n=>n.tag==='details'&&n.className==='tc-receipt'),'answered card folds into a readable receipt');
  assert.ok(all().some(n=>n.tag==='blockquote'&&n.textContent.includes('<script>')),'quoted evidence stays literal text');
  console.log('task-conversation-ui: optional shortcuts, full text, failed-send retry, delegation and folded receipt passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
