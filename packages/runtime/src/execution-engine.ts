import type {
  Agent,
  Job,
} from "@hqoverlord/core";

import {
  requireToolPermission,
} from "./capability-gate.ts";

import type {
  AgentDriver,
  AgentObservation,
  ExecutionResult,
  ToolCall,
  ToolResult,
} from "./execution-contracts.ts";

import {
  RuntimeError,
  PersistenceBoundaryError,
} from "./runtime-error.ts";

import {
  ToolRegistry,
} from "./tool-registry.ts";

export interface ExecutionEngineOptions {
  readonly maxTurns?: number;
}

export interface ExecutionControls {
  resolveAgent?(): Agent;
  readonly signal?: AbortSignal;
  readonly observations?: readonly AgentObservation[];
  readonly turns?: number;
  readonly pendingTool?: ToolCall;
  beforeTool?(call: ToolCall, turns: number): Promise<boolean>;
  afterTool?(call: ToolCall, result: ToolResult): Promise<ToolResult|void>;
}

export class ExecutionEngine {
  readonly #tools: ToolRegistry;
  readonly #maxTurns: number;

  constructor(
    tools: ToolRegistry,
    options: ExecutionEngineOptions = {},
  ) {
    this.#tools = tools;
    this.#maxTurns =
      options.maxTurns ?? 20;

    if (
      !Number.isInteger(this.#maxTurns) ||
      this.#maxTurns < 1
    ) {
      throw new TypeError(
        "maxTurns must be a positive integer",
      );
    }
  }

  async execute(
    job: Job,
    agent: Agent,
    driver: AgentDriver,
    controls: ExecutionControls = {},
  ): Promise<ExecutionResult> {
    if (job.businessId !== agent.businessId) {
      throw new RuntimeError(
        "BUSINESS_SCOPE_VIOLATION",
        "Job and agent belong to different businesses",
      );
    }

    if (
      job.agentId !== undefined &&
      job.agentId !== agent.id
    ) {
      throw new RuntimeError(
        "BUSINESS_SCOPE_VIOLATION",
        "Job is assigned to a different agent",
      );
    }

    const observations: AgentObservation[] = [...(controls.observations ?? [])];
    let pending = controls.pendingTool;
    let boundaryFailed = false;

    try {
      for (
        let turn = controls.turns ?? 0;
        pending !== undefined || turn < this.#maxTurns;
        turn += 1
      ) {
        if (controls.signal?.aborted) return { status: "cancelled" };
        const liveAgent = controls.resolveAgent?.() ?? agent;
        if (liveAgent.businessId !== job.businessId || liveAgent.id !== agent.id) throw new RuntimeError("BUSINESS_SCOPE_VIOLATION", "Execution identity changed");
        const resuming = pending !== undefined;
        const action = structuredClone(pending ?? await driver.next({
          businessId: job.businessId,
          job,
          agent: liveAgent,
          observations: [...observations],
          ...(controls.signal ? { signal: controls.signal } : {}),
        }));
        pending = undefined;
        if (resuming) turn -= 1;
        if (controls.signal?.aborted) return { status: "cancelled" };

        if (action.kind === "complete") {
          return {
            status: "completed",
            output: action.output,
          };
        }

        requireToolPermission(
          liveAgent,
          action.toolId,
        );

        const tool =
          this.#tools.require(action.toolId);

        // Invalid calls must never acquire consent or a dispatched checkpoint.
        this.#tools.validateArguments(action.toolId, action.input);

        let allowed = tool.definition.effect !== "consequential";
        if (controls.beforeTool) {
          try { allowed = await controls.beforeTool(action, turn + 1); }
          catch (error) { boundaryFailed = true; throw error; }
        }
        if (controls.signal?.aborted) return { status: "cancelled" };
        if (!allowed) return { status: "waiting_for_approval", pendingTool: action };

        let result = await tool.execute(
          structuredClone(action.input),
          {
            businessId: job.businessId,
            job,
            agent: liveAgent,
            ...(controls.signal ? { signal: controls.signal } : {}),
          },
        );

        if (controls.afterTool) {
          try { const recorded=await controls.afterTool(action, result);if(recorded)result=recorded; }
          catch (error) { boundaryFailed = true; throw error; }
        }

        observations.push({
          toolId: action.toolId,
          result,
        });
      }

      return {
        status: "failed",
        error: {
          code: "MAX_TURNS_EXCEEDED",
          message:
            `Execution exceeded ${this.#maxTurns} turns`,
        },
      };
    } catch (error) {
      if (boundaryFailed || error instanceof PersistenceBoundaryError) throw error;
      if (controls.signal?.aborted) return { status: "cancelled" };
      return {
        status: "failed",
        error: {
          code:
            error instanceof RuntimeError
              ? error.code
              : "EXECUTION_FAILED",

          message:
            error instanceof Error
              ? error.message
              : "Unknown execution failure",
        },
      };
    }
  }
}
