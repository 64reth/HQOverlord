import type { BusinessId, JobId, LedgerEntryId } from "./ids.ts";
import type { Money } from "./money.ts";

export type LedgerEntryKind = "revenue" | "expense";

/** Recorded economic activity, never an estimate or a planned transaction. */
export interface LedgerEntry {
  readonly id: LedgerEntryId;
  readonly businessId: BusinessId;
  readonly jobId?: JobId;
  readonly kind: LedgerEntryKind;
  readonly amount: Money;
  readonly description: string;
  readonly occurredAt: string;
}
