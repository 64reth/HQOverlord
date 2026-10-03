import { createRequire } from "node:module";
import {createHash} from "node:crypto";
import type { AgentId, JobId } from "@hqoverlord/core";
import { commandId, type CommandContext } from "./command-context.ts";
import type { DurableRuntime } from "./durable-runtime.ts";
import type { DurableState } from "./durable-state.ts";
import {normalizePostconditions} from "./station-postconditions.ts";
import type { ExecutionResult } from "./execution-contracts.ts";
import {commandFingerprint} from './command-fingerprint.ts';
import {executeFloorWorkflow} from './floor-workflow.ts';
const require=createRequire(import.meta.url);
export interface Recipe {readonly id:string;readonly name:string;readonly task:string;readonly params:readonly {key:string;default?:string;type?:string;label?:string;required?:boolean;options?:readonly string[]}[];readonly sourceJobId?:JobId;readonly forkedFrom?:string;readonly gear?:readonly string[];readonly category?:string;readonly cadence?:string;readonly tags?:Readonly<Record<string,number>>;readonly steps?:readonly string[];readonly acceptance?:readonly Record<string,unknown>[];}
export interface Routine {readonly workflowId?:string;readonly archived?:boolean;readonly id:string;readonly agentId:AgentId;readonly recipeId:string;readonly inputs:Readonly<Record<string,string>>;readonly schedule:Record<string,unknown>;readonly enabled:boolean;readonly nextRunAt?:string;readonly lastRunAt?:string;}
export interface RoutineFire {readonly workflowId?:string;readonly id:string;readonly routineId:string;readonly recipeId?:string;readonly agentId:AgentId;readonly task:string;readonly postconditions?:unknown;readonly scheduledFor:number;readonly jobId?:JobId;readonly status:"pending"|"running"|"completed"|"failed"|"interrupted";}
export interface NightState {v:number;day:number;beatsUsedToday:number;lastBeatAt:number;haltedAt:number;}
export interface RoutineState {
  readonly recipes:readonly Recipe[];readonly routines:readonly Routine[];readonly fires:readonly RoutineFire[];
  readonly dailyLimit:number;readonly day:number;readonly jobsToday:number;readonly halted:boolean;readonly lastUserActivityAt:number;
  readonly night:{readonly enabled:boolean;readonly allowPrivateWrites?:boolean;readonly jobIds?:readonly JobId[];readonly reviews?:readonly {readonly jobId:JobId;readonly verdict:'keep'|'discard'|'later';readonly note:string;readonly at:string}[];readonly learn?:Readonly<Record<string,{up:number;down:number}>>;readonly agentId?:AgentId;readonly leashPerDay:number;readonly state:NightState;readonly beliefs:Readonly<Record<string,readonly {text:string;updatedAt:number}[]>>};
}
export const cron=require("../vendor/starnet/sidecar/cron.js") as {
  parseSchedule(text:string,now:number,options?:unknown):Record<string,unknown>|null;
  nextFireAt(schedule:unknown,last:string|null,now:number,options?:unknown):number|null;
  planTick(jobs:readonly Routine[],now:number):{fire:{jobId:string;scheduledFor:number}[];next:{jobId:string;nextAt:number;prevAt:number}[]};
};
export const nightshift=require("../vendor/starnet/sidecar/nightshift.js") as {
  fresh(now:number):NightState;rollDay(state:NightState,now:number):NightState;recordBeat(state:NightState,now:number):NightState;
  decide(state:NightState,inputs:unknown):{fire:boolean;binding:string|null};
};
interface Candidate {title:string;archetype:string;grounds:string;confidence:string;spec:string;}
export const autopilot=require("../vendor/starnet/frontend/app/autopilot.js") as {
  readiness(summary:unknown,beliefs:unknown,now:number,options?:unknown):{tier:string;usableDims:string[];groundedBy:string|null};
  eligibleArchetypes(dims:readonly string[],options?:unknown):readonly unknown[];
  buildCandidateDirectiveV2(context:unknown):string;parseCandidates(text:string,options:unknown):Candidate[];
  scoreAndSelect(candidates:readonly Candidate[],options?:unknown):{selected:Candidate|null;reason:string};buildDoDirectiveV2(candidate:Candidate,context:unknown):string;
  learnFold(learn:Record<string,{up:number;down:number}>,archetype:string,useful:boolean):Record<string,{up:number;down:number}>;learnWeightsFrom(learn:unknown):Record<string,number>;
};
export const recipeLibrary=require("../vendor/starnet/frontend/app/recipes.js") as {builtins():readonly Recipe[];exportRecipe(recipe:Recipe):Record<string,unknown>;validateImport(value:unknown):{ok:boolean;recipe?:Recipe;error?:string};fillTask(recipe:Recipe,values:unknown):string|null;postconditionsFor(recipe:Recipe,values:unknown):unknown};
const recipes=recipeLibrary;
export const recipePostconditions=(recipe:Recipe,values:Readonly<Record<string,string>>)=>recipes.postconditionsFor(recipe,values);
export const fillRecipe=(recipe:Recipe,inputs:Readonly<Record<string,string>>):string=>recipes.fillTask(recipe,inputs)??"";
export function initialRoutines(now:number):RoutineState {
  return {recipes:[],routines:[],fires:[],dailyLimit:10,day:Math.floor(now/86400000),jobsToday:0,halted:false,lastUserActivityAt:now,
    night:{enabled:false,leashPerDay:1,state:nightshift.fresh(now),beliefs:{}}};
}
export function validateRoutineState(value:RoutineState,state:DurableState,businessId:string):void {
  const refuse=()=>{throw new TypeError("Invalid durable routine state");};
  const unique=(list:readonly {id:string}[])=>{if(!Array.isArray(list)||new Set(list.map(x=>x.id)).size!==list.length)refuse();};
  if(!value||!Number.isSafeInteger(value.dailyLimit)||value.dailyLimit<0||value.dailyLimit>1000||!Number.isSafeInteger(value.jobsToday)||value.jobsToday<0||!Number.isSafeInteger(value.day)||typeof value.halted!=="boolean"||!Number.isFinite(value.lastUserActivityAt))refuse();
  unique(value.recipes);unique(value.routines);unique(value.fires);
  if(value.night?.allowPrivateWrites!==undefined&&typeof value.night.allowPrivateWrites!=='boolean')refuse();
  if(value.night?.jobIds&&(!Array.isArray(value.night.jobIds)||value.night.jobIds.some(id=>!state.authority.jobs.some(j=>j.id===id&&j.businessId===businessId&&j.agentId===value.night.agentId))))refuse();
  const owned=(id:string)=>state.authority.agents.some(a=>a.id===id&&a.businessId===businessId);
  for(const recipe of value.recipes){
    if(recipe.gear&&(!Array.isArray(recipe.gear)||recipe.gear.some(g=>!['dish','cabinet','workbench','notebook','computer','connector','studio'].includes(g)))||recipe.category!==undefined&&typeof recipe.category!=='string'||recipe.cadence!==undefined&&typeof recipe.cadence!=='string'||recipe.forkedFrom!==undefined&&(typeof recipe.forkedFrom!=='string'||recipe.forkedFrom.length>200))refuse();
    if(recipe.steps&&(!Array.isArray(recipe.steps)||recipe.steps.length>12||recipe.steps.some(step=>typeof step!=="string"||step.length>240)))refuse();
    if(recipe.acceptance?.length&&normalizePostconditions(recipePostconditions(recipe,{})).errors.length)refuse();
    if(typeof recipe.id!=="string"||!recipe.id.trim()||typeof recipe.name!=="string"||!recipe.name.trim()||typeof recipe.task!=="string"||!recipe.task.trim()||recipe.task.length>12000||!Array.isArray(recipe.params)||recipe.params.some(p=>!p||!/^[A-Za-z0-9_]{1,64}$/.test(p.key)||["__proto__","constructor","prototype"].includes(p.key))||recipe.sourceJobId&&!state.authority.jobs.some(j=>j.id===recipe.sourceJobId&&j.businessId===businessId&&j.status==="completed"))refuse();
  }
  for(const routine of value.routines){if(routine.workflowId&&!state.stations?.find(s=>s.businessId===businessId)?.workflows?.some(w=>w.id===routine.workflowId))refuse();if(routine.archived!==undefined&&(typeof routine.archived!=="boolean"||routine.archived&&routine.enabled))refuse();if(!owned(routine.agentId)||!value.recipes.some(r=>r.id===routine.recipeId)||typeof routine.enabled!=="boolean"||!routine.schedule||!cron.nextFireAt(routine.schedule,null,0)&&routine.schedule.kind!=="once"||Object.values(routine.inputs).some(s=>typeof s!=="string"))refuse();}
  for(const fire of value.fires){if(fire.workflowId&&!state.stations?.find(s=>s.businessId===businessId)?.workflows?.some(w=>w.id===fire.workflowId))refuse();if(!owned(fire.agentId)||!value.routines.some(r=>r.id===fire.routineId)||!Number.isFinite(fire.scheduledFor)||typeof fire.task!=="string"||!["pending","running","completed","failed","interrupted"].includes(fire.status)||fire.jobId&&!state.authority.jobs.some(j=>j.id===fire.jobId&&j.businessId===businessId&&j.agentId===fire.agentId))refuse();}
  const night=value.night;if(!night||typeof night.enabled!=="boolean"||!Number.isSafeInteger(night.leashPerDay)||night.leashPerDay<0||night.leashPerDay>100||night.agentId&&!owned(night.agentId)||!night.state||![night.state.day,night.state.beatsUsedToday,night.state.lastBeatAt,night.state.haltedAt].every(n=>Number.isSafeInteger(n)&&n>=0)||!night.beliefs)refuse();
  if(night.reviews&&(!Array.isArray(night.reviews)||new Set(night.reviews.map(r=>r.jobId)).size!==night.reviews.length||night.reviews.some(r=>!state.authority.jobs.some(j=>j.id===r.jobId&&j.businessId===businessId)||!['keep','discard','later'].includes(r.verdict)||typeof r.note!=='string'||r.note.length>2000||!Number.isFinite(Date.parse(r.at)))))refuse();
  if(night.learn&&Object.entries(night.learn).some(([key,value])=>!/^[-a-z0-9_]{1,80}$/.test(key)||['constructor','prototype','__proto__'].includes(key)||![value.up,value.down].every(n=>Number.isSafeInteger(n)&&n>=0)))refuse();
  for(const beliefs of Object.values(night.beliefs))if(!Array.isArray(beliefs)||beliefs.some(b=>typeof b.text!=="string"||b.text.length>4000||!Number.isFinite(b.updatedAt)))refuse();
}

