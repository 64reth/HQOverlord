import { ids } from "@hqoverlord/core";
import { correlationId, eventId } from "../src/index.ts";
import type { HQEvent } from "../src/index.ts";

export function checkEventContracts(event: HQEvent): void {
  if (event.type === "job.failed") {
    const message: string = event.payload.error.message;
    // @ts-expect-error Narrowing excludes unrelated payloads.
    event.payload.entry;
    void message;
  }
  const envelope = {
    id: eventId("event-1"), occurredAt: "2026-10-02T12:00:00.000Z", businessId: ids.business("business-1"),
    correlationId: correlationId("chain-1"), causationId: null,
  };
  // @ts-expect-error Event type and payload cannot be independently selected.
  const mismatched: HQEvent = { ...envelope, type: "job.completed", payload: { agent: {} } };
  const { correlationId: omittedCorrelation, ...withoutCorrelation } = envelope;
  // @ts-expect-error Every event carries correlation information.
  const missingCorrelation: HQEvent = { ...withoutCorrelation, type: "job.completed", payload: { jobId: ids.job("job-1") } };
  const { causationId: omittedCausation, ...withoutCausation } = envelope;
  // @ts-expect-error Root events explicitly use null; causation must not be omitted.
  const missingCausation: HQEvent = { ...withoutCausation, type: "job.completed", payload: { jobId: ids.job("job-1") } };
  // @ts-expect-error Correlation IDs are distinct from event IDs.
  const wrongCorrelation: HQEvent = { ...envelope, correlationId: eventId("event-2"), type: "job.completed", payload: { jobId: ids.job("job-1") } };
  // @ts-expect-error An already completed job cannot be announced as a queued job creation.
  const wrongInitialState: HQEvent<"job.created"> = { ...envelope, type: "job.created", payload: { job: { id: ids.job("j"), businessId: envelope.businessId, objective: "Work", status: "completed" } } };
  void [mismatched, omittedCorrelation, missingCorrelation, omittedCausation, missingCausation, wrongCorrelation, wrongInitialState];
}
