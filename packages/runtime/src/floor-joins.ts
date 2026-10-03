import type {JobId} from '@hqoverlord/core';
import type {DurableRuntime} from './durable-runtime.ts';
import type {CommandContext} from './command-context.ts';
export interface FloorJoin {readonly id:string;readonly workflowId:string;readonly expected:number;readonly expiresAt:string;readonly status:'waiting'|'released'|'timed_out'|'cancelled'|'interrupted';readonly parts:readonly {readonly jobId:JobId;readonly agentId:string;readonly dockId:string;readonly text:string;readonly workitemId:string}[];}
export function joinResult(join:FloorJoin){return {released:join.status!=='waiting',parts:join.parts,missing:join.status==='timed_out'?Array.from({length:Math.max(0,join.expected-join.parts.length)},(_,i)=>'lane '+(join.parts.length+i+1)):[],...(join.status==='timed_out'?{timedOut:true}:{}),...(['cancelled','interrupted'].includes(join.status)?{cancelled:true}:{})};}
export async function waitFloorJoin(runtime:DurableRuntime,context:CommandContext,id:string,options:{signal?:AbortSignal;setTimer?:(fn:()=>void,ms:number)=>unknown;clearTimer?:(handle:unknown)=>void}={}){
 const read=()=>runtime.station(context).joins?.find(j=>j.id===id);const initial=read();if(!initial)return null;if(initial.status!=='waiting')return joinResult(initial);
 return new Promise<ReturnType<typeof joinResult>|null>((resolve,reject)=>{let timer:unknown,unsubscribe=()=>{},finished=false;
  const cleanup=()=>{unsubscribe();options.signal?.removeEventListener('abort',abort);if(timer!==undefined)(options.clearTimer??((handle:unknown)=>clearTimeout(handle as ReturnType<typeof setTimeout>)))(timer);};
  const finish=()=>{const join=read();if(!finished&&join?.status!=='waiting'){finished=true;cleanup();resolve(join?joinResult(join):null);}};
  const settle=(status:'timed_out'|'cancelled')=>{void runtime.settleFloorJoin(context,id,status).then(finish,error=>{finished=true;cleanup();reject(error);});};
  const abort=()=>settle('cancelled');unsubscribe=runtime.subscribe(finish);options.signal?.addEventListener('abort',abort,{once:true});
  timer=(options.setTimer??setTimeout)(()=>settle('timed_out'),Math.max(0,Date.parse(initial.expiresAt)-Date.parse(runtime.currentTime())));if(options.signal?.aborted)abort();finish();
 });
}
