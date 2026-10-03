import { createRequire } from "node:module";
import { ids, type Job } from "@hqoverlord/core";
import { commandId, type CommandContext } from "./command-context.ts";
import {waitFloorJoin} from "./floor-joins.ts";
import type { DurableRuntime } from "./durable-runtime.ts";
import type { ExecutionResult } from "./execution-contracts.ts";
const require=createRequire(import.meta.url);
export interface FloorGeometry {
  readonly props: readonly { readonly id:string;readonly t:string;readonly x:number;readonly y:number;readonly w?:number;readonly h?:number;readonly agentId?:string;readonly [key:string]:unknown }[];
  readonly belts: readonly {readonly x:number;readonly y:number;readonly dir:string}[];
}
export interface FloorWorkflow {readonly id:string;readonly name:string;readonly geometry:FloorGeometry;readonly roundRobin:Readonly<Record<string,number>>;}
export interface FloorWorkItem {readonly id:string;readonly workflowId:string;readonly runId:string;readonly dockId:string;readonly fromDockId?:string;readonly beltPath?:readonly {readonly x:number;readonly y:number}[];readonly agentId:Job['agentId'];readonly jobId:Job['id'];readonly state:'placed'|'working'|'delivered'|'stopped'|'interrupted';readonly updatedAt:string;}
interface Dock {agentId:string;dockId:string;}
interface Plan {errors:readonly unknown[];hash:string;lineLimits:Record<string,unknown>;}
export const floorCompiler=require("../vendor/starnet/frontend/app/pipeline.js") as {
  compileRoutingPlan(geometry:FloorGeometry):Plan;ok(plan:Plan):boolean;
  resolveDock(plan:Plan,ctx:unknown,pick:(key:string,length:number)=>number):Dock|null;
  chainNextDock(plan:Plan,dockId:string,ctx:unknown,pick?:(key:string,length:number)=>number):Dock|null;
  chainStepDock(plan:Plan,dockId:string,ctx:unknown,pick?:(key:string,length:number)=>number):unknown;
  fanSiblingsDock(plan:Plan,dockId:string):readonly Dock[];
  entryDockOf(plan:Plan,agentId:string):string|null;lineOfDock(plan:Plan,dockId:string):string|null;
  composeStageBrief(brief:unknown,hands:unknown):string|null;
  _internals:{nextTiles(map:Record<string,string>,junctions:Record<string,unknown>,tile:{x:number;y:number}):{x:number;y:number}[]};
};
/** Read the actual source compiler's dock hookups and directed lanes for a dispatched handoff's visual path. */
export function floorCratePath(geometry:FloorGeometry,fromDock:string,toDock:string):readonly {x:number;y:number}[]{
  const plan=floorCompiler.compileRoutingPlan(geometry) as Plan&{belts:Record<string,string>;junctions:Record<string,unknown>;dockChains:Record<string,{tile?:{x:number;y:number}}>;bayTileToDock:Record<string,string>};
  const start=plan.dockChains[fromDock]?.tile;if(!start)return [];
  const queue=[{tile:start,path:[start]}],seen=new Set<string>();
  while(queue.length&&seen.size<4096){const item=queue.shift()!,key=item.tile.x+','+item.tile.y;if(seen.has(key))continue;seen.add(key);const dock=plan.bayTileToDock[key];if(dock===toDock)return item.path;if(dock&&dock!==fromDock)continue;
    const next=floorCompiler._internals.nextTiles(plan.belts,plan.junctions,item.tile),gate=plan.junctions[key] as {kind?:string;back?:string}|undefined;
    if(gate?.kind==='loop'&&gate.back){const vector=({E:[1,0],S:[0,1],W:[-1,0],N:[0,-1]} as Record<string,number[]>)[gate.back];if(vector){const tile={x:item.tile.x+vector[0]!,y:item.tile.y+vector[1]!};if(plan.belts[tile.x+','+tile.y])next.push(tile);}}
    for(const tile of next)queue.push({tile,path:[...item.path,tile]});
  }return [];
}
const chains=require("../vendor/starnet/sidecar/routing/chain.js") as {makeChainRunner(options:unknown):{advance(seed:unknown):Promise<{text:string;stopped:string|null;hops:readonly unknown[]}>}};
export function validateFloorGeometry(geometry:FloorGeometry):void {
  if(!geometry||!Array.isArray(geometry.props)||!Array.isArray(geometry.belts)||geometry.props.length>1000||geometry.belts.length>4096)throw new TypeError("Invalid floor geometry");
  const tile=(n:unknown)=>Number.isSafeInteger(n)&&(n as number)>=0&&(n as number)<=1000,names=new Set<string>();
  for(const p of geometry.props){
    if(!p||typeof p.id!=="string"||!/^[A-Za-z0-9_-]{1,80}$/.test(p.id)||["__proto__","constructor","prototype"].includes(p.id)||names.has(p.id)||!["intake","bay","outbox","filter","splitter","merger","joiner","loop"].includes(p.t)||!tile(p.x)||!tile(p.y)||(p.w!==undefined&&(!tile(p.w)||p.w<1))||(p.h!==undefined&&(!tile(p.h)||p.h<1)))throw new TypeError("Invalid floor prop");
    names.add(p.id);
  }
  for(const b of geometry.belts)if(!b||!tile(b.x)||!tile(b.y)||!["E","S","W","N"].includes(b.dir))throw new TypeError("Invalid belt tile");
  if(!floorCompiler.ok(floorCompiler.compileRoutingPlan(geometry)))throw new TypeError("Floor does not compile to an executable graph");
}
/** Actual StarNet geometric compiler/chain walker; every stage is a durable HQ job. */
const lines=new WeakMap<DurableRuntime,Set<string>>();
export async function executeFloorWorkflow(runtime:DurableRuntime,context:CommandContext,workflowId:string,input:string,
  execute:(context:CommandContext,job:Job)=>Promise<ExecutionResult>,options:{readonly completedEntryJobId?:Job["id"];readonly boundAgentId?:import("@hqoverlord/core").AgentId;readonly entryPostconditions?:unknown;readonly tag?:string;readonly signal?:AbortSignal;readonly now?:()=>number}={}) {
  let active=lines.get(runtime);if(!active){active=new Set();lines.set(runtime,active);}const key=JSON.stringify([context.businessId,workflowId,context.commandId]);if(active.has(key))throw new Error('Work line attempt already active');active.add(key);
  const work=executeLine(runtime,context,workflowId,input,execute,options);
  try{return await work;}catch(error){
    const snapshot=runtime.snapshot(),inputId='floor-input:'+context.commandId,resultId='floor-result:'+context.commandId;
    if(snapshot.artifacts?.some(a=>a.businessId===context.businessId&&a.id===inputId)&&!snapshot.artifacts.some(a=>a.businessId===context.businessId&&a.id===resultId))await runtime.createArtifact(context,{id:resultId,category:'draft',contentType:'application/json',content:{workflowId,stopped:'line interrupted; inspect its durable stage jobs',jobs:(runtime.station(context).workItems??[]).filter(w=>w.runId===String(context.commandId)).map(w=>w.jobId),hops:[]},sourceIds:[]});throw error;
  }finally{active.delete(key);}
}
async function executeLine(runtime:DurableRuntime,context:CommandContext,workflowId:string,input:string,
  execute:(context:CommandContext,job:Job)=>Promise<ExecutionResult>,options:{readonly completedEntryJobId?:Job["id"];readonly boundAgentId?:import("@hqoverlord/core").AgentId;readonly entryPostconditions?:unknown;readonly tag?:string;readonly signal?:AbortSignal;readonly now?:()=>number}={}) {
  if(!input.trim()||input.length>12000)throw new TypeError("Work line requires input");
  options.signal?.throwIfAborted();
  const artifactId=`floor-input:${context.commandId}`;
  if(runtime.snapshot().artifacts?.some(a=>a.businessId===context.businessId&&a.id===artifactId))throw new Error("Work line attempt already admitted; use a new attempt");
  const {workflow,dock}=await runtime.admitFloorWorkflow(context,workflowId,options.tag??"general",options.boundAgentId),plan=floorCompiler.compileRoutingPlan(workflow.geometry),jobs:Job[]=[];
  const runId=context.commandId;
  await runtime.createArtifact(context,{id:artifactId,category:"draft",contentType:"application/json",content:{workflowId,input,dockId:dock.dockId},sourceIds:[]});
  let sequence=0;const dockJobs=new Map<string,Job>();
  const counters:Record<string,number>={...workflow.roundRobin},pick=(key:string,length:number)=>{const n=counters[key]??0;counters[key]=n+1;return n%length;};
  const run=async(call:{agentId:string;dockId:string;text:string;signal?:AbortSignal;fromDock?:string|null})=>{
    options.signal?.throwIfAborted();

    const stageContext={...context,commandId:commandId(`${runId}-stage-${sequence++}`)};
    const stage=await runtime.createArtifact(stageContext,{id:`floor-stage:${stageContext.commandId}`,category:"draft",contentType:"application/json",content:{workflowId,dockId:call.dockId,input:call.text,...(jobs.length===0&&options.entryPostconditions?{postconditions:options.entryPostconditions}:{})},sourceIds:[]});
    const firstExisting=jobs.length===0&&options.completedEntryJobId?runtime.inspectJob(context,options.completedEntryJobId):undefined;if(firstExisting&&(firstExisting.status!=='completed'||firstExisting.agentId!==call.agentId||firstExisting.workflowId!==workflowId))throw new Error('Completed owned entry job does not match the addressed dock');
    const job=firstExisting??(await runtime.createJob(stageContext,{agentId:ids.agent(call.agentId),workflowId:ids.workflow(workflowId),objective:call.text.slice(0,12000),inputArtifactIds:[stage.id]})).record;jobs.push(job);dockJobs.set(call.dockId,job);
    const workItem={id:`floor-crate:${stageContext.commandId}`,workflowId,runId:String(runId),dockId:call.dockId,...(call.fromDock?{fromDockId:call.fromDock,beltPath:floorCratePath(workflow.geometry,call.fromDock,call.dockId)}:{}),agentId:job.agentId,jobId:job.id};
    await runtime.saveFloorWorkItem(stageContext,{...workItem,state:"placed"});
    const abort=()=>{void runtime.cancelJob({...stageContext,commandId:commandId(`${stageContext.commandId}-cancel`)},job.id).catch(()=>{});};
    options.signal?.addEventListener("abort",abort,{once:true});
    try {
      const result:ExecutionResult=firstExisting?{status:'completed',output:runtime.snapshot().artifacts!.find(a=>a.businessId===context.businessId&&a.jobId===job.id&&a.id==='job-output:'+job.id)!.content}:await execute({...stageContext,commandId:commandId(`${stageContext.commandId}-run`)},job);
      await runtime.saveFloorWorkItem(stageContext,{...workItem,state:result.status==="completed"?"delivered":"stopped"});
      if(result.status!=="completed")return {error:`stage ${result.status}; resolve its durable job before a new line attempt`};
      const account=runtime.snapshot().modelAccounts?.find(a=>a.businessId===context.businessId&&a.jobId===job.id);
      if(account?.invocations.some(i=>i.status!=="settled"))return {error:"usage unsettled; line stopped to preserve budget truth"};
      const snapshot=runtime.snapshot();
      const nano=(snapshot.meteredExpenses??[]).filter(e=>e.businessId===context.businessId&&e.jobId===job.id).reduce((n,e)=>n+e.cost.nanodollars,0n)
        +(snapshot.ledger??[]).filter(e=>e.businessId===context.businessId&&e.jobId===job.id&&e.kind==='expense'&&e.amount.currency==='USD').reduce((n,e)=>n+e.amount.minorUnits*10_000_000n,0n);
      return {text:typeof result.output==="string"?result.output:JSON.stringify(result.output),usd:Number(nano)/1e9};
    } catch(error){if(['queued','running'].includes(runtime.inspectJob(stageContext,job.id).status))await runtime.cancelJob({...stageContext,commandId:commandId(stageContext.commandId+'-interrupted')},job.id);await runtime.saveFloorWorkItem(stageContext,{...workItem,state:"interrupted"});throw error;} finally {options.signal?.removeEventListener("abort",abort);}
  };
  const first=await run({...dock,text:input});if(first.error){
    const result={text:'',stopped:first.error,jobs:jobs.map(j=>j.id),hops:[]};
    await runtime.createArtifact(context,{id:`floor-result:${runId}`,category:'draft',contentType:'application/json',content:{workflowId,...result},sourceIds:[]});return result;
  }
  const runner=chains.makeChainRunner({
    barrier:{deliver:async(id:string,expected:number,_agentId:string,_text:string,timeoutMin:number,dockId:string)=>{const job=dockJobs.get(dockId);if(!job)throw new Error("Join has no actual stage job");return runtime.deliverFloorJoin(context,{id,workflowId,expected,timeoutMin,jobId:job.id,dockId});},wait:(id:string)=>waitFloorJoin(runtime,context,id,options.signal?{signal:options.signal}:{})},
    nextAgent:(agentId:string,ctx:unknown)=>floorCompiler.chainNextDock(plan,floorCompiler.entryDockOf(plan,agentId)!,ctx,pick),
    stepDock:(dockId:string,ctx:unknown)=>runtime.stepFloorDock(context,workflowId,plan.hash,dockId,ctx),fanSiblingsDock:(dockId:string)=>floorCompiler.fanSiblingsDock(plan,dockId),
    lineOfAgent:(agentId:string,dockId?:string)=>floorCompiler.lineOfDock(plan,dockId??floorCompiler.entryDockOf(plan,agentId)!),
    stageBrief:(_agentId:string,dockId:string)=>{const p=workflow.geometry.props.find(p=>p.id===dockId);return floorCompiler.composeStageBrief(p?.brief,p?.hands);},
    loopGateAfter:(_agentId:string,lineId:string,dockId:string)=>{
      const step=floorCompiler.chainStepDock(plan,dockId,{lineId,tag:options.tag??'general'},(key,length)=>(runtime.station(context).workflows?.find(w=>w.id===workflowId)?.roundRobin[key]??0)%length) as {loop?:string;when?:string}|null;
      return step?.loop?{when:step.when}:null;
    },
    lineLimits:(lineId:string)=>plan.lineLimits[lineId]??null,getTag:(text:string)=>/\bTAG:\s*([a-z0-9_-]+)/i.exec(text)?.[1]??options.tag??"general",
    daySpend:{spentToday:()=>{
      const snapshot=runtime.snapshot(),day=new Date((options.now??Date.now)()).toISOString().slice(0,10),owned=new Set(snapshot.authority.jobs.filter(j=>j.businessId===context.businessId&&j.workflowId===workflowId).map(j=>j.id));
      const nano=(snapshot.meteredExpenses??[]).filter(e=>e.businessId===context.businessId&&owned.has(e.jobId)&&e.occurredAt.slice(0,10)===day).reduce((n,e)=>n+e.cost.nanodollars,0n)
        +(snapshot.ledger??[]).filter(e=>e.businessId===context.businessId&&e.jobId&&owned.has(e.jobId)&&e.occurredAt.slice(0,10)===day&&e.kind==='expense'&&e.amount.currency==='USD').reduce((n,e)=>n+e.amount.minorUnits*10_000_000n,0n);
      return Number(nano)/1e9;
    },note:()=>{}}, // Actual job expenses are already durable; never create a second float ledger.
    runAgent:run,now:options.now??Date.now,newId:()=>`${runId}-hop-${sequence++}`,
  });
  const result=await runner.advance({...dock,text:first.text,originalText:input,lineId:floorCompiler.lineOfDock(plan,dock.dockId),runId,entryUsd:first.usd,signal:options.signal});

  await runtime.createArtifact(context,{id:`floor-result:${runId}`,category:"draft",contentType:"application/json",content:{workflowId,...result,jobs:jobs.map(j=>j.id)},sourceIds:[]});
  return {...result,jobs:jobs.map(j=>j.id)};
}
