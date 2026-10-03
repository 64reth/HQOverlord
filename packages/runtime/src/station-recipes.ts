import {createRequire} from 'node:module';
import type {BusinessId} from '@hqoverlord/core';
import type {DurableState} from './durable-state.ts';
import {stationIn} from './station-state.ts';
import {recipeLibrary,type Recipe} from './station-routines.ts';
const require=createRequire(import.meta.url);
const drift=require('../vendor/starnet/sidecar/recipe-drift.js') as {assessDrift(rows:readonly unknown[]):{status:string;baselineRuns:number;signals:{code:string}[];[key:string]:unknown}};
const fit=require('../vendor/starnet/frontend/app/recipefit.js') as {offers(recipes:readonly Recipe[],context:unknown):unknown;basis(context:unknown):string};
export const recipeTemplates=recipeLibrary.builtins();
export const exportRecipe=recipeLibrary.exportRecipe;
/** SOURCE strips foreign execution state; the operator supplies a fresh owned identity. */
export function importRecipe(id:string,input:unknown):Recipe{
 const parsed=recipeLibrary.validateImport(input);if(!parsed.ok||!parsed.recipe)throw new TypeError(parsed.error??'Invalid recipe');const r=parsed.recipe;
 return {id,name:r.name,task:r.task,params:r.params,steps:r.steps??[],acceptance:r.acceptance??[],...(r.forkedFrom?{forkedFrom:r.forkedFrom}:{}),...(r.gear?{gear:r.gear}:{}),...(r.category?{category:r.category}:{}),...(r.cadence?{cadence:r.cadence}:{}),...(r.tags?{tags:r.tags}:{})};
}
export function recipeEvidence(state:DurableState,businessId:BusinessId,connectedChannelIds:readonly string[]=[]){
 const station=stationIn(state,businessId),recipes=station.routineState?.recipes??[],artifacts=state.artifacts??[];
 const rows=state.authority.jobs.filter(j=>j.businessId===businessId&&['completed','failed','cancelled'].includes(j.status)).flatMap(job=>{
  const input=artifacts.find(a=>a.businessId===businessId&&job.inputArtifactIds?.includes(a.id)&&a.id.startsWith('recipe-input:')),recipeId=(input?.content as {recipeId?:string})?.recipeId;if(!recipeId)return [];
  const execution=state.executions?.find(e=>e.jobId===job.id&&e.businessId===businessId),account=state.modelAccounts?.find(a=>a.jobId===job.id&&a.businessId===businessId),known=!!account?.invocations.length&&account.invocations.every(i=>i.status==='settled'&&i.usage);
  const nano=(state.meteredExpenses??[]).filter(e=>e.jobId===job.id&&e.businessId===businessId).reduce((n,e)=>n+e.cost.nanodollars,0n),cents=(state.ledger??[]).filter(e=>e.jobId===job.id&&e.businessId===businessId&&e.kind==='expense'&&e.amount.currency==='USD').reduce((n,e)=>n+e.amount.minorUnits,0n);
  const verification=artifacts.find(a=>a.businessId===businessId&&a.id==='postcondition-verdict:'+job.id)??artifacts.filter(a=>a.businessId===businessId&&a.jobId===job.id&&a.id.startsWith('postcondition-check:')).at(-1);
  return [{runId:job.id,recipeId,order:state.facts.findLastIndex(f=>f.businessId===businessId&&['job.completed','job.failed','job.cancelled'].includes(f.type)&&(f.payload as {jobId?:string}).jobId===job.id),ts:Date.parse(execution?.finishedAt??'')||0,reason:job.status==='completed'?'done':job.status==='cancelled'?'cancelled':'error',completionEvidence:verification?.content,toolTrace:execution?.observations.map(o=>({name:o.toolId}))??[],model:account?.invocations.at(-1)?.usage?.model??'',...(known?{usd:Number(nano)/1e9+Number(cents)/100}:{}),costKnown:known,turns:execution?.turns??0}];
 }).sort((a,b)=>b.ts-a.ts||b.order-a.order);
 const verdicts=Object.fromEntries(recipes.map(recipe=>{const history=rows.filter(r=>r.recipeId===recipe.id),value=drift.assessDrift(history),costKnown=history.every(r=>r.costKnown);if(!costKnown){value.signals=value.signals.filter(s=>s.code!=='cost_spike');if(value.status!=='insufficient')value.status=value.signals.length?'drift':'steady';}return [recipe.id,{...value,costKnown}];}));
 const launches=Object.fromEntries(recipes.map(r=>[r.id,{n:rows.filter(row=>row.recipeId===r.id).length}])),channels=(station.channels??[]).filter(c=>c.enabled&&connectedChannelIds.includes(c.id)).map(c=>({label:c.id}));
 // Configured channels are not connected ones. Private folders do not prove external project grants.
 const context={projects:[],topics:[],channels,launches,scheduled:station.routineState?.routines.filter(r=>r.enabled)??[]};
 return {drift:verdicts,offers:fit.offers([...recipes,...recipeTemplates],context),basis:fit.basis(context)};
}