const leasedFires=new WeakMap<DurableRuntime,Set<string>>();
const routineTicks=new WeakMap<DurableRuntime,Map<string,Promise<void>>>();
/** Serialize host ticks per business so two controllers cannot claim the same pending run. */
export async function runRoutineTick(runtime:DurableRuntime,context:CommandContext,execute:(context:CommandContext,jobId:JobId)=>Promise<ExecutionResult>):Promise<void>{
  let ticks=routineTicks.get(runtime);if(!ticks){ticks=new Map();routineTicks.set(runtime,ticks);}
  const prior=ticks.get(context.businessId)??Promise.resolve();
  const next=prior.catch(()=>{}).then(()=>prepareRoutineTick(runtime,context,execute));const admission=next.then(()=>{});ticks.set(context.businessId,admission);
  let work:Promise<void>[];try{work=await next;}finally{if(ticks.get(context.businessId)===admission)ticks.delete(context.businessId);}await Promise.all(work);
}
/** No automatic replay of an interrupted paid run. A pending ticket can recover its still-queued job. */
async function prepareRoutineTick(runtime:DurableRuntime,context:CommandContext,execute:(context:CommandContext,jobId:JobId)=>Promise<ExecutionResult>):Promise<Promise<void>[]>{
  const work:Promise<void>[]=[];let leases=leasedFires.get(runtime);if(!leases){leases=new Set();leasedFires.set(runtime,leases);}
  await runtime.claimRoutineTick(context);
  const state=runtime.station(context).routineState;if(!state||state.halted)return work;
  for(const fire of state.fires.filter(f=>f.status==="pending"||f.status==="running")){
    const lease=JSON.stringify([context.businessId,fire.id]);if(leases.has(lease))continue;
    if(fire.workflowId){
      const lineContext={...context,commandId:commandId('routine:'+fire.id+':line')};
      if(fire.status==='running'||runtime.snapshot().artifacts?.some(a=>a.businessId===context.businessId&&a.id==='floor-input:'+lineContext.commandId)){await runtime.settleRoutineFire(context,fire.id,fire.jobId,'interrupted');continue;}
      await runtime.settleRoutineFire(context,fire.id,undefined,'running');leases.add(lease);let first:JobId|undefined;
      const task=executeFloorWorkflow(runtime,lineContext,fire.workflowId,fire.task,async(c,job)=>{if(!first){first=job.id;await runtime.settleRoutineFire(context,fire.id,job.id,'running');}return execute(c,job.id);},{boundAgentId:fire.agentId,...(fire.postconditions?{entryPostconditions:fire.postconditions}:{})}).then(async result=>{await runtime.settleRoutineFire(context,fire.id,first,result.stopped?'failed':'completed');},async()=>{await runtime.settleRoutineFire(context,fire.id,first,'interrupted');}).finally(()=>leases!.delete(lease));work.push(task);continue;
    }
    const jobContext={...context,commandId:commandId(`routine:${fire.id}`)};
    const admitted=runtime.snapshot().processedCommands.find(c=>c.businessId===context.businessId&&c.commandId===jobContext.commandId&&c.result.kind==='job');
    const existing=admitted?runtime.inspectJob(context,admitted.result.recordId as JobId):undefined;
    if(existing&&(existing.agentId!==fire.agentId||existing.objective!==fire.task||fire.postconditions&&!runtime.jobInputs(context,existing.id).some(a=>commandFingerprint((a.content as {postconditions?:unknown})?.postconditions??null)===commandFingerprint(normalizePostconditions(fire.postconditions).contract))))throw new Error('Recovered routine job does not match its captured admission');
    const job=fire.jobId?runtime.inspectJob(context,fire.jobId):existing??(await runtime.createRecipeJob(jobContext,fire.agentId,fire.task,fire.postconditions,fire.recipeId)).record;
    if(runtime.isJobActive(context,job.id))continue;
    if(job.status==="running"){await runtime.settleRoutineFire(context,fire.id,job.id,"interrupted");continue;}
    if(job.status!=="queued"){await runtime.settleRoutineFire(context,fire.id,job.id,job.status==="completed"?"completed":"failed");continue;}
    await runtime.settleRoutineFire(context,fire.id,job.id,"running");
    leases.add(lease);
    const task=Promise.resolve().then(()=>execute({...context,commandId:commandId(`routine:${fire.id}:run`)},job.id)).then(async outcome=>{await runtime.settleRoutineFire(context,fire.id,job.id,outcome.status==="completed"?"completed":outcome.status==="waiting_for_approval"?"interrupted":"failed");},async()=>{await runtime.settleRoutineFire(context,fire.id,job.id,"failed");}).finally(()=>leases!.delete(lease));
    work.push(task);
  }
  return work;
}

