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
  readonly "artifact.created.v1": { readonly artifactId: string; readonly jobId?: JobId; readonly category: string };
  readonly "source.recorded.v1": { readonly sourceId: string; readonly jobId?: JobId };
  readonly "knowledge.recorded.v1": { readonly knowledgeId: string };
  readonly "agent.tools_configured.v1": { readonly agentId: AgentId; readonly toolIds: readonly ToolId[] };
  readonly "tool.dispatched.v1": { readonly jobId: JobId; readonly agentId: AgentId; readonly operationId: OperationId; readonly toolId: ToolId };
  readonly "tool.completed.v1": { readonly jobId: JobId; readonly operationId: OperationId; readonly toolId: ToolId };
  readonly "model.expense_recorded.v1": {
    readonly id: string;
    readonly jobId: JobId;
    readonly invocationId: string;
    readonly kind: "expense";
    readonly cost: { readonly version: 1; readonly currency: "USD"; readonly unit: "nanodollar"; readonly nanodollars: bigint };
    readonly description: "Model/API usage";
    readonly occurredAt: string;
  };
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
  readonly "model.usage_recorded": {
    readonly jobId: JobId;
    readonly invocationId: string;
    readonly provider: string;
    readonly model: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cachedInputTokens?: number;
    readonly requestId?: string;
  };
}

export type HQEventType = keyof HQEventPayloadMap;
