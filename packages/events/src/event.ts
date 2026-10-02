import type {
  BusinessId,
} from "@hqoverlord/core";

import type {
  HQEventPayloadMap,
  HQEventType,
} from "./catalog.ts";

import type {
  CorrelationId,
  EventId,
} from "./ids.ts";

export type EventActor =
  | {
      readonly kind: "human";
      readonly id: string;
    }
  | {
      readonly kind: "agent";
      readonly id: string;
    }
  | {
      readonly kind: "system";
      readonly id: string;
    };

interface EventEnvelope<
  Type extends HQEventType,
> {
  readonly id: EventId;
  readonly type: Type;
  readonly occurredAt: string;

  readonly businessId: BusinessId;

  readonly correlationId: CorrelationId;
  readonly causationId: EventId | null;

  /**
   * The trusted principal that caused or authorised
   * this fact to be produced.
   */
  readonly actor: EventActor;

  /**
   * The trusted HQ component that emitted the fact.
   * This is host-owned metadata, never model supplied.
   */
  readonly producer: string;

  readonly payload: HQEventPayloadMap[Type];
}

export type HQEvent<
  Type extends HQEventType = HQEventType,
> = {
  [Key in Type]: EventEnvelope<Key>;
}[Type];
