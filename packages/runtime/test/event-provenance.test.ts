import assert from "node:assert/strict";
import test from "node:test";

import {
  ids,
  type Business,
} from "@hqoverlord/core";

import {
  correlationId,
  eventId,
} from "@hqoverlord/events";

import {
  AuthorityStore,
} from "../src/authority-store.ts";

import {
  CommandService,
} from "../src/command-service.ts";

import {
  commandId,
  type CommandContext,
} from "../src/command-context.ts";

import type {
  RuntimeClock,
  RuntimeIds,
} from "../src/runtime-environment.ts";

const occurredAt =
  "2026-10-02T12:00:00.000Z";

function environment(): {
  clock: RuntimeClock;
  ids: RuntimeIds;
} {
  let agentNumber = 0;
  let jobNumber = 0;
  let eventNumber = 0;

  return {
    clock: {
      now: () => occurredAt,
    },

    ids: {
      agent: () =>
        ids.agent(
          `provenance-agent-${++agentNumber}`,
        ),

      job: () =>
        ids.job(
          `provenance-job-${++jobNumber}`,
        ),

      event: () =>
        eventId(
          `provenance-event-${++eventNumber}`,
        ),
    },
  };
}

function context(
  business: Business,
  principal: CommandContext["principal"],
): CommandContext {
  return {
    commandId: commandId(
      `command-${principal.kind}-${principal.id}`,
    ),

    principal,

    businessId: business.id,

    correlationId: correlationId(
      `correlation-${principal.kind}-${principal.id}`,
    ),
  };
}

function setup() {
  const business: Business = {
    id: ids.business(
      "provenance-business",
    ),

    name: "Provenance Business",
    status: "active",
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };

  const store = new AuthorityStore();

  store.addBusiness(business);

  const runtime = environment();

  const service = new CommandService(
    store,
    runtime.clock,
    runtime.ids,
  );

  return {
    business,
    service,
  };
}

test(
  "events record the trusted human principal as actor",
  () => {
    const {
      business,
      service,
    } = setup();

    const result = service.createAgent(
      context(
        business,
        {
          kind: "human",
          id: "owner-1",
        },
      ),
      {
        name: "Researcher",
      },
    );

    assert.deepEqual(
      result.event.actor,
      {
        kind: "human",
        id: "owner-1",
      },
    );

    assert.equal(
      result.event.producer,
      "hq.runtime",
    );
  },
);

test(
  "agent initiated commands preserve agent provenance",
  () => {
    const {
      business,
      service,
    } = setup();

    const result = service.createJob(
      context(
        business,
        {
          kind: "agent",
          id: "agent-controller",
        },
      ),
      {
        objective:
          "Prepare a research brief",
      },
    );

    assert.deepEqual(
      result.event.actor,
      {
        kind: "agent",
        id: "agent-controller",
      },
    );

    assert.equal(
      result.event.producer,
      "hq.runtime",
    );
  },
);

test(
  "system initiated commands preserve system provenance",
  () => {
    const {
      business,
      service,
    } = setup();

    const result = service.createJob(
      context(
        business,
        {
          kind: "system",
          id: "scheduler",
        },
      ),
      {
        objective:
          "Run scheduled maintenance",
      },
    );

    assert.deepEqual(
      result.event.actor,
      {
        kind: "system",
        id: "scheduler",
      },
    );

    assert.equal(
      result.event.producer,
      "hq.runtime",
    );
  },
);
