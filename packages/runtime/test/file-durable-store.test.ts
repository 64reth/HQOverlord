import assert from "node:assert/strict";
import test from "node:test";

import {
  mkdtemp,
  rm,
} from "node:fs/promises";

import {
  join,
} from "node:path";

import {
  tmpdir,
} from "node:os";

import {
  ids,
  type Business,
  type Job,
} from "@hqoverlord/core";

import {
  correlationId,
  eventId,
  type HQEvent,
} from "@hqoverlord/events";

import {
  FileDurableStore,
  type DurableState,
} from "../src/index.ts";

const occurredAt = "2026-10-02T12:00:00.000Z";

test("file durable store survives a fresh store instance", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "hqoverlord-store-"),
  );

  try {
    const path = join(directory, "hq-state.json");

    const business: Business = {
      id: ids.business("business-a"),
      name: "Business A",
      status: "active",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };

    const job: Job = {
      id: ids.job("job-a"),
      businessId: business.id,
      objective: "Survive restart",
      status: "queued",
    };

    const fact: HQEvent<"job.created"> = {
      id: eventId("event-a"),
      type: "job.created",
      occurredAt,
      businessId: business.id,
      correlationId: correlationId("correlation-a"),
      causationId: null,
      actor: { kind: "system", id: "test-system" },
      producer: "hq.runtime",
      payload: {
        jobId: job.id,
        objective: job.objective,
        status: "queued",
      },
    };

    const state: DurableState = {
      version: 1,
      authority: {
        businesses: [business],
        agents: [],
        jobs: [job],
      },
      facts: [fact],
      processedCommands: [
        {
          commandId: "command-a",
          businessId: business.id,
          inputFingerprint: "fingerprint-a",
          eventIds: [fact.id],
          result: {
            kind: "job",
            recordId: job.id,
          },
        },
      ],
    };

    const firstRuntime = new FileDurableStore(path);

    await firstRuntime.save(state);

    // A completely new instance represents HQ starting again later.
    const restartedRuntime = new FileDurableStore(path);
    const restored = await restartedRuntime.load();

    assert.deepEqual(restored, state);
    assert.equal(restored.authority.jobs[0]?.objective, "Survive restart");
    assert.equal(restored.facts[0]?.id, fact.id);
    assert.equal(
      restored.processedCommands[0]?.commandId,
      "command-a",
    );
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    });
  }
});

test("missing durable file starts as empty state", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "hqoverlord-empty-"),
  );

  try {
    const path = join(directory, "does-not-exist.json");
    const store = new FileDurableStore(path);

    const state = await store.load();

    assert.equal(state.version, 1);
    assert.deepEqual(state.authority.businesses, []);
    assert.deepEqual(state.authority.agents, []);
    assert.deepEqual(state.authority.jobs, []);
    assert.deepEqual(state.facts, []);
    assert.deepEqual(state.processedCommands, []);
  } finally {
    await rm(directory, {
      recursive: true,
      force: true,
    });
  }
});


