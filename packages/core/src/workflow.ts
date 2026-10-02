import type { BusinessId, WorkflowId } from "./ids.ts";

export type WorkflowStatus = "draft" | "active" | "archived";

/** Reusable orchestration identity; execution semantics will be defined by the runtime. */
export interface Workflow {
  readonly id: WorkflowId;
  readonly businessId: BusinessId;
  readonly name: string;
  readonly description: string;
  readonly status: WorkflowStatus;
}
