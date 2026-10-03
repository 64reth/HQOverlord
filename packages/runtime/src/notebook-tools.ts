import { ids } from "@hqoverlord/core";
import { commandId } from "./command-context.ts";
import { correlationId } from "@hqoverlord/events";
import type { DurableRuntime } from "./durable-runtime.ts";
import type { ExecutableTool, ToolExecutionContext } from "./execution-contracts.ts";
import {createRequire} from 'node:module';
import {memoryContext,referenceRecords} from './station-memory.ts';
const require=createRequire(import.meta.url);
interface SourceTool {name:string;description:string;schema:Record<string,unknown>;run(input:unknown,context:unknown):Promise<unknown>;}
const source=require('../vendor/starnet/tools/builtin/notebook.js') as {makeNotebookTools(options:unknown):{readTool:SourceTool;writeTool:SourceTool;feedbackTool:SourceTool}};

/** Matches StarNet's notebook scope: the executing agent owns the mutable notebook. */
export function notebookTools(runtime: DurableRuntime): readonly ExecutableTool[] {
  const context = (execution: ToolExecutionContext) => ({ businessId: execution.businessId,
    commandId: commandId(`notebook:${execution.job.id}`), correlationId: correlationId(`job:${execution.job.id}`),
    principal: { kind: "agent" as const, id: execution.agent.id } });
  const carried=(name:'readTool'|'writeTool'|'feedbackTool',input:unknown,execution:ToolExecutionContext)=>{
    const ctx=context(execution),agentId=execution.agent.id,station=runtime.station(ctx);
    const channel=station.channelMessages?.find(m=>m.jobId===execution.job.id),fire=station.routineState?.fires.find(f=>f.jobId===execution.job.id);
    const origin=channel?`channel:${station.channels?.find(c=>c.id===channel.channelId)?.kind}`:station.routineState?.night.jobIds?.includes(execution.job.id)?'nightshift':fire?'schedule':'commander';
    const tools=source.makeNotebookTools({clock:{now:()=>Date.parse(runtime.currentTime())},redact:memoryContext.redact,rank:memoryContext.rank,
      store:{get:()=>referenceRecords(runtime.notebook(ctx,agentId)),update:(_key:string,mutate:(records:Record<string,unknown>[])=>Record<string,unknown>[]|undefined)=>runtime.updateNotebookRecords(ctx,agentId,mutate)}});
    return tools[name].run(input,{agentId,runId:execution.job.id,streamId:execution.job.workflowId??execution.job.id,origin});
  };
  const shapes=source.makeNotebookTools({store:{get:()=>[]}});
  return [{ definition: { id: ids.tool("notebook.read"), name: "notebook.read", description: shapes.readTool.description, effect: "read_only" },
    inputSchema: shapes.readTool.schema,
    async execute(input, execution) { const query=(input as {query?:string})?.query;return { output:query?await carried('readTool',input,execution):runtime.notebook(context(execution),execution.agent.id) }; } },
  { definition: { id: ids.tool("notebook.write"), name: "notebook.write", description: shapes.writeTool.description+" Legacy named entries accept key/text.", effect: "internal_write" },
    inputSchema: { type: "object", properties: { ...shapes.writeTool.schema.properties as Record<string,unknown>,key: { type: "string" }, text: { type: "string" } }, additionalProperties: false },
    async execute(input, execution) {
      if(input&&typeof input==='object'&&'body' in input){if(typeof (input as {title?:unknown}).title!=='string'||typeof (input as {body?:unknown}).body!=='string')throw new TypeError('Notebook title/body required');return {output:await carried('writeTool',input,execution)};}
      const value = input as { key?: unknown; text?: unknown };
      if (!value || typeof value.key !== "string" || typeof value.text !== "string") throw new TypeError("Notebook key/text required");
      const station=runtime.station(context(execution)),channel=station.channelMessages?.find(m=>m.jobId===execution.job.id),fire=station.routineState?.fires.find(f=>f.jobId===execution.job.id);
      await runtime.writeNotebook(context(execution),execution.agent.id,value.key,value.text,{sourceRunId:execution.job.id,origin:channel?'channel:'+station.channels?.find(c=>c.id===channel.channelId)?.kind:station.routineState?.night.jobIds?.includes(execution.job.id)?'nightshift':fire?'schedule':'commander'});
      return { output: { saved: true, key: value.key } };
    } },{definition:{id:ids.tool('notebook.feedback'),name:'notebook.feedback',description:shapes.feedbackTool.description,effect:'internal_write'},inputSchema:shapes.feedbackTool.schema,
      async execute(input,execution){return {output:await carried('feedbackTool',input,execution)};}}];
}
