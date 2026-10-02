import type { ApprovalId, BusinessId, JobId, OperationId } from "./ids.ts";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

/** Records an approval requirement. Only the host may enforce or resolve it. */
export interface Approval {
  readonly id: ApprovalId;
  readonly businessId: BusinessId;
  readonly operationId: OperationId;
  readonly jobId?: JobId;
  readonly reason: string;
  readonly status: ApprovalStatus;
}
