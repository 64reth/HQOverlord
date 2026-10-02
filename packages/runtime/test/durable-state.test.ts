import assert from "node:assert/strict";
import test from "node:test";

import {
  currencyCode,
  ids,
  money,
  type Business,
} from "@hqoverlord/core";

import {
  correlationId,
  eventId,
  type HQEvent,
} from "@hqoverlord/events";

import {
  decodeDurableState,
  encodeDurableState,
  emptyDurableState,
  type DurableState,
} from "../src/index.ts";

const occurredAt = "2026-10-02T12:00:00.000Z";

test("empty durable state round-trips through JSON", () => {
  const original = emptyDurableState();

  const restored = decodeDurableState(
    encodeDurableState(original),
  );

  assert.deepEqual(restored, original);
});

test("durable state preserves authority, facts and processed commands", () => {
  const business: Business = {
    id: ids.business("business-a"),
    name: "Business A",
    status: "active",
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };

  const ledgerFact: HQEvent<"ledger.entry_recorded"> = {
    id: eventId("event-ledger-1"),
    type: "ledger.entry_recorded",
    occurredAt,
    businessId: business.id,
    correlationId: correlationId("correlation-1"),
    causationId: null,
    actor: { kind: "system", id: "test-system" },
    producer: "hq.runtime",
    payload: {
      entry: {
        id: ids.ledgerEntry("ledger-1"),
        businessId: business.id,
        kind: "revenue",
        amount: money(
          900719925474099312345678901234567890n,
          currencyCode("GBP"),
        ),
        description: "Exact revenue",
        occurredAt,
      },
    },
  };

  const original: DurableState = {
    version: 1,
    authority: {
      businesses: [business],
      agents: [],
      jobs: [],
    },
    facts: [ledgerFact],
    processedCommands: [
      {
        commandId: "command-1",
        businessId: business.id,
        inputFingerprint: "fingerprint-1",
        eventIds: [ledgerFact.id],
        result: {
          kind: "job",
          recordId: "job-result-1",
        },
      },
    ],
  };

  const serialized = encodeDurableState(original);
  const restored = decodeDurableState(serialized);

  assert.deepEqual(restored, original);

  const restoredFact = restored.facts[0];

  assert.ok(restoredFact);
  assert.equal(restoredFact.type, "ledger.entry_recorded");

  if (restoredFact.type === "ledger.entry_recorded") {
    assert.equal(
      restoredFact.payload.entry.amount.minorUnits,
      900719925474099312345678901234567890n,
    );
  }
});

test("durable state rejects unsupported versions", () => {
  assert.throws(
    () =>
      decodeDurableState(
        JSON.stringify({
          version: 999,
          authority: {
            businesses: [],
            agents: [],
            jobs: [],
          },
          facts: [],
          processedCommands: [],
        }),
      ),
    /Unsupported durable state version/,
  );
});

