import type { BusinessId } from "@hqoverlord/core";
import type { HQEventPayloadMap, HQEventType } from "./catalog.ts";
import type { CorrelationId, EventId } from "./ids.ts";

/** Every current catalog event is business-scoped, including business creation. */
interface EventEnvelope<Type extends HQEventType> {
  readonly id: EventId;
  readonly type: Type;
  /** UTC ISO 8601 timestamp of the fact, not its display or delivery time. */
  readonly occurredAt: string;
  readonly businessId: BusinessId;
  /** Shared by events in the same operation or request chain. */
  readonly correlationId: CorrelationId;
  /** Immediate causal event, or null when this is a root event. */
  readonly causationId: EventId | null;
  readonly payload: HQEventPayloadMap[Type];
}

/** Mapped union preserves the type/payload relationship, including for subsets. */
export type HQEvent<Type extends HQEventType = HQEventType> = {
  [Key in Type]: EventEnvelope<Key>;
}[Type];
