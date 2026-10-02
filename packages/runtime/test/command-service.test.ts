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
  CommandService,
  RuntimeError,
  commandId,
  type CommandContext,
  type RuntimeClock,
  type RuntimeIds,
} from "../src/index.ts";

const fixedTime = "2026-10-02T12:00:00.000Z";

function contextFor(name: string): CommandContext {
  return {
    commandId: commandId(`command-${name}`),
    principal: {
      kind: "human",
      id: "operator-001",
    },
    businessId: ids.business(name),
    correlationId: correlationId(`correlation-${name}`),
  };
}

function business(name: string): Business {
  return {
    id: ids.business(name),
    name,
    status: "active",
    createdAt: fixedTime,
    updatedAt: fixedTime,
  };
}

function deterministicEnvironment(): {
  clock: RuntimeClock;
  ids: RuntimeIds;
} {
  let agentSequence = 0;
  let jobSequence = 0;
  let eventSequence = 0;

  return {
    clock: {
      now: () => fixedTime,
    },
    ids: {
      agent: () => ids.agent(`generated-agent-${++agentSequence}`),
      job: () => ids.job(`generated-job-${++jobSequence}`),
      event: () => eventId(`generated-event-${++eventSequence}`),
    },
  };
}

test("createAgent derives canonical scope, state and event metadata", () => {
  const store = new AuthorityStore();
  const businessA = business("business-a");

  store.addBusiness(businessA);

  const environment = deterministicEnvironment();
  const service = new CommandService(
    store,
    environment.clock,
    environment.ids,
  );

  const context = contextFor("business-a");

  const result = service.createAgent(context, {
    name: "  Researcher  ",
    capabilities: ["research"],
  });

  assert.equal(result.record.id, ids.agent("generated-agent-1"));
  assert.equal(result.record.businessId, businessA.id);
  assert.equal(result.record.name, "Researcher");
  assert.equal(result.record.status, "idle");

  assert.equal(result.event.type, "agent.created");
  assert.equal(result.event.businessId, businessA.id);
  assert.equal(result.event.correlationId, context.correlationId);
  assert.equal(result.event.causationId, null);
  assert.equal(result.event.occurredAt, fixedTime);

  assert.deepEqual(result.event.payload, {
    agentId: result.record.id,
    name: result.record.name,
    status: result.record.status,
    capabilities: result.record.capabilities,
    toolIds: result.record.toolIds,
  });

  assert.deepEqual(
    store.listAgents(context).map((agent) => agent.id),
    [result.record.id],
  );
});

test("createJob accepts an agent owned by the authorised business", () => {
  const store = new AuthorityStore();
  const businessA = business("business-a");

  store.addBusiness(businessA);

  const environment = deterministicEnvironment();
  const service = new CommandService(
    store,
    environment.clock,
    environment.ids,
  );

  const context = contextFor("business-a");

  const agent = service.createAgent(context, {
    name: "Writer",
  }).record;

  const result = service.createJob(context, {
    objective: "  Draft article  ",
    agentId: agent.id,
  });

  assert.equal(result.record.id, ids.job("generated-job-1"));
  assert.equal(result.record.businessId, businessA.id);
  assert.equal(result.record.agentId, agent.id);
  assert.equal(result.record.objective, "Draft article");
  assert.equal(result.record.status, "queued");

  assert.equal(result.event.type, "job.created");
  assert.equal(result.event.businessId, businessA.id);
  assert.equal(result.event.correlationId, context.correlationId);
  assert.equal(result.event.payload.jobId, result.record.id);
  assert.equal(result.event.payload.agentId, agent.id);
});

test("cross-business agent assignment is rejected without creating a job", () => {
  const store = new AuthorityStore();

  store.addBusiness(business("business-a"));
  store.addBusiness(business("business-b"));

  const environment = deterministicEnvironment();
  const service = new CommandService(
    store,
    environment.clock,
    environment.ids,
  );

  const contextA = contextFor("business-a");
  const contextB = contextFor("business-b");

  const agentB = service.createAgent(contextB, {
    name: "Business B Worker",
  }).record;

  const jobsBefore = store.listJobs(contextA);

  assert.throws(
    () =>
      service.createJob(contextA, {
        objective: "Cross the boundary",
        agentId: agentB.id,
      }),
    (error: unknown) =>
      error instanceof RuntimeError &&
      error.code === "BUSINESS_SCOPE_VIOLATION",
  );

  const jobsAfter = store.listJobs(contextA);

  assert.deepEqual(jobsAfter, jobsBefore);
  assert.equal(jobsAfter.length, 0);
});

test("invalid command input does not mutate runtime state", () => {
  const store = new AuthorityStore();
  store.addBusiness(business("business-a"));

  const environment = deterministicEnvironment();
  const service = new CommandService(
    store,
    environment.clock,
    environment.ids,
  );

  const context = contextFor("business-a");

  assert.throws(
    () => service.createAgent(context, { name: "   " }),
    /Agent name must not be empty/,
  );

  assert.throws(
    () => service.createJob(context, { objective: "   " }),
    /Job objective must not be empty/,
  );

  assert.equal(store.listAgents(context).length, 0);
  assert.equal(store.listJobs(context).length, 0);
});
