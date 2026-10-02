import assert from "node:assert/strict";
import test from "node:test";

import {
  ids,
  type Agent,
  type Business,
  type Job,
} from "@hqoverlord/core";

import {
  correlationId,
} from "@hqoverlord/events";

import {
  AuthorityStore,
  commandId,
  RuntimeError,
  type CommandContext,
} from "../src/index.ts";

function contextFor(businessName: string): CommandContext {
  return {
    commandId: commandId(`command-${businessName}`),
    principal: {
      kind: "human",
      id: "operator-001",
    },
    businessId: ids.business(businessName),
    correlationId: correlationId(`correlation-${businessName}`),
  };
}

function expectScopeViolation(action: () => unknown): void {
  assert.throws(
    action,
    (error: unknown) =>
      error instanceof RuntimeError &&
      error.code === "BUSINESS_SCOPE_VIOLATION",
  );
}

test("business scope prevents access to another business agent and job", () => {
  const store = new AuthorityStore();

  const businessA: Business = {
    id: ids.business("business-a"),
    name: "Business A",
    status: "active",
    createdAt: "2026-10-02T12:00:00.000Z",
    updatedAt: "2026-10-02T12:00:00.000Z",
  };

  const businessB: Business = {
    id: ids.business("business-b"),
    name: "Business B",
    status: "active",
    createdAt: "2026-10-02T12:00:00.000Z",
    updatedAt: "2026-10-02T12:00:00.000Z",
  };

  const agentA: Agent = {
    id: ids.agent("agent-a"),
    businessId: businessA.id,
    name: "Agent A",
    status: "idle",
    capabilities: [],
    toolIds: [],
  };

  const agentB: Agent = {
    id: ids.agent("agent-b"),
    businessId: businessB.id,
    name: "Agent B",
    status: "idle",
    capabilities: [],
    toolIds: [],
  };

  const jobA: Job = {
    id: ids.job("job-a"),
    businessId: businessA.id,
    objective: "Work belonging to A",
    status: "queued",
  };

  const jobB: Job = {
    id: ids.job("job-b"),
    businessId: businessB.id,
    objective: "Work belonging to B",
    status: "queued",
  };

  store.addBusiness(businessA);
  store.addBusiness(businessB);
  store.addAgent(agentA);
  store.addAgent(agentB);
  store.addJob(jobA);
  store.addJob(jobB);

  const contextA = contextFor("business-a");

  assert.equal(store.requireAgent(contextA, agentA.id), agentA);
  assert.equal(store.requireJob(contextA, jobA.id), jobA);

  expectScopeViolation(() => store.requireAgent(contextA, agentB.id));
  expectScopeViolation(() => store.requireJob(contextA, jobB.id));
});

test("business-scoped lists never expose another business records", () => {
  const store = new AuthorityStore();

  const businessA: Business = {
    id: ids.business("business-a"),
    name: "Business A",
    status: "active",
    createdAt: "2026-10-02T12:00:00.000Z",
    updatedAt: "2026-10-02T12:00:00.000Z",
  };

  const businessB: Business = {
    id: ids.business("business-b"),
    name: "Business B",
    status: "active",
    createdAt: "2026-10-02T12:00:00.000Z",
    updatedAt: "2026-10-02T12:00:00.000Z",
  };

  const agentA: Agent = {
    id: ids.agent("agent-a"),
    businessId: businessA.id,
    name: "Agent A",
    status: "idle",
    capabilities: [],
    toolIds: [],
  };

  const agentB: Agent = {
    id: ids.agent("agent-b"),
    businessId: businessB.id,
    name: "Agent B",
    status: "idle",
    capabilities: [],
    toolIds: [],
  };

  const jobA: Job = {
    id: ids.job("job-a"),
    businessId: businessA.id,
    objective: "A job",
    status: "queued",
  };

  const jobB: Job = {
    id: ids.job("job-b"),
    businessId: businessB.id,
    objective: "B job",
    status: "queued",
  };

  store.addBusiness(businessA);
  store.addBusiness(businessB);
  store.addAgent(agentA);
  store.addAgent(agentB);
  store.addJob(jobA);
  store.addJob(jobB);

  const contextA = contextFor("business-a");

  assert.deepEqual(
    store.listAgents(contextA).map((agent) => agent.id),
    [agentA.id],
  );

  assert.deepEqual(
    store.listJobs(contextA).map((job) => job.id),
    [jobA.id],
  );
});

test("unknown business scope is rejected before scoped reads", () => {
  const store = new AuthorityStore();
  const missingContext = contextFor("business-missing");

  assert.throws(
    () => store.listAgents(missingContext),
    (error: unknown) =>
      error instanceof RuntimeError &&
      error.code === "BUSINESS_NOT_FOUND",
  );
});

test("authority snapshots create isolated working copies", () => {
  const original = new AuthorityStore();

  const businessA: Business = {
    id: ids.business("snapshot-business"),
    name: "Snapshot Business",
    status: "active",
    createdAt: "2026-10-02T12:00:00.000Z",
    updatedAt: "2026-10-02T12:00:00.000Z",
  };

  original.addBusiness(businessA);

  const workingCopy = original.clone();

  workingCopy.addAgent({
    id: ids.agent("working-agent"),
    businessId: businessA.id,
    name: "Working Agent",
    status: "idle",
    capabilities: [],
    toolIds: [],
  });

  const context: CommandContext = {
    commandId: commandId("snapshot-command"),
    principal: {
      kind: "system",
      id: "test-runtime",
    },
    businessId: businessA.id,
    correlationId: correlationId("snapshot-correlation"),
  };

  assert.equal(original.listAgents(context).length, 0);
  assert.equal(workingCopy.listAgents(context).length, 1);
});
