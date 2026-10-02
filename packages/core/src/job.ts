import type { AgentId, BusinessId, JobId, WorkflowId } from "./ids.ts";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface Job {
  readonly id: JobId;
  readonly businessId: BusinessId;
  readonly agentId?: AgentId;
  readonly workflowId?: WorkflowId;
  readonly objective: string;
  readonly status: JobStatus;
}
