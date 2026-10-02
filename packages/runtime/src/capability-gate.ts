import type {
  Agent,
  ToolId,
} from "@hqoverlord/core";

import {
  RuntimeError,
} from "./runtime-error.ts";

export function requireToolPermission(
  agent: Agent,
  toolId: ToolId,
): void {
  if (!agent.toolIds.includes(toolId)) {
    throw new RuntimeError(
      "BUSINESS_SCOPE_VIOLATION",
      `Agent ${agent.id} is not permitted to use tool ${toolId}`,
    );
  }
}
