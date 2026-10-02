import assert from "node:assert/strict";
import test from "node:test";
import { currencyCode, ids, money } from "@hqoverlord/core";
import { correlationId, eventId } from "../src/index.ts";
import type { HQEvent } from "../src/index.ts";

const businessId = ids.business("business-1");
const chainId = correlationId("chain-1");
const occurredAt = "2026-10-02T12:00:00.000Z";

test("events retain business scope, correlation and immediate causation", () => {
  const created: HQEvent<"job.created"> = {
    id: eventId("event-1"), type: "job.created", occurredAt, businessId,
    correlationId: chainId, causationId: null,
    actor: { kind: "system", id: "test-system" },
    producer: "hq.runtime",
    payload: { jobId: ids.job("job-1"), objective: "Review", status: "queued" },
  };
  const started: HQEvent<"job.started"> = {
    id: eventId("event-2"), type: "job.started", occurredAt, businessId,
    correlationId: chainId, causationId: created.id,
    actor: { kind: "system", id: "test-system" },
    producer: "hq.runtime",
    payload: { jobId: created.payload.jobId, agentId: ids.agent("agent-1") },
  };
  assert.notEqual(created.id, started.id);
  assert.equal(started.businessId, created.businessId);
  assert.equal(started.correlationId, created.correlationId);
  assert.equal(started.causationId, created.id);
  assert.equal(created.causationId, null);
});

function describeFact(event: HQEvent): string {
  switch (event.type) {
    case "business.created": return event.payload.business.name;
    case "agent.created": return event.payload.name;
    case "job.created": return event.payload.objective;
    case "job.started":
    case "job.cancelled":
    case "job.completed": return event.payload.jobId;
    case "job.failed": return event.payload.error.message;
    case "approval.requested": return event.payload.approval.reason;
    case "approval.granted": return event.payload.operationId;
    case "approval.rejected": return event.payload.reason;
    case "ledger.entry_recorded": return event.payload.entry.amount.minorUnits.toString();
    case "model.usage_recorded": return event.payload.model;
    case "model.expense_recorded.v1": return event.payload.cost.nanodollars.toString();
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

test("event type narrows payload across the catalog", () => {
  const failed: HQEvent = {
    id: eventId("failed-1"), type: "job.failed", occurredAt, businessId,
    correlationId: chainId, causationId: eventId("started-1"),
    actor: { kind: "system", id: "test-system" },
    producer: "hq.runtime",
    payload: { jobId: ids.job("job-1"), error: { code: "TOOL_UNAVAILABLE", message: "Tool unavailable" } },
  };
  const recorded: HQEvent = {
    id: eventId("recorded-1"), type: "ledger.entry_recorded", occurredAt, businessId,
    correlationId: chainId, causationId: null,
    actor: { kind: "system", id: "test-system" },
    producer: "hq.runtime",
    payload: { entry: {
      id: ids.ledgerEntry("entry-1"), businessId, kind: "expense", amount: money(1234n, currencyCode("GBP")),
      description: "Payment made", occurredAt,
    } },
  };
  assert.equal(describeFact(failed), "Tool unavailable");
  assert.equal(describeFact(recorded), "1234");
});

test("event and correlation identifier factories reject empty values", () => {
  assert.throws(() => eventId(""), TypeError);
  assert.throws(() => correlationId("  "), TypeError);
});
