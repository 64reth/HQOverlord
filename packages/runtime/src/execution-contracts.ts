import type {
  Agent,
  BusinessId,
  Job,
  Tool,
  ToolId,
} from "@hqoverlord/core";

export interface ToolExecutionContext {
  readonly businessId: BusinessId;
  readonly job: Job;
  readonly agent: Agent;
  readonly signal?: AbortSignal;
}

export interface ToolResult {
  readonly output: unknown;
}

export interface ExecutableTool {
  readonly inputSchema?: Readonly<Record<string, unknown>>;
  readonly definition: Tool;

  execute(
    input: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolResult>;
}

export interface ToolCall {
  readonly kind: "tool";
  readonly toolId: ToolId;
  readonly input: unknown;
}

export interface CompleteAction {
  readonly kind: "complete";
  readonly output: unknown;
}

export type AgentAction =
  | ToolCall
  | CompleteAction;

export interface AgentObservation {
  readonly toolId: ToolId;
  readonly result: ToolResult;
}

export interface AgentTurnContext {
  readonly signal?: AbortSignal;
  readonly businessId: BusinessId;
  readonly job: Job;
  readonly agent: Agent;
  readonly observations: readonly AgentObservation[];
}

export interface AgentDriver {
  next(
    context: AgentTurnContext,
  ): Promise<AgentAction>;
}

export interface ExecutionResult {
  readonly status: "completed" | "failed" | "cancelled" | "waiting_for_approval";
  readonly pendingTool?: ToolCall;
  readonly output?: unknown;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}
