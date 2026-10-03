import {executeFloorWorkflow,floorCompiler} from './floor-workflow.ts';
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import {ids,type AgentId,type JobId,type ApprovalId} from "@hqoverlord/core";
import { commandId, type CommandContext } from "./command-context.ts";
import type { DurableRuntime } from "./durable-runtime.ts";
import type { DurableState } from "./durable-state.ts";
import type { ExecutionResult } from "./execution-contracts.ts";
import { ToolRegistry } from "./tool-registry.ts";
import type {StationAttachment} from './station-attachments.ts';
import {cron} from './station-routines.ts';
const require=createRequire(import.meta.url);
export const channelCommands=require('../vendor/starnet/sidecar/channels/hub.js') as {parseCommand(text:string):{cmd:string;arg:string}|null;matchAgent(roster:readonly {agentId:string;name:string}[],query:string):{agent?:{agentId:string;name:string};ambiguous?:unknown[]}|null;COMMANDS:readonly {command:string;description:string;usage?:string}[]};
export type ChannelKind="telegram"|"discord"|"slack"|"matrix"|"signal";
export interface ChannelConfig {readonly id:string;readonly kind:ChannelKind;readonly agentId:AgentId;readonly ownerUserId:string;readonly allowedChats:readonly string[];readonly enabled:boolean;}
export interface ChannelMedia {readonly kind:string;readonly fileId:string;readonly name?:string;readonly mime?:string;readonly size?:number;readonly voice?:boolean;}
export interface InboundMessage {readonly observeOnly?:boolean;readonly mediaGroupId?:string;readonly chatId:string;readonly userId:string;readonly messageId:string;readonly text:string;readonly chatType?:string;readonly directReply?:string;readonly threadId?:string;readonly media?:readonly ChannelMedia[];readonly replyTo?:{readonly text:string;readonly userName?:string;readonly fromBot?:boolean;readonly media?:readonly ChannelMedia[]};}
export function validChannelMedia(value:unknown):value is readonly ChannelMedia[]{return Array.isArray(value)&&value.length<=10&&value.every(m=>m&&typeof m.kind==='string'&&m.kind.length<=50&&typeof m.fileId==='string'&&m.fileId.length>0&&m.fileId.length<=4000&&(m.name===undefined||typeof m.name==='string'&&m.name.length<=200)&&(m.mime===undefined||typeof m.mime==='string'&&/^[a-zA-Z0-9.+_-]+\/[a-zA-Z0-9.+_-]+$/.test(m.mime))&&(m.size===undefined||Number.isSafeInteger(m.size)&&m.size>=0)&&(m.voice===undefined||typeof m.voice==='boolean'));}
export function boundedChannelFetch(transport:typeof fetch):typeof fetch{return async(url,init)=>{
  const signal=init?.signal?AbortSignal.any([init.signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000);
  const response=await transport(url,{...init,signal,redirect:'error'});if(!response.body)return response;
  if(Number(response.headers.get('content-length'))>8*1024*1024){await response.body.cancel();throw new Error('Channel response exceeds 8MB');}
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{for(;;){signal.throwIfAborted();const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>8*1024*1024)throw new Error('Channel response exceeds 8MB');parts.push(part.value);}}finally{await reader.cancel();}
  return new Response(Buffer.concat(parts),{status:response.status,statusText:response.statusText,headers:response.headers});
};}
export interface ChannelMessage extends InboundMessage {
  readonly albumMerged?:{readonly text:string;readonly media:readonly ChannelMedia[];readonly partIds:readonly string[]};readonly mergedInto?:string;
  readonly id:string;readonly channelId:string;readonly agentId:AgentId;readonly receivedAt:string;readonly jobId?:JobId;
  readonly status:"pending"|"running"|"waiting_for_approval"|"completed"|"failed"|"interrupted"|"coalesced"|"observed";
  readonly consent?:{readonly approvalId:ApprovalId;readonly expiresAt:string};
  readonly outbox:readonly {readonly attempts?:number;readonly retryAt?:string;readonly text:string;readonly status:"pending"|"sending"|"sent"|"unknown"|"rejected";readonly messageId?:string;readonly approvalId?:ApprovalId}[];
}
interface SendResult {ok:boolean;messageId?:string;knownRejected?:boolean;retryAfter?:number;}
interface Adapter {sendMedia(chatId:string,item:unknown,options?:unknown):Promise<SendResult>;connect():unknown;disconnect():unknown;answerCallback(id:string,text:string):Promise<unknown>;getFile(id:string,options?:unknown):Promise<{ok:boolean;buffer?:Uint8Array;error?:string}>;send(chatId:string,text:string,options?:unknown):Promise<SendResult>;MAX_MESSAGE_LENGTH:number;_internals:{dispatch(raw:unknown):Promise<void>};}
export function validateChannels(configs:readonly ChannelConfig[],messages:readonly ChannelMessage[],state:DurableState,businessId:string):void{
  const refuse=()=>{throw new TypeError("Invalid durable channel state");};
  const owned=(id:string)=>state.authority.agents.some(a=>a.id===id&&a.businessId===businessId);
  for(const list of [configs,messages])if(!Array.isArray(list)||new Set(list.map(v=>v.id)).size!==list.length)refuse();
  for(const c of configs)if(!c||typeof c.id!=="string"||!c.id.trim()||!["telegram","discord","slack","matrix","signal"].includes(c.kind)||!owned(c.agentId)||typeof c.ownerUserId!=="string"||!c.ownerUserId.trim()||!Array.isArray(c.allowedChats)||c.allowedChats.some(id=>typeof id!=="string"||!id.trim())||typeof c.enabled!=="boolean")refuse();
  for(const m of messages)if(!m||!configs.some(c=>c.id===m.channelId)||!owned(m.agentId)||!["pending","running","waiting_for_approval","completed","failed","interrupted","coalesced","observed"].includes(m.status)||![m.id,m.chatId,m.userId,m.messageId,m.text,m.receivedAt].every(s=>typeof s==="string")||!m.messageId||!Number.isFinite(Date.parse(m.receivedAt))||!Array.isArray(m.outbox)||m.outbox.some(p=>typeof p.text!=="string"||!["pending","sending","sent","unknown","rejected"].includes(p.status)||p.attempts!==undefined&&(!Number.isSafeInteger(p.attempts)||p.attempts<1||p.attempts>2)||p.retryAt!==undefined&&!Number.isFinite(Date.parse(p.retryAt)))||m.jobId&&!state.authority.jobs.some(j=>j.id===m.jobId&&j.agentId===m.agentId&&j.businessId===businessId))refuse();
  for(const m of messages){
    if(m.observeOnly!==undefined&&typeof m.observeOnly!=='boolean'||m.observeOnly&&(m.status!=='observed'||m.jobId||m.outbox.length)||m.status==='observed'&&!m.observeOnly||m.chatType!==undefined&&!['dm','group'].includes(m.chatType))refuse();
    if(m.mediaGroupId!==undefined&&(typeof m.mediaGroupId!=='string'||!m.mediaGroupId||m.mediaGroupId.length>200||!m.media?.length))refuse();
    if(m.status==='coalesced'&&!m.mergedInto||m.mergedInto&&(m.status!=='coalesced'||m.jobId||!messages.some(a=>a.id===m.mergedInto&&a.albumMerged?.partIds.includes(m.id)&&a.agentId===m.agentId&&a.chatId===m.chatId&&a.threadId===m.threadId&&a.channelId===m.channelId&&a.mediaGroupId===m.mediaGroupId)))refuse();
    if(m.albumMerged){const a=m.albumMerged;if(!m.mediaGroupId||typeof a.text!=='string'||a.text.length>12000||!validChannelMedia(a.media)||!Array.isArray(a.partIds)||!a.partIds.length||a.partIds.length>10||new Set(a.partIds).size!==a.partIds.length||a.partIds[0]!==m.id||a.partIds.some(id=>!messages.some(part=>part.id===id&&part.agentId===m.agentId&&part.chatId===m.chatId&&part.threadId===m.threadId&&part.channelId===m.channelId&&part.userId===m.userId&&part.mediaGroupId===m.mediaGroupId)))refuse();const parts=a.partIds.map(id=>messages.find(p=>p.id===id)!);if(a.text!==parts.map(p=>p.text).filter(Boolean).join('\n').slice(0,12000)||JSON.stringify(a.media)!==JSON.stringify(parts.flatMap(p=>p.media??[])))refuse();}
  }
  for(const m of messages)if(m.consent&&(!Number.isFinite(Date.parse(m.consent.expiresAt))||!state.approvals?.some(a=>a.id===m.consent!.approvalId&&a.jobId===m.jobId&&a.businessId===businessId))||m.outbox.some(p=>p.approvalId&&!state.approvals?.some(a=>a.id===p.approvalId&&a.jobId===m.jobId&&a.businessId===businessId)))refuse();
  for(const m of messages)if(m.threadId!==undefined&&(typeof m.threadId!=='string'||!m.threadId||m.threadId.length>200)||m.replyTo!==undefined&&(!m.replyTo||typeof m.replyTo.text!=='string'||m.replyTo.text.length>12000||m.replyTo.userName!==undefined&&(typeof m.replyTo.userName!=='string'||m.replyTo.userName.length>200)||m.replyTo.fromBot!==undefined&&typeof m.replyTo.fromBot!=='boolean'))refuse();
  for(const m of messages)if(m.media!==undefined&&!validChannelMedia(m.media)||m.replyTo?.media!==undefined&&!validChannelMedia(m.replyTo.media))refuse();
}
export interface ChannelHostOptions {
  readonly runtime:DurableRuntime;readonly context:CommandContext;readonly id:string;
  readonly execute:(context:CommandContext,jobId:JobId)=>Promise<ExecutionResult>;
  /** Secret-bearing adapter settings stay in the composition root, outside canonical state. */
  readonly transportOptions:Readonly<Record<string,unknown>>;
  readonly saveAttachment?:(context:CommandContext,agentId:AgentId,name:string,mime:string,bytes:Uint8Array)=>Promise<StationAttachment>;
  readonly models?:readonly {readonly provider:string;readonly model:string}[]|(()=>readonly {readonly provider:string;readonly model:string}[]);
  readonly albumWaitMs?:number;
  readonly schedule?:(callback:()=>void,delay:number)=>()=>void;
  readonly now?:()=>number;readonly onStatus?:(state:string)=>void;
}
/** Real StarNet platform adapters, with HQ asynchronous durable intake and explicit owner/chat binding. */
export class ChannelHost {
  #botUsername=''; #botName=''; #seesAllGroupMessages:boolean|undefined; #probeMetadata:(()=>Promise<unknown>)|undefined;
  readonly #o:ChannelHostOptions;readonly #adapter:Adapter;readonly #active=new Set<string>();readonly #running=new Set<Promise<void>>();
  readonly #unsubscribe:()=>void;#closed=false;
  readonly #deliveryTimers=new Map<string,()=>void>();
  readonly #lineAborts=new Map<string,AbortController>();
  readonly #albumTimers=new Map<string,()=>void>();readonly #consentTimers=new Map<string,()=>void>();readonly #rerun=new Set<string>();
  constructor(options:ChannelHostOptions){
    this.#o=options;const config=this.#config();
    const transportOptions={...options.transportOptions,fetch:boundedChannelFetch((options.transportOptions.fetch??fetch) as typeof fetch)};
    const factory=require(`../vendor/starnet/sidecar/channels/${config.kind}.js`) as Record<string,(options:unknown)=>Adapter>;
    const name=`make${config.kind[0]!.toUpperCase()+config.kind.slice(1)}Adapter`;
    const gateway=config.kind==="discord"?(require("../vendor/starnet/sidecar/channels/discord.gateway.js") as {makeConnectGateway(options:unknown):unknown}).makeConnectGateway({fetch:transportOptions.fetch,WebSocketImpl:options.transportOptions.WebSocketImpl??globalThis.WebSocket}):undefined;
    const cursor=options.runtime.station(this.#context()).channelCursors?.find(c=>c.channelId===config.id)?.value;
    const onCursor=(value:string)=>options.runtime.saveChannelCursor(this.#context(),config.id,value);
    let transport=options.transportOptions.transport;
    if(!transport&&config.kind==='matrix')transport=(require('../vendor/starnet/sidecar/channels/matrix.transport.js') as {makeMatrixTransport(options:unknown):unknown}).makeMatrixTransport({newId:randomUUID,...transportOptions,initialSince:cursor,onCursor});
    if(!transport&&config.kind==='telegram'){
      const telegram=(require('../vendor/starnet/sidecar/channels/telegram.transport.js') as {makeTelegramTransport(options:unknown):Record<string,unknown>}).makeTelegramTransport(transportOptions);
      this.#probeMetadata=typeof telegram.getMe==='function'?()=>((telegram.getMe as ()=>Promise<unknown>)()):undefined;
      transport={...telegram,acknowledge:async(raw:{update_id?:number})=>{if(Number.isSafeInteger(raw.update_id))await onCursor(String(raw.update_id!+1));}};
    }
    this.#adapter=factory[name]!({newId:randomUUID,...transportOptions,...(transport?{transport}:{}),...(config.kind==="telegram"&&cursor?{startOffset:Number(cursor)}:{}),ownerUserId:config.ownerUserId,allowedChats:config.allowedChats,dropPendingOnConnect:false,botUsername:()=>this.#botUsername||String(options.transportOptions.botUsername??''),mentionPatterns:()=>[this.#botName,...options.runtime.snapshot().authority.agents.filter(a=>a.businessId===options.context.businessId).map(a=>a.name)],requireMention:(chatId:string)=>options.runtime.station(options.context).channelChats?.find(c=>c.channelId===config.id&&c.chatId===chatId)?.requireMention,observeUnmentioned:(chatId:string)=>options.runtime.station(options.context).channelChats?.find(c=>c.channelId===config.id&&c.chatId===chatId)?.observeUnmentioned,
      ...(gateway?{connectGateway:gateway}:{}),clock:{now:options.now??Date.now},WebSocketImpl:options.transportOptions.WebSocketImpl??globalThis.WebSocket,
      onStatus:(value:{state:string})=>options.onStatus?.(value.state),
      onCallback:(callback:{chatId:string|number;userId:string|number;data:string;callbackId:string;messageId:string|number})=>this.#callback(callback),
      onInbound:async(message:InboundMessage)=>{
        const admitted=await options.runtime.claimChannelMessage(this.#context(),config.id,message);
        if(admitted&&admitted.status!=='observed'){for(const previous of options.runtime.station(this.#context()).channelMessages??[])if(previous.status==='interrupted')this.#lineAborts.get(previous.id)?.abort();for(const old of options.runtime.station(this.#context()).channelMessages??[])if(old.channelId===config.id&&old.chatId===admitted.chatId&&old.threadId===admitted.threadId&&old.status==='interrupted'&&old.jobId&&['queued','running'].includes(options.runtime.inspectJob(this.#context(),old.jobId).status))await options.runtime.cancelJob(this.#context(),old.jobId);this.#admitLaunch(admitted);}
      }});
    const binding=JSON.stringify(config);
    this.#unsubscribe=options.runtime.subscribe(()=>{if(JSON.stringify(this.#config())!==binding||!this.#config().enabled)this.disconnect();});
  }
  #context():CommandContext{return {...this.#o.context,principal:{kind:"system",id:`hq.channel:${this.#o.id}`}};}
  #config():ChannelConfig{const config=this.#o.runtime.station(this.#o.context).channels?.find(c=>c.id===this.#o.id);if(!config)throw new Error("Channel is not configured in this business");return config;}
  async sendExternal(context:CommandContext,chatId:string,threadId:string|undefined,text:string,signal?:AbortSignal){this.#externalScope(context,chatId,threadId);signal?.throwIfAborted();return this.#adapter.send(chatId,text,{noRetry:true,signal,...(threadId?{threadId}:{})});}
  async sendExternalMedia(context:CommandContext,chatId:string,threadId:string|undefined,item:unknown,signal?:AbortSignal){this.#externalScope(context,chatId,threadId);signal?.throwIfAborted();return this.#adapter.sendMedia(chatId,item,{noRetry:true,signal,...(threadId?{threadId}:{})});}
  #externalScope(context:CommandContext,chatId:string,threadId:string|undefined){const config=this.#config();if(this.#closed||context.businessId!==this.#o.context.businessId||!config.enabled||!config.allowedChats.includes(chatId)||this.#o.runtime.station(context).routineState?.halted||!this.#o.runtime.station(context).channelMessages?.some(m=>m.channelId===config.id&&m.chatId===chatId&&m.threadId===threadId&&m.userId===config.ownerUserId))throw new Error('Channel target is not an owned opened conversation');}
  connect(){if(this.#closed||!this.#config().enabled)throw new Error("Channel is disabled");this.#adapter.connect();
    if(this.#probeMetadata)void this.#probeMetadata().then(raw=>{const r=raw as {ok?:boolean;username?:string;name?:string;seesAllGroupMessages?:boolean};if(r.ok){this.#botUsername=String(r.username??'');this.#botName=String(r.name??'');this.#seesAllGroupMessages=r.seesAllGroupMessages;}}).catch(()=>{});
    for(const message of this.#o.runtime.station(this.#o.context).channelMessages??[])if(message.channelId===this.#o.id&&(["pending","running","waiting_for_approval"].includes(message.status)||message.outbox.some(p=>p.status==='pending'||p.status==='sending')))this.#admitLaunch(message);
  }
  disconnect(){if(this.#closed)return;this.#closed=true;this.#adapter.disconnect();this.#unsubscribe();this.#o.onStatus?.("down");
    for(const cancel of this.#deliveryTimers.values())cancel();this.#deliveryTimers.clear();
    for(const abort of this.#lineAborts.values())abort.abort();
    for(const cancel of this.#albumTimers.values())cancel();this.#albumTimers.clear();
    for(const cancel of this.#consentTimers.values())cancel();this.#consentTimers.clear();
    for(const message of this.#o.runtime.station(this.#o.context).channelMessages??[])if(this.#active.has(message.id)&&message.jobId&&this.#o.runtime.inspectJob(this.#o.context,message.jobId).status==='running')void this.#o.runtime.cancelJob(this.#context(),message.jobId).catch(()=>{});
  }
  async acceptRaw(raw:unknown){await this.#adapter._internals.dispatch(raw);await this.idle();}
  async idle(){await Promise.all([...this.#running]);}
  #admitLaunch(message:ChannelMessage){
    if(!message.mediaGroupId||message.albumMerged||message.status!=='pending'){if(message.status!=='coalesced')this.#launch(message.id);return;}
    const key=JSON.stringify([message.channelId,message.chatId,message.threadId,message.mediaGroupId]);this.#albumTimers.get(key)?.();
    const fire=()=>{this.#albumTimers.delete(key);void this.#o.runtime.sealChannelAlbum(this.#context(),message.id).then(id=>{if(id)this.#launch(id);}).catch(()=>this.#o.onStatus?.('error'));};
    const delay=Math.max(0,Math.min(5000,this.#o.albumWaitMs??800)),cancel=this.#o.schedule?this.#o.schedule(fire,delay):(()=>{const timer=setTimeout(fire,delay);return ()=>clearTimeout(timer);})();this.#albumTimers.set(key,cancel);
  }
  #launch(id:string){if(this.#active.has(id)||this.#closed)return;this.#active.add(id);
    const running=this.#process(id).catch(()=>{this.#o.onStatus?.("error");}).finally(()=>{this.#active.delete(id);this.#running.delete(running);if(this.#rerun.delete(id))this.#launch(id);});this.#running.add(running);
  }
  #token(id:string){return 'hq:a:'+createHash('sha256').update(JSON.stringify([this.#o.context.businessId,this.#o.id,id])).digest('hex').slice(0,32);}
  #armConsent(message:ChannelMessage){if(!message.consent||this.#consentTimers.has(message.id)||this.#closed)return;const expire=()=>{this.#consentTimers.delete(message.id);void this.#expireConsent(message.id).catch(()=>this.#o.onStatus?.('error'));};const delay=Math.max(0,Date.parse(message.consent.expiresAt)-Date.parse(this.#o.runtime.currentTime()));
    const cancel=this.#o.schedule?this.#o.schedule(expire,delay):(()=>{const timer=setTimeout(expire,delay);timer.unref();return ()=>clearTimeout(timer);})();this.#consentTimers.set(message.id,cancel);
  }
  async #expireConsent(id:string){const runtime=this.#o.runtime,context=this.#context(),message=runtime.station(context).channelMessages?.find(m=>m.id===id);if(!message?.consent||message.status!=='waiting_for_approval'||Date.parse(runtime.currentTime())<Date.parse(message.consent.expiresAt))return;
    const approval=runtime.inspectApproval(context,message.consent.approvalId);if(approval.status!=='pending')return;
    await runtime.cancelJob({...context,commandId:commandId('channel-consent-expired:'+approval.id)},message.jobId!);await runtime.saveChannelMessage(context,{...message,status:'failed',outbox:[{text:'Permission timed out. The exact operation was not dispatched.',status:'pending'}]});if(this.#active.has(id))this.#rerun.add(id);else this.#launch(id);
  }
  async #callback(callback:{chatId:string|number;userId:string|number;data:string;callbackId:string;messageId:string|number}){
    const config=this.#config(),runtime=this.#o.runtime,context=this.#context();if(this.#closed||!config.enabled||String(callback.userId)!==config.ownerUserId||!config.allowedChats.includes(String(callback.chatId)))return;
    const message=runtime.station(context).channelMessages?.find(m=>m.channelId===config.id&&m.chatId===String(callback.chatId)&&m.status==='waiting_for_approval'&&m.consent&&[':allow',':deny'].some(choice=>callback.data===this.#token(m.consent!.approvalId)+choice)&&m.outbox.some(p=>p.approvalId===m.consent!.approvalId&&p.status==='sent'&&p.messageId===String(callback.messageId)));
    if(!message?.consent){await this.#adapter.answerCallback(callback.callbackId,'This permission request is no longer active.');return;}
    if(Date.parse(runtime.currentTime())>=Date.parse(message.consent.expiresAt)){await this.#expireConsent(message.id);await this.#adapter.answerCallback(callback.callbackId,'This permission request expired.');return;}
    const human={...context,commandId:commandId('channel-consent:'+message.consent.approvalId),principal:{kind:'human' as const,id:config.ownerUserId}};
    const approval=runtime.inspectApproval(context,message.consent.approvalId);if(approval.status!=='pending')return;
    if(callback.data.endsWith(':allow'))await runtime.approveOperation(human,approval.id);else await runtime.rejectOperation(human,approval.id,'Denied by the bound channel owner');
    this.#consentTimers.get(message.id)?.();this.#consentTimers.delete(message.id);await this.#adapter.answerCallback(callback.callbackId,callback.data.endsWith(':allow')?'Allowed once.':'Denied.');if(this.#active.has(message.id))this.#rerun.add(message.id);else this.#launch(message.id);
  }
  #armDelivery(id:string,at:string){this.#deliveryTimers.get(id)?.();const delay=Math.max(0,Date.parse(at)-Date.parse(this.#o.runtime.currentTime())),fire=()=>{this.#deliveryTimers.delete(id);if(this.#active.has(id))this.#rerun.add(id);else this.#launch(id);};const cancel=this.#o.schedule?this.#o.schedule(fire,delay):(()=>{const t=setTimeout(fire,delay);return ()=>clearTimeout(t);})();this.#deliveryTimers.set(id,cancel);}
  async #process(id:string){
    const runtime=this.#o.runtime,context=this.#context();let message=runtime.station(context).channelMessages!.find(m=>m.id===id)!;
    if(message.status==='interrupted'||message.status==='observed')return;
    if(!message.jobId&&channelCommands.parseCommand(message.text)){
      const parsed=channelCommands.parseCommand(message.text)!;
      const conversations=(runtime.station(context).channelMessages??[]).filter(m=>m.id!==id&&m.channelId===message.channelId&&m.chatId===message.chatId&&m.threadId===message.threadId);
      const live=conversations.filter(m=>m.jobId&&(runtime.isJobActive(context,m.jobId)||this.#lineAborts.has(m.id)||m.status==='waiting_for_approval'));
      const chat=runtime.station(context).channelChats?.find(c=>c.channelId===message.channelId&&c.chatId===message.chatId&&c.threadId===message.threadId)??{channelId:message.channelId,chatId:message.chatId,...(message.threadId?{threadId:message.threadId}:{}),approvals:false};
      const human={...context,principal:{kind:'human' as const,id:this.#config().ownerUserId}};
      let reply:string;
      if(parsed.cmd==='stop'){for(const m of live){this.#lineAborts.get(m.id)?.abort();await runtime.saveChannelMessage(context,{...m,status:'interrupted'});await runtime.cancelJob(context,m.jobId!);}reply=live.length?'Stopped the run in progress.':'Nothing is running for this chat right now.';}
      else if(parsed.cmd==='new')reply=live.length?'A run is still going — send /stop first, then /new.':'This chat starts fresh. Its audit records are retained.';
      else if(parsed.cmd==='status')reply=live.length?live.map(m=>{const j=runtime.inspectJob(context,m.jobId!),execution=runtime.snapshot().executions?.find(e=>e.businessId===context.businessId&&e.jobId===j.id);return `Working: ${j.id}${execution?.startedAt?` — ${Math.max(0,Math.floor((Date.parse(runtime.currentTime())-Date.parse(execution.startedAt))/1000))}s so far`:''}`;}).join('\n'):'Idle — nothing running.';
      else if(parsed.cmd==='agents')reply=runtime.snapshot().authority.agents.filter(a=>a.businessId===context.businessId&&a.status!=='retired').map(a=>`${a.id===message.agentId?'→ ':''}${a.name} (${a.id})`).join('\n');
      else if(parsed.cmd==='whoami')reply=runtime.effectiveAgent(context,message.agentId).name;
      else if(parsed.cmd==='tools')reply=runtime.effectiveAgent(context,message.agentId).toolIds.join('\n')||'No tools are granted.';
      else if(parsed.cmd==='talk'){const matched=channelCommands.matchAgent(runtime.snapshot().authority.agents.filter(a=>a.businessId===context.businessId&&a.status!=='retired').map(a=>({agentId:a.id,name:a.name})),parsed.arg);if(live.length)reply='A run is still going — send /stop before switching agents.';else if(!matched?.agent)reply=matched?.ambiguous?'Agent name is ambiguous. Use /agents and an exact identifier.':'No matching agent. Use /agents.';else{await runtime.configureChannelChat(human,{...chat,agentId:ids.agent(matched.agent.agentId)});reply='Now talking to '+matched.agent.name+'.';}}
      else if(parsed.cmd==='approvals'){if(!parsed.arg)reply='Approve/deny buttons: '+(chat.approvals?'ON':'OFF')+'.';else if(this.#config().kind!=='telegram')reply='Inline consent is not available on this channel.';else if(!['on','off'].includes(parsed.arg.toLowerCase()))reply='Usage: /approvals [on|off]';else{await runtime.configureChannelChat(human,{...chat,approvals:parsed.arg.toLowerCase()==='on'});reply=parsed.arg.toLowerCase()==='on'?'Approve/deny buttons ON. Exact consequential operations wait up to two minutes for your decision, then cancel without dispatch.':'Approve/deny buttons OFF. Consequential work cancels without a channel grant.';}}
      else if(parsed.cmd==='mention'){const want=/^(on|yes|enable|enabled|true|1)$/i.test(parsed.arg)?'on':/^(off|no|disable|disabled|false|0)$/i.test(parsed.arg)?'off':/^(observe|watch|listen|follow|context)$/i.test(parsed.arg)?'observe':null;if(this.#config().kind!=='telegram')reply='Mention gating is available on Telegram groups.';else if(message.chatType!=='group')reply='This setting only applies to groups; in a direct chat I always answer you.';else if(!parsed.arg)reply='Mention gate: '+(chat.requireMention===false?'off':chat.observeUnmentioned?'observe':'on')+'. Use /mention on | observe | off.';else if(!want)reply='Usage: /mention on | observe | off';else{await runtime.configureChannelChat(human,{...chat,requireMention:want!=='off',observeUnmentioned:want==='observe'});reply=want==='off'?'Answer every received group message; each run can spend.':want==='observe'?'Answer only when addressed; retain other admitted messages as untrusted context without model calls.':'Answer only when addressed; forget other group messages.';if(want!=='on'&&this.#seesAllGroupMessages===false)reply+=' Telegram privacy mode is ON: ordinary chatter is not delivered. Disable it through BotFather /setprivacy to receive those messages.';}}
      else if(parsed.cmd==='usage'){const accounts=runtime.snapshot().modelAccounts?.filter(a=>a.businessId===context.businessId&&runtime.inspectJob(context,a.jobId).agentId===message.agentId)??[];let nano=0n,cents=0n,unknown=0;for(const account of accounts)for(const invocation of account.invocations){if(invocation.status!=='settled')unknown++;nano+=invocation.meteredCost?.nanodollars??0n;if(invocation.cost?.currency==='USD')cents+=invocation.cost.minorUnits;}const total=nano+cents*10_000_000n;reply='Actual recorded USD spend: $'+(total/1_000_000_000n)+'.'+(total%1_000_000_000n).toString().padStart(9,'0')+(unknown?'\n'+unknown+' unresolved invocation(s); their costs remain UNKNOWN.':'');}
      else if(parsed.cmd==='model'&&parsed.arg){const models=typeof this.#o.models==='function'?this.#o.models():this.#o.models??[];const candidates=models.filter(m=>m.model===parsed.arg||m.provider+'/'+m.model===parsed.arg);if(live.length)reply='A run is still going ? send /stop before changing models.';else if(candidates.length!==1)reply='Choose one host-configured priced model:\n'+models.map(m=>m.provider+'/'+m.model).join('\n');else{const profile=runtime.station(context).profiles.find(p=>p.agentId===message.agentId);await runtime.configureAgent(human,{agentId:message.agentId,instructions:profile?.instructions??'',personality:profile?.personality??'',skills:profile?.skills??[],...(profile?.budget?{budget:profile.budget}:{}),model:candidates[0]!});reply='Model changed to '+candidates[0]!.provider+'/'+candidates[0]!.model+'.';}}
      else if(parsed.cmd==='routine'){const routines=runtime.station(context).routineState?.routines.filter(r=>r.agentId===message.agentId&&!r.archived)??[],parts=/^add\s+(.+?)\s*\|\s*([\s\S]+)$/.exec(parsed.arg),pause=/^(pause|resume|rm)\s+(.+)$/.exec(parsed.arg);if(!parsed.arg||parsed.arg==='list')reply=routines.map((r,i)=>(i+1)+'. '+r.id+' '+(r.enabled?'ON':'PAUSED')+' '+JSON.stringify(r.schedule)).join('\n')||'No routines for this crew.';else if(parts){const id='channel-routine:'+createHash('sha256').update(JSON.stringify([context.businessId,message.id])).digest('hex'),task=parts[2]!.trim();if(!cron.parseSchedule(parts[1]!,Date.parse(runtime.currentTime()),{tz:'UTC'})){reply='Invalid recurrence. No routine was saved.';}else{if(!runtime.station(context).routineState?.routines.some(r=>r.id===id)){await runtime.saveRecipe(human,{id,name:task.slice(0,80),task,params:[]});await runtime.saveRoutine(human,{id,agentId:message.agentId,recipeId:id,inputs:{},schedule:parts[1]!,timezone:'UTC',enabled:true});}reply='Routine saved for this crew (UTC): '+id;}}else if(pause){const r=routines.find(r=>r.id===pause[2])??routines[Number(pause[2])-1];if(!r)reply='Routine unavailable. Use /routine list.';else{if(pause[1]==='rm')await runtime.removeRoutine(human,r.id);else await runtime.setRoutineEnabled(human,r.id,pause[1]==='resume');reply=(pause[1]==='rm'?'Removed ':pause[1]==='resume'?'Resumed ':'Paused ')+r.id+'.';}}else reply='Usage: /routine list | add <schedule> | <task> | pause N | resume N | rm N';}
      else if(parsed.cmd==='model'&&!parsed.arg){const model=runtime.station(context).profiles.find(p=>p.agentId===message.agentId)?.model;reply=model?`${model.provider}/${model.model}`:'The host default model is selected.';}
      else if(parsed.cmd==='help'||parsed.cmd==='start')reply='Commands:\n'+channelCommands.COMMANDS.filter(c=>['stop','new','status','agents','talk','whoami','tools','model','usage','routine','mention','approvals','help','start'].includes(c.command)).map(c=>(c.usage||'/'+c.command)+' — '+c.description).join('\n');
      else reply='This command is not available here yet. Use the Station for this operation.';
      message={...message,status:live.length&&parsed.cmd==='new'?'failed':'completed',outbox:[{text:reply,status:'pending'}]};await runtime.saveChannelMessage(context,message);
    }
    const digest=createHash("sha256").update(JSON.stringify([context.businessId,id])).digest("hex");
    if(!message.jobId&&message.status==='pending'){
      const snapshot=runtime.snapshot(),savedInput=snapshot.artifacts?.find(a=>a.businessId===context.businessId&&a.id===`channel-input:${digest}`);
      const attachments:StationAttachment[]=[],mediaNotes:string[]=[];
      for(const item of savedInput?[]:[...(message.albumMerged?.media??message.media??[]),...(message.replyTo?.media??[]).slice(0,4)]){
        if(!this.#o.saveAttachment){mediaNotes.push('Media download is not configured on this host.');continue;}
        if((item.size??0)>8*1024*1024){mediaNotes.push('Attachment '+(item.name??'file')+' exceeds 8MB; resend a smaller version.');continue;}
        const got=await this.#adapter.getFile(item.fileId,{maxBytes:8*1024*1024});
        if(!got.ok||!got.buffer?.byteLength||got.buffer.byteLength>8*1024*1024){mediaNotes.push('Could not download attachment '+(item.name??'file')+'.');continue;}
        try{attachments.push(await this.#o.saveAttachment(context,message.agentId,item.name??'file',item.mime??'application/octet-stream',got.buffer));if(item.voice)mediaNotes.push('Voice transcription is not configured; the original audio is saved.');}catch{mediaNotes.push('Could not save attachment '+(item.name??'file')+'.');}
        if(this.#closed||runtime.station(context).channelMessages!.find(m=>m.id===id)!.status==='interrupted')return;
      }
      const conversation=(runtime.station(context).channelMessages??[]).filter(m=>m.id!==message.id&&m.channelId===message.channelId&&m.chatId===message.chatId&&m.threadId===message.threadId&&m.agentId===message.agentId);
      const reset=conversation.findLastIndex(m=>channelCommands.parseCommand(m.text)?.cmd==='new'&&m.status==='completed');
      const history=conversation.slice(reset+1).filter(m=>['completed','observed'].includes(m.status)&&!m.directReply&&!channelCommands.parseCommand(m.text)).slice(-12).map(m=>{
        const output=snapshot.artifacts?.find(a=>a.businessId===context.businessId&&a.id===`job-output:${m.jobId}`)?.content;
        if(m.status==='observed')return {user:m.text.slice(0,4000),observedOnly:true};return {user:m.text.slice(0,4000),assistant:(typeof output==='string'?output:JSON.stringify(output??null)).slice(0,4000)};
      });
      const source=savedInput??await runtime.createArtifact(context,{id:`channel-input:${digest}`,category:"source",contentType:"application/json",content:{channelId:message.channelId,chatId:message.chatId,userId:message.userId,messageId:message.messageId,text:message.albumMerged?.text??message.text,...(message.threadId?{threadId:message.threadId}:{}),...(message.replyTo?{replyTo:message.replyTo}:{}),...(attachments.length?{attachments}:{}),...(mediaNotes.length?{mediaNotes}:{}),history},sourceIds:[]});
      const entryLines=message.directReply?[]:(runtime.station(context).workflows??[]).filter(w=>{const p=floorCompiler.compileRoutingPlan(w.geometry),dock=floorCompiler.entryDockOf(p,message.agentId);return dock&&floorCompiler.lineOfDock(p,dock);});
      const job=(await runtime.createJob({...context,commandId:commandId(`channel:${digest}`)},{agentId:message.agentId,...(entryLines.length===1?{workflowId:ids.workflow(entryLines[0]!.id)}:{}),objective:message.directReply?"Channel authentication exchange":(message.albumMerged?.text??message.text).trim()||'Inspect the actual attachments sent in this message. Report download or interpretation limitations honestly.',inputArtifactIds:[source.id]})).record;
      if(runtime.station(context).channelMessages!.find(m=>m.id===id)!.status==='interrupted'){await runtime.cancelJob(context,job.id);return;}
      message={...message,jobId:job.id,status:"running"};await runtime.saveChannelMessage(context,message);
    }
    const job=message.jobId?runtime.inspectJob(context,message.jobId):undefined;
    if(message.outbox.some(p=>p.status==='sending')){
      message={...message,outbox:message.outbox.map(p=>p.status==='sending'?{...p,status:'unknown' as const}:p)};
      await runtime.saveChannelMessage(context,message);
    }
    if(job&&runtime.isJobActive(context,job.id))return;
    const decision=message.consent?runtime.inspectApproval(context,message.consent.approvalId).status:undefined;
    if(message.status==='waiting_for_approval'&&decision==='pending'){if(Date.parse(runtime.currentTime())>=Date.parse(message.consent!.expiresAt)){await this.#expireConsent(message.id);return;}this.#armConsent(message);}
    if(job?.status==="running"&&message.status!=='waiting_for_approval'){await runtime.saveChannelMessage(context,{...message,status:"interrupted"});return;}
    if(job?.status==="queued"||job?.status==='running'&&message.status==='waiting_for_approval'&&decision==='approved'){
      const runContext={...context,commandId:commandId(`channel:${digest}:${message.consent?'resume:'+message.consent.approvalId:'run'}`)};
      let result=message.directReply?await runtime.executeJob(runContext,job.id,{async next(){return {kind:'complete',output:message.directReply};}},new ToolRegistry()):await this.#o.execute(runContext,job.id);
      if(runtime.station(context).channelMessages!.find(m=>m.id===id)!.status==='interrupted')return;
      if(result.status==='completed'&&!message.directReply){const matches=(runtime.station(context).workflows??[]).filter(w=>w.id===job.workflowId);if(matches.length===1){const lineContext={...context,commandId:commandId('channel-line:'+digest)},abort=new AbortController();this.#lineAborts.set(id,abort);try{const line=await executeFloorWorkflow(runtime,lineContext,matches[0]!.id,message.albumMerged?.text??message.text,async(c,next)=>{const r=await this.#o.execute(c,next.id);if(r.status==='waiting_for_approval'){await runtime.cancelJob({...c,commandId:commandId('channel-downstream-consent:'+next.id)},next.id);return {status:'cancelled'};}return r;},{completedEntryJobId:job.id,boundAgentId:message.agentId,signal:abort.signal});result={status:'completed',output:line.stopped?'Entry completed; workflow stopped: '+line.stopped+'\n'+String(result.output):line.text};}finally{this.#lineAborts.delete(id);}if(runtime.station(context).channelMessages!.find(m=>m.id===id)!.status==='interrupted')return;}}
      if(result.status==='waiting_for_approval'){
        const approval=runtime.snapshot().approvals?.find(a=>a.businessId===context.businessId&&a.jobId===job.id&&a.status==='pending'),opted=runtime.station(context).channelChats?.find(c=>c.channelId===message.channelId&&c.chatId===message.chatId&&c.threadId===message.threadId)?.approvals;
        if(approval&&opted&&this.#config().kind==='telegram'){
          const args=JSON.stringify(approval.toolCall.input),text='Permission needed: '+approval.toolCall.toolId+'\n'+args.slice(0,2500)+(args.length>2500?'\nArguments truncated; inspect the full captured operation in the Station.':'')+'\nAllow once or deny. No answer within two minutes cancels this operation.';
          message={...message,status:'waiting_for_approval',consent:{approvalId:approval.id,expiresAt:new Date(Date.parse(runtime.currentTime())+120000).toISOString()},outbox:[{text,status:'pending',approvalId:approval.id}]};await runtime.saveChannelMessage(context,message);this.#armConsent(message);
        }else{await runtime.cancelJob({...context,commandId:commandId('channel-consent-off:'+job.id)},job.id);message={...message,status:'failed',outbox:[{text:'This consequential operation was not dispatched. Enable /approvals on for exact permission buttons, or use the Station.',status:'pending'}]};await runtime.saveChannelMessage(context,message);}
      }else{
      const text=result.status==="completed"?(typeof result.output==="string"?result.output:JSON.stringify(result.output)):`Work ${result.status}; inspect the local job ${job.id}.`;
      const chunks:string[]=[];for(let i=0;i<text.length;i+=this.#adapter.MAX_MESSAGE_LENGTH)chunks.push(text.slice(i,i+this.#adapter.MAX_MESSAGE_LENGTH));
      message={...message,status:result.status==="completed"?"completed":"failed",outbox:chunks.map(text=>({text,status:"pending" as const}))};await runtime.saveChannelMessage(context,message);
      }
    }
    else if(job&&['running','waiting_for_approval'].includes(message.status)&&['completed','failed','cancelled'].includes(job.status)){
      // Completion may have committed immediately before the process died. Recover the
      // actual output, never rerun the agent to reconstruct a response.
      const output=runtime.snapshot().artifacts?.find(a=>a.businessId===context.businessId&&a.id===`job-output:${job.id}`)?.content;
      const lineInput=runtime.snapshot().artifacts?.find(a=>a.businessId===context.businessId&&a.id==='floor-input:channel-line:'+digest),lineResult=runtime.snapshot().artifacts?.find(a=>a.businessId===context.businessId&&a.id==='floor-result:channel-line:'+digest)?.content as {text?:string;stopped?:string}|undefined;
      const text=job.status==='completed'?(lineInput?(lineResult&&!lineResult.stopped?String(lineResult.text):'Entry completed; workflow interrupted/stopped. Inspect its durable stage jobs.\n'+String(output)):typeof output==='string'?output:JSON.stringify(output??null)):`Work ${job.status}; inspect the local job ${job.id}.`;
      const chunks:string[]=[];for(let i=0;i<text.length;i+=this.#adapter.MAX_MESSAGE_LENGTH)chunks.push(text.slice(i,i+this.#adapter.MAX_MESSAGE_LENGTH));
      message={...message,status:job.status==='completed'?'completed':'failed',outbox:chunks.map(text=>({text,status:'pending' as const}))};
      await runtime.saveChannelMessage(context,message);
    }
    for(let index=0;index<message.outbox.length;index++){
      const part=message.outbox[index]!;if(part.status!=="pending")continue;
      if(part.retryAt&&Date.parse(part.retryAt)>Date.parse(runtime.currentTime())){this.#armDelivery(id,part.retryAt);return;}
      if(this.#closed||!this.#config().enabled||runtime.station(context).routineState?.halted||runtime.station(context).channelMessages!.find(m=>m.id===id)!.status==='interrupted')return;
      message={...message,outbox:message.outbox.map((p,i)=>i===index?{...p,attempts:(p.attempts??0)+1,status:"sending" as const}:p)};await runtime.saveChannelMessage(context,message);
      const keyboard=part.approvalId?{reply_markup:{inline_keyboard:[[{text:'Allow once',callback_data:this.#token(part.approvalId)+':allow'}],[{text:'Deny',callback_data:this.#token(part.approvalId)+':deny'}]]}}:{};
      const result=await this.#adapter.send(message.chatId,part.text,{newId:randomUUID,noRetry:true,...(message.threadId?{threadId:message.threadId}:{}),...keyboard});
      if(!result.ok&&result.knownRejected===true&&(part.attempts??0)===0){const seconds=Number.isFinite(result.retryAfter)&&result.retryAfter!>0?Math.min(result.retryAfter!,30):1,at=new Date(Date.parse(runtime.currentTime())+seconds*1000).toISOString();message={...message,outbox:message.outbox.map((p,i)=>i===index?{...p,status:'pending' as const,retryAt:at}:p)};await runtime.saveChannelMessage(context,message);this.#armDelivery(id,at);return;}
      message={...message,outbox:message.outbox.map((p,i)=>i===index?{...p,status:result.ok?"sent" as const:result.knownRejected?"rejected" as const:"unknown" as const,...(result.messageId?{messageId:result.messageId}:{})}:p)};await runtime.saveChannelMessage(context,message);
      if(part.approvalId&&!result.ok){await runtime.cancelJob({...context,commandId:commandId('channel-consent-undelivered:'+part.approvalId)},message.jobId!);await runtime.saveChannelMessage(context,{...message,status:'failed'});this.#consentTimers.get(id)?.();this.#consentTimers.delete(id);return;}
    }
  }
}
