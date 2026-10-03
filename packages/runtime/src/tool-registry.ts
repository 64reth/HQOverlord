import type {
  ToolId,
} from "@hqoverlord/core";

import type {
  ExecutableTool,
} from "./execution-contracts.ts";
import { createRequire } from "node:module";
const schema=createRequire(import.meta.url)("../vendor/starnet/shared/schema.js") as {validate(schema:unknown,value:unknown):{ok:boolean;errors:readonly string[]}};

import {
  RuntimeError,
} from "./runtime-error.ts";

export class ToolRegistry {
  readonly #tools =
    new Map<ToolId, ExecutableTool>();

  register(tool: ExecutableTool): void {
    if(tool.connectorVerification&&tool.definition.effect!=='consequential')throw new TypeError('Connector verification must use an exact-consented operation');
    if (this.#tools.has(tool.definition.id)) {
      throw new RuntimeError(
        "INVALID_STATE",
        `Tool ${tool.definition.id} is already registered`,
      );
    }

    this.#tools.set(
      tool.definition.id,
      { ...tool, async execute(input,context){
        const checked=schema.validate(tool.inputSchema??{},input);
        if(!checked.ok)throw new RuntimeError("INVALID_STATE","Tool arguments do not match the installed schema");
        return tool.execute(input,context);
      } },
    );
  }

  find(toolId: ToolId): ExecutableTool | undefined {
    return this.#tools.get(toolId);
  }

  list(): readonly ExecutableTool[] { return [...this.#tools.values()]; }

  validateArguments(toolId: ToolId, input: unknown): void {
    if (!schema.validate(this.require(toolId).inputSchema ?? {}, input).ok) {
      throw new RuntimeError("INVALID_STATE", "Tool arguments do not match the installed schema");
    }
  }

  require(toolId: ToolId): ExecutableTool {
    const tool = this.#tools.get(toolId);

    if (tool === undefined) {
      throw new RuntimeError(
        "INVALID_STATE",
        `Tool ${toolId} is not registered`,
      );
    }

    return tool;
  }
}
