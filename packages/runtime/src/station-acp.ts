import { createRequire } from 'node:module';
import type { AgentId, JobId } from '@hqoverlord/core';
import { commandId, type CommandContext } from './command-context.ts';
import type { DurableRuntime } from './durable-runtime.ts';
import type { ExecutionResult } from './execution-contracts.ts';
const require=createRequire(import.meta.url);
interface EventSink {onEvent(name:string,payload:unknown):void;onCancel(cancel:()=>void):void;messages:readonly {role:string;content:string}[];cwd:string;}
interface Core {handleRpc(message:unknown):Promise<unknown>;}
const reference=require('../vendor/starnet/sidecar/acp/core.js') as {makeAcpCore(options:unknown):Core};
export interface AcpOptions {
  runtime:DurableRuntime;context:()=>CommandContext;agentId:AgentId;
  execute:(context:CommandContext,id:JobId)=>Promise<ExecutionResult>;
  notify:(method:string,params:unknown)=>void;request:(method:string,params:unknown)=>Promise<unknown>;
}
/** ACP is another controller of existing business-scoped jobs, never a second store owner. */
export function createAcpBridge(options:AcpOptions){
  const runtime=options.runtime;runtime.effectiveAgent(options.context(),options.agentId);
  let sequence=0;const consent=new Map<string,{jobId:JobId;resolve:()=>void}>(),active=new Map<JobId,()=>void>();
  const core=reference.makeAcpCore({newId:()=>`hq-${++sequence}`,version:'0.1.0',notify:options.notify,request:options.request,
    async callSidecar(method:string,path:string,body:{runId:string;promptId:string;decision:string}){
      if(method!=='POST'||path!=='/api/consent')throw new Error('ACP operation unavailable');
      const waiting=consent.get(body.promptId);if(!waiting||waiting.jobId!==body.runId)throw new Error('Approval is not bound to this editor run');
      const context=options.context(),approval=runtime.snapshot().approvals?.find(a=>a.id===body.promptId&&a.jobId===waiting.jobId&&a.businessId===context.businessId);
      if(!approval||approval.status!=='pending')throw new Error('Approval is no longer pending');
      if(body.decision==='once')await runtime.approveOperation(context,approval.id);else await runtime.rejectOperation(context,approval.id,'Editor denied this exact operation');
      consent.delete(body.promptId);waiting.resolve();return {ok:true};
    },
    async openRun(sink:EventSink){
      const context=options.context(),last=sink.messages.findLast(m=>m.role==='user')?.content??'';
      const artifact=await runtime.createArtifact(context,{id:`acp-input:${context.commandId}`,category:'draft',contentType:'application/json',content:{messages:sink.messages,requestedCwd:sink.cwd,workspace:'Private agent workspace; editor cwd does not grant filesystem authority'},sourceIds:[]});
      const job=(await runtime.createJob(context,{agentId:options.agentId,objective:last.slice(0,12000),inputArtifactIds:[artifact.id]})).record;
      const cancel=()=>{void runtime.cancelJob(options.context(),job.id).catch(()=>{sink.onEvent('agent.run.error',{message:'Editor cancellation could not be persisted'});}).finally(()=>{for(const [id,wait]of consent)if(wait.jobId===job.id){consent.delete(id);wait.resolve();}});};
      active.set(job.id,cancel);sink.onCancel(cancel);sink.onEvent('agent.run.start',{runId:job.id});
      let factIndex=runtime.snapshot().facts.length;
      const unsubscribe=runtime.subscribe(()=>{
        const snapshot=runtime.snapshot(),facts=snapshot.facts.slice(factIndex);factIndex=snapshot.facts.length;
        for(const fact of facts){
          if(fact.businessId!==context.businessId)continue;
          if(fact.type==='tool.dispatched.v1'&&fact.payload.jobId===job.id){
            const operation=snapshot.executions?.find(e=>e.jobId===job.id)?.operation;
            sink.onEvent('agent.tool_call',{callId:fact.payload.operationId,name:fact.payload.toolId,argsSummary:JSON.stringify(operation?.call.input??{})});
          }
          if(fact.type==='tool.completed.v1'&&fact.payload.jobId===job.id){
            const observation=snapshot.executions?.find(e=>e.jobId===job.id)?.observations.at(-1);
            sink.onEvent('agent.tool_result',{callId:fact.payload.operationId,isError:false,summary:JSON.stringify(observation?.result.output??null).slice(0,4000)});
          }
        }
      });
      try{
        for(let attempt=0;attempt<64;attempt++){
          const outcome=await options.execute({...context,commandId:commandId(`${context.commandId}:run:${attempt}`)},job.id);
          if(outcome.status!=='waiting_for_approval'){
            if(outcome.status==='completed')sink.onEvent('agent.token',{delta:typeof outcome.output==='string'?outcome.output:JSON.stringify(outcome.output??null)});
            else if(outcome.error)sink.onEvent('agent.run.error',{message:outcome.error.message});
            return {reason:outcome.status==='completed'?'done':outcome.status==='cancelled'?'cancelled':'error'};
          }
          const approval=runtime.snapshot().approvals?.find(a=>a.jobId===job.id&&a.businessId===context.businessId&&a.status==='pending');
          if(!approval)throw new Error('Awaiting operation has no exact approval');
          let resolve!:()=>void;const answered=new Promise<void>(r=>{resolve=r;});consent.set(approval.id,{jobId:job.id,resolve});
          const timeout=setTimeout(()=>{void runtime.rejectOperation(options.context(),approval.id,'Editor approval timed out').catch(()=>{sink.onEvent('agent.run.error',{message:'Editor approval timeout could not be persisted'});}).finally(()=>{consent.delete(approval.id);resolve();});},120_000);timeout.unref();
          sink.onEvent('permission.prompt',{promptId:approval.id,tool:approval.toolCall.toolId,argsSummary:JSON.stringify(approval.toolCall.input)});
          try{await answered;}finally{clearTimeout(timeout);}
          if(runtime.inspectJob(context,job.id).status!=='running')return {reason:runtime.inspectJob(context,job.id).status==='cancelled'?'cancelled':'refusal'};
        }
        cancel();return {reason:'max_iters'};
      }finally{unsubscribe();active.delete(job.id);}
    }});
  return {handleRpc:(message:unknown)=>core.handleRpc(message),close(){for(const cancel of active.values())cancel();}};
}
