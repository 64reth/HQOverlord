import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {ids} from '@hqoverlord/core';
import type {AgentTurnContext} from './execution-contracts.ts';
import type {ToolRegistry} from './tool-registry.ts';
import {commandFingerprint} from './command-fingerprint.ts';
import {responseContract} from './result-contract.ts';
const source=createRequire(import.meta.url)('../vendor/starnet/sidecar/task-postconditions.js') as {
 normalizeContract(input:unknown):{contract:unknown;errors:string[]};assessPostconditions(input:unknown):Promise<{completionVerdict:string;checks:unknown[]}>;
};
export function normalizePostconditions(value:unknown){const result=source.normalizeContract(value);for(const req of (result.contract as {requirements?:{id:string;regex?:string}[]}|null)?.requirements??[])if(req.regex&&!responseContract({type:'json_schema',json_schema:{schema:{type:'string',pattern:req.regex}}}).ok)return {contract:null,errors:[req.id+': connector regex exceeds the bounded safe pattern subset']};return result;}
/** Source fresh-read rule: a host-classified observe must follow an actual act by this run. */
export function nextConnectorReadback(contract:unknown,turn:AgentTurnContext,tools:ToolRegistry){
 const requirements=(normalizePostconditions(contract).contract as {requirements?:{id:string;type:string;connector:string;tool:string;args?:unknown}[]}|null)?.requirements??[];
 for(const req of requirements){if(req.type!=='connector_readback')continue;
  const acted=turn.observations.findLastIndex(o=>o.result.connectorReceipt?.connector===req.connector&&o.result.connectorReceipt.role==='act');if(acted<0)continue;
  if(turn.observations.some((o,i)=>i>acted&&o.result.connectorReceipt?.connector===req.connector&&o.result.connectorReceipt.role==='observe'&&o.result.connectorReceipt.purpose==='postcondition'&&o.result.connectorReceipt.tool===req.tool&&o.result.connectorReceipt.argumentsFingerprint===commandFingerprint(req.args??{})))continue;
  const tool=tools.list().find(t=>t.connectorVerification?.connector===req.connector&&t.connectorVerification.tool===req.tool&&t.connectorVerification.role==='observe'&&turn.agent.toolIds.includes(t.definition.id));
  if(tool)return {id:req.id,call:{kind:'tool' as const,toolId:tool.definition.id,input:structuredClone(req.args??{})},acted};
 }return undefined;
}
/** Only actual receipts qualify as touched files; fresh reads use the owned jailed read tool. */
export async function assessJobPostconditions(contract:unknown,turn:AgentTurnContext,tools:ToolRegistry){
 const artifacts:{kind:string;path:string}[]=[];
 for(const observation of turn.observations){const output=observation.result.output as {receipt?:{path?:string;state?:string}}|null;
  if(output?.receipt?.state==='read-back-verified'&&typeof output.receipt.path==='string')artifacts.push({kind:'file',path:output.receipt.path});
 }
 return source.assessPostconditions({contract,reason:'done',artifacts,evidence:[],effects:turn.observations.filter(o=>o.result.connectorReceipt?.role==='act').map(o=>({domain:'external',connector:o.result.connectorReceipt!.connector})),effectVerdict:'mechanically_verified',uncertainMutations:[],
  readConnector:async(req:{connector:string;tool:string;args?:unknown})=>{const acted=turn.observations.findLastIndex(o=>o.result.connectorReceipt?.connector===req.connector&&o.result.connectorReceipt.role==='act');const observed=turn.observations.findLast((o,i)=>i>acted&&o.result.connectorReceipt?.connector===req.connector&&o.result.connectorReceipt.tool===req.tool&&o.result.connectorReceipt.role==='observe'&&o.result.connectorReceipt.purpose==='postcondition'&&o.result.connectorReceipt.argumentsFingerprint===commandFingerprint(req.args??{}));if(!observed)return {ok:false,code:'fresh_consented_connector_readback_unavailable'};return {ok:true,text:typeof observed.result.output==='string'?observed.result.output:JSON.stringify(observed.result.output)};},
  readArtifact:async(req:{path:string;text?:string})=>{const id=ids.tool('fs.read'),tool=tools.find(id);if(!tool||!turn.agent.toolIds.includes(id)||tool.definition.effect!=='read_only')return null;const result=await tool.execute({path:req.path,raw:true},turn);const content=(result.output as {content?:unknown})?.content;if(typeof content!=='string')return null;return {exists:true,isFile:true,contains:req.text!==undefined&&content.includes(req.text),sha256:createHash('sha256').update(content).digest('hex')};}});
}
