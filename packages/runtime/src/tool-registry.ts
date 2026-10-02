import type {
  ToolId,
} from "@hqoverlord/core";

import type {
  ExecutableTool,
} from "./execution-contracts.ts";

import {
  RuntimeError,
} from "./runtime-error.ts";

export class ToolRegistry {
  readonly #tools =
    new Map<ToolId, ExecutableTool>();

  register(tool: ExecutableTool): void {
    if (this.#tools.has(tool.definition.id)) {
      throw new RuntimeError(
        "INVALID_STATE",
        `Tool ${tool.definition.id} is already registered`,
      );
    }

    this.#tools.set(
      tool.definition.id,
      tool,
    );
  }

  find(toolId: ToolId): ExecutableTool | undefined {
    return this.#tools.get(toolId);
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
