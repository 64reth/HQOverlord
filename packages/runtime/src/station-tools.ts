import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { ids } from "@hqoverlord/core";
import { correlationId } from "@hqoverlord/events";
import { commandId, type CommandContext } from "./command-context.ts";
import type { DurableRuntime } from "./durable-runtime.ts";
import type { ExecutableTool, ToolExecutionContext } from "./execution-contracts.ts";
import type { ToolRegistry } from "./tool-registry.ts";
import { createWebSearchTool, createToolSearchTool } from './station-discovery.ts';
import {createWebRequestTool,type WebRequestDependencies} from './station-web.ts';

const require = createRequire(import.meta.url);
interface ReferenceTool {
  name: string; description: string; scope: string; requiresConsent?: boolean;
  schema: Record<string, unknown>; run(input: unknown, context: Record<string, unknown>): Promise<unknown>;
}
const fsModule = require("../vendor/starnet/tools/builtin/fs.js") as { makeFsTools(options: unknown): { register(registry: { register(tool: ReferenceTool): void }): void } };
const codeModule = require("../vendor/starnet/tools/builtin/code.js") as { makeCodeTools(options?: unknown): { codeTool: ReferenceTool } };

function command(context: ToolExecutionContext): CommandContext {
  return { businessId: context.businessId, commandId: commandId(`tool-${context.job.id}`),
    correlationId: correlationId(context.job.id), principal: { kind: "agent", id: context.agent.id } };
}
/** Host-generated collision-resistant workspace keys cannot name credentials, another business, or a path. */
export function workspaceKey(context: Pick<ToolExecutionContext,"businessId"|"agent">): string {
  return createHash("sha256").update(JSON.stringify([context.businessId,context.agent.id])).digest("hex").slice(0,40);
}
export function registerStationTools(runtime: DurableRuntime, registry: ToolRegistry, workspaceRoot: string,options:{readonly webKeyFor?:WebRequestDependencies['keyFor']}={}): void {
  registry.register(createWebSearchTool());registry.register(createToolSearchTool(registry));
  registry.register(createWebRequestTool({root:workspaceRoot,...(options.webKeyFor?{keyFor:options.webKeyFor}:{})}));
  const family: ReferenceTool[]=[];
  fsModule.makeFsTools({ fsp, pathMod: path, root: path.resolve(workspaceRoot) }).register({ register(tool) { family.push(tool); } });
  family.push(codeModule.makeCodeTools().codeTool);
  for (const source of family) {
    const tool: ExecutableTool = {
      definition: { id: ids.tool(source.name), name: source.name, description: source.description,
        effect: source.requiresConsent || source.scope !== "read" ? "consequential" : "read_only" },
      inputSchema: source.schema,
      async execute(input, context) {
        context.signal?.throwIfAborted();
        const nested: { toolId: string; output: unknown }[]=[];
        const result = await source.run(input, { agentId: workspaceKey(context), signal: context.signal,
          async composeDispatch(call: {name: string; args: unknown}, control: {signal: AbortSignal}) {
            control.signal.throwIfAborted();
            const id=ids.tool(call.name), executable=registry.require(id);
            const agent=runtime.effectiveAgent(command(context),context.agent.id);
            if (!agent.toolIds.includes(id) || executable.definition.effect !== "read_only" || call.name === "code.run") throw new Error("Nested tool withheld: only currently granted read tools may be composed");
            const observation=await executable.execute(call.args,{...context,agent,signal:control.signal});
            nested.push({toolId:call.name,output:observation.output});return observation.output;
          } });
        context.signal?.throwIfAborted();
        // Reference results contain optional undefined fields; canonical HQ artifacts contain JSON data only.
        return { output: JSON.parse(JSON.stringify(source.name === "code.run" ? { result, nestedObservations: nested } : result)) as unknown };
      },
    };
    registry.register(tool);
  }
}
