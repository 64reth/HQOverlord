import type { AgentId, BusinessId, ToolId } from "./ids.ts";

export type AgentStatus = "idle" | "running" | "paused" | "retired";

export interface Agent {
  readonly id: AgentId;
  readonly businessId: BusinessId;
  readonly name: string;
  readonly status: AgentStatus;
  /** Generic capability labels and executable tool references; no provider configuration. */
  readonly capabilities: readonly string[];
  readonly toolIds: readonly ToolId[];
}
