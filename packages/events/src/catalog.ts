import type {
  AgentId,
  ApprovalId,
  BusinessId,
  JobId,
  LedgerEntryId,
  OperationId,
  ToolId,
  WorkflowId,
} from "@hqoverlord/core";

/**
 * Historical event payload contracts.
 *
 * These shapes intentionally do not reuse live domain record types.
 * Domain models may evolve; already-recorded facts must retain their
 * original meaning and shape.
 */

export interface BusinessCreatedPayload {
  readonly business: {
    readonly id: BusinessId;
    readonly name: string;
    readonly status: "active" | "paused" | "archived";
    readonly createdAt: string;
    readonly updatedAt: string;
  };
}

export interface AgentCreatedPayload {
  readonly agentId: AgentId;
  readonly name: string;
  readonly status: "idle" | "running" | "paused" | "retired";
  readonly capabilities: readonly string[];
  readonly toolIds: readonly ToolId[];
}

export interface JobCreatedPayload {
  readonly jobId: JobId;
  readonly agentId?: AgentId;
  readonly workflowId?: WorkflowId;
  readonly objective: string;
  readonly status: "queued";
}

export interface JobStartedPayload {
  readonly jobId: JobId;
  readonly agentId?: AgentId;
}

export interface JobCompletedPayload {
  readonly jobId: JobId;
}

export interface JobFailedPayload {
  readonly jobId: JobId;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export interface ApprovalRequestedPayload {
  readonly approval: {
    readonly id: ApprovalId;
    readonly businessId: BusinessId;
    readonly operationId: OperationId;
    readonly jobId?: JobId;
    readonly reason: string;
    readonly status: "pending";
  };
}

export interface ApprovalGrantedPayload {
  readonly approvalId: ApprovalId;
  readonly operationId: OperationId;
}

export interface ApprovalRejectedPayload {
  readonly approvalId: ApprovalId;
  readonly operationId: OperationId;
  readonly reason: string;
}

export interface LedgerEntryRecordedPayload {
  readonly entry: {
    readonly id: LedgerEntryId;
    readonly businessId: BusinessId;
    readonly jobId?: JobId;
    readonly kind: "revenue" | "expense";
    readonly amount: {
      readonly minorUnits: bigint;
      readonly currency: string;
    };
    readonly description: string;
    readonly occurredAt: string;
  };
}

/**
 * Durable facts.
 *
 * Existing event types and payload meanings are additive-only:
 * add new facts rather than silently redefining historical ones.
 */
export interface HQEventPayloadMap {
  readonly "business.created": BusinessCreatedPayload;
  readonly "agent.created": AgentCreatedPayload;
  readonly "job.created": JobCreatedPayload;
  readonly "job.started": JobStartedPayload;
  readonly "job.completed": JobCompletedPayload;
  readonly "job.failed": JobFailedPayload;
  readonly "job.cancelled": { readonly jobId: JobId };
  readonly "approval.requested": ApprovalRequestedPayload;
  readonly "approval.granted": ApprovalGrantedPayload;
  readonly "approval.rejected": ApprovalRejectedPayload;
  readonly "ledger.entry_recorded": LedgerEntryRecordedPayload;
}

export type HQEventType = keyof HQEventPayloadMap;
