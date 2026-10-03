/** ACP stdio edge. Proxies the running HQ owner; never opens a durable store. */
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
const base=new URL(process.env.HQ_ACP_URL??'http://127.0.0.1:8788');
if(base.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(base.hostname)||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw new Error('ACP requires the local HQ server');
const agentId=process.env.HQ_ACP_AGENT_ID,business=process.env.HQ_ACP_BUSINESS_ID??'business-001';
if(!agentId)throw new Error('Set HQ_ACP_AGENT_ID to an existing business agent');
const clientId=randomUUID(),origin=base.origin;
const first=await fetch(origin,{redirect:'error'}),cookie=first.headers.get('set-cookie')?.split(';')[0];
if(!first.ok||!cookie)throw new Error('Start the HQ control centre before the editor bridge');
const headers={Cookie:cookie,Origin:origin,'Content-Type':'application/json'};
const output=(message:unknown)=>{if(message!==null)process.stdout.write(JSON.stringify(message)+'\n');};
const path=(name:string)=>`${origin}/api/${name}?business=${encodeURIComponent(business)}`;
let closed=false,registered=false;
async function rpc(message:unknown){
  const response=await fetch(path('acp'),{method:'POST',headers,body:JSON.stringify({clientId,agentId,message})});
  if(!response.ok)throw new Error('HQ editor request refused; inspect local host configuration');registered=true;return response.json();
}
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
input.on('line',line=>{if(line.length>256_000){output({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Editor message too large'}});return;}let message:{id?:unknown};try{message=JSON.parse(line);}catch{output({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}});return;}
  void rpc(message).then(output).catch(()=>output({jsonrpc:'2.0',id:message.id??null,error:{code:-32603,message:'HQ is unavailable or this operation was refused'}}));
});
const timer=setInterval(()=>{if(closed||!registered)return;void fetch(`${path('acp-events')}&clientId=${encodeURIComponent(clientId)}`,{headers,signal:AbortSignal.timeout(5000)}).then(async r=>{if(!r.ok)return;const messages=await r.json() as unknown[];for(const message of messages)output(message);}).catch(()=>{});},250);
input.on('close',()=>{closed=true;clearInterval(timer);void fetch(path('acp-close'),{method:'POST',headers,body:JSON.stringify({clientId})}).finally(()=>process.exit());});
