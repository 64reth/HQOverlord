import type { Id } from "@hqoverlord/core";

export type EventId = Id<"Event">;
export type CorrelationId = Id<"Correlation">;

export function eventId(value: string): EventId {
  if (value.trim().length === 0) throw new TypeError("An event identifier must not be empty");
  return value as EventId;
}

export function correlationId(value: string): CorrelationId {
  if (value.trim().length === 0) throw new TypeError("A correlation identifier must not be empty");
  return value as CorrelationId;
}