export async function runNightShiftTick(runtime:DurableRuntime,context:CommandContext,execute:(context:CommandContext,jobId:JobId,reasonOnly?:boolean)=>Promise<ExecutionResult>){
  const claimed=await runtime.claimNightShift(context);if(!claimed)return {binding:"gated"};
  const {agentId,beliefs,activity,eligible,runId}=claimed;
  const propose=(await runtime.createJob({...context,commandId:commandId(`${runId}:propose`)},{agentId,objective:autopilot.buildCandidateDirectiveV2({beliefs,activity,eligible,initiative:"leash"}).slice(0,12000)})).record;
  const candidates=await execute({...context,commandId:commandId(`${runId}:propose:run`)},propose.id,true);
  if(candidates.status!=="completed")return {binding:"proposal-failed"};
  const parsed=autopilot.parseCandidates(String(candidates.output),{beliefs,activity,eligible,requireGrounding:true});
  const selected=autopilot.scoreAndSelect(parsed,{weights:autopilot.learnWeightsFrom(runtime.station(context).routineState?.night.learn)});if(!selected.selected)return {binding:selected.reason};
  if(runtime.station(context).routineState?.halted)return {binding:"halt"};
  const workshopDir="workshop/"+createHash("sha256").update(JSON.stringify([context.businessId,runId])).digest("hex").slice(0,40);
  const job=(await runtime.createJob({...context,commandId:commandId(`${runId}:act`)},{agentId,objective:autopilot.buildDoDirectiveV2(selected.selected,{runId,dir:workshopDir,initiative:"leash"}).slice(0,12000)})).record;
  await runtime.bindNightShiftJob({...context,commandId:commandId(`${runId}:act`)},job.id);
  const outcome=await execute({...context,commandId:commandId(`${runId}:act:run`)},job.id);
  await runtime.createArtifact(context,{id:`nightshift:${runId}`,jobId:job.id,category:"draft",contentType:"application/json",content:{candidate:selected.selected,status:outcome.status,proposalJobId:propose.id,workshopDir},sourceIds:[]});
  return {binding:null,jobId:job.id,status:outcome.status};
}
