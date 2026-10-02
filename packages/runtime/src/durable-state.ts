import type { HQEvent } from "@hqoverlord/events";
import type { Approval, AgentId, BusinessId, JobId, OperationId } from "@hqoverlord/core";
import type { AgentObservation, ExecutionResult, ToolCall } from "./execution-contracts.ts";
import type { LedgerEntry } from "@hqoverlord/core";
import type { JobModelAccount } from "./model-state.ts";
import type { MeteredExpense } from "./metered-cost.ts";

export interface DurableExecution {
  readonly jobId: JobId;
  readonly businessId: BusinessId;
  readonly agentId: AgentId;
  readonly turns: number;
  readonly maxTurns: number;
  readonly observations: readonly AgentObservation[];
  readonly status: "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
  readonly outcome?: ExecutionResult;
  readonly operation?: {
    readonly id: OperationId;
    readonly call: ToolCall;
    readonly dispatched: boolean;
    readonly approvalId?: Approval["id"];
  };
}

export interface DurableApproval extends Approval {
  /** Immutable input captured before consent; retained after the operation settles. */
  readonly toolCall: ToolCall;
}

import type {
  AuthoritySnapshot,
} from "./authority-store.ts";

export const DURABLE_STATE_VERSION = 1 as const;

export type ProcessedCommandResult =
  | {
      readonly kind: "agent";
      readonly recordId: string;
    }
  | {
      readonly kind: "job";
      readonly recordId: string;
    };

export interface ProcessedCommand {
  readonly commandId: string;
  readonly businessId: string;

  /**
   * Stable representation of the successful command input.
   * Reusing a command ID with different input is a conflict.
   */
  readonly inputFingerprint: string;

  readonly eventIds: readonly string[];
  readonly result: ProcessedCommandResult;
}

export interface DurableState {
  readonly sources?: readonly import("./knowledge.ts").Source[];
  readonly artifacts?: readonly import("./knowledge.ts").Artifact[];
  readonly knowledge?: readonly import("./knowledge.ts").KnowledgeFact[];
  readonly version: typeof DURABLE_STATE_VERSION;
  readonly authority: AuthoritySnapshot;
  readonly facts: readonly HQEvent[];
  readonly processedCommands: readonly ProcessedCommand[];
  readonly approvals?: readonly DurableApproval[];
  readonly executions?: readonly DurableExecution[];
  readonly modelAccounts?: readonly JobModelAccount[];
  readonly ledger?: readonly LedgerEntry[];
  readonly meteredExpenses?: readonly MeteredExpense[];
}

export function emptyDurableState(): DurableState {
  return {
    version: DURABLE_STATE_VERSION,
    authority: {
      businesses: [],
      agents: [],
      jobs: [],
    },
    facts: [],
    processedCommands: [],
  };
}
